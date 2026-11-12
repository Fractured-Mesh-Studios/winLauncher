$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot

$packageJsonPath = Join-Path $projectRoot 'package.json'
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json

$manifestPath = Join-Path $projectRoot 'manifest.json'
if (-not (Test-Path $manifestPath)) {
    throw "manifest.json was not found in project root."
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if (-not $manifest.CodePathWin) {
    throw "manifest.json is missing CodePathWin."
}

$packageVersion = [string]$packageJson.version
$manifestVersion = [string]$manifest.Version

if (-not $packageVersion) {
    throw "package.json is missing version."
}

if (-not $manifestVersion) {
    throw "manifest.json is missing Version."
}

if ($packageVersion -ne $manifestVersion) {
    throw "Version mismatch: package.json ($packageVersion) != manifest.json ($manifestVersion)."
}

$exeName = [string]$manifest.CodePathWin
$exePath = Join-Path $projectRoot $exeName

Write-Host "Packaging version $packageVersion..."
Write-Host "Building Windows executable..."
npm run build:win
if ($LASTEXITCODE -ne 0) {
    throw "build:win failed."
}

if (-not (Test-Path $exePath)) {
    throw "Expected executable not found: $exeName"
}

$releaseRoot = Join-Path $projectRoot 'release'
$pluginFolderName = if ($manifest.UUID) { "$($manifest.UUID).sdPlugin" } else { "$(Split-Path $projectRoot -Leaf).sdPlugin" }
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

$zipArchive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    [void]$zipArchive.CreateEntry("$pluginFolderName/")

    $sourceRoot = Split-Path $stagingDir -Parent
    $files = Get-ChildItem -Path $stagingDir -Recurse -File

    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($sourceRoot.Length).TrimStart([char[]]@('\', '/'))
        $entryName = $relativePath -replace '\\', '/'

        $entry = $zipArchive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $fileStream = [System.IO.File]::OpenRead($file.FullName)
        try {
            $fileStream.CopyTo($entryStream)
        }
        finally {
            $fileStream.Dispose()
            $entryStream.Dispose()
        }
    }
}
finally {
    $zipArchive.Dispose()
}

Write-Host ""
Write-Host "Release created successfully:"
Write-Host "- Version: $packageVersion"
Write-Host "- Staging folder: $stagingDir"
Write-Host "- Installable ZIP: $zipPath"
Write-Host ""
Write-Host "Use the ZIP from OpenDeck plugin installer, or copy the staging folder to the plugins directory."
