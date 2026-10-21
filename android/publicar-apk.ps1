# Envia ..\pronto\Exilados.apk (gerado por gerar-apk.ps1) para https://filabox3d.com.br/exilados/atualizacao/Exilados.apk,
# o endereço do botão de baixar no navegador do Android e do QR code do programa do Windows.
# Em outro PC, com outra chave do servidor: -SshChave ~\.ssh\filabox_vps -SshConhecidos ~\.ssh\known_hosts
param(
    [string]$Servidor = '177.153.35.193',
    [string]$SshChave = (Join-Path $HOME '.ssh\filabox3d_deploy_ed25519'),
    [string]$SshConhecidos = (Join-Path $HOME '.ssh\filabox3d_known_hosts')
)
$ErrorActionPreference = 'Stop'
$apk = Join-Path $PSScriptRoot '..\pronto\Exilados.apk'
if (-not (Test-Path $apk)) { throw 'Falta pronto\Exilados.apk: rode android\gerar-apk.ps1 antes.' }
$ssh = @('-i', $SshChave, '-o', "UserKnownHostsFile=$SshConhecidos", '-o', 'BatchMode=yes')
$pasta = '/var/www/exilados/atualizacao'

$ErrorActionPreference = 'Continue'
& scp @ssh -q $apk "root@${Servidor}:$pasta/Exilados.apk.novo"
if ($LASTEXITCODE -ne 0) { throw 'O envio do APK falhou.' }
$hash = & ssh @ssh "root@$Servidor" "cd $pasta && chmod 644 Exilados.apk.novo && mv -f Exilados.apk.novo Exilados.apk && sha256sum Exilados.apk | cut -d' ' -f1"
if ($hash -ne (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'O APK no servidor não confere com o gerado.' }
Write-Host 'Publicado em https://filabox3d.com.br/exilados/atualizacao/Exilados.apk' -ForegroundColor Green
