# Publica uma versão nova do Exilados para Windows: compila (arquivo único), assina com a chave de atualização e
# envia Exilados.exe e manifest.json para https://filabox3d.com.br/exilados/atualizacao/.
#
# A chave fica fora do repositório (padrão: OneDrive\Exilados\chave-atualizacao.exk, para valer nos dois PCs),
# cifrada com a senha do dono. A senha vem de EXILADOS_SENHA_CHAVE, do arquivo protegido deste PC
# (%APPDATA%\Exilados-publicar\senha.dpapi, criado na primeira vez) ou é pedida aqui.
# Antes de publicar, suba o número da versão em Exilados.csproj (<Version>).
# Em outro PC, com outra chave do servidor: -SshChave ~\.ssh\filabox_vps -SshConhecidos ~\.ssh\known_hosts
param(
    [string]$Chave = (Join-Path $env:OneDrive 'Exilados\chave-atualizacao.exk'),
    [string]$Servidor = '177.153.35.193',
    [string]$SshChave = (Join-Path $HOME '.ssh\filabox3d_deploy_ed25519'),
    [string]$SshConhecidos = (Join-Path $HOME '.ssh\filabox3d_known_hosts')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$aqui = $PSScriptRoot
$ssh = @('-i', $SshChave, '-o', "UserKnownHostsFile=$SshConhecidos", '-o', 'BatchMode=yes')
$pastaRemota = '/var/www/exilados/atualizacao'
$arquivoSenha = Join-Path $env:APPDATA 'Exilados-publicar\senha.dpapi'

if (-not (Test-Path $Chave)) { throw "Não achei a chave de atualização em $Chave." }

# Senha da chave.
$senha = $env:EXILADOS_SENHA_CHAVE
if (-not $senha -and (Test-Path $arquivoSenha)) {
    $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($arquivoSenha), $null, 'CurrentUser')
    $senha = [System.Text.Encoding]::UTF8.GetString($bytes)
}
if (-not $senha) {
    $segura = Read-Host 'Senha da chave de atualização do Exilados' -AsSecureString
    $senha = [System.Net.NetworkCredential]::new('', $segura).Password
    $guardar = Read-Host 'Guardar a senha protegida neste PC para as próximas publicações? (s/n)'
    if ($guardar -eq 's') {
        New-Item -ItemType Directory -Force (Split-Path $arquivoSenha) | Out-Null
        $protegida = [System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes($senha), $null, 'CurrentUser')
        [System.IO.File]::WriteAllBytes($arquivoSenha, $protegida)
    }
}

$ErrorActionPreference = 'Continue'
$saida = Join-Path $env:TEMP 'exilados-windows-publicar'
if (Test-Path $saida) { Remove-Item -Recurse -Force $saida }
& dotnet publish (Join-Path $aqui 'Exilados.csproj') -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true `
    -p:DebugType=none -p:DebugSymbols=false -o $saida -nologo -v q
if ($LASTEXITCODE -ne 0) { throw 'A compilação falhou.' }
$exe = Join-Path $saida 'Exilados.exe'
$versao = (Get-Item $exe).VersionInfo.FileVersion
Write-Host "Compilado: Exilados $versao"

# Nunca publica a mesma versão ou uma mais velha (o programa instalado não voltaria de versão de qualquer jeito).
$atual = & ssh @ssh "root@$Servidor" "cat $pastaRemota/manifest.json 2>/dev/null || true"
if ($atual) {
    $publicada = ($atual | ConvertFrom-Json).Version
    if ([version]$publicada -ge [version]($versao -replace '^(\d+\.\d+\.\d+).*', '$1')) {
        throw "O servidor já tem a versão $publicada. Suba a versão em Exilados.csproj."
    }
}

$manifesto = Join-Path $saida 'manifest.json'
$env:EXILADOS_SENHA_CHAVE = $senha
$assinatura = Start-Process -FilePath $exe -ArgumentList '--assinar', "`"$exe`"", "`"$Chave`"", "`"$manifesto`"" -PassThru -Wait -NoNewWindow
Remove-Item Env:EXILADOS_SENHA_CHAVE
if ($assinatura.ExitCode -ne 0) { throw "A assinatura falhou (código $($assinatura.ExitCode): 4 = a chave não corresponde à pública do programa; 5 = senha errada)." }

& scp @ssh -q $exe "root@${Servidor}:$pastaRemota/Exilados.exe.novo"
if ($LASTEXITCODE -ne 0) { throw 'O envio do programa falhou.' }
& scp @ssh -q $manifesto "root@${Servidor}:$pastaRemota/manifest.json.novo"
if ($LASTEXITCODE -ne 0) { throw 'O envio do manifesto falhou.' }
$hash = & ssh @ssh "root@$Servidor" "cd $pastaRemota && chmod 644 Exilados.exe.novo manifest.json.novo && mv -f Exilados.exe.novo Exilados.exe && mv -f manifest.json.novo manifest.json && sha256sum Exilados.exe | cut -d' ' -f1"
$esperado = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $esperado) { throw 'O arquivo no servidor não confere com o publicado.' }
Write-Host "Publicado: Exilados $versao em https://filabox3d.com.br/exilados/atualizacao/Exilados.exe"
