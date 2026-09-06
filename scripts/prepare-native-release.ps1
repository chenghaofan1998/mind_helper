$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceExe = Join-Path $root "dist-native\CommandPocketNative.exe"
$releaseDir = Join-Path $root "dist\CommandPocketNative"
$targetExe = Join-Path $releaseDir "CommandPocket.exe"
$zipPath = Join-Path $root "dist\CommandPocket-native.zip"

if (-not (Test-Path $sourceExe)) {
    throw "Native executable not found: $sourceExe"
}

if (-not (Test-Path $releaseDir)) {
    New-Item -ItemType Directory -Path $releaseDir | Out-Null
}

Copy-Item -LiteralPath $sourceExe -Destination $targetExe -Force

if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path $targetExe -DestinationPath $zipPath -Force

Write-Host "Native desktop package is ready:"
Write-Host "  $targetExe"
Write-Host "  $zipPath"
