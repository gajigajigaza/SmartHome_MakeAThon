"""XIAO BLE 메시지와 FastAPI WebSocket 메시지 사이의 변환 규격."""

from __future__ import annotations

import json
import math
from typing import Any


BLE_DEVICE_NAME = "DUDEOJI-XIAO"
SENSE_BLE_DEVICE_NAME = "DUDEOJI-SENSE"
CONTROL_BLE_DEVICE_NAME = "DUDEOJI-CONTROL"
SENSE_DEVICE_ID = "sense-01"
CONTROL_DEVICE_ID = "control-01"

SERVICE_UUID = "7d2ea28a-f7bd-485a-bd9d-92ad6ecfe93e"
SENSOR_CHARACTERISTIC_UUID = "7d2ea28b-f7bd-485a-bd9d-92ad6ecfe93e"
CONTROL_CHARACTERISTIC_UUID = "7d2ea28c-f7bd-485a-bd9d-92ad6ecfe93e"
RESULT_CHARACTERISTIC_UUID = "7d2ea28d-f7bd-485a-bd9d-92ad6ecfe93e"

ALLOWED_ACTIONS = frozenset(
    {
        "OPEN_WINDOW",
        "CLOSE_WINDOW",
        "TURN_ON_AIRCON",
        "TURN_OFF_AIRCON",
    }
)


class ProtocolError(ValueError):
    """BLE 또는 WebSocket 메시지 계약 위반."""


def decode_json_message(raw: bytes | bytearray | str) -> dict[str, Any]:
    if isinstance(raw, (bytes, bytearray)):
        try:
            text = bytes(raw).decode("utf-8")
        except UnicodeDecodeError as error:
            raise ProtocolError("BLE 데이터가 UTF-8이 아닙니다.") from error
    else:
        text = raw

    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise ProtocolError("JSON 형식이 아닙니다.") from error

    if not isinstance(value, dict):
        raise ProtocolError("JSON 객체가 필요합니다.")

    return value


def _require_number(
    message: dict[str, Any],
    key: str,
    *,
    minimum: float,
    maximum: float,
) -> float:
    value = message.get(key)

    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
    ):
        raise ProtocolError(f"{key}에 유효한 숫자가 필요합니다.")

    normalized = float(value)
    if not minimum <= normalized <= maximum:
        raise ProtocolError(
            f"{key}는 {minimum}~{maximum} 범위여야 합니다."
        )
    return normalized


def _require_bool(message: dict[str, Any], key: str) -> bool:
    value = message.get(key)
    if not isinstance(value, bool):
        raise ProtocolError(f"{key}에 true 또는 false가 필요합니다.")
    return value


def _require_optional_bool(
    message: dict[str, Any],
    key: str,
) -> bool | None:
    value = message.get(key)
    if value is not None and not isinstance(value, bool):
        raise ProtocolError(f"{key}는 true, false 또는 null이어야 합니다.")
    return value


def _require_optional_number(
    message: dict[str, Any],
    key: str,
) -> float | None:
    value = message.get(key)
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
    ):
        raise ProtocolError(f"{key}는 유효한 숫자 또는 null이어야 합니다.")
    return float(value)


def _require_device_message(
    message: dict[str, Any],
    *,
    expected_type: str,
    expected_device_id: str,
) -> None:
    if message.get("type") != expected_type:
        raise ProtocolError(
            f"BLE 메시지 type은 {expected_type}이어야 합니다."
        )
    if message.get("device_id") != expected_device_id:
        raise ProtocolError(
            f"BLE 메시지 device_id는 {expected_device_id}이어야 합니다."
        )


