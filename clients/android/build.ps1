# Builds the 枕书 Android client and copies the APK to dist-android/.
#
# The Android Gradle plugin refuses project paths with non-ASCII characters
# on Windows (aapt2 breaks on them), so the sources are copied to an ASCII
# work folder first and built there.
#
#   powershell -File clients/android/build.ps1
#   powershell -File clients/android/build.ps1 -Jdk "C:\...\jdk-17" -Sdk "D:\Android\Sdk"

param(
    [string]$Jdk = "C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot",
    [string]$Sdk = "D:\Android\Sdk",
    [string]$Work = "D:\Android\build\zhenshu-android"
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$repo = Resolve-Path (Join-Path $source "..\..")

if ($Work -match '[^\x00-\x7F]') { throw "The work folder must be an ASCII path: $Work" }
foreach ($required in @("$Jdk\bin\java.exe", "$Sdk\platforms\android-35", "$Sdk\build-tools\35.0.0")) {
    if (-not (Test-Path $required)) { throw "Missing: $required (see clients/android/README.md)" }
}

New-Item -ItemType Directory -Force $Work | Out-Null
# Fresh sources each time; Gradle's own caches live outside the work folder.
Get-ChildItem $Work -Force | Where-Object { $_.Name -notin @('.gradle', 'build', 'app') } | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }
if (Test-Path "$Work\app\src") { Remove-Item "$Work\app\src" -Recurse -Force }
Copy-Item -Recurse -Force "$source\*" $Work -Exclude '.gradle', 'build'
Set-Content -Path "$Work\local.properties" -Value ("sdk.dir=" + ($Sdk -replace '\\', '\\'))

$env:JAVA_HOME = $Jdk
Push-Location $Work
try {
    & .\gradlew.bat assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
}

$version = (Select-String -Path "$source\app\build.gradle.kts" -Pattern 'versionName = "([^"]+)"').Matches[0].Groups[1].Value
$out = Join-Path $repo "dist-android"
New-Item -ItemType Directory -Force $out | Out-Null
$apk = Join-Path $out "zhenshu-android-$version.apk"
Copy-Item "$Work\app\build\outputs\apk\release\app-release.apk" $apk -Force
Write-Host "APK: $apk"
