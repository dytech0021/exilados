# Gera o APK do Exilados para Android: testes, análise do Android, compilação e assinatura, e copia o resultado para
# ..\pronto\Exilados.apk.
#
# A chave que assina fica fora do repositório (ele é público). Padrão: OneDrive\Exilados\exilados-android.jks, para
# valer nos dois PCs; na primeira vez ela é criada. Perder a chave impede instalar versões novas por cima da antiga.
# A senha é a mesma da chave de atualização do programa do Windows: EXILADOS_SENHA_CHAVE, o arquivo protegido deste PC
# (%APPDATA%\Exilados-publicar\senha.dpapi) ou pedida aqui.
# Antes de publicar, suba versionCode (de um em um) e versionName em app\build.gradle.kts.
param(
    [string]$Chave = (Join-Path $env:OneDrive 'Exilados\exilados-android.jks')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ambiente.ps1')
Add-Type -AssemblyName System.Security

$senha = $env:EXILADOS_SENHA_CHAVE
$arquivoSenha = Join-Path $env:APPDATA 'Exilados-publicar\senha.dpapi'
if (-not $senha -and (Test-Path $arquivoSenha)) {
    $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($arquivoSenha), $null, 'CurrentUser')
    $senha = [System.Text.Encoding]::UTF8.GetString($bytes)
}
if (-not $senha) {
    $segura = Read-Host 'Senha da chave do Exilados (a mesma da chave de atualização do programa)' -AsSecureString
    $senha = [System.Net.NetworkCredential]::new('', $segura).Password
}
if ($senha.Length -lt 12) { throw 'A senha da chave precisa ter pelo menos 12 caracteres.' }

$env:EXILADOS_APK_SENHA = $senha
# keytool e Gradle escrevem andamento na saída de erro: confere-se o código de saída de cada um.
$ErrorActionPreference = 'Continue'
try {
    $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
    if (-not (Test-Path $Chave)) {
        New-Item -ItemType Directory -Force (Split-Path $Chave) | Out-Null
        & $keytool -genkeypair -keystore $Chave -storetype PKCS12 -alias exilados -keyalg RSA -keysize 3072 -validity 36500 `
            -dname 'CN=Exilados' -storepass:env EXILADOS_APK_SENHA -keypass:env EXILADOS_APK_SENHA | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Não deu para criar a chave do APK.' }
        Write-Host "Chave nova do APK criada em $Chave (guarde: sem ela o app não atualiza por cima)." -ForegroundColor Yellow
    }

    $env:EXILADOS_APK_CHAVE = $Chave
    Push-Location $PSScriptRoot
    try {
        & .\gradlew.bat --no-daemon --console=plain -q :app:testDebugUnitTest :app:lintRelease :app:assembleRelease
        $codigo = $LASTEXITCODE
    }
    finally { Pop-Location }
    if ($codigo -ne 0) { throw 'Os testes, a análise ou a compilação falharam; o APK não foi gerado.' }

    $saida = Join-Path $PSScriptRoot 'app\build\outputs\apk\release'
    $metadata = Get-Content (Join-Path $saida 'output-metadata.json') -Raw | ConvertFrom-Json
    if (@($metadata.elements).Count -ne 1 -or $metadata.elements[0].outputFile -ne 'app-release.apk') {
        throw 'A compilação não produziu um único APK assinado.'
    }
    $apk = Join-Path $saida 'app-release.apk'
    $versao = [string]$metadata.elements[0].versionName

    # Confere a assinatura e mostra só a impressão digital do certificado (pública).
    $sdkLinha = Get-Content (Join-Path $PSScriptRoot 'local.properties') | Where-Object { $_ -match '^\s*sdk\.dir\s*=' } | Select-Object -Last 1
    $sdk = ($sdkLinha -replace '^\s*sdk\.dir\s*=\s*', '') -replace '\\([\\: =])', '$1'
    $apksigner = Get-ChildItem (Join-Path $sdk 'build-tools\*\apksigner.bat') |
        Sort-Object { [version]($_.Directory.Name -replace '-.*$', '') } -Descending | Select-Object -First 1
    $certificado = & $apksigner.FullName verify --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'A assinatura do APK não confere.' }
    $digital = ($certificado | Select-String 'SHA-256 digest: (\w+)').Matches[0].Groups[1].Value

    $pronto = Join-Path $PSScriptRoot '..\pronto'
    New-Item -ItemType Directory -Force $pronto | Out-Null
    Copy-Item $apk (Join-Path $pronto 'Exilados.apk') -Force
    $tamanho = (Get-Item $apk).Length
    Write-Host "Exilados para Android $versao em pronto\Exilados.apk ($tamanho bytes). Certificado SHA-256: $digital" -ForegroundColor Green
}
finally {
    Remove-Item Env:EXILADOS_APK_SENHA, Env:EXILADOS_APK_CHAVE -ErrorAction SilentlyContinue
}
