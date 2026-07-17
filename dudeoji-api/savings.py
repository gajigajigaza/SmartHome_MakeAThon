"""절감량(전력·비용) 계산 모듈.

담당: 정현(나)
"예상 절감(1일/1주/1달)" 화면과 연결됩니다.
recommendation_engine.py의 determine_action()이 액션을 정하면,
이 모듈이 그 액션에 대한 절감 수치·멘트를 계산해서 붙여줍니다.
(주의: 지금은 recommendation_engine.py가 이 모듈을 호출하지 않아 파이프라인과
분리된 상태 — 연동은 별도 작업.)

한전 공고 기준 2026년 추정치, 실제 요금표 변경 가능.

TODO(정현): 일/주/월 누적 합산 함수(estimate_daily_savings 등)는 아직 없음.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from db import PLACES_TABLE, READINGS_TABLE, USER_AIRCONS_TABLE, supabase

# 전력량요금(원/kWh) 누진 구간표. 기본요금(월 고정비)은 시간당 계산에
# 포함하지 않으므로 제외. 각 항목은 (구간상한kWh, 그 구간의 단가) 형태이며,
# 마지막 구간의 상한은 무한대(float("inf"))로 표현한다.
TARIFF_NORMAL = [
    (200, 120.0),
    (400, 214.6),
    (float("inf"), 307.3),
]

TARIFF_SUMMER = [
    (300, 120.0),
    (450, 214.6),
    (float("inf"), 307.3),
]

DEFAULT_POWER_W = 2000
# TODO: readings 히스토리 누적 합산으로 교체 예정. 지금은 평균 가정(4인) 월사용량 근사치.
DEFAULT_CUMULATIVE_KWH = 300


def is_current_month_summer() -> bool:
    """현재 달이 여름철(7~8월) 요금 구간에 해당하는지 여부."""
    return datetime.now().month in (7, 8)


def get_marginal_price(cumulative_kwh_this_month: float, is_summer: bool) -> float:
    """이번 달 누적 사용량 기준으로 '다음 1kWh'에 적용될 한계단가(원/kWh)를 반환한다."""
    tariff = TARIFF_SUMMER if is_summer else TARIFF_NORMAL

    for upper_bound_kwh, unit_price in tariff:
        if cumulative_kwh_this_month < upper_bound_kwh:
            return unit_price

    return tariff[-1][1]


def estimate_savings(
    action: str,
    rated_power_w: Optional[int] = None,
    duration_hours: float = 1.0,
    cumulative_kwh_this_month: Optional[float] = None,
) -> dict:
    """행동(action)이 실제 유지된 시간(duration_hours) 동안의 절감/소비 총량 추정치."""
    power_w = rated_power_w if rated_power_w is not None else DEFAULT_POWER_W
    cumulative_kwh = (
        cumulative_kwh_this_month
        if cumulative_kwh_this_month is not None
        else DEFAULT_CUMULATIVE_KWH
    )
    power_kw = power_w / 1000
    kwh_total = power_kw * duration_hours

    if action == "OPEN_WINDOW":
        power_saved_kwh = kwh_total
        message = "환기로 에어컨 가동을 대체 중이에요"
    elif action == "USE_AIRCON":
        power_saved_kwh = -kwh_total
        message = "에어컨을 가동해 전력을 소비하고 있어요"
    else:
        power_saved_kwh = 0.0
        message = "지금은 절감량 계산 대상 행동이 아니에요"

    is_summer = is_current_month_summer()
    marginal_price = get_marginal_price(cumulative_kwh, is_summer)
    cost_won = round(power_saved_kwh * marginal_price)

    return {
        "power_saved_kwh": power_saved_kwh,
        "time_applied_hours": duration_hours,
        "cost_won": cost_won,
        "message": message,
    }


def get_rated_power(place_id: str) -> Optional[int]:
    """place_id에 등록된 에어컨의 정격 냉방 전력(W)을 반환한다. 없으면 None.

    TODO: 여러 대 처리 방식은 추후 결정. 지금은 먼저 조회된 에어컨 하나만 쓴다.
    """
    result = (
        supabase.table(USER_AIRCONS_TABLE)
        .select("rated_cooling_power_w")
        .eq("place_id", place_id)
        .order("created_at")
        .limit(1)
        .execute()
    )

    if not result.data:
        return None

    return result.data[0].get("rated_cooling_power_w")


def get_cumulative_kwh(user_id: str) -> float:
    """이번 달(1일 0시~현재) 동안 사용자의 에어컨 가동으로 소비된 누적 전력(kWh) 추정치.

    readings.place_id가 있는 행은 그 장소에 등록된 에어컨의 정격 전력을 그대로
    쓴다. place_id가 NULL인 행(마이그레이션 이전에 저장된 기존 데이터, 또는
    아직 readings_router.py가 place_id를 채우지 않는 경우)은 사용자의
    (가장 오래된) 장소 정격 전력으로 근사한다 — 알려진 한계, CLAUDE.md의
    readings_router.py 항목 참고.
    """
    place_result = (
        supabase.table(PLACES_TABLE)
        .select("id")
        .eq("user_id", user_id)
        .order("created_at")
        .limit(1)
        .execute()
    )

    fallback_place_id = place_result.data[0]["id"] if place_result.data else None
    rated_power_kw_by_place: dict = {}

    def power_kw_for(place_id):
        lookup_id = place_id if place_id is not None else fallback_place_id
        if lookup_id not in rated_power_kw_by_place:
            power_w = get_rated_power(lookup_id) if lookup_id is not None else None
            rated_power_kw_by_place[lookup_id] = (power_w or DEFAULT_POWER_W) / 1000
        return rated_power_kw_by_place[lookup_id]

    month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )

    readings_result = (
        supabase.table(READINGS_TABLE)
        .select("measured_at,recommendation,place_id")
        .eq("user_id", user_id)
        .gte("measured_at", month_start.isoformat())
        .order("measured_at")
        .execute()
    )

    readings = readings_result.data or []
    if len(readings) < 2:
        return 0.0

    total_kwh = 0.0
    for current_reading, next_reading in zip(readings, readings[1:]):
        action = (current_reading.get("recommendation") or {}).get("action")
        is_ac_on = action in ("USE_AIRCON", "ENJOY")
        if not is_ac_on:
            continue

        current_time = datetime.fromisoformat(
            current_reading["measured_at"].replace("Z", "+00:00")
        )
        next_time = datetime.fromisoformat(
            next_reading["measured_at"].replace("Z", "+00:00")
        )
        hours = (next_time - current_time).total_seconds() / 3600
        power_kw = power_kw_for(current_reading.get("place_id"))
        total_kwh += hours * power_kw

    return total_kwh


def get_savings_summary(user_id: str, period: str) -> dict:
    """기간(day/week/month) 동안 저장된 reading들의 recommendation.savings 값을 그대로 합산한다.

    get_cumulative_kwh()와 달리 새로 계산하지 않고, save_reading_for_user()가
    각 reading에 저장해둔 savings 스냅샷(power_saved_kwh, cost_won)을 그대로 더한다.
    savings가 없는 기존 데이터(마이그레이션 이전 등)는 건너뛴다.
    action이 OPEN_WINDOW인 reading만 "절감"으로 집계하고, USE_AIRCON(소비) 등
    나머지 action은 제외한다 — 그래서 합계는 항상 0 이상이다.
    """
    now = datetime.now(timezone.utc)

    if period == "day":
        period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        period_start = today_start - timedelta(days=today_start.weekday())
    elif period == "month":
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        raise ValueError(f"알 수 없는 period입니다: {period}")

    readings_result = (
        supabase.table(READINGS_TABLE)
        .select("recommendation")
        .eq("user_id", user_id)
        .gte("measured_at", period_start.isoformat())
        .execute()
    )

    total_power_saved_kwh = 0.0
    total_cost_won = 0

    for reading in readings_result.data or []:
        recommendation = reading.get("recommendation") or {}
        if recommendation.get("action") != "OPEN_WINDOW":
            continue

        savings = recommendation.get("savings")
        if not savings:
            continue
        total_power_saved_kwh += savings.get("power_saved_kwh") or 0.0
        total_cost_won += savings.get("cost_won") or 0

    return {
        "period": period,
        "power_saved_kwh": round(total_power_saved_kwh, 3),
        "cost_won": round(total_cost_won),
    }


if __name__ == "__main__":
    print(estimate_savings("OPEN_WINDOW", 2000, 0.5, 250))
    print(estimate_savings("USE_AIRCON", 2000, 0.5, 250))
