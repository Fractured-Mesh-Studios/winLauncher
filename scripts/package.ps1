$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot

$manifestPath = Join-Path $projectRoot 'manifest.json'
if (-not (Test-Path $manifestPath)) {
    throw "manifest.json was not found in project root."
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if (-not $manifest.CodePathWin) {
    throw "manifest.json is missing CodePathWin."
}

$exeName = [string]$manifest.CodePathWin
$exePath = Join-Path $projectRoot $exeName

Write-Host "Building Windows executable..."
npm run build:win
if ($LASTEXITCODE -ne 0) {
    throw "build:win failed."
}

if (-not (Test-Path $exePath)) {
    throw "Expected executable not found: $exeName"
}

$releaseRoot = Join-Path $projectRoot 'release'
$pluginFolderName = Split-Path $projectRoot -Leaf
$stagingDir = Join-Path $releaseRoot $pluginFolderName
$zipPath = Join-Path $releaseRoot "$pluginFolderName.zip"

if (Test-Path $stagingDir) {
    Remove-Item $stagingDir -Recurse -Force
}

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

$exclude = @(
    'node_modules',
    'src',
    'scripts',
    'release',
    '.git',
    '.github',
    '.vscode',
    'plugin.js',
    'plugin.cmd',
    'package.json',
    'package-lock.json'
)

$itemsToCopy = Get-ChildItem -Path $projectRoot -Force | Where-Object {
    $exclude -notcontains $_.Name
}

foreach ($item in $itemsToCopy) {
    $destination = Join-Path $stagingDir $item.Name
    Copy-Item -Path $item.FullName -Destination $destination -Recurse -Force
}

Compress-Archive -Path (Join-Path $stagingDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host ""
Write-Host "Release created successfully:"
Write-Host "- Staging folder: $stagingDir"
Write-Host "- Installable ZIP: $zipPath"
Write-Host ""
Write-Host "Use the ZIP from OpenDeck plugin installer, or copy the staging folder to the plugins directory."
