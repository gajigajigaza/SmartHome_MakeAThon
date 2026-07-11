"""절감량(전력·시간·비용) 계산 모듈.

담당: 정현(나)
"예상 절감(1일/1주/1달)" 화면과 연결됩니다.
recommendation_engine.py의 determine_action()이 액션을 정하면,
이 모듈이 그 액션에 대한 절감 수치·멘트를 계산해서 붙여줍니다.

TODO(정현): 지금은 창문 개방 1회당 고정값이지만, 실제 실내외 온도차·
지속 시간을 반영한 수치로 구체화하고, 1일/1주/1달 누적 합산 함수를
추가할 예정입니다 (예: estimate_daily_savings, estimate_weekly_savings).
"""
from typing import TypedDict


class SavingsEstimate(TypedDict):
    power_saved_kwh: float
    time_applied_hours: float
    cost_won: int
    message: str


def estimate_savings(action: str) -> SavingsEstimate:
    """행동(action)에 따른 절감량 추정치."""
    if action == "OPEN_WINDOW":
        return {
            "power_saved_kwh": 0.5,
            "time_applied_hours": 1,
            "cost_won": 150,
            "message": "창문 열기로 에어컨 대비 약 150원의 전기료를 아꼈어요! 두두가 상쾌한 바람을 즐깁니다.",
        }

    return {
        "power_saved_kwh": 0.0,
        "time_applied_hours": 0,
        "cost_won": 0,
        "message": "전력 절감을 위해 외부 공기가 시원해지기를 기다리고 있어요.",
    }
