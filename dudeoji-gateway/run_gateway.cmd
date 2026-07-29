@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: Python virtual environment not found.
  echo Run install_gateway.cmd first.
  exit /b 1
)

if not exist ".env" (
  echo ERROR: .env not found.
  exit /b 1
)

".venv\Scripts\python.exe" "check_gateway_env.py"
if errorlevel 1 exit /b 1

".venv\Scripts\python.exe" -u "gateway.py"
