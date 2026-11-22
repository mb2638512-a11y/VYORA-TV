<#
  Vyora TV - Android TV APK builder (no Gradle required)

  Pipeline: aapt2 compile/link -> javac -> d8 -> zip -> zipalign -> apksigner
  Requires: Android SDK build-tools + platform android.jar, JDK 17, Python 3.
#>
param(
  [string]$Sdk = $(if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }),
  [string]$BuildTools = "35.0.0",
  [string]$Platform = "android-36",
  [string]$MinSdk = "21",
  [string]$TargetSdk = "34",
  [string]$VersionName = "1.0.1",
  [int]$VersionCode = 2,
  [ValidateSet("tv", "phone")][string]$Variant = "tv"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'android\app'
$libs = Join-Path $root 'android\libs'
# Media3 DASH is an optional module; fetch the pinned version so .mpd
# catalogue entries can use the same native player as HLS streams.
$dashAar = Join-Path $libs 'media3-exoplayer-dash-1.4.1.aar'
if (-not (Test-Path $dashAar)) {
  New-Item -ItemType Directory -Force -Path $libs | Out-Null
  Invoke-WebRequest -Uri 'https://dl.google.com/dl/android/maven2/androidx/media3/media3-exoplayer-dash/1.4.1/media3-exoplayer-dash-1.4.1.aar' -OutFile $dashAar
}
$build = Join-Path $root 'android\build'
$outDir = Join-Path $root 'android\out'
$bt = Join-Path $Sdk "build-tools\$BuildTools"
$androidJar = Join-Path $Sdk "platforms\$Platform\android.jar"

Write-Host "== Vyora TV APK build ==" -ForegroundColor Cyan
foreach ($p in @("$bt\aapt2.exe", "$bt\d8.bat", "$bt\zipalign.exe", "$bt\apksigner.bat", $androidJar)) {
  if (-not (Test-Path $p)) { throw "Missing tool: $p" }
}

# ---------------------------------------------------------------- clean
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $build | Out-Null
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
# The CI pipeline builds TV first, then phone. Clean stale APKs only once,
# before the first variant, so the second variant does not delete the first.
# Preserve the CI test keystore and any non-APK diagnostics in android/out.
if ($Variant -eq 'tv') {
  Get-ChildItem -Path $outDir -Filter 'Vyora-*.apk' -File -ErrorAction SilentlyContinue |
    Remove-Item -Force
}

# ---------------------------------------------------------------- assets
$webDist = Join-Path $root 'web\dist'
if (-not (Test-Path (Join-Path $webDist 'index.html'))) {
  throw "web/dist not found - run 'npm run build' first"
}
$assets = Join-Path $app 'assets'
if (Test-Path $assets) { Remove-Item $assets -Recurse -Force }
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item -Path (Join-Path $webDist '*') -Destination $assets -Recurse -Force
Write-Host "[1/7] assets copied ($((Get-ChildItem $assets -Recurse -File).Count) files)"

# ---------------------------------------------------------------- aar resources + classes
$resZips = @()
$classJars = @()
$aarDir = Join-Path $build 'aar'
New-Item -ItemType Directory -Force -Path $aarDir | Out-Null
foreach ($aar in Get-ChildItem $libs -Filter *.aar -ErrorAction SilentlyContinue) {
  $ex = Join-Path $aarDir $aar.BaseName
  if (Test-Path $ex) { Remove-Item $ex -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $ex | Out-Null
  Copy-Item $aar.FullName (Join-Path $ex 'lib.zip')
  Expand-Archive -Path (Join-Path $ex 'lib.zip') -DestinationPath $ex -Force
  Remove-Item (Join-Path $ex 'lib.zip')
  $cj = Join-Path $ex 'classes.jar'
  if (Test-Path $cj) { $classJars += $cj }
  $resDir = Join-Path $ex 'res'
  if (Test-Path $resDir) {
    $zip = Join-Path $build "$($aar.BaseName)-res.zip"
    & "$bt\aapt2.exe" compile --dir $resDir -o $zip
    if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed for $($aar.Name)" }
    $resZips += $zip
  }
}
foreach ($jar in Get-ChildItem $libs -Filter *.jar -ErrorAction SilentlyContinue) { $classJars += $jar.FullName }
Write-Host "[2/7] libraries: $($classJars.Count) class containers"

# ---------------------------------------------------------------- aapt2 compile app res
$appResZip = Join-Path $build 'app-res.zip'
& "$bt\aapt2.exe" compile --dir (Join-Path $app 'res') -o $appResZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }
Write-Host '[3/7] app resources compiled'

