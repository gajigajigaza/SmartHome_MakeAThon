#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
gateway_dir="$(cd -- "$script_dir/.." && pwd)"
service_user="${SUDO_USER:-${USER:-}}"
template="$script_dir/dudeoji-gateway.service.template"
service_name="dudeoji-gateway.service"

if [[ -z "$service_user" ]]; then
  echo "서비스 실행 사용자를 확인하지 못했습니다." >&2
  exit 1
fi

if [[ ! -x "$gateway_dir/.venv/bin/python" ]]; then
  echo "먼저 bash install_gateway_linux.sh를 실행하세요." >&2
  exit 1
fi

if [[ ! -f "$gateway_dir/.env" ]]; then
  echo ".env 설정이 필요합니다." >&2
  exit 1
fi

"$gateway_dir/.venv/bin/python" "$gateway_dir/check_gateway_env.py"

escaped_user="$(printf '%s' "$service_user" | sed 's/[&|]/\\&/g')"
escaped_dir="$(printf '%s' "$gateway_dir" | sed 's/[&|]/\\&/g')"
rendered_service="$(mktemp)"
trap 'rm -f "$rendered_service"' EXIT

sed \
  -e "s|__SERVICE_USER__|$escaped_user|g" \
  -e "s|__GATEWAY_DIR__|$escaped_dir|g" \
  "$template" > "$rendered_service"

sudo install -m 0644 \
  "$rendered_service" \
  "/etc/systemd/system/$service_name"
sudo systemctl daemon-reload
sudo systemctl enable --now "$service_name"

echo "SYSTEMD_SERVICE_INSTALLED = $service_name"
sudo systemctl --no-pager --full status "$service_name"
