$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$releaseDir = Join-Path $root "dist\ActionPocket"
if (-not (Test-Path $releaseDir)) {
    throw "Neutralino release directory not found: $releaseDir"
}

$shellCandidates = @(
    Get-ChildItem -LiteralPath $releaseDir -Recurse -File |
        Where-Object { $_.Name -like "*-win_x64.exe" }
)
if ($shellCandidates.Count -ne 1) {
    $found = @(Get-ChildItem -LiteralPath $releaseDir -Recurse -File | ForEach-Object { $_.FullName }) -join "; "
    throw "Expected one Neutralino win_x64 executable, found $($shellCandidates.Count). Run 'npm run neutralino:update' and rebuild first. Release files: $found"
}

$sourceShell = $shellCandidates[0].FullName
$shellExe = Join-Path $releaseDir "ActionPocketShell.exe"
$launcherSource = Join-Path $root "dist-native\ActionPocketLauncher.exe"
$launcherExe = Join-Path $releaseDir "ActionPocket.exe"
$resourceFile = Join-Path $releaseDir "resources.neu"
$serverSource = Join-Path $root ".server-dist"
$webSource = Join-Path $root "web-dist"
$appDir = Join-Path $releaseDir "app"
$runtimeDir = Join-Path $releaseDir "runtime"

$required = @($sourceShell, $launcherSource, $resourceFile, $serverSource, $webSource)
foreach ($path in $required) {
    if (-not (Test-Path $path)) {
        throw "Required release input not found: $path"
    }
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeSource = $nodeCommand.Source
$nodeMajor = [int](& $nodeSource -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
    throw "Node.js 20+ is required to build the bundled runtime. Found: $nodeMajor"
}

if (Test-Path $appDir) {
    Remove-Item -LiteralPath $appDir -Recurse -Force
}
if (Test-Path $runtimeDir) {
    Remove-Item -LiteralPath $runtimeDir -Recurse -Force
}
New-Item -ItemType Directory -Path $appDir, $runtimeDir -Force | Out-Null

Copy-Item -LiteralPath $sourceShell -Destination $shellExe -Force
Copy-Item -LiteralPath $launcherSource -Destination $launcherExe -Force
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $runtimeDir "node.exe") -Force
Copy-Item -LiteralPath $serverSource -Destination (Join-Path $appDir "server-dist") -Recurse -Force
Copy-Item -LiteralPath $webSource -Destination (Join-Path $appDir "web-dist") -Recurse -Force
Remove-Item -LiteralPath $sourceShell -Force

$instructions = @(
    "Action Pocket P0 Windows test package"
    ""
    "1. Run ActionPocket.exe."
    "2. The app opens without forcing knowledge-source setup."
    "3. To connect or change a local directory, run: ActionPocket.exe --choose-graph"
    "4. Press Ctrl+Alt+P to show or hide the window; use the tray if the hotkey is unavailable."
    "5. Exit from the tray menu so the launcher also stops the local knowledge service."
    ""
    "The app listens only on a randomly assigned 127.0.0.1 port."
)
Set-Content -LiteralPath (Join-Path $releaseDir "README.txt") -Value $instructions -Encoding UTF8

$zipPath = Join-Path $root "dist\ActionPocket-windows-x64.zip"
if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $releaseDir "*") -DestinationPath $zipPath -Force

Write-Host "Windows desktop package is ready:"
Write-Host "  $launcherExe"
Write-Host "  $zipPath"