# ---------------------------------------------------------------- aapt2 link
$genDir = Join-Path $build 'gen'
New-Item -ItemType Directory -Force -Path $genDir | Out-Null
$baseApk = Join-Path $build 'base.apk'
$linkArgs = @(
  'link',
  '-o', $baseApk,
  '-I', $androidJar,
  '--manifest', (Join-Path $app $(if ($Variant -eq 'phone') { 'AndroidManifest.phone.xml' } else { 'AndroidManifest.xml' })),
  '-R', $appResZip,
  '--java', $genDir,
  '-A', $assets,
  '--min-sdk-version', $MinSdk,
  '--target-sdk-version', $TargetSdk,
  '--version-code', "$VersionCode",
  '--version-name', $VersionName,
  '--auto-add-overlay'
)
foreach ($z in $resZips) { $linkArgs += @('-R', $z) }
& "$bt\aapt2.exe" @linkArgs
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }
Write-Host '[4/7] resources linked'

# ---------------------------------------------------------------- javac
$classesDir = Join-Path $build 'classes'
New-Item -ItemType Directory -Force -Path $classesDir | Out-Null
$sources = Get-ChildItem (Join-Path $app 'java') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources += (Get-ChildItem $genDir -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$cp = @($androidJar) + $classJars
& javac -encoding UTF-8 -source 8 -target 8 -nowarn -Xlint:none -classpath ($cp -join ';') -d $classesDir @sources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
Write-Host "[5/7] compiled $($sources.Count) source file(s)"

# ---------------------------------------------------------------- d8
$dexDir = Join-Path $build 'dex'
New-Item -ItemType Directory -Force -Path $dexDir | Out-Null
$d8Inputs = (Get-ChildItem $classesDir -Recurse -Filter *.class | ForEach-Object { $_.FullName }) + $classJars
& "$bt\d8.bat" --lib $androidJar --min-api $MinSdk --release --output $dexDir @d8Inputs
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }
Write-Host "[6/7] dexed $((Get-ChildItem $dexDir -Filter *.dex).Count) dex file(s)"

# ---------------------------------------------------------------- package
$unsigned = Join-Path $build 'app-unsigned.apk'
& python (Join-Path $root 'android\tools\pack_apk.py') $baseApk $dexDir $unsigned
if ($LASTEXITCODE -ne 0) { throw 'packaging failed' }

$aligned = Join-Path $build 'app-aligned.apk'
& "$bt\zipalign.exe" -p -f 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

# ---------------------------------------------------------------- sign
$ks = if ($env:GITHUB_ACTIONS -eq 'true') { Join-Path $outDir 'ci-vyora-test.jks' } else { Join-Path $root 'android\vyora-release.jks' }
$storePass = if ($env:GITHUB_ACTIONS -eq 'true') { 'vyora-ci-test-only' } else { 'vyora2026' }
if (-not (Test-Path $ks)) {
  Write-Host '[sign] generating release keystore...'
  & keytool -genkeypair -v -keystore $ks -storepass $storePass -keypass $storePass -alias vyora `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -dname "CN=Vyora TV, OU=Vyora, O=Vyora, L=Dubai, S=Dubai, C=AE"
  if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}

$finalApk = Join-Path $outDir "Vyora-$Variant-$VersionName.apk"
& "$bt\apksigner.bat" sign --ks $ks --ks-pass "pass:$storePass" --key-pass "pass:$storePass" `
  --ks-key-alias vyora --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true `
  --out $finalApk $aligned
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

& "$bt\apksigner.bat" verify --print-certs $finalApk | Select-Object -First 4
$size = [math]::Round((Get-Item $finalApk).Length / 1MB, 2)
Write-Host "== APK READY: $finalApk ($size MB) ==" -ForegroundColor Green
