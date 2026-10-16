# Gera os ícones do site (EX branco no quadrado laranja do grupo) em site\icones\.
# Uso: powershell -File ferramentas\gerar-icones.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$pasta = Join-Path (Split-Path -Parent $PSScriptRoot) 'site\icones'
New-Item -ItemType Directory -Force $pasta | Out-Null
$laranja = [System.Drawing.Color]::FromArgb(255, 0xC0, 0x66, 0x2B)

function Gerar([int]$lado, [string]$nome, [bool]$mascara) {
    $bmp = New-Object System.Drawing.Bitmap $lado, $lado, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::Transparent)
    $pincel = New-Object System.Drawing.SolidBrush $laranja
    if ($mascara) {
        $g.FillRectangle($pincel, 0, 0, $lado, $lado)
        $tamanhoTexto = $lado * 0.30
    } else {
        $raio = [int]($lado * 0.30)
        $caminho = New-Object System.Drawing.Drawing2D.GraphicsPath
        $caminho.AddArc(0, 0, $raio * 2, $raio * 2, 180, 90)
        $caminho.AddArc($lado - $raio * 2, 0, $raio * 2, $raio * 2, 270, 90)
        $caminho.AddArc($lado - $raio * 2, $lado - $raio * 2, $raio * 2, $raio * 2, 0, 90)
        $caminho.AddArc(0, $lado - $raio * 2, $raio * 2, $raio * 2, 90, 90)
        $caminho.CloseFigure()
        $g.FillPath($pincel, $caminho)
        $tamanhoTexto = $lado * 0.40
    }
    $fonte = New-Object System.Drawing.Font 'Segoe UI', $tamanhoTexto, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $formato = New-Object System.Drawing.StringFormat
    $formato.Alignment = 'Center'
    $formato.LineAlignment = 'Center'
    $area = New-Object System.Drawing.RectangleF 0, ($lado * 0.02), $lado, $lado
    $g.DrawString('EX', $fonte, [System.Drawing.Brushes]::White, $area, $formato)
    $g.Dispose()
    $bmp.Save((Join-Path $pasta $nome), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

Gerar 180 'icone-180.png' $true
Gerar 192 'icone-192.png' $false
Gerar 512 'icone-512.png' $false
Gerar 512 'icone-mascara-512.png' $true
Get-ChildItem $pasta | Select-Object Name, Length