def environment_ble_to_state(
    message: dict[str, Any],
) -> dict[str, Any]:
    """ESP-SENSE 환경 메시지를 검증하고 정규화합니다."""

    _require_device_message(
        message,
        expected_type="environment",
        expected_device_id=SENSE_DEVICE_ID,
    )
    bme_ok = _require_bool(message, "bme_ok")
    camera_ready = _require_bool(message, "camera_ready")
    person_detected = _require_optional_bool(message, "person_detected")

    if bme_ok:
        temperature = _require_number(
            message,
            "temperature",
            minimum=-50,
            maximum=80,
        )
        humidity = _require_number(
            message,
            "humidity",
            minimum=0,
            maximum=100,
        )
    else:
        temperature = _require_optional_number(message, "temperature")
        humidity = _require_optional_number(message, "humidity")

    return {
        "type": "environment",
        "device_id": SENSE_DEVICE_ID,
        "temperature": temperature,
        "humidity": humidity,
        "bme_ok": bme_ok,
        "camera_ready": camera_ready,
        "person_detected": person_detected,
    }


def control_ble_to_state(
    message: dict[str, Any],
) -> dict[str, Any]:
    """ESP-CONTROL 상태 메시지를 검증하고 정규화합니다."""

    _require_device_message(
        message,
        expected_type="control_state",
        expected_device_id=CONTROL_DEVICE_ID,
    )
    power_watt = _require_optional_number(message, "power_watt")
    if power_watt is not None and not 0 <= power_watt <= 20000:
        raise ProtocolError("power_watt는 0~20000 범위여야 합니다.")

    return {
        "type": "control_state",
        "device_id": CONTROL_DEVICE_ID,
        "window_open": _require_bool(message, "window_open"),
        "fan_on": _require_bool(message, "fan_on"),
        "ina_available": _require_bool(message, "ina_available"),
        "bus_voltage": _require_optional_number(
            message,
            "bus_voltage",
        ),
        "current_ma": _require_optional_number(message, "current_ma"),
        "power_watt": power_watt,
    }


def combined_sensor_to_server(
    environment: dict[str, Any],
    control: dict[str, Any],
) -> dict[str, Any]:
    """두 ESP의 최신 상태를 기존 Render sensor_reading으로 합칩니다."""

    normalized_environment = environment_ble_to_state(environment)
    normalized_control = control_ble_to_state(control)
    if not normalized_environment["bme_ok"]:
        raise ProtocolError(
            "BME280 측정값이 없어 sensor_reading을 만들 수 없습니다."
        )

    return {
        "type": "sensor_reading",
        "data": {
            "indoor_temperature": normalized_environment["temperature"],
            "indoor_humidity": normalized_environment["humidity"],
            "window_is_open": normalized_control["window_open"],
            "ac_is_on": normalized_control["fan_on"],
            "power_watt": normalized_control["power_watt"],
            "person_detected": normalized_environment["person_detected"],
        },
    }


def control_state_to_device_state(
    control: dict[str, Any],
    *,
    bme_available: bool,
) -> dict[str, Any]:
    """Control 상태와 Sense BME 가용성을 Render device_state로 합칩니다."""

    normalized_control = control_ble_to_state(control)
    if not isinstance(bme_available, bool):
        raise ProtocolError("bme_available은 true 또는 false여야 합니다.")

    return {
        "type": "device_state",
        "data": {
            "window_is_open": normalized_control["window_open"],
            "ac_is_on": normalized_control["fan_on"],
            "bme_available": bme_available,
        },
    }


def _require_sensor_message(message: dict[str, Any]) -> None:
    if message.get("type") != "sensor":
        raise ProtocolError("BLE 센서 메시지 type은 sensor여야 합니다.")

    bme_ok = message.get("bme_ok")
    if not isinstance(bme_ok, bool):
        raise ProtocolError("bme_ok에 true 또는 false가 필요합니다.")


def sensor_ble_to_device_state(
    message: dict[str, Any],
) -> dict[str, Any]:
    """BME280 상태와 무관하게 리드·릴레이 상태를 서버 형식으로 변환합니다."""

    _require_sensor_message(message)

    return {
        "type": "device_state",
        "data": {
            "window_is_open": _require_bool(message, "window_open"),
            "ac_is_on": _require_bool(message, "fan_on"),
            "bme_available": message["bme_ok"],
        },
    }


