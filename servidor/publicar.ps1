# Publica o Exilados no servidor: empacota api/, servidor/ e site/, envia e roda servidor/instalar.sh como root.
# Uso: .\servidor\publicar.ps1   (precisa da chave SSH do servidor em ~\.ssh, a mesma do Ponte)
param(
    [string]$Servidor = '177.153.35.193'
)
$ErrorActionPreference = 'Stop'
# Programas externos (ssh, scp, node, tar) escrevem andamento no stderr: confere-se o código de saída de cada um.
$PSNativeCommandUseErrorActionPreference = $false

$raiz = Split-Path -Parent $PSScriptRoot
$chave = Join-Path $HOME '.ssh\filabox3d_deploy_ed25519'
$conhecidos = Join-Path $HOME '.ssh\filabox3d_known_hosts'
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

    $pacote = Join-Path $env:TEMP 'exilados-publicar.tar.gz'
    if (Test-Path $pacote) { Remove-Item $pacote -Force }
    & tar -czf $pacote --exclude=test --exclude=node_modules --exclude=*.test.mjs api servidor site
    if ($LASTEXITCODE -ne 0) { throw 'Não deu para empacotar.' }

    & scp @opcoes $pacote "root@${Servidor}:/tmp/exilados-publicar.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw 'Não deu para enviar ao servidor.' }

    $comando = 'set -e; rm -rf /tmp/exilados-publicar; mkdir /tmp/exilados-publicar; ' +
        'tar -xzf /tmp/exilados-publicar.tar.gz -C /tmp/exilados-publicar; ' +
        'bash /tmp/exilados-publicar/servidor/instalar.sh; ' +
        'rm -rf /tmp/exilados-publicar /tmp/exilados-publicar.tar.gz'
    & ssh @opcoes "root@$Servidor" $comando
    if ($LASTEXITCODE -ne 0) { throw 'A instalação no servidor falhou (veja acima).' }
    Remove-Item $pacote -Force
    Write-Host 'Publicado em https://filabox3d.com.br/exilados/'
}
finally {
    Pop-Location
}
