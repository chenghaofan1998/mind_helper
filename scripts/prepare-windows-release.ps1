$ErrorActionPreference = "Stop"

$releaseDir = Join-Path $PSScriptRoot "..\dist\CommandPocket"
$sourceExe = Join-Path $releaseDir "CommandPocket-win_x64.exe"
$targetExe = Join-Path $releaseDir "CommandPocket.exe"
$resourceFile = Join-Path $releaseDir "resources.neu"

if (-not (Test-Path $sourceExe)) {
    throw "Windows executable not found: $sourceExe"
}

if (-not (Test-Path $resourceFile)) {
    throw "Neutralino resource file not found: $resourceFile"
}

Copy-Item -LiteralPath $sourceExe -Destination $targetExe -Force

$zipPath = Join-Path $PSScriptRoot "..\dist\CommandPocket-windows.zip"
if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $zipPath -Force

Write-Host "Windows desktop package is ready:"
Write-Host "  $targetExe"
Write-Host "  $zipPath"
