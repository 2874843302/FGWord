param([string]$EntryName)
if ($EntryName -notmatch '^WordGlass-QA-\d+-\d+$') { throw 'Only an isolated QA startup entry may be launched' }
$runKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
try { $command = $runKey.GetValue($EntryName) } finally { $runKey.Dispose() }
if (-not $command) { throw 'QA startup command was not registered' }
$launcher = New-Object -ComObject WScript.Shell
$launcher.Run($command, 0, $false) | Out-Null
