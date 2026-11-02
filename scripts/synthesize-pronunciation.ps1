$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($request.word) -or $request.word.Length -gt 100) { throw 'Invalid pronunciation text' }
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$stream = New-Object System.IO.MemoryStream
try {
  $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*' } |
    Sort-Object @{Expression={if ($_.VoiceInfo.Culture.Name -eq 'en-US') { 0 } else { 1 }}} | Select-Object -First 1
  if (-not $voice) { throw 'No English speech voice installed in Windows' }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  $synth.Rate = 0
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToAudioStream($stream, $format)
  $synth.Speak([string]$request.word)
  $bytes = $stream.ToArray()
  @{ voice = $voice.VoiceInfo.Name; locale = $voice.VoiceInfo.Culture.Name; pcm = [Convert]::ToBase64String($bytes) } | ConvertTo-Json -Compress
} finally {
  $synth.Dispose()
  $stream.Dispose()
}
