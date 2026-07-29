#!/usr/bin/env bash
set -euo pipefail

gateway_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$gateway_dir"

if [[ ! -x ".venv/bin/python" ]]; then
  echo "먼저 bash install_gateway_linux.sh를 실행하세요." >&2
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo ".env가 없습니다. .env.example을 복사하고 값을 설정하세요." >&2
  exit 1
fi

".venv/bin/python" "check_gateway_env.py"
exec ".venv/bin/python" -u "gateway.py"
