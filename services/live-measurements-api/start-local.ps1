[CmdletBinding()]
param(
    [switch]$Install
)

$serviceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonPath = Join-Path $serviceRoot ".venv\Scripts\python.exe"
$requirementsPath = Join-Path $serviceRoot "requirements.sukat-ai.txt"

if (-not (Test-Path -LiteralPath $pythonPath)) {
    py -3.11 -m venv (Join-Path $serviceRoot ".venv")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $Install = $true
}

if ($Install) {
    & $pythonPath -m pip install --no-cache-dir -r $requirementsPath
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ([string]::IsNullOrWhiteSpace($env:PROVIDER_API_KEY)) {
    $env:PROVIDER_API_KEY = "change-me-local"
}
if ([string]::IsNullOrWhiteSpace($env:HOST)) {
    $env:HOST = "127.0.0.1"
}
if ([string]::IsNullOrWhiteSpace($env:PORT)) {
    $env:PORT = "8001"
}

& $pythonPath (Join-Path $serviceRoot "app.py")
exit $LASTEXITCODE