def sensor_ble_to_server(
    message: dict[str, Any],
    *,
    fallback_temperature: float | None = None,
    fallback_humidity: float | None = None,
) -> dict[str, Any]:
    """유효한 온습도를 기존 FastAPI sensor_reading 형식으로 변환합니다.

    BME280이 없을 때는 기본적으로 실패합니다. 통신 시연을 위해 호출자가
    fallback 두 값을 모두 명시한 경우에만 해당 값을 사용합니다.
    """

    _require_sensor_message(message)

    has_temperature_fallback = fallback_temperature is not None
    has_humidity_fallback = fallback_humidity is not None
    if has_temperature_fallback != has_humidity_fallback:
        raise ProtocolError(
            "가상 BME 값은 온도와 습도를 함께 설정해야 합니다."
        )

    if message["bme_ok"] is True:
        temperature = _require_number(
            message,
            "temperature",
            minimum=-50,
            maximum=80,
        )
        humidity = _require_number(
            message,
            "humidity",
            minimum=0,
            maximum=100,
        )
    elif has_temperature_fallback and has_humidity_fallback:
        fallback_message = {
            "temperature": fallback_temperature,
            "humidity": fallback_humidity,
        }
        temperature = _require_number(
            fallback_message,
            "temperature",
            minimum=-50,
            maximum=80,
        )
        humidity = _require_number(
            fallback_message,
            "humidity",
            minimum=0,
            maximum=100,
        )
    else:
        raise ProtocolError(
            "BME280 측정값이 없어 서버 전송을 건너뜁니다."
        )

    window_open = _require_bool(message, "window_open")
    fan_on = _require_bool(message, "fan_on")

    return {
        "type": "sensor_reading",
        "data": {
            "indoor_temperature": temperature,
            "indoor_humidity": humidity,
            "window_is_open": window_open,
            # 현재 FastAPI/DB 계약에서 팬은 에어컨 대체 장치입니다.
            "ac_is_on": fan_on,
        },
    }


def server_command_to_ble(message: dict[str, Any]) -> bytes:
    if message.get("type") != "device_command":
        raise ProtocolError("서버 명령 type은 device_command여야 합니다.")

    command_id = message.get("command_id")
    action = message.get("action")

    if not isinstance(command_id, str) or not command_id.strip():
        raise ProtocolError("command_id가 필요합니다.")
    if action not in ALLOWED_ACTIONS:
        raise ProtocolError("지원하지 않는 action입니다.")

    payload = {
        "command_id": command_id.strip(),
        "action": action,
    }
    return json.dumps(
        payload,
        ensure_ascii=True,
        separators=(",", ":"),
    ).encode("utf-8")


def result_ble_to_server(message: dict[str, Any]) -> dict[str, Any]:
    if message.get("type") != "result":
        raise ProtocolError("BLE 결과 메시지 type은 result여야 합니다.")

    command_id = message.get("command_id")
    action = message.get("action")
    success = message.get("success")
    detail = message.get("detail", "")

    if not isinstance(command_id, str):
        raise ProtocolError("command_id는 문자열이어야 합니다.")
    if action not in ALLOWED_ACTIONS and action != "":
        raise ProtocolError("지원하지 않는 결과 action입니다.")
    if not isinstance(success, bool):
        raise ProtocolError("success는 true 또는 false여야 합니다.")
    if not isinstance(detail, str):
        raise ProtocolError("detail은 문자열이어야 합니다.")

    return {
        "type": "command_result",
        "command_id": command_id,
        "action": action,
        "success": success,
        "detail": detail[:200],
    }


def failed_command_result(
    command: dict[str, Any],
    detail: str,
) -> dict[str, Any]:
    command_id = command.get("command_id", "")
    action = command.get("action", "")

    return {
        "type": "command_result",
        "command_id": command_id if isinstance(command_id, str) else "",
        "action": action if isinstance(action, str) else "",
        "success": False,
        "detail": detail[:200],
    }
