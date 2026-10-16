# Teste de ponta a ponta da atualização automática do programa do Windows, sem tocar na cópia instalada, no
# servidor nem na chave de verdade. Compila duas versões (9.0.0 e 9.0.1) de uma cópia do código com uma chave de
# atualização descartável, o endereço de atualização e o site no modo de demonstração (neste PC), outra pasta de
# dados, outra trava e sem "Abrir com o Windows". Confere três situações:
# 1. abrir o programa com uma versão nova no servidor: atualiza antes de mostrar a janela e abre já na nova;
# 2. a versão nova sai com a janela aberta: aparece a setinha verde no site, nada reinicia sozinho, e clicar nela
#    reinicia na versão nova com a janela aberta;
# 3. com a setinha à vista, fechar a janela e abrir o programa de novo: abre já na versão nova.
# Uso: .\ferramentas\teste-atualizacao\teste.ps1   (precisa do .NET SDK e do Node)
param(
    [int]$Porta = 5181,
    [int]$PortaDepuracao = 9333
)
$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$base = Join-Path $env:TEMP 'exilados-teste-atualizacao'
$fonte = Join-Path $base 'fonte'
$servir = Join-Path $base 'servir'
$instalado = Join-Path $base 'instalado\Exilados.exe'
$cdp = Join-Path $PSScriptRoot 'cdp.mjs'
# 127.0.0.1, não localhost: o servidor de demonstração só escuta no IPv4.
$site = "http://127.0.0.1:$Porta/exilados/"
$dados = Join-Path $env:APPDATA 'Exilados-teste-atualizacao'
$resultado = [System.Collections.Generic.List[string]]::new()
$falhas = 0

function Linha([bool]$ok, [string]$texto) {
    $linha = "{0} {1}" -f $(if ($ok) { 'OK   ' } else { 'FALHA' }), $texto
    $resultado.Add($linha)
    Write-Host $linha
    if (-not $ok) { $script:falhas++ }
}

function Esperar([scriptblock]$condicao, [int]$segundos) {
    $fim = (Get-Date).AddSeconds($segundos)
    while ((Get-Date) -lt $fim) {
        if (& $condicao) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return [bool](& $condicao)
}

function ProcessosDoTeste {
    @(Get-Process Exilados -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($base, [StringComparison]::OrdinalIgnoreCase) })
}

function PararProgramas {
    ProcessosDoTeste | ForEach-Object { try { $_.Kill(); $_.WaitForExit(5000) | Out-Null } catch { } }
    Start-Sleep -Milliseconds 800
}

function VersaoInstalada { (Get-Item $instalado).VersionInfo.FileVersion }

# O processo do programa nessa versão (9.0.1.0), se estiver aberto.
function Processo([string]$versao) {
    ProcessosDoTeste | Where-Object { try { $_.MainModule.FileVersionInfo.FileVersion -eq $versao } catch { $false } } | Select-Object -First 1
}

function JanelaVisivel([string]$versao) {
    $p = Processo $versao
    if (-not $p) { return $false }
    $p.Refresh()
    return $p.MainWindowHandle -ne [IntPtr]::Zero -and $p.MainWindowTitle -notlike '*tualizando*'
}

function NoSite([string]$expressao) {
    $saida = & node $cdp $PortaDepuracao $site avaliar $expressao 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($saida | Select-Object -Last 1)
}

function SiteAberto([string]$versao) {
    (NoSite "!!window.exiladosPrograma && window.exiladosPrograma.versao === '$versao' && !document.getElementById('app').hidden") -eq 'true'
}

function SetinhaVisivel {
    (NoSite "!document.getElementById('trilho-baixar').hidden && (document.getElementById('atualizar-programa') || {}).title || ''") -match '9\.0\.1'
}

function PublicarNova {
    Copy-Item (Join-Path $base 'B\Exilados.exe') (Join-Path $servir 'Exilados.exe') -Force
    Copy-Item (Join-Path $base 'manifest.json') (Join-Path $servir 'manifest.json') -Force
}

function Preparar([bool]$comNova) {
    PararProgramas
    Get-ChildItem $servir -File | Remove-Item -Force
    if ($comNova) { PublicarNova }
    $pasta = Split-Path $instalado
    Get-ChildItem $pasta -File -ErrorAction SilentlyContinue | Remove-Item -Force
    Copy-Item (Join-Path $base 'A\Exilados.exe') $instalado -Force
}

function Trocar([string]$arquivo, [string]$de, [string]$para) {
    $caminho = Join-Path $fonte $arquivo
    $texto = [IO.File]::ReadAllText($caminho)
    if (-not $texto.Contains($de)) { throw "Não achei em $arquivo o trecho a trocar: $de" }
    [IO.File]::WriteAllText($caminho, $texto.Replace($de, $para), [Text.UTF8Encoding]::new($true))
}

