param([int]$ExcludedProcessId = 0, [switch]$ClipboardOnly, [long]$TargetWindow = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WordGlassSelectionNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GUIINFO {
    public uint Size, Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public RECT CaretRect;
  }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GUIINFO info);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
  public static string ReadEditSelection(IntPtr requestedWindow) {
    GUIINFO info = new GUIINFO(); info.Size = (uint)Marshal.SizeOf(info);
    if (requestedWindow != IntPtr.Zero) info.Focus = requestedWindow; else if (!GetGUIThreadInfo(0, ref info) || info.Focus == IntPtr.Zero) return null;
    var name = new StringBuilder(256); GetClassName(info.Focus, name, name.Capacity);
    if (name.ToString().IndexOf("EDIT", StringComparison.OrdinalIgnoreCase) < 0) return null;
    if ((GetWindowLong(info.Focus, -16) & 0x20) != 0) throw new Exception("不能读取密码输入框");
    IntPtr startPointer = Marshal.AllocHGlobal(4), endPointer = Marshal.AllocHGlobal(4), buffer = IntPtr.Zero, result;
    try {
      Marshal.WriteInt32(startPointer, 0); Marshal.WriteInt32(endPointer, 0);
      if (SendMessageTimeout(info.Focus, 0xB0, startPointer, endPointer, 2, 300, out result) == IntPtr.Zero) return null;
      int start = Marshal.ReadInt32(startPointer), end = Marshal.ReadInt32(endPointer); if (start == end && result.ToInt64() >= 0) { start = (int)(result.ToInt64() & 0xffff); end = (int)((result.ToInt64() >> 16) & 0xffff); }
      if (start < 0 || end <= start || end - start > 1024 || end > 100000) return null;
      buffer = Marshal.AllocHGlobal((end + 1) * 2);
      if (SendMessageTimeout(info.Focus, 0xD, (IntPtr)(end + 1), buffer, 2, 300, out result) == IntPtr.Zero) return null;
      var text = Marshal.PtrToStringUni(buffer, result.ToInt32());
      return text.Length >= end ? text.Substring(start, end - start) : null;
    } finally {
      Marshal.FreeHGlobal(startPointer); Marshal.FreeHGlobal(endPointer);
      if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
    }
  }
  public static void Copy() {
    keybd_event(0x11, 0, 0, UIntPtr.Zero);
    keybd_event(0x43, 0, 0, UIntPtr.Zero);
    keybd_event(0x43, 0, 2, UIntPtr.Zero);
    keybd_event(0x11, 0, 2, UIntPtr.Zero);
  }
}
'@

$ownedSequence = $null
$backup = $null
$hadClipboard = $false
try {
  $foreground = [WordGlassSelectionNative]::GetForegroundWindow()
  [uint32]$foregroundPid = 0
  [WordGlassSelectionNative]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid) | Out-Null
  if ($foregroundPid -eq $ExcludedProcessId) { throw '请先在其他应用里选中英文单词，再按快捷键' }

  # Prefer accessibility text selection: this does not touch the clipboard.
  $selectedText = ''
  $captureMethod = 'accessibility'
  if (-not $ClipboardOnly) {
    $selectedText = [WordGlassSelectionNative]::ReadEditSelection([IntPtr]$TargetWindow)
    if (-not [string]::IsNullOrWhiteSpace($selectedText)) { $captureMethod = 'native-edit' }
  }
  try {
    if ($ClipboardOnly -or -not [string]::IsNullOrWhiteSpace($selectedText)) { throw 'Skip accessibility mode' }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $element = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($element.Current.IsPassword) { throw '不能读取密码输入框' }
    for ($level = 0; $element -and $level -lt 5; $level++) {
      $pattern = $null
      if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
        $ranges = $pattern.GetSelection()
        if ($ranges.Count -gt 0) { $selectedText = $ranges[0].GetText(1024) }
        if (-not [string]::IsNullOrWhiteSpace($selectedText)) { break }
      }
      $element = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
    }
  } catch {
    if ($_.Exception.Message -eq '不能读取密码输入框') { throw }
  }

  if ([string]::IsNullOrWhiteSpace($selectedText)) {
    $captureMethod = 'copy'
    # Wait for the shortcut's modifier keys to be released before sending Ctrl+C.
    $deadline = [DateTime]::UtcNow.AddMilliseconds(1400)
    do {
      $held = @(0x10, 0x11, 0x12, 0x5B, 0x5C) | Where-Object {
        ([WordGlassSelectionNative]::GetAsyncKeyState($_) -band 0x8000) -ne 0
      }
      if ($held.Count -eq 0) { break }
      Start-Sleep -Milliseconds 20
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($held.Count -ne 0) { throw '请松开快捷键后再试一次' }
    if ([WordGlassSelectionNative]::GetForegroundWindow() -ne $foreground) { throw '前台应用已切换，请重新选词' }

    # Eagerly copy all available formats before replacing the clipboard.
    $original = [System.Windows.Forms.Clipboard]::GetDataObject()
    $backup = New-Object System.Windows.Forms.DataObject
    if ($original) {
      $hadClipboard = $true
      foreach ($format in $original.GetFormats($false)) {
        $value = $original.GetData($format, $false)
        if ($value -is [System.IO.MemoryStream]) { $value = [System.IO.MemoryStream]::new($value.ToArray()) }
        elseif ($value -is [System.Drawing.Bitmap]) { $value = $value.Clone() }
        if ($null -ne $value) { $backup.SetData($format, $false, $value) }
      }
    }
    $beforeCopy = [WordGlassSelectionNative]::GetClipboardSequenceNumber()
    [WordGlassSelectionNative]::Copy()
    $deadline = [DateTime]::UtcNow.AddMilliseconds(900)
    do {
      Start-Sleep -Milliseconds 30
      $sequence = [WordGlassSelectionNative]::GetClipboardSequenceNumber()
    } while ($sequence -eq $beforeCopy -and [DateTime]::UtcNow -lt $deadline)
    if ($sequence -eq $beforeCopy) { throw '未读取到选中文字，请选中后再试，或先复制单词' }
    $ownedSequence = $sequence
    $selectedText = [System.Windows.Forms.Clipboard]::GetText()
    if ([string]::IsNullOrWhiteSpace($selectedText)) { throw '选中的内容不是文字，请重新选择英文单词' }
  }
  $result = @{ ok = $true; text = $selectedText; method = $captureMethod }
} catch {
  $result = @{ ok = $false; error = $_.Exception.Message }
} finally {
  # Do not replace newer clipboard content copied by the user during capture.
  if ($null -ne $ownedSequence -and [WordGlassSelectionNative]::GetClipboardSequenceNumber() -eq $ownedSequence) {
    try {
      if ($hadClipboard) { [System.Windows.Forms.Clipboard]::SetDataObject($backup, $true, 5, 30) }
      else { [System.Windows.Forms.Clipboard]::Clear() }
    } catch { $result = @{ ok = $false; error = '恢复剪贴板失败，请先复制单词后使用「从剪贴板添加」' } }
  }
}
$result | ConvertTo-Json -Compress
