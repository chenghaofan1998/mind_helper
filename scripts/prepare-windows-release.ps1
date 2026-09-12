$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$neutralinoReleaseDir = Join-Path $root "dist\ActionPocket"
$stagingDir = Join-Path $root "dist\windows-x64-staging"
if (-not (Test-Path $neutralinoReleaseDir)) {
    throw "Neutralino release directory not found: $neutralinoReleaseDir"
}

$shellCandidates = @(
    Get-ChildItem -LiteralPath $neutralinoReleaseDir -Recurse -File |
        Where-Object { $_.Name -like "*-win_x64.exe" }
)
if ($shellCandidates.Count -ne 1) {
    $found = @(Get-ChildItem -LiteralPath $neutralinoReleaseDir -Recurse -File | ForEach-Object { $_.FullName }) -join "; "
    throw "Expected one Neutralino win_x64 executable, found $($shellCandidates.Count). Run 'npm run neutralino:update' and rebuild first. Release files: $found"
}

$sourceShell = $shellCandidates[0].FullName
$resourceSource = Join-Path $neutralinoReleaseDir "resources.neu"
$launcherSource = Join-Path $root "dist-native\ActionPocketLauncher.exe"
$serverSource = Join-Path $root ".server-dist"
$webSource = Join-Path $root "web-dist"
$required = @($sourceShell, $launcherSource, $resourceSource, $serverSource, $webSource)
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

# Build the user-facing archive from a clean, dedicated staging tree. Never mutate
# Neutralino's multi-platform release directory or archive it wholesale.
if (Test-Path $stagingDir) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force
}
$appDir = Join-Path $stagingDir "app"
$shellDir = Join-Path $appDir "shell"
$runtimeDir = Join-Path $appDir "runtime"
New-Item -ItemType Directory -Path $stagingDir, $appDir, $shellDir, $runtimeDir -Force | Out-Null

Copy-Item -LiteralPath $launcherSource -Destination (Join-Path $stagingDir "ActionPocket.exe") -Force
Copy-Item -LiteralPath $sourceShell -Destination (Join-Path $shellDir "ActionPocketShell.exe") -Force
Copy-Item -LiteralPath $resourceSource -Destination (Join-Path $shellDir "resources.neu") -Force
Copy-Item -LiteralPath $nodeSource -Destination (Join-Path $runtimeDir "node.exe") -Force
Copy-Item -LiteralPath $serverSource -Destination (Join-Path $appDir "server-dist") -Recurse -Force
Copy-Item -LiteralPath $webSource -Destination (Join-Path $appDir "web-dist") -Recurse -Force

$instructions = @(
    "Action Pocket Windows x64"
    ""
    "1. Run ActionPocket.exe. Do not run files inside the app directory."
    "2. Closing the window keeps Action Pocket in the system tray."
    "3. Double-click the tray icon or press Ctrl+Alt+P to show it again."
    "4. To connect or change a local directory, run: ActionPocket.exe --choose-graph"
    "5. Use 'Exit Action Pocket' in the tray menu to stop the app and local knowledge service."
    ""
    "The app listens only on a randomly assigned 127.0.0.1 port."
)
Set-Content -LiteralPath (Join-Path $stagingDir "README.txt") -Value $instructions -Encoding UTF8

$rootEntries = @(Get-ChildItem -LiteralPath $stagingDir | ForEach-Object { $_.Name } | Sort-Object)
$expectedRootEntries = @("ActionPocket.exe", "app", "README.txt") | Sort-Object
if (Compare-Object -ReferenceObject $expectedRootEntries -DifferenceObject $rootEntries) {
    throw "Unexpected Windows package root entries: $($rootEntries -join ', ')"
}
$foreignNeutralinoBinaries = @(
    Get-ChildItem -LiteralPath $stagingDir -Recurse -File |
        Where-Object { $_.Name -match "-(linux|mac)_" }
)
if ($foreignNeutralinoBinaries.Count -ne 0) {
    throw "Windows staging contains non-Windows Neutralino binaries."
}

$zipPath = Join-Path $root "dist\ActionPocket-windows-x64.zip"
if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $stagingDir "*") -DestinationPath $zipPath -Force

Write-Host "Windows desktop package is ready:"
Write-Host "  $(Join-Path $stagingDir 'ActionPocket.exe')"
Write-Host "  $zipPath"