function TrocarPadrao([string]$arquivo, [string]$padrao, [string]$para) {
    $caminho = Join-Path $fonte $arquivo
    $texto = [IO.File]::ReadAllText($caminho)
    if ($texto -notmatch $padrao) { throw "Não achei em $arquivo o padrão a trocar: $padrao" }
    [IO.File]::WriteAllText($caminho, ($texto -replace $padrao, $para), [Text.UTF8Encoding]::new($true))
}

function Compilar([string]$versao, [string]$saida) {
    & dotnet publish (Join-Path $fonte 'Exilados.csproj') -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true `
        -p:DebugType=none -p:DebugSymbols=false -p:Version=$versao -o $saida -nologo -v q | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "A compilação da versão $versao falhou." }
}

$servidor = $null
try {
    # ---------- preparação: cópia do código, chave descartável, as duas versões ----------
    PararProgramas
    if (Test-Path $base) { Remove-Item -Recurse -Force $base }
    if (Test-Path $dados) { Remove-Item -Recurse -Force $dados }
    $webview = Join-Path $env:LOCALAPPDATA 'Exilados-teste-atualizacao'
    if (Test-Path $webview) { Remove-Item -Recurse -Force $webview }
    New-Item -ItemType Directory -Force $fonte, $servir, (Split-Path $instalado) | Out-Null
    Get-ChildItem (Join-Path $raiz 'windows') -Force | Where-Object { $_.Name -notin 'bin', 'obj' } | Copy-Item -Destination $fonte -Recurse -Force

    Trocar 'Atualizacao.cs' 'https://filabox3d.com.br/exilados/atualizacao/' "http://127.0.0.1:$Porta/exilados/atualizacao/"
    Trocar 'Registro.cs' 'ApplicationData), "Exilados")' 'ApplicationData), "Exilados-teste-atualizacao")'
    Trocar 'Programa.cs' '@"Local\Exilados-programa"' '@"Local\Exilados-teste-programa"'
    Trocar 'Programa.cs' '@"Local\Exilados-mostrar"' '@"Local\Exilados-teste-mostrar"'
    Trocar 'Inicializacao.cs' 'public static bool Ativa { get; set; } = true;' 'public static bool Ativa { get; set; } = false;'
    Trocar 'JanelaPrincipal.cs' 'public static string Endereco { get; set; } = Conta.Site;' "public static string Endereco { get; set; } = `"$site`";"
    # Procura a versão nova a cada 10 s (em vez de a cada hora).
    TrocarPadrao 'Bandeja.cs' '_relogio = new\(\) \{ Interval = [^}]+\}' '_relogio = new() { Interval = 10 * 1000 }'

    $sorteio = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($sorteio)
    $env:EXILADOS_SENHA_CHAVE = [Convert]::ToBase64String($sorteio)
    $chave = Join-Path $base 'chave-teste.exk'
    & dotnet build (Join-Path $fonte 'Exilados.csproj') -c Debug -o (Join-Path $base 'dev') -nologo -v q | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'A compilação de desenvolvimento falhou.' }
    $gerar = Start-Process (Join-Path $base 'dev\Exilados.exe') -ArgumentList '--gerar-chave', "`"$chave`"", "`"$(Join-Path $fonte 'ChaveAtualizacao.cs')`"" -Wait -PassThru -NoNewWindow
    if ($gerar.ExitCode -ne 0) { throw "Não deu para gerar a chave de teste (código $($gerar.ExitCode))." }

    Compilar '9.0.0' (Join-Path $base 'A')
    Compilar '9.0.1' (Join-Path $base 'B')
    $exeB = Join-Path $base 'B\Exilados.exe'
    $assinar = Start-Process $exeB -ArgumentList '--assinar', "`"$exeB`"", "`"$chave`"", "`"$(Join-Path $base 'manifest.json')`"" -Wait -PassThru -NoNewWindow
    if ($assinar.ExitCode -ne 0) { throw "A assinatura de teste falhou (código $($assinar.ExitCode))." }
    Remove-Item Env:EXILADOS_SENHA_CHAVE

    $env:PORTA = "$Porta"
    $env:ATUALIZACAO = $servir
    $servidor = Start-Process node -ArgumentList "`"$(Join-Path $raiz 'ferramentas\demo\servidor.mjs')`"" -PassThru -WindowStyle Hidden
    Remove-Item Env:PORTA, Env:ATUALIZACAO
    if (-not (Esperar { try { (Invoke-WebRequest -UseBasicParsing $site -TimeoutSec 2).StatusCode -eq 200 } catch { $false } } 15)) { throw 'O servidor de demonstração não abriu.' }
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$PortaDepuracao"

    # ---------- 1. abrir com uma versão nova no servidor ----------
    Preparar $true
    Start-Process $instalado | Out-Null
    $ok = Esperar { (VersaoInstalada) -eq '9.0.1.0' -and (JanelaVisivel '9.0.1.0') -and (SiteAberto '9.0.1') } 60
    Linha $ok "1. abrir com versão nova: abre já na 9.0.1 com a janela e o site (instalada: $(VersaoInstalada))"
    $registro = Get-Content (Join-Path $dados 'sessoes.txt') -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    Linha ([bool]($registro -match '9\.0\.0 . atualiza.+instalando a vers.o 9\.0\.1')) '1. o registro mostra a 9.0.0 instalando a 9.0.1'

    # ---------- 2. versão nova com a janela aberta: setinha e clique ----------
    Preparar $false
    Start-Process $instalado | Out-Null
    $ok = Esperar { (JanelaVisivel '9.0.0.0') -and (SiteAberto '9.0.0') } 60
    Linha $ok '2. sem versão nova: abre na 9.0.0 com o site'
    Linha (-not (SetinhaVisivel)) '2. sem versão nova: sem setinha'
    PublicarNova
    $ok = Esperar { SetinhaVisivel } 45
    Linha $ok '2. versão nova no servidor: a setinha verde aparece (com a versão 9.0.1 no aviso)'
    & node $cdp $PortaDepuracao $site foto (Join-Path $base 'setinha.png') 2>$null
    Start-Sleep -Seconds 3
    Linha ((VersaoInstalada) -eq '9.0.0.0' -and (JanelaVisivel '9.0.0.0')) '2. com a janela aberta, nada reinicia sozinho'
    NoSite "document.getElementById('atualizar-programa').click(), true" | Out-Null
    $ok = Esperar { (VersaoInstalada) -eq '9.0.1.0' -and (JanelaVisivel '9.0.1.0') -and (SiteAberto '9.0.1') } 60
    Linha $ok "2. clicar na setinha: reinicia na 9.0.1 com a janela aberta (instalada: $(VersaoInstalada))"
    Linha (-not (Processo '9.0.0.0')) '2. a 9.0.0 fechou'

    # ---------- 3. setinha à vista, fechar a janela e abrir de novo ----------
    Preparar $false
    Start-Process $instalado | Out-Null
    $ok = (Esperar { (JanelaVisivel '9.0.0.0') -and (SiteAberto '9.0.0') } 60)
    PublicarNova
    $ok = $ok -and (Esperar { SetinhaVisivel } 45)
    Linha $ok '3. janela aberta na 9.0.0 com a setinha'
    # O X da janela (WM_SYSCOMMAND/SC_CLOSE); um WM_CLOSE solto o Windows Forms trata como o Gerenciador de Tarefas.
    Add-Type -Namespace Teste -Name Janela -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr janela, uint mensagem, IntPtr w, IntPtr l);'
    [Teste.Janela]::PostMessage((Processo '9.0.0.0').MainWindowHandle, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) | Out-Null
    $ok = Esperar { (VersaoInstalada) -eq '9.0.1.0' -and (Processo '9.0.1.0') -and -not (Processo '9.0.0.0') } 60
    Linha $ok '3. fechar a janela: troca para a 9.0.1 perto do relógio'
    Start-Sleep -Seconds 2
    Linha (-not (JanelaVisivel '9.0.1.0')) '3. depois da troca, a janela continua fechada'
    Start-Process $instalado | Out-Null
    $ok = Esperar { (JanelaVisivel '9.0.1.0') -and (SiteAberto '9.0.1') } 60
    Linha $ok '3. abrir de novo: a janela abre já na 9.0.1'
}
catch {
    Linha $false "erro: $($_.Exception.Message)"
}
finally {
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
    PararProgramas
    if ($servidor) { try { Stop-Process -Id $servidor.Id -Force } catch { } }
}

$texto = $resultado -join [Environment]::NewLine
$final = if ($falhas -eq 0) { 'RESULTADO: tudo certo' } else { "RESULTADO: $falhas falha(s)" }
Write-Host $final
[IO.File]::WriteAllText((Join-Path $base 'relatorio.txt'), "$texto$([Environment]::NewLine)$final$([Environment]::NewLine)", [Text.UTF8Encoding]::new($true))
exit $(if ($falhas -eq 0) { 0 } else { 1 })
