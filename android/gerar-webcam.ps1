# Companheiro de câmera, instalável ao lado do Exilados original. Chave própria, fora do repositório.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ambiente.ps1')
Add-Type -AssemblyName System.Security
$pastaChave = Join-Path $env:LOCALAPPDATA 'Exilados-Webcam-publicar'
New-Item -ItemType Directory -Force $pastaChave | Out-Null
$chave = Join-Path $pastaChave 'exilados-webcam.jks'
$protecao = Join-Path $pastaChave 'senha.dpapi'
if ((Test-Path $chave) -and -not (Test-Path $protecao)) { throw 'A chave existe, mas falta a senha protegida deste PC.' }
if (-not (Test-Path $protecao)) {
    $aleatorio = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Fill($aleatorio)
    $senhaNova = [Convert]::ToBase64String($aleatorio)
    [IO.File]::WriteAllBytes($protecao, [Security.Cryptography.ProtectedData]::Protect(
        [Text.Encoding]::UTF8.GetBytes($senhaNova), $null, 'CurrentUser'))
}
$senha = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect(
    [IO.File]::ReadAllBytes($protecao), $null, 'CurrentUser'))
$antesChave = $env:EXILADOS_APK_CHAVE
$antesSenha = $env:EXILADOS_APK_SENHA
$antesJava = $env:JAVA_TOOL_OPTIONS
try {
    $env:EXILADOS_APK_CHAVE = $chave
    $env:EXILADOS_APK_SENHA = $senha
    # O JDK usa um socket local com caminho curto no Windows.
    New-Item -ItemType Directory -Force 'C:\Temp' | Out-Null
    $env:JAVA_TOOL_OPTIONS = "$antesJava -Djdk.net.unixdomain.tmpdir=C:\Temp".Trim()
    $PSNativeCommandUseErrorActionPreference = $false
    if (-not (Test-Path $chave)) {
        & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -keystore $chave -storetype PKCS12 -alias exilados `
            -keyalg RSA -keysize 3072 -validity 36500 -dname 'CN=Exilados Webcam' `
            -storepass:env EXILADOS_APK_SENHA -keypass:env EXILADOS_APK_SENHA
        if ($LASTEXITCODE) { throw 'Não deu para criar a chave do companheiro de câmera.' }
    }
    Push-Location $PSScriptRoot
    try {
        & .\gradlew.bat --no-daemon --console=plain -q -PwebcamCompanion=true :app:testDebugUnitTest :app:lintRelease :app:assembleRelease
        if ($LASTEXITCODE) { throw 'Falha nos testes ou na compilação do companheiro de câmera.' }
    } finally { Pop-Location }
    $saida = Join-Path $PSScriptRoot 'app\build\outputs\apk\release'
    $pronto = Join-Path $PSScriptRoot '..\pronto\webcam'
    New-Item -ItemType Directory -Force $pronto | Out-Null
    $apk = Join-Path $pronto 'Exilados.apk'
    Copy-Item (Join-Path $saida 'app-release.apk') $apk -Force
    $meta = Get-Content (Join-Path $saida 'output-metadata.json') -Raw | ConvertFrom-Json
    if ($meta.applicationId -ne 'com.dytech.exilados.webcam') { throw 'O APK não é o companheiro de câmera.' }
    $manifesto = [ordered]@{ versionCode = $meta.elements[0].versionCode; versionName = $meta.elements[0].versionName
        size = (Get-Item $apk).Length; sha256 = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant() }
    [IO.File]::WriteAllText((Join-Path $pronto 'android.json'), ($manifesto | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Write-Host "Companheiro de câmera pronto em $pronto"
} finally {
    $env:EXILADOS_APK_CHAVE = $antesChave
    $env:EXILADOS_APK_SENHA = $antesSenha
    $env:JAVA_TOOL_OPTIONS = $antesJava
    $senha = $null
}
