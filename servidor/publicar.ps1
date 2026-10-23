# Publica o Exilados no servidor: empacota api/, servidor/ e site/, envia e roda servidor/instalar.sh como root.
# O site vai com a versão dele (site/js/versao.js): o número de commits e o commit publicado ("+" no fim quando há
# mudança em site/ ainda sem commit). Só o pacote muda; no repositório o arquivo continua "dev".
# Uso: .\servidor\publicar.ps1   (precisa da chave SSH do servidor em ~\.ssh, a mesma do Ponte)
# Em outro PC, com outra chave: .\servidor\publicar.ps1 -Chave ~\.ssh\filabox_vps -Conhecidos ~\.ssh\known_hosts
# Só montar o pacote, sem enviar (para conferir): .\servidor\publicar.ps1 -SoPacote
# Forçar todos a atualizar: .\servidor\publicar.ps1 -Forcar — a versão mínima (site/versao.json) passa a ser esta:
# quem está aberto numa versão mais velha recarrega sozinho em até 1 minuto, o servidor não deixa versão velha entrar
# na voz, e todos são tirados das salas de voz (entram de novo já na versão nova).
param(
    [string]$Servidor = '177.153.35.193',
    [string]$Chave = (Join-Path $HOME '.ssh\filabox3d_deploy_ed25519'),
    [string]$Conhecidos = (Join-Path $HOME '.ssh\filabox3d_known_hosts'),
    [switch]$SoPacote,
    [switch]$Forcar
)
$ErrorActionPreference = 'Stop'
# Programas externos (ssh, scp, node, tar) escrevem andamento no stderr: confere-se o código de saída de cada um.
$PSNativeCommandUseErrorActionPreference = $false

$raiz = Split-Path -Parent $PSScriptRoot
foreach ($arquivo in @($chave, $conhecidos)) {
    if (-not (Test-Path $arquivo)) { throw "Falta $arquivo (chave de acesso ao servidor)." }
}
$opcoes = @('-i', $chave, '-o', "UserKnownHostsFile=$conhecidos", '-o', 'BatchMode=yes')

Push-Location $raiz
try {
    $ErrorActionPreference = 'Continue'
    Push-Location api
    $saida = & node --test 2>&1
    $resultado = $LASTEXITCODE
    Pop-Location
    $saida | Select-String -Pattern '(pass|fail) \d+' | ForEach-Object { $_.Line }
    if ($resultado -ne 0) { $saida; throw 'Os testes do exilados-api falharam; nada foi publicado.' }

    $montagem = Join-Path $env:TEMP 'exilados-publicar'
    if (Test-Path $montagem) { Remove-Item -Recurse -Force $montagem }
    New-Item -ItemType Directory $montagem | Out-Null
    foreach ($parte in 'api', 'servidor', 'site') { Copy-Item $parte $montagem -Recurse }
    $numero = "$(& git rev-list --count HEAD)".Trim()
    $commit = "$(& git rev-parse --short HEAD)".Trim()
    if (-not $numero -or -not $commit) { throw 'Não deu para ler a versão no git.' }
    if (& git status --porcelain -- site) { $commit += '+' }
    [IO.File]::WriteAllText((Join-Path $montagem 'site\js\versao.js'),
        "// Gerado por servidor/publicar.ps1.`nexport const VERSAO_SITE = '$numero';`nexport const COMMIT_SITE = '$commit';`n",
        [Text.UTF8Encoding]::new($false))
    # Sem -Forcar, a versão mínima continua a que está publicada.
    $minima = 0
    if ($Forcar) { $minima = [int]$numero }
    else {
        try { $minima = [int](Invoke-RestMethod 'https://filabox3d.com.br/exilados/versao.json' -TimeoutSec 10).minima } catch { }
    }
    [IO.File]::WriteAllText((Join-Path $montagem 'site\versao.json'), "{`"versao`":$numero,`"minima`":$minima}`n",
        [Text.UTF8Encoding]::new($false))
    Write-Host "Site versão $numero ($commit), mínima $minima$(if ($Forcar) { ' (forçada)' })"

    $pacote = Join-Path $env:TEMP 'exilados-publicar.tar.gz'
    if (Test-Path $pacote) { Remove-Item $pacote -Force }
    & tar -czf $pacote -C $montagem --exclude=test --exclude=node_modules --exclude=*.test.mjs api servidor site
    if ($LASTEXITCODE -ne 0) { throw 'Não deu para empacotar.' }
    Remove-Item -Recurse -Force $montagem
    if ($SoPacote) {
        Write-Host "Pacote em $pacote (nada foi enviado)."
        return
    }

    & scp @opcoes $pacote "root@${Servidor}:/tmp/exilados-publicar.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw 'Não deu para enviar ao servidor.' }

    $comando = 'set -e; rm -rf /tmp/exilados-publicar; mkdir /tmp/exilados-publicar; ' +
        'tar -xzf /tmp/exilados-publicar.tar.gz -C /tmp/exilados-publicar; ' +
        'bash /tmp/exilados-publicar/servidor/instalar.sh; ' +
        $(if ($Forcar) { 'node /tmp/exilados-publicar/servidor/derrubar-voz.mjs; ' } else { '' }) +
        'rm -rf /tmp/exilados-publicar /tmp/exilados-publicar.tar.gz'
    & ssh @opcoes "root@$Servidor" $comando
    if ($LASTEXITCODE -ne 0) { throw 'A instalação no servidor falhou (veja acima).' }
    Remove-Item $pacote -Force
    Write-Host 'Publicado em https://filabox3d.com.br/exilados/'
}
finally {
    Pop-Location
}
