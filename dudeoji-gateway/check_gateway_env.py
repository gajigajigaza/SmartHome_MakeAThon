"""게이트웨이 .env를 비밀값 노출 없이 검사합니다."""

from __future__ import annotations

import re
from pathlib import Path


ENV_PATH = Path(__file__).resolve().with_name(".env")
REQUIRED_KEYS = (
    "DUDEOJI_PLACE_ID",
    "DUDEOJI_AUTH_TOKEN",
)
PLACEHOLDER_PATTERN = re.compile(
    r"TOKEN_TO_BE_ADDED_LATER|CHANGE|REPLACE|YOUR|<|>",
    re.IGNORECASE,
)


def load_entries(path: Path) -> tuple[dict[str, str], list[str]]:
    entries: dict[str, str] = {}
    duplicates: list[str] = []

    for raw_line in path.read_text(
        encoding="utf-8-sig",
    ).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        normalized_key = key.strip()
        normalized_value = value.strip().strip('"').strip("'")
        if normalized_key in entries:
            duplicates.append(normalized_key)
        entries[normalized_key] = normalized_value

    return entries, duplicates


def main() -> None:
    if not ENV_PATH.is_file():
        raise SystemExit(f"ENV_MISSING = {ENV_PATH}")

    entries, duplicates = load_entries(ENV_PATH)
    missing = [key for key in REQUIRED_KEYS if not entries.get(key)]
    token = entries.get("DUDEOJI_AUTH_TOKEN", "")
    token_is_placeholder = bool(PLACEHOLDER_PATTERN.search(token))

    try:
        place_id = int(entries.get("DUDEOJI_PLACE_ID", ""))
    except ValueError:
        place_id = 0

    websocket_url = entries.get(
        "DUDEOJI_WEBSOCKET_URL",
        "wss://dudeoji-makerthon.onrender.com/ws/sensors",
    )
    ble_name = entries.get(
        "DUDEOJI_BLE_DEVICE_NAME",
        "DUDEOJI-XIAO",
    )
    sense_ble_name = entries.get("DUDEOJI_SENSE_BLE_NAME", "")
    control_ble_name = entries.get("DUDEOJI_CONTROL_BLE_NAME", "")
    dual_ble_enabled = bool(sense_ble_name and control_ble_name)
    sense_only_enabled = bool(sense_ble_name) and not bool(control_ble_name)
    control_only_enabled = bool(control_ble_name) and not bool(sense_ble_name)
    duplicate_ble_names = bool(
        dual_ble_enabled and sense_ble_name == control_ble_name
    )
    try:
        stale_seconds = float(
            entries.get("DUDEOJI_BLE_STATE_STALE_SECONDS", "30")
        )
    except ValueError:
        stale_seconds = 0.0

    print(f"ENV_FILE = {ENV_PATH}")
    print(f"MISSING_KEYS = {','.join(missing) if missing else 'NONE'}")
    print(
        "DUPLICATE_KEYS = "
        f"{','.join(sorted(set(duplicates))) if duplicates else 'NONE'}"
    )
    print(f"PLACE_ID = {place_id if place_id > 0 else 'INVALID'}")
    print(f"TOKEN_CONFIGURED = {bool(token) and not token_is_placeholder}")
    print(
        "WEBSOCKET_URL_VALID = "
        f"{websocket_url.startswith(('ws://', 'wss://'))}"
    )
    if dual_ble_enabled:
        ble_mode = "2-ESP"
    elif sense_only_enabled:
        ble_mode = "Sense-only"
    elif control_only_enabled:
        ble_mode = "Control-only"
    else:
        ble_mode = "1-ESP-compatible"
    print(f"BLE_MODE = {ble_mode}")
    if dual_ble_enabled:
        print(f"SENSE_BLE_NAME = {sense_ble_name}")
        print(f"CONTROL_BLE_NAME = {control_ble_name}")
    elif sense_only_enabled:
        print(f"SENSE_BLE_NAME = {sense_ble_name}")
    elif control_only_enabled:
        print(f"CONTROL_BLE_NAME = {control_ble_name}")
    else:
        print(f"BLE_DEVICE_NAME = {ble_name or 'MISSING'}")
    print(
        "BLE_STATE_STALE_SECONDS = "
        f"{stale_seconds if stale_seconds > 0 else 'INVALID'}"
    )

    if (
        missing
        or duplicates
        or place_id < 1
        or token_is_placeholder
        or not websocket_url.startswith(("ws://", "wss://"))
        or duplicate_ble_names
        or (not dual_ble_enabled and not ble_name)
        or stale_seconds <= 0
    ):
        raise SystemExit("GATEWAY_ENV_CHECK_FAILED")

    print("GATEWAY_ENV_CHECK_OK")


if __name__ == "__main__":
    main()
