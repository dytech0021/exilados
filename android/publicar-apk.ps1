# Envia ..\pronto\Exilados.apk e android.json (gerados por gerar-apk.ps1) para
# https://filabox3d.com.br/exilados/atualizacao/: o APK é o endereço do botão de baixar no navegador do Android e do QR
# code do programa do Windows; o android.json avisa os apps instalados (eles se atualizam sozinhos). O aviso vai por
# último, para nunca apontar para um APK que ainda não chegou.
# Em outro PC, com outra chave do servidor: -SshChave ~\.ssh\filabox_vps -SshConhecidos ~\.ssh\known_hosts
param(
    [string]$Servidor = '177.153.35.193',
    [string]$SshChave = (Join-Path $HOME '.ssh\filabox3d_deploy_ed25519'),
    [string]$SshConhecidos = (Join-Path $HOME '.ssh\filabox3d_known_hosts')
)
$ErrorActionPreference = 'Stop'
$apk = Join-Path $PSScriptRoot '..\pronto\Exilados.apk'
$aviso = Join-Path $PSScriptRoot '..\pronto\android.json'
if (-not (Test-Path $apk) -or -not (Test-Path $aviso)) { throw 'Falta pronto\Exilados.apk ou pronto\android.json: rode android\gerar-apk.ps1 antes.' }
$esperado = (Get-Content $aviso -Raw | ConvertFrom-Json)
if ($esperado.sha256 -ne (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'pronto\android.json não é deste APK: gere de novo.' }
$ssh = @('-i', $SshChave, '-o', "UserKnownHostsFile=$SshConhecidos", '-o', 'BatchMode=yes')
$pasta = '/var/www/exilados/atualizacao'

$ErrorActionPreference = 'Continue'
& scp @ssh -q $apk "root@${Servidor}:$pasta/Exilados.apk.novo"
if ($LASTEXITCODE -ne 0) { throw 'O envio do APK falhou.' }
$hash = & ssh @ssh "root@$Servidor" "cd $pasta && chmod 644 Exilados.apk.novo && mv -f Exilados.apk.novo Exilados.apk && sha256sum Exilados.apk | cut -d' ' -f1"
if ($hash -ne (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'O APK no servidor não confere com o gerado.' }
& scp @ssh -q $aviso "root@${Servidor}:$pasta/android.json.novo"
if ($LASTEXITCODE -ne 0) { throw 'O envio do android.json falhou.' }
& ssh @ssh "root@$Servidor" "cd $pasta && chmod 644 android.json.novo && mv -f android.json.novo android.json"
if ($LASTEXITCODE -ne 0) { throw 'Não deu para trocar o android.json no servidor.' }
Write-Host "Publicado: Exilados para Android $($esperado.versionName) em https://filabox3d.com.br/exilados/atualizacao/Exilados.apk" -ForegroundColor Green
