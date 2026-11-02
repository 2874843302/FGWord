param([long]$WindowHandle)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MouseWindowStyle {
  [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)]
  public static extern int GetWindowLong(IntPtr window, int index);
}
'@
$style = [MouseWindowStyle]::GetWindowLong([IntPtr]$WindowHandle, -20)
if ($style -eq 0) { throw 'Unable to read native window style' }
if (($style -band 0x20) -ne 0) { Write-Output 'transparent' } else { Write-Output 'interactive' }
