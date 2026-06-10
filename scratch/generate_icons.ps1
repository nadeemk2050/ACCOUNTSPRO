Add-Type -AssemblyName System.Drawing

# 1. Generate 512x512 Icon
$bmp512 = New-Object System.Drawing.Bitmap(512, 512)
$g512 = [System.Drawing.Graphics]::FromImage($bmp512)
$g512.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$rect512 = New-Object System.Drawing.RectangleF(0, 0, 512, 512)
$brush512 = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect512, [System.Drawing.Color]::FromArgb(30, 27, 75), [System.Drawing.Color]::FromArgb(67, 56, 202), 45.0)
$g512.FillRectangle($brush512, $rect512)

$pen512 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(129, 140, 248), 12)
$g512.DrawEllipse($pen512, 24, 24, 464, 464)

$font512 = New-Object System.Drawing.Font("Segoe UI", 160, [System.Drawing.FontStyle]::Bold)
$textBrush = [System.Drawing.Brushes]::White
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$g512.DrawString("QP", $font512, $textBrush, $rect512, $sf)

$g512.Dispose()
$bmp512.Save("c:\app2026\accountspro\quickaccpro\public\icons\icon-512x512.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp512.Dispose()

# 2. Generate 192x192 Icon
$bmp192 = New-Object System.Drawing.Bitmap(192, 192)
$g192 = [System.Drawing.Graphics]::FromImage($bmp192)
$g192.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$rect192 = New-Object System.Drawing.RectangleF(0, 0, 192, 192)
$brush192 = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect192, [System.Drawing.Color]::FromArgb(30, 27, 75), [System.Drawing.Color]::FromArgb(67, 56, 202), 45.0)
$g192.FillRectangle($brush192, $rect192)

$pen192 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(129, 140, 248), 5)
$g192.DrawEllipse($pen192, 8, 8, 176, 176)

$font192 = New-Object System.Drawing.Font("Segoe UI", 64, [System.Drawing.FontStyle]::Bold)
$g192.DrawString("QP", $font192, $textBrush, $rect192, $sf)

$g192.Dispose()
$bmp192.Save("c:\app2026\accountspro\quickaccpro\public\icons\icon-192x192.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp192.Dispose()

Write-Output "PWA Icons generated successfully!"
