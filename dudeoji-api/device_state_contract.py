"""게이트웨이와 웹 사이 device_state 메시지 계약입니다."""

from typing import Any


DEVICE_STATE_CORE_BOOL_FIELDS = (
    "window_is_open",
    "ac_is_on",
    "bme_available",
)

DEVICE_STATE_OPTIONAL_BOOL_FIELDS = (
    "sense_connected",
    "control_connected",
    "ina_available",
)


class DeviceStateContractError(ValueError):
    """device_state.data가 계약에 맞지 않을 때 발생합니다."""


def validate_device_state_data(data: Any) -> dict[str, bool]:
    """구버전 3필드와 신버전 선택 필드를 함께 검증해 반환합니다."""

    if not isinstance(data, dict):
        raise DeviceStateContractError("device_state.data 객체가 필요합니다.")

    normalized: dict[str, bool] = {}
    for field in DEVICE_STATE_CORE_BOOL_FIELDS:
        value = data.get(field)
        if not isinstance(value, bool):
            raise DeviceStateContractError(
                "device_state에는 window_is_open, ac_is_on, "
                "bme_available 불리언 값이 필요합니다."
            )
        normalized[field] = value

    for field in DEVICE_STATE_OPTIONAL_BOOL_FIELDS:
        if field not in data:
            continue

        value = data[field]
        if not isinstance(value, bool):
            raise DeviceStateContractError(
                f"device_state의 {field} 값은 불리언이어야 합니다."
            )
        normalized[field] = value

    return normalized
