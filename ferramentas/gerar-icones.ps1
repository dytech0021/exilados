# Gera os ícones do site (X curvo no quadrado lavanda) em site\icones\.
# Uso: powershell -File ferramentas\gerar-icones.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$pasta = Join-Path (Split-Path -Parent $PSScriptRoot) 'site\icones'
New-Item -ItemType Directory -Force $pasta | Out-Null
$lavanda = [System.Drawing.Color]::FromArgb(255, 0xBD, 0xAA, 0xFF)
$roxo = [System.Drawing.Color]::FromArgb(255, 0x37, 0x25, 0x5C)

function Gerar([int]$lado, [string]$nome, [bool]$mascara) {
    $bmp = [System.Drawing.Bitmap]::new($lado, $lado, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $pincel = [System.Drawing.SolidBrush]::new($lavanda)
    if ($mascara) {
        $g.FillRectangle($pincel, 0, 0, $lado, $lado)
    } else {
        $raio = [int]($lado * 0.30)
        $caminho = [System.Drawing.Drawing2D.GraphicsPath]::new()
        $caminho.AddArc(0, 0, $raio * 2, $raio * 2, 180, 90)
        $caminho.AddArc($lado - $raio * 2, 0, $raio * 2, $raio * 2, 270, 90)
        $caminho.AddArc($lado - $raio * 2, $lado - $raio * 2, $raio * 2, $raio * 2, 0, 90)
        $caminho.AddArc(0, $lado - $raio * 2, $raio * 2, $raio * 2, 90, 90)
        $caminho.CloseFigure()
        $g.FillPath($pincel, $caminho)
        $caminho.Dispose()
    }
    $pincel.Dispose()

    # Duas fitas curvas formam um X próprio, legível também no ícone de 16 px.
    $caneta = [System.Drawing.Pen]::new($roxo, [float]($lado * 0.16))
    $caneta.StartCap = 'Round'
    $caneta.EndCap = 'Round'
    $caneta.LineJoin = 'Round'
    $g.DrawBezier($caneta,
        [System.Drawing.PointF]::new([float]($lado * 0.25), [float]($lado * 0.23)),
        [System.Drawing.PointF]::new([float]($lado * 0.40), [float]($lado * 0.34)),
        [System.Drawing.PointF]::new([float]($lado * 0.60), [float]($lado * 0.66)),
        [System.Drawing.PointF]::new([float]($lado * 0.75), [float]($lado * 0.77)))
    $g.DrawBezier($caneta,
        [System.Drawing.PointF]::new([float]($lado * 0.75), [float]($lado * 0.23)),
        [System.Drawing.PointF]::new([float]($lado * 0.60), [float]($lado * 0.34)),
        [System.Drawing.PointF]::new([float]($lado * 0.40), [float]($lado * 0.66)),
        [System.Drawing.PointF]::new([float]($lado * 0.25), [float]($lado * 0.77)))
    $caneta.Dispose()
    $g.Dispose()
    $bmp.Save((Join-Path $pasta $nome), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Gerar 180 'icone-180.png' $true
Gerar 192 'icone-192.png' $false
Gerar 512 'icone-512.png' $false
Gerar 512 'icone-mascara-512.png' $true

# Ícone do programa do Windows: um .ico com as imagens PNG em vários tamanhos.
$tamanhos = 16, 24, 32, 48, 64, 128, 256
$imagens = foreach ($t in $tamanhos) {
    Gerar $t "ico-$t.png" $false
    $arquivo = Join-Path $pasta "ico-$t.png"
    ,[System.IO.File]::ReadAllBytes($arquivo)
    Remove-Item $arquivo
}
$ico = Join-Path (Split-Path -Parent $PSScriptRoot) 'windows\exilados.ico'
$saida = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $saida
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$tamanhos.Count)
$posicao = 6 + 16 * $tamanhos.Count
for ($i = 0; $i -lt $tamanhos.Count; $i++) {
    $t = $tamanhos[$i]; $lado = if ($t -ge 256) { 0 } else { $t }
    $w.Write([byte]$lado); $w.Write([byte]$lado); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$imagens[$i].Length); $w.Write([uint32]$posicao)
    $posicao += $imagens[$i].Length
}
foreach ($img in $imagens) { $w.Write($img) }
$w.Flush()
[System.IO.File]::WriteAllBytes($ico, $saida.ToArray())
Get-ChildItem $pasta | Select-Object Name, Length
