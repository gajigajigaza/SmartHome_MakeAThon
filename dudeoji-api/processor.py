"""통합 판단 규칙 엔진.

minzoo 브랜치에서 옮겨온 모듈입니다. 온습도만 보던 ryeun의 단순 로직 대신
불쾌지수(THI) + 미세먼지 + 강풍 + 강우/강설/태풍 여부까지 함께 고려합니다.
"""
from typing import Optional, TypedDict


def calculate_thi(temp: float, humidity: float) -> float:
    """불쾌지수(THI) 계산 공식."""
    return 0.81 * temp + 0.01 * humidity * (0.99 * temp - 14.3) + 46.3


class SavingsEstimate(TypedDict):
    power_saved_kwh: float
    time_applied_hours: float
    cost_won: int
    message: str


def estimate_savings(action: str) -> SavingsEstimate:
    """행동(action)에 따른 절감량 추정치.

    지금은 창문 개방 1회당 고정값으로 추정하지만, '나' 담당의
    예상 절감(1일/1주/1달) 기능에서 이 값을 누적해 계산할 예정입니다.
    """
    if action == "OPEN_WINDOW":
        return {
            "power_saved_kwh": 0.5,
            "time_applied_hours": 1,
            "cost_won": 150,
            "message": "창문 열기로 에어컨 대비 약 150원의 전기료를 아꼈어요!",
        }

    return {
        "power_saved_kwh": 0.0,
        "time_applied_hours": 0,
        "cost_won": 0,
        "message": "전력 절감을 위해 외부 공기가 시원해지기를 기다리고 있어요.",
    }


def determine_action(
    indoor_temperature: float,
    indoor_humidity: float,
    outdoor_temperature: float,
    outdoor_humidity: float,
    weather_condition: str = "맑음",
    pm25: Optional[float] = None,
    wind_speed: Optional[float] = None,
    window_is_open: bool = False,
) -> dict:
    """실내외 환경 + 외부 날씨 조건을 종합해 액션과 사유를 반환합니다."""

    pm25_value = 10.0 if pm25 is None else pm25
    wind_speed_value = 2.0 if wind_speed is None else wind_speed

    thi_in = calculate_thi(indoor_temperature, indoor_humidity)
    temperature_difference = indoor_temperature - outdoor_temperature

    is_raining = weather_condition in ("비", "소나기")
    is_snowing = weather_condition == "눈"
    is_typhoon = weather_condition == "태풍"
    is_dusty = pm25_value > 35.0
    is_windy = wind_speed_value > 8.0
    is_too_hot_outside = outdoor_temperature >= indoor_temperature

    bad_outdoor_condition = (
        is_raining or is_snowing or is_typhoon or is_dusty or is_windy or is_too_hot_outside
    )

    warning_message = None
    if is_typhoon:
        warning_message = "🚨 태풍이 불고 있어요. 창문을 열지 마세요."
    elif is_dusty:
        warning_message = "🚨 외부 미세먼지 수치가 나빠요."
    elif is_windy:
        warning_message = "🚨 강풍 주의보예요."

    action = "MAINTAIN"
    title = "현재 상태를 유지해도 좋아요"
    summary = "실내 환경이 비교적 쾌적한 범위입니다."
    reason = f"현재 실내 온도는 {indoor_temperature:.1f}℃로 냉방이 꼭 필요한 수준은 아닙니다."

    needs_cooling = indoor_temperature >= 27 or thi_in >= 75

    if needs_cooling:
        if bad_outdoor_condition:
            action = "USE_AIRCON"
            title = "에어컨 사용을 권장해요"
            if is_dusty:
                reason_prefix = "미세먼지가 나빠서"
            elif is_raining or is_snowing:
                reason_prefix = "비/눈이 와서"
            elif is_typhoon:
                reason_prefix = "태풍이 불어서"
            elif is_windy:
                reason_prefix = "바람이 너무 강해서"
            else:
                reason_prefix = "바깥이 실내보다 더워서"
            summary = "외부 공기로는 실내를 충분히 식히기 어렵습니다."
            reason = (
                f"{reason_prefix} 자연환기 대신 냉방이 적절합니다. "
                f"(실내외 온도차 {temperature_difference:.1f}℃, 불쾌지수 {thi_in:.0f})"
            )
        else:
            action = "OPEN_WINDOW"
            title = "지금은 창문을 열어보세요"
            summary = "실외 공기가 더 시원하고 쾌적합니다."
            reason = (
                f"실외 온도가 실내보다 {abs(temperature_difference):.1f}℃ 낮고, "
                f"미세먼지·바람 상태도 양호해 자연환기가 유리합니다."
            )

    savings = estimate_savings(action)

    return {
        "action": action,
        "title": title,
        "summary": summary,
        "reason": reason,
        "warning": warning_message,
        "savings": savings,
    }
