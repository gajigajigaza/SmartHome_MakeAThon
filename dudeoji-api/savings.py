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
from recommendation_engine import VENTILATION_ACTIONS

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
    window_is_open: Optional[bool] = None,
    ac_is_on: Optional[bool] = None,
    current_ac_is_on: Optional[bool] = None,
) -> dict:
    """구간 시작 시점(직전 reading)의 상태로, 그 구간(duration_hours) 동안의
    절감/소비 총량을 정산한다(interval closing).

    action/window_is_open/ac_is_on은 "지금 이 순간"이 아니라 호출부가 넘긴
    "그 구간이 시작될 때 실제로 확인된 상태"여야 한다 — 그 상태가 구간 내내
    유지됐다고 가정하는 방식(get_cumulative_kwh()와 같은 관례)이라, 방금
    들어온 새 reading의 상태로 과거 구간을 소급 판단하지 않는다.

    jh 수정함 - recommendation_engine.determine_action()은 window_is_open이
    이미 True면 "OPEN_WINDOW"가 아니라 "ENJOY"를 반환한다(창문을 열라고
    또 추천하지 않고 "잘 하고 있다"고만 알려줌). 그래서 action=="OPEN_WINDOW"
    and window_is_open is True는 같은 reading 안에서 동시에 성립할 수 없는
    조합이라 절감이 항상 0이었다. "환기 대체 시간"의 실제 의미는 "창문을
    열라고 추천했거나(OPEN_WINDOW), 이미 열어서 잘 유지 중이라고
    확인해준(ENJOY) 구간에서, 실제로 창문 열림+에어컨 꺼짐이 확인된 시간"
    이므로 ENJOY도 인정 대상에 포함한다. window_is_open이 True이고
    ac_is_on이 False로 실제 확인됐을 때만 절감으로 인정하는 건 그대로다
    (추천만 됐고 실제로 창문을 열었는지는 모를 수 있어서).

    jh 수정함 - TURN_OFF_AIRCON은 그 정의상 구간이 "시작될 때" 항상
    ac_is_on=True다(모든 TURN_OFF_AIRCON 분기가 is_ac_on=True를 전제로
    함) — 그래서 ENJOY처럼 "구간 시작 상태로 이미 확인된 절감"을 못 쓴다.
    이 액션만 예외적으로 current_ac_is_on(구간이 끝나는 지금 이 reading에서
    새로 확인된 실제 에어컨 상태)을 받아서, "꺼라고 추천했고 실제로 꺼진
    게 지금 확인됐다"를 그 구간(duration_hours) 전체의 절감으로 인정한다.
    창문을 열 필요가 없는 상황(재실 없음 등)이라 window_is_open은 안 본다.
    """
    power_w = rated_power_w if rated_power_w is not None else DEFAULT_POWER_W
    cumulative_kwh = (
        cumulative_kwh_this_month
        if cumulative_kwh_this_month is not None
        else DEFAULT_CUMULATIVE_KWH
    )
    power_kw = power_w / 1000
    kwh_total = power_kw * duration_hours

    if (
        action in VENTILATION_ACTIONS
        and window_is_open is True
        and ac_is_on is False
    ):
        power_saved_kwh = kwh_total
        message = "환기로 에어컨 가동을 대체했어요"
    elif action == "TURN_OFF_AIRCON" and current_ac_is_on is False:
        power_saved_kwh = kwh_total
        message = "에어컨을 꺼서 전력 낭비를 막았어요"
    elif action == "TURN_OFF_AIRCON":
        power_saved_kwh = 0.0
        message = "에어컨 끄기를 추천했지만 아직 꺼지지 않았어요"
    elif action == "OPEN_WINDOW":
        power_saved_kwh = 0.0
        message = "창문 열기를 추천했지만 실제 환기 상태가 확인되지 않았어요"
    elif action == "USE_AIRCON":
        power_saved_kwh = -kwh_total
        message = "에어컨을 가동해 전력을 소비했어요"
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
    """이번 달(1일 0시~현재) 동안 사용자의 에어컨 가동으로 소비된 누적 전력(kWh), 실측(ac_is_on) 기준.

    readings.place_id가 있는 행은 그 장소에 등록된 에어컨의 정격 전력을 그대로
    쓴다. place_id가 NULL인 행(마이그레이션 이전에 저장된 기존 데이터, 또는
    place_id 없이 저장된 예외 상황)은 사용자의 (가장 오래된) 장소 정격 전력으로
    근사한다.

    jh 수정함 - readings_router.py의 팬아웃 도입(실내값 1건 → 사용자의 모든
    장소에 각각 저장) 때문에, 물리 센서 한 번 push당 여러 장소 행이 거의
    같은 시각에 연달아 insert된다. 이전처럼 "user_id로만 조회해서 전체를
    시간순으로 훑으며 연속 행끼리 시간차"를 계산하면, 같은 배치 안 형제
    행끼리는 몇 초 차이(→ kWh 거의 0)로 뭉개지고 배치 사이 진짜 간격은
    그 배치의 마지막 place에만 몰빵돼서 소비량이 왜곡된다. place_id별로
    먼저 그룹화한 뒤 그룹 안에서만 연속 시간차를 계산하도록 고쳤다.
    place_id가 NULL인 행들은 서로 하나의 그룹으로만 묶는다(다른 place
    그룹과 안 섞이게).

    jh 수정함 - 구간 누적 조건을 추천 action(USE_AIRCON/ENJOY) 기준에서
    실제 ac_is_on 센서값 기준으로 바꿨다. 알고 싶은 건 "그 구간 동안
    에어컨이 실제로 켜져 있었는지"지 그 순간 무엇을 추천했는지가 아니라서.
    ac_is_on이 None(센서 미연결)이거나 False면 소비 0으로 잡히므로, 센서가
    없는 계정은 이번 달 누적이 계속 0 → estimate_savings()의 누진 단가가
    항상 1구간(최저가)으로 고정된다 — 실측이 없으니 보수적으로 최저가를
    쓰는 의도된 동작이다.
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

    readings_by_place: dict = {}
    for reading in readings:
        readings_by_place.setdefault(reading.get("place_id"), []).append(reading)

    total_kwh = 0.0
    for place_id, place_readings in readings_by_place.items():
        if len(place_readings) < 2:
            continue

        power_kw = power_kw_for(place_id)
        for current_reading, next_reading in zip(place_readings, place_readings[1:]):
            is_ac_on = (
                current_reading.get("recommendation") or {}
            ).get("ac_is_on") is True
            if not is_ac_on:
                continue

            current_time = datetime.fromisoformat(
                current_reading["measured_at"].replace("Z", "+00:00")
            )
            next_time = datetime.fromisoformat(
                next_reading["measured_at"].replace("Z", "+00:00")
            )
            hours = (next_time - current_time).total_seconds() / 3600
            total_kwh += hours * power_kw

    return total_kwh


def get_savings_summary(
    user_id: str, period: str, place_id: Optional[str] = None
) -> dict:
    """기간(day/week/month) 동안 저장된 reading들의 recommendation.savings 값을 그대로 합산한다.

    get_cumulative_kwh()와 달리 새로 계산하지 않고, save_reading_for_user()가
    각 reading에 저장해둔 savings 스냅샷(power_saved_kwh, cost_won)을 그대로 더한다.
    savings가 없는 기존 데이터(마이그레이션 이전 등)는 건너뛴다.

    jh 수정함 - 표시 정책: 저장된 스냅샷 중 양수(환기 절감)만 합산한다.
    음수(에어컨 소비) 스냅샷은 reading에는 계속 저장되지만(estimate_savings()가
    interval closing으로 계산·기록하는 원본 데이터는 그대로 보존 — 나중에
    "소비 리포트"를 따로 만들 때 필요) 이 절감 합계에는 포함하지 않는다.
    표시 계층에서만 걸러내는 것이라 저장 계층(estimate_savings/get_cumulative_kwh)은
    건드리지 않는다. 그 결과 합계는 항상 0 이상이다.
    place_id를 주면 해당 장소의 reading만 집계하고, 안 주면 사용자의 모든 장소를 합산한다.
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

    query = (
        supabase.table(READINGS_TABLE)
        .select("recommendation")
        .eq("user_id", user_id)
        .gte("measured_at", period_start.isoformat())
    )
    if place_id is not None:
        query = query.eq("place_id", place_id)

    readings_result = query.execute()

    total_power_saved_kwh = 0.0
    total_cost_won = 0

    for reading in readings_result.data or []:
        recommendation = reading.get("recommendation") or {}
        savings = recommendation.get("savings")
        if not savings:
            continue

        power_saved_kwh = savings.get("power_saved_kwh") or 0.0
        if power_saved_kwh <= 0:
            continue
        total_power_saved_kwh += power_saved_kwh
        total_cost_won += savings.get("cost_won") or 0

    return {
        "period": period,
        "power_saved_kwh": round(total_power_saved_kwh, 3),
        "cost_won": round(total_cost_won),
    }


if __name__ == "__main__":
    print(estimate_savings("OPEN_WINDOW", 2000, 0.5, 250, window_is_open=True, ac_is_on=False))
    print(estimate_savings("USE_AIRCON", 2000, 0.5, 250))
