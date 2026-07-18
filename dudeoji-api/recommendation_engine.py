"""두더지 추천 판단 규칙 엔진.

실내 온·습도, 실외 날씨 API, 미세먼지, 풍속, 창문 상태와 에어컨 상태를
종합해 환기/냉방/유지 동작을 결정합니다. 프론트 상태 표시와 같은 기준을
사용할 수 있도록 LOGIC_THRESHOLDS를 공개합니다.
"""
from typing import Optional


LOGIC_THRESHOLDS = {
    "sensor_temperature_min": -10.0,
    "sensor_temperature_max": 50.0,
    "indoor_hot": 26.0,
    "indoor_cold": 18.0,
    "indoor_humidity_high": 70.0,
    "thi_high": 75.0,
    "pm25_bad": 35.0,
    "wind_ventilation": 3.0,
    "wind_strong": 10.0,
    "outdoor_temperature_margin": 2.0,
    "ac_cooldown_min_temperature": 22.0,
}


def calculate_thi(temp: float, humidity: float) -> float:
    return (
        1.8 * temp
        - 0.55 * (1 - humidity / 100.0) * (1.8 * temp - 26.0)
        + 32.0
    )


def determine_action(
    indoor_temp: float,
    outdoor_temp: float,
    indoor_humidity: float = 50.0,
    outdoor_humidity: float = 50.0,
    pm25: float = 0.0,
    wind_speed: float = 0.0,
    weather_condition: str = "맑음",
    window_is_open: Optional[bool] = None,
    is_ac_on: Optional[bool] = None,
    current_mode: str = "MANUAL",
    ac_run_time_minutes: int = 0,
    target_cooldown_minutes: int = 30,
):
    """현재 환경을 기준으로 추천 동작을 반환합니다.

    window_is_open=None은 창문 센서가 연결되지 않았거나 값을 받지 못한 상태입니다.
    is_ac_on=None은 에어컨 전원 센서가 연결되지 않았거나 값을 받지 못한 상태입니다.
    추천 action으로 에어컨 전원 상태를 추정하지 않습니다.
    이 경우 닫힘으로 단정하지 않고, 필요한 동작은 조건부 문구로 안내합니다.
    """
    thresholds = LOGIC_THRESHOLDS
    thi = calculate_thi(indoor_temp, indoor_humidity)
    is_auto = current_mode == "AUTO"
    window_state_known = window_is_open is not None
    window_open = window_is_open is True

    if (
        indoor_temp > thresholds["sensor_temperature_max"]
        or indoor_temp < thresholds["sensor_temperature_min"]
    ):
        return {
            "action": "ERROR",
            "title": "센서 점검 필요 🚨",
            "summary": "실내 온도 센서 값이 비정상적입니다.",
            "reason": f"현재 측정된 온도가 {indoor_temp}도로 오류가 의심됩니다.",
            "show_popup": False,
            "popup_message": None,
            "is_auto_triggered": False,
        }

    is_bad_weather = (
        "비" in weather_condition
        or "Rain" in weather_condition
        or "눈" in weather_condition
        or wind_speed >= thresholds["wind_strong"]
    )
    is_bad_air = pm25 > thresholds["pm25_bad"]

    if is_bad_weather or is_bad_air:
        warn_msg = (
            "비가 들이치거나 강한 바람이 유입될 수 있습니다."
            if is_bad_weather
            else "미세먼지 수치가 높습니다."
        )

        if window_open:
            return {
                "action": "CLOSE_WINDOW",
                "title": "창문 단속 제안 🚪" if not is_auto else "자동으로 창문 단속 완료! 🚪",
                "summary": "지금 밖에 비가 오거나 공기가 좋지 않아요.",
                "reason": f"{warn_msg} 창문을 닫아주세요.",
                "show_popup": not is_auto,
                "popup_message": "실외 환경이 좋지 않습니다. 창문을 닫으시겠습니까?",
                "is_auto_triggered": is_auto,
            }

        if indoor_temp >= thresholds["indoor_hot"] or thi >= thresholds["thi_high"]:
            if is_ac_on:
                return {
                    "action": "ENJOY",
                    "title": "시원한 냉기가 집안을 채우는 중 ❄️",
                    "summary": "안전하고 시원하게 온도를 조절하고 있어요.",
                    "reason": (
                        f"실내 불쾌지수가 {thi:.1f}로 높지만 실외 환경이 좋지 않아 "
                        "에어컨을 유지합니다."
                    ),
                    "show_popup": False,
                    "popup_message": None,
                    "is_auto_triggered": False,
                }

            return {
                "action": "USE_AIRCON",
                "title": "에어컨 냉방 추천 ❄️" if not is_auto else "지능형 에어컨 가동 시작! ❄️",
                "summary": "창문을 열 수 없는 실외 환경입니다. 에어컨을 켤까요?",
                "reason": (
                    f"실내가 {indoor_temp}도(불쾌지수 {thi:.1f})로 덥지만 "
                    "실외 날씨나 공기질이 좋지 않아 에어컨 사용을 권장합니다."
                ),
                "show_popup": not is_auto,
                "popup_message": "실외 환경이 좋지 않아 환기하기 어렵습니다. 에어컨을 켜시겠습니까?",
                "is_auto_triggered": is_auto,
            }

        if not window_state_known:
            return {
                "action": "MAINTAIN",
                "title": "창문 상태 확인 필요 🪟",
                "summary": "실외 환경이 좋지 않지만 창문 센서 상태를 확인할 수 없어요.",
                "reason": f"{warn_msg} 창문이 열려 있다면 닫아주세요.",
                "show_popup": False,
                "popup_message": None,
                "is_auto_triggered": False,
            }

        return {
            "action": "MAINTAIN",
            "title": "안전하게 실내 보호 중 😌",
            "summary": "창문이 닫혀 있어 실외 환경으로부터 안전해요.",
            "reason": "실외 환경은 좋지 않지만 실내는 쾌적하게 유지되고 있습니다.",
            "show_popup": False,
            "popup_message": None,
            "is_auto_triggered": False,
        }

    if is_ac_on and ac_run_time_minutes < target_cooldown_minutes:
        if indoor_temp >= thresholds["ac_cooldown_min_temperature"]:
            return {
                "action": "ENJOY",
                "title": "냉기가 집안에 자리 잡는 중 ❄️",
                "summary": (
                    f"에어컨 가동 {ac_run_time_minutes}분 차, "
                    f"목표 시간({target_cooldown_minutes}분)까지 유지하고 있어요."
                ),
                "reason": (
                    "에어컨은 일정 시간 유지하는 것이 효율적입니다. "
                    f"설정한 최소 가동 시간({target_cooldown_minutes}분) 동안 유지합니다."
                ),
                "show_popup": False,
                "popup_message": None,
                "is_auto_triggered": False,
            }

    if indoor_temp >= thresholds["indoor_hot"] or thi >= thresholds["thi_high"]:
        if indoor_humidity >= thresholds["indoor_humidity_high"]:
            if is_ac_on:
                return {
                    "action": "ENJOY",
                    "title": "시원한 냉기가 집안을 채우는 중 ❄️",
                    "summary": "높은 습도를 에어컨으로 조절하고 있어요.",
                    "reason": (
                        f"실내 습도가 {indoor_humidity}%로 높습니다. "
                        "에어컨을 유지해 주세요."
                    ),
                    "show_popup": False,
                    "popup_message": None,
                    "is_auto_triggered": False,
                }

            return {
                "action": "USE_AIRCON",
                "title": "습도 조절 냉방 추천 ❄️" if not is_auto else "쾌적 제습 가동 시작! ❄️",
                "summary": "실내 습도가 높아요. 에어컨을 켤까요?",
                "reason": (
                    f"실내 습도가 {indoor_humidity}%로 높습니다. "
                    "제습과 냉방을 위해 에어컨 가동을 추천합니다."
                ),
                "show_popup": not is_auto,
                "popup_message": "실내가 습합니다. 에어컨을 켜시겠습니까?",
                "is_auto_triggered": is_auto,
            }

        wind_is_helpful = (
            wind_speed >= thresholds["wind_ventilation"]
            and outdoor_temp
            <= indoor_temp + thresholds["outdoor_temperature_margin"]
        )

        if wind_is_helpful:
            if window_open:
                return {
                    "action": "ENJOY",
                    "title": "현재 바깥 바람을 안으로 초대하는 중 🍃",
                    "summary": "자연 바람이 실내를 식히고 있어요.",
                    "reason": (
                        f"풍속 {wind_speed}m/s이고 실외 온도도 환기에 적합해 "
                        "현재 상태를 유지합니다."
                    ),
                    "show_popup": False,
                    "popup_message": None,
                    "is_auto_triggered": False,
                }

            unknown_note = (
                " 창문 센서가 연결되지 않았으므로 닫혀 있다면 열어주세요."
                if not window_state_known
                else ""
            )
            return {
                "action": "OPEN_WINDOW",
                "title": "환기 상태 확인 제안 🪟" if not window_state_known else (
                    "천연 에어컨 작동 제안 🪟" if not is_auto else "천연 에어컨 가동(창문 열기)! 🪟"
                ),
                "summary": "시원한 바람이 불어 자연 환기가 유리해요.",
                "reason": (
                    f"풍속 {wind_speed}m/s이고 실외 온도가 환기 가능한 범위입니다."
                    f"{unknown_note}"
                ),
                "show_popup": not is_auto and window_state_known,
                "popup_message": (
                    "에어컨 대신 창문을 여시겠습니까?"
                    if window_state_known
                    else None
                ),
                "is_auto_triggered": is_auto and window_state_known,
            }

        if outdoor_temp < indoor_temp:
            if window_open:
                return {
                    "action": "ENJOY",
                    "title": "기분 좋은 환기 진행 중 🍃",
                    "summary": "시원한 실외 공기가 들어오고 있어요.",
                    "reason": "실외 온도가 더 낮아 계속 열어두는 것을 추천합니다.",
                    "show_popup": False,
                    "popup_message": None,
                    "is_auto_triggered": False,
                }

            unknown_note = (
                " 창문 센서가 연결되지 않았으므로 닫혀 있다면 열어주세요."
                if not window_state_known
                else ""
            )
            return {
                "action": "OPEN_WINDOW",
                "title": "환기 상태 확인 제안 🪟" if not window_state_known else (
                    "자연 환기 추천 🪟" if not is_auto else "시원한 공기 유입(창문 열기)! 🪟"
                ),
                "summary": "실외 공기가 더 시원해 자연 환기가 유리해요.",
                "reason": (
                    f"실외({outdoor_temp}도)가 실내({indoor_temp}도)보다 시원합니다."
                    f"{unknown_note}"
                ),
                "show_popup": not is_auto and window_state_known,
                "popup_message": (
                    "실외가 더 시원합니다. 창문을 여시겠습니까?"
                    if window_state_known
                    else None
                ),
                "is_auto_triggered": is_auto and window_state_known,
            }

        if is_ac_on:
            return {
                "action": "ENJOY",
                "title": "시원한 냉기가 집안을 채우는 중 ❄️",
                "summary": "에어컨으로 더위를 식히고 있어요.",
                "reason": "바람이 약하고 실외도 더워 에어컨 유지가 적합합니다.",
                "show_popup": False,
                "popup_message": None,
                "is_auto_triggered": False,
            }

        return {
            "action": "USE_AIRCON",
            "title": "에어컨 냉방 가동 추천 ❄️" if not is_auto else "스마트 냉방 가동 시작! ❄️",
            "summary": "바람이 약하고 실외도 더워요. 에어컨을 켤까요?",
            "reason": "실내외 온도가 모두 높아 에어컨이 가장 확실한 냉방 방법입니다.",
            "show_popup": not is_auto,
            "popup_message": "자연풍을 기대하기 어렵습니다. 에어컨을 켜시겠습니까?",
            "is_auto_triggered": is_auto,
        }

    if indoor_temp < thresholds["indoor_cold"]:
        if window_open:
            return {
                "action": "CLOSE_WINDOW",
                "title": "실내 온기 보호 🚪" if not is_auto else "온기 보호를 위해 창문 폐쇄! 🚪",
                "summary": "실내가 쌀쌀해요. 창문을 닫을까요?",
                "reason": f"실내 온도가 {indoor_temp}도로 낮아 창문을 닫아주세요.",
                "show_popup": not is_auto,
                "popup_message": "실내가 쌀쌀합니다. 창문을 닫으시겠습니까?",
                "is_auto_triggered": is_auto,
            }

        if not window_state_known:
            return {
                "action": "CLOSE_WINDOW",
                "title": "창문 상태 확인 제안 🪟",
                "summary": "실내가 쌀쌀하지만 창문 센서가 연결되지 않았어요.",
                "reason": (
                    f"실내 온도가 {indoor_temp}도로 낮습니다. "
                    "창문이 열려 있다면 닫아주세요."
                ),
                "show_popup": False,
                "popup_message": None,
                "is_auto_triggered": False,
            }

        return {
            "action": "MAINTAIN",
            "title": "따뜻하고 아늑하게 유지 중 😌",
            "summary": "현재 창문이 닫혀 있어 온기를 유지하고 있어요.",
            "reason": "실내가 다소 쌀쌀하지만 창문이 닫혀 있습니다.",
            "show_popup": False,
            "popup_message": None,
            "is_auto_triggered": False,
        }

    window_note = (
        " 창문 상태는 센서 미연결로 확인할 수 없습니다."
        if not window_state_known
        else ""
    )
    return {
        "action": "ENJOY",
        "title": "쾌적함 100% 🍃",
        "summary": "현재 실내 환경이 쾌적해요.",
        "reason": (
            f"현재 실내 {indoor_temp}도, 습도 {indoor_humidity}%로 "
            f"추천 기준상 쾌적한 상태입니다.{window_note}"
        ),
        "show_popup": False,
        "popup_message": None,
        "is_auto_triggered": False,
    }
