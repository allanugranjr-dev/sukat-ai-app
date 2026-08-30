param(
    [string]$TargetRoot = 'C:\xampp\htdocs\bsit-sukat-ai'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$apiSource = Join-Path $PSScriptRoot 'api'
$storageSource = Join-Path $PSScriptRoot 'storage\.htaccess'

if (-not (Test-Path -LiteralPath (Join-Path $distRoot 'index.html'))) {
    throw 'The XAMPP build is missing. Run npm run build:xampp first.'
}

New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $TargetRoot 'api') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $TargetRoot 'storage') -Force | Out-Null

Copy-Item -Path (Join-Path $distRoot '*') -Destination $TargetRoot -Recurse -Force
Copy-Item -Path (Join-Path $apiSource '*') -Destination (Join-Path $TargetRoot 'api') -Recurse -Force
Copy-Item -LiteralPath $storageSource -Destination (Join-Path $TargetRoot 'storage\.htaccess') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.htaccess') -Destination (Join-Path $TargetRoot '.htaccess') -Force

Write-Output "SukatAI XAMPP files deployed to $TargetRoot"
Write-Output 'Open http://localhost/bsit-sukat-ai/ after Apache and MySQL are running.'
