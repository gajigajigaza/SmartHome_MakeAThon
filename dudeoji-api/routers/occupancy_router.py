"""재실 감지 이력 수신 + 패턴 학습 트리거 API.

담당: 정현(나). 센서 담당 팀원의 보드(Edge Impulse 온보드 추론)가 감지할
때마다 `POST /api/occupancy/logs`로 재실 여부를 보낸다. 이 값이 서버로
넘어오는 형태는 감지 방식(YOLO26+Pi든 Edge Impulse 온보드든)과 무관하게
항상 동일하다. `/api/dev/occupancy/*`는 실제 하드웨어 없이 가짜 이력으로
패턴 학습을 데모/테스트하기 위한 개발용 엔드포인트.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from auth_utils import execute_supabase_with_retry, get_current_user
from db import OCCUPANCY_LOGS_TABLE, OCCUPANCY_MODELS_TABLE, supabase
from dev_tools.mock_generator import generate_mock_occupancy_history
from occupancy_engine import train_occupancy_pattern
from routers.readings_router import get_place_for_user

router = APIRouter(prefix="/api", tags=["occupancy"])

_INSERT_CHUNK_SIZE = 500


class OccupancyLogCreate(BaseModel):
    place_id: int = Field(ge=1)
    person_detected: bool
    confidence: Optional[float] = Field(default=None, ge=0, le=1)


class OccupiedWindow(BaseModel):
    weekdays: list[int] = Field(min_length=1)
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=1, le=24)


class OccupancySeedRequest(BaseModel):
    place_id: int = Field(ge=1)
    days: int = Field(default=21, ge=1, le=90)
    interval_minutes: int = Field(default=15, ge=1, le=120)
    occupied_windows: list[OccupiedWindow]
    replace_existing: bool = True


def _insert_logs_in_chunks(rows: list[dict]) -> None:
    for start in range(0, len(rows), _INSERT_CHUNK_SIZE):
        chunk = rows[start : start + _INSERT_CHUNK_SIZE]
        execute_supabase_with_retry(
            lambda chunk=chunk: (
                supabase.table(OCCUPANCY_LOGS_TABLE).insert(chunk).execute()
            )
        )


@router.post("/occupancy/logs", status_code=status.HTTP_201_CREATED)
def create_occupancy_log(
    payload: OccupancyLogCreate,
    current_user: dict = Depends(get_current_user),
):
    """센서 담당 보드/스크립트가 재실 감지할 때마다 호출하는 엔드포인트."""
    get_place_for_user(current_user["id"], payload.place_id)

    row = {
        "place_id": payload.place_id,
        "person_detected": payload.person_detected,
        "confidence": payload.confidence,
    }
    result = execute_supabase_with_retry(
        lambda: supabase.table(OCCUPANCY_LOGS_TABLE).insert(row).execute()
    )
    return result.data[0]


@router.get("/occupancy/pattern")
def read_occupancy_pattern(
    place_id: int = Query(ge=1),
    current_user: dict = Depends(get_current_user),
):
    """학습된 평일/주말 패턴 모델 조회 — 디버깅/데모 화면용."""
    get_place_for_user(current_user["id"], place_id)

    result = execute_supabase_with_retry(
        lambda: (
            supabase.table(OCCUPANCY_MODELS_TABLE)
            .select("day_type, hour_weights, sample_count, trained_at")
            .eq("place_id", place_id)
            .execute()
        )
    )
    return {"place_id": place_id, "models": result.data or []}


@router.post("/dev/occupancy/train")
def train_occupancy_now(
    place_id: int = Query(ge=1),
    current_user: dict = Depends(get_current_user),
):
    """재시딩 없이 기존 occupancy_logs만으로 재학습한다."""
    get_place_for_user(current_user["id"], place_id)
    return train_occupancy_pattern(place_id)


@router.post("/dev/occupancy/seed", status_code=status.HTTP_201_CREATED)
def seed_occupancy_history(
    payload: OccupancySeedRequest,
    current_user: dict = Depends(get_current_user),
):
    """데모/개발용: 가짜 재실 이력을 생성해 채워 넣고 바로 학습까지 실행한다.

    실제 팀원 하드웨어(Edge Impulse 보드) 없이도 "이력 축적 -> 패턴 학습 ->
    빈 방 추천" 전체 흐름을 즉시 확인할 수 있게 하는 것이 목적.
    """
    place = get_place_for_user(current_user["id"], payload.place_id)

    if payload.replace_existing:
        execute_supabase_with_retry(
            lambda: (
                supabase.table(OCCUPANCY_LOGS_TABLE)
                .delete()
                .eq("place_id", place["id"])
                .execute()
            )
        )

    generated = generate_mock_occupancy_history(
        occupied_windows=[window.model_dump() for window in payload.occupied_windows],
        days=payload.days,
        interval_minutes=payload.interval_minutes,
    )

    rows = [
        {
            "place_id": place["id"],
            "person_detected": log["person_detected"],
            "detected_at": log["detected_at"],
        }
        for log in generated
    ]
    _insert_logs_in_chunks(rows)

    training_result = train_occupancy_pattern(place["id"])

    return {
        "place_id": place["id"],
        "seeded_logs": len(rows),
        "training_result": training_result,
    }
