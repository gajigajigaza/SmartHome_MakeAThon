"""프로필(뱃지) 잠금 해제 조건 계산 모듈.

기존엔 프론트(src/shared/profileBadges.jsx)에 unlocked: true/false가 그냥
박혀 있어서 실제 사용 여부와 무관했다. 여기서는 이미 있는 데이터(절감량
합산, 추천 수락/거절 로그, 에어컨 등록, reading의 추천 action)만으로 계산
가능한 조건은 그대로 재사용하고, 없던 것(수동 조작 여부)만
device_control_events 표를 새로 추가해서 채웠다.

뱃지 이름/설명/아이콘 같은 표시용 메타데이터는 여기 두지 않는다 — 프론트
shared/profileBadges.jsx가 id로 갖고 있고(화면 담당), 여기는 "그 id가
잠겼는지/진행도가 얼마인지"만 계산한다. 새 뱃지를 추가하려면 이 파일의
BADGE ID 조건 하나 + 프론트 메타데이터 항목 하나, 둘 다 같은 id로 맞춰야
한다.
"""
from typing import Optional

from db import (
    DEVICE_CONTROL_EVENTS_TABLE,
    PLACES_TABLE,
    READINGS_TABLE,
    RECOMMENDATION_REFRESH_EVENTS_TABLE,
    USER_AIRCONS_TABLE,
    supabase,
)
from savings import get_savings_summary

# 창문 열기를 추천받았거나(OPEN_WINDOW), 이미 열어서 잘 유지 중이라고
# 확인해준(ENJOY) reading을 "환기 활용"으로 센다. savings.py의 절감 인정
# 조건(estimate_savings)과 달리 여기는 "추천을 몇 번 접했는지" 자체가
# 퀘스트라 실제 절감 성사 여부는 안 본다.
VENTILATION_ACTIONS = ("OPEN_WINDOW", "ENJOY")

VENTILATION_TARGET = 5
ACCEPT_TARGET = 10
REJECT_TARGET = 10
POWER_TIER_TARGETS_KWH = (1, 5, 20)


def _get_user_place_ids(user_id) -> list:
    result = (
        supabase.table(PLACES_TABLE).select("id").eq("user_id", user_id).execute()
    )
    return [row["id"] for row in (result.data or [])]


def _has_any_reading(user_id) -> bool:
    result = (
        supabase.table(READINGS_TABLE)
        .select("id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return bool(result.data)


def _count_ventilation_readings(user_id) -> int:
    result = (
        supabase.table(READINGS_TABLE)
        .select("recommendation")
        .eq("user_id", user_id)
        .execute()
    )
    return sum(
        1
        for row in (result.data or [])
        if (row.get("recommendation") or {}).get("action") in VENTILATION_ACTIONS
    )


def _has_registered_aircon(user_id) -> bool:
    place_ids = _get_user_place_ids(user_id)
    if not place_ids:
        return False

    result = (
        supabase.table(USER_AIRCONS_TABLE)
        .select("id")
        .in_("place_id", place_ids)
        .limit(1)
        .execute()
    )
    return bool(result.data)


def _count_refresh_outcomes(user_id, outcome: str) -> int:
    result = (
        supabase.table(RECOMMENDATION_REFRESH_EVENTS_TABLE)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("previous_outcome", outcome)
        .execute()
    )
    return result.count or 0


def _count_manual_control_events(user_id) -> int:
    result = (
        supabase.table(DEVICE_CONTROL_EVENTS_TABLE)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("source", "manual")
        .execute()
    )
    return result.count or 0


def _progress(current: float, target: float) -> dict:
    return {"current": min(current, target), "target": target}


def get_badge_states(user_id) -> list[dict]:
    """뱃지 id별 잠금 여부 + 진행도(progress)를 계산해 반환한다.

    표시용 이름/설명은 포함하지 않는다 - 프론트가 id로 자기 메타데이터와
    합친다.
    """
    lifetime_kwh = get_savings_summary(user_id, "all")["power_saved_kwh"]
    accepted_count = _count_refresh_outcomes(user_id, "AUTO_EXECUTED")
    rejected_count = _count_refresh_outcomes(user_id, "REJECTED_MANUAL")
    manual_control_count = _count_manual_control_events(user_id)
    ventilation_count = _count_ventilation_readings(user_id)
    has_reading = _has_any_reading(user_id)
    has_aircon = _has_registered_aircon(user_id)

    states = [
        {"id": "sprout", "unlocked": True, "progress": None},
        {
            "id": "energy-saver",
            "unlocked": has_reading,
            "progress": _progress(1 if has_reading else 0, 1),
        },
        {
            "id": "cool-window",
            "unlocked": ventilation_count >= VENTILATION_TARGET,
            "progress": _progress(ventilation_count, VENTILATION_TARGET),
        },
        {
            "id": "ice-master",
            "unlocked": has_aircon,
            "progress": _progress(1 if has_aircon else 0, 1),
        },
        {
            "id": "accept-10",
            "unlocked": accepted_count >= ACCEPT_TARGET,
            "progress": _progress(accepted_count, ACCEPT_TARGET),
        },
        {
            "id": "reject-10",
            "unlocked": rejected_count >= REJECT_TARGET,
            "progress": _progress(rejected_count, REJECT_TARGET),
        },
        {
            "id": "manual-first",
            "unlocked": manual_control_count >= 1,
            "progress": _progress(manual_control_count, 1),
        },
    ]

    for tier_index, target_kwh in enumerate(POWER_TIER_TARGETS_KWH, start=1):
        states.append(
            {
                "id": f"power-hero-{tier_index}",
                "unlocked": lifetime_kwh >= target_kwh,
                "progress": _progress(round(lifetime_kwh, 3), target_kwh),
            }
        )

    return states
