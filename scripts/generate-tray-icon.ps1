$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets'
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null
$images = @()
foreach ($size in @(16, 20, 24, 32, 48, 64, 256)) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform(($size / 32.0), ($size / 32.0))
  $outline = New-Object System.Drawing.Drawing2D.GraphicsPath
  $outline.AddArc(1, 1, 12, 12, 180, 90)
  $outline.AddArc(19, 1, 12, 12, 270, 90)
  $outline.AddArc(19, 19, 12, 12, 0, 90)
  $outline.AddArc(1, 19, 12, 12, 90, 90)
  $outline.CloseFigure()
  $fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush([System.Drawing.Point]::new(0, 0), [System.Drawing.Point]::new(32, 32), [System.Drawing.Color]::FromArgb(255, 53, 67, 93), [System.Drawing.Color]::FromArgb(255, 16, 22, 36))
  $edge = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 144, 237, 250), 1)
  $letter = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 2.6)
  $letter.StartCap = $letter.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $letter.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $points = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(7, 10), [System.Drawing.PointF]::new(10.5, 23), [System.Drawing.PointF]::new(16, 14), [System.Drawing.PointF]::new(21.5, 23), [System.Drawing.PointF]::new(25, 10))
  $graphics.FillPath($fill, $outline)
  $graphics.DrawPath($edge, $outline)
  $graphics.DrawLines($letter, $points)
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += @{ Size = $size; Bytes = $stream.ToArray() }
  if ($size -eq 32) { [System.IO.File]::WriteAllBytes((Join-Path $assetDirectory 'tray.png'), $stream.ToArray()) }
  if ($size -eq 256) { [System.IO.File]::WriteAllBytes((Join-Path $assetDirectory 'logo.png'), $stream.ToArray()) }
  $stream.Dispose(); $letter.Dispose(); $edge.Dispose(); $fill.Dispose(); $outline.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$iconStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($iconStream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($image in $images) {
  $dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
  $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$image.Bytes.Length); $writer.Write([uint32]$offset)
  $offset += $image.Bytes.Length
}
foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
[System.IO.File]::WriteAllBytes((Join-Path $assetDirectory 'tray.ico'), $iconStream.ToArray())
$writer.Dispose(); $iconStream.Dispose()
