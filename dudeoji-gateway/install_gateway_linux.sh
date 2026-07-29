#!/usr/bin/env bash
set -euo pipefail

gateway_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$gateway_dir"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3를 찾지 못했습니다." >&2
  exit 1
fi

if ! python3 -c \
  'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'
then
  echo "Python 3.10 이상이 필요합니다." >&2
  exit 1
fi

if [[ ! -x ".venv/bin/python" ]]; then
  python3 -m venv .venv
fi

".venv/bin/python" -m pip install --upgrade pip
".venv/bin/python" -m pip install -r requirements.txt

if [[ ! -f ".env" ]]; then
  cp ".env.example" ".env"
  echo
  echo ".env 파일을 만들었습니다."
  echo "DUDEOJI_PLACE_ID와 DUDEOJI_AUTH_TOKEN을 입력하세요."
fi

chmod 600 ".env"

echo
echo "게이트웨이 설치 완료"
