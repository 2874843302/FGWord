$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$reportDirectory = Join-Path $projectRoot '.test/report'
New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
$clipboardAvailable = $true; $original = $null; try { $original = [System.Windows.Forms.Clipboard]::GetDataObject() } catch { $clipboardAvailable = $false }
$originalBackup = New-Object System.Windows.Forms.DataObject
if ($original) {
  foreach ($format in $original.GetFormats($false)) {
    $value = $original.GetData($format, $false)
    if ($value -is [System.IO.MemoryStream]) { $value = [System.IO.MemoryStream]::new($value.ToArray()) }
    elseif ($value -is [System.Drawing.Bitmap]) { $value = $value.Clone() }
    if ($null -ne $value) { $originalBackup.SetData($format, $false, $value) }
  }
}
$sentinel = 'Word Glass native selection test clipboard'
$html = '<b>Word Glass clipboard HTML fixture</b>'
$results = New-Object System.Collections.Generic.List[object]
try {
  foreach ($compatibilityMode in $(if ($clipboardAvailable) { @($false, $true) } else { @($false) })) {
    $fixture = New-Object System.Windows.Forms.DataObject
    $fixture.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $sentinel)
    $fixture.SetData([System.Windows.Forms.DataFormats]::Html, $html)
    if ($clipboardAvailable) { [System.Windows.Forms.Clipboard]::SetDataObject($fixture, $true) }
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Word Glass selection verification'
    $form.Size = New-Object System.Drawing.Size(360, 120)
    $form.StartPosition = 'CenterScreen'
    $form.TopMost = $true
    $textbox = New-Object System.Windows.Forms.TextBox
    $textbox.Text = 'resilient'; $textbox.Multiline = $true
    $textbox.Dock = 'Fill'
    $textbox.Font = New-Object System.Drawing.Font('Segoe UI', 20)
    $form.Controls.Add($textbox)
    $captureOutput = Join-Path $reportDirectory "native-selection-$compatibilityMode.json"
    $captureError = Join-Path $reportDirectory "native-selection-$compatibilityMode.err.log"
    $arguments = @('-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $projectRoot 'scripts/capture-selection.ps1'))
    if ($compatibilityMode) { $arguments += '-ClipboardOnly' } else { $arguments += @('-TargetWindow', $textbox.Handle.ToInt64().ToString()) }
    $context = @{ process = $null; started = $false; error = $null }
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 100
    $form.Add_Shown({ $textbox.Focus() | Out-Null; $textbox.SelectAll(); $timer.Start() })
    $timer.Add_Tick({
      if (-not $context.started) {
        $context.started = $true
        $context.process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $captureOutput -RedirectStandardError $captureError -PassThru
      } elseif ($context.process.HasExited) { $timer.Stop(); $form.Close() }
    })
    [System.Windows.Forms.Application]::Run($form)
    $timer.Dispose(); $form.Dispose()
    $result = Get-Content -LiteralPath $captureOutput -Raw -Encoding utf8 | ConvertFrom-Json
    if (-not $result.ok -or $result.text -ne 'resilient') { throw "Native selection failed: $($result.error)" }
    if ($clipboardAvailable -and [System.Windows.Forms.Clipboard]::GetText() -ne $sentinel) { throw 'Clipboard text was not restored' }
    if ($clipboardAvailable -and [System.Windows.Forms.Clipboard]::GetData([System.Windows.Forms.DataFormats]::Html) -ne $html) { throw 'Clipboard HTML was not restored' }
    $restored = if ($clipboardAvailable) { $true } else { $null }
    $results.Add(@{ passed = $true; method = $result.method; compatibilityMode = $compatibilityMode; clipboardTextRestored = $restored; clipboardHtmlRestored = $restored; clipboardAccessAvailable = $clipboardAvailable; targetMode = 'explicit handle of an isolated external WinForms edit control' })
  }
} finally {
  if ($clipboardAvailable -and [System.Windows.Forms.Clipboard]::GetText() -eq $sentinel) {
    if ($original) { [System.Windows.Forms.Clipboard]::SetDataObject($originalBackup, $true) }
    else { [System.Windows.Forms.Clipboard]::Clear() }
  }
}
$results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportDirectory 'selection-native.json') -Encoding utf8
$results | ConvertTo-Json -Compress
