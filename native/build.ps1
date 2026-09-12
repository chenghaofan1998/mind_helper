param(
  [string]$Name = "ActionPocketLauncher"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "dist-native"
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$output = Join-Path $outDir "$Name.exe"

# The launcher is split by responsibility across several .cs files; compile them all together.
$sources = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*.cs" | Sort-Object Name | ForEach-Object { $_.FullName })
$entry = Join-Path $PSScriptRoot "$Name.cs"

if (!(Test-Path $compiler)) {
  throw "Cannot find csc.exe at $compiler"
}
if (!(Test-Path $entry)) {
  throw "Cannot find entry source at $entry"
}
if ($sources.Count -eq 0) {
  throw "No C# sources found in $PSScriptRoot"
}
if (!(Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

$outArg = "/out:$output"

& $compiler `
  /nologo `
  /target:winexe `
  /platform:x64 `
  /codepage:65001 `
  $outArg `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Drawing.dll `
  /reference:System.Web.Extensions.dll `
  /reference:System.Windows.Forms.dll `
  $sources

if ($LASTEXITCODE -ne 0) {
  throw "csc.exe failed with exit code $LASTEXITCODE"
}

$test = Start-Process -FilePath $output -ArgumentList "--self-test" -Wait -PassThru
if ($test.ExitCode -ne 0) {
  throw "$Name self-test failed with exit code $($test.ExitCode)"
}

Write-Host "Built and verified dist-native\$Name.exe"
