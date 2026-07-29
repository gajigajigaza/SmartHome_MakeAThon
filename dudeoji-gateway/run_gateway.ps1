$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    throw "먼저 .\install_gateway.ps1 을 실행하세요."
}

if (-not (Test-Path ".env")) {
    throw ".env가 없습니다. .env.example을 복사하고 값을 설정하세요."
}

& ".\.venv\Scripts\python.exe" "check_gateway_env.py"
if ($LASTEXITCODE -ne 0) {
    throw ".env 검사가 실패했습니다."
}

& ".\.venv\Scripts\python.exe" -u "gateway.py"
