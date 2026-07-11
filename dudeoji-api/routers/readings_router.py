"""센서 기록 저장/조회 + 추천 API.

담당: 민주

"결과 추천 화면"과 "최근 온도 변화 화면"이 이 파일의 API(recommendation,
readings/history)를 그대로 씁니다. MQTT/dev_tools로 들어오는 센서 데이터도
결국 이 파일의 save_reading_for_user()로 저장되니, 센서 데이터가 들어와서
화면에 나가기까지의 파이프라인 전체를 민주가 관리한다고 보면 됩니다.

정현(나)은 여기 직접 손대기보다, recommendation_engine.py가 반환하는
값에 필요한 날씨/미세먼지/바람 데이터를 채워서 보내는 쪽(위치·날씨 기능)과
savings.py(절감량 계산)를 담당합니다.
"""
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from auth_utils import get_current_user
from db import READINGS_TABLE, supabase
from recommendation_engine import determine_action

router = APIRouter(prefix="/api", tags=["readings"])

RecommendationAction = Literal[
    "OPEN_WINDOW",
    "USE_AIRCON",
    "MAINTAIN",
    # 아래 2개는 창문 개폐 센서가 붙어야 실제로 나오는 액션입니다.
    # 지금은 SensorReadingCreate.window_is_open이 항상 False 기본값이라
    # 실제로는 반환되지 않지만, 민주가 "창문센서 확장 시 로직 분기"를
    # 만들 때를 위해 스키마에 미리 넣어뒀습니다.
    "CLOSE_WINDOW",
    "ENJOY",
]


class SensorReadingCreate(BaseModel):
    indoor_temperature: float = Field(ge=-50, le=80)
    indoor_humidity: float = Field(ge=0, le=100)
    outdoor_temperature: float = Field(ge=-50, le=80)
    outdoor_humidity: float = Field(ge=0, le=100)

    # 아래 3개는 선택 항목입니다. '위치/실외 날씨' 기능(담당: 정현(나))에서
    # 값을 채워 보내면 추천 정확도가 올라가고, 안 보내면 기본값으로 동작합니다.
    weather_condition: Optional[str] = Field(default="맑음", max_length=10)
    pm25: Optional[float] = Field(default=None, ge=0, le=1000)
    wind_speed: Optional[float] = Field(default=None, ge=0, le=100)

    # 창문 개폐 센서가 붙기 전까지는 기본값(False/MANUAL)으로 동작합니다.
    # 민주가 "창문센서 확장 시 로직 분기"를 만들 때, 실제 창문 상태를
    # 여기로 넣어서 보내면 됩니다(recommendation_engine.py가 이미 처리 가능).
    window_is_open: bool = False
    current_mode: Literal["MANUAL", "AUTO"] = "MANUAL"


class SavingsEstimate(BaseModel):
    power_saved_kwh: float
    time_applied_hours: float
    cost_won: int
    message: str


class Recommendation(BaseModel):
    action: RecommendationAction
    title: str
    summary: str
    reason: str
    # 아래 2개는 선택 항목입니다. 기존 프론트는 무시해도 되고,
    # '예상 절감(1일/1주/1달)' 기능(담당: 정현(나))에서 사용할 예정입니다.
    warning: Optional[str] = None
    savings: Optional[SavingsEstimate] = None
    # current_mode="AUTO"이고 action이 실제로 뭔가를 제어해야 하는 액션일 때
    # True가 됩니다. 자동 제어 기능이 생기면 이 값을 보고 실행하면 됩니다.
    is_auto_triggered: bool = False


class SensorReadingResponse(SensorReadingCreate):
    id: int
    measured_at: datetime
    recommendation: Recommendation


def calculate_recommendation(sensor_data: SensorReadingCreate) -> Recommendation:
    """실내외 온습도 + (있다면) 날씨/미세먼지/바람 데이터를 종합해 추천을 만든다.

    핵심 판단 로직은 recommendation_engine.determine_action()에 있다(담당: 민주).
    이 함수는 Recommendation 스키마에 맞게 결과를 감싸는 역할만 한다.
    """
    result = determine_action(
        indoor_temperature=sensor_data.indoor_temperature,
        indoor_humidity=sensor_data.indoor_humidity,
        outdoor_temperature=sensor_data.outdoor_temperature,
        outdoor_humidity=sensor_data.outdoor_humidity,
        weather_condition=sensor_data.weather_condition or "맑음",
        pm25=sensor_data.pm25,
        wind_speed=sensor_data.wind_speed,
        window_is_open=sensor_data.window_is_open,
        current_mode=sensor_data.current_mode,
    )

    return Recommendation(
        action=result["action"],
        title=result["title"],
        summary=result["summary"],
        reason=result["reason"],
        warning=result["warning"],
        savings=SavingsEstimate(**result["savings"]),
        is_auto_triggered=result["is_auto_triggered"],
    )


def get_latest_reading(user_id: int) -> SensorReadingResponse:
    try:
        result = (
            supabase.table(READINGS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("measured_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as error:
        print(f"Supabase 최신 기록 조회 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase에서 최신 기록을 조회하지 못했습니다.",
        ) from error

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="저장된 센서 기록이 없습니다.",
        )

    return SensorReadingResponse.model_validate(result.data[0])


def save_reading_for_user(user_id: int, sensor_data_dict: dict) -> SensorReadingResponse:
    """센서 값 dict를 받아 추천을 계산하고 Supabase에 저장한다.

    REST API(/api/readings)와 MQTT 수신 핸들러(담당: 민주)가 이 함수를 공유한다.
    """
    sensor_data = SensorReadingCreate.model_validate(sensor_data_dict)
    recommendation = calculate_recommendation(sensor_data)
    reading_data = {
        **sensor_data.model_dump(),
        "user_id": user_id,
        "recommendation": recommendation.model_dump(),
    }

    try:
        result = supabase.table(READINGS_TABLE).insert(reading_data).execute()
    except Exception as error:
        print(f"Supabase 센서 기록 저장 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="센서 기록을 Supabase에 저장하지 못했습니다.",
        ) from error

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="저장 결과를 확인하지 못했습니다.",
        )

    return SensorReadingResponse.model_validate(result.data[0])


@router.post(
    "/readings",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_reading(
    sensor_data: SensorReadingCreate,
    current_user: dict = Depends(get_current_user),
):
    return save_reading_for_user(current_user["id"], sensor_data.model_dump())


@router.get(
    "/readings/latest",
    response_model=SensorReadingResponse,
)
def read_latest(current_user: dict = Depends(get_current_user)):
    return get_latest_reading(current_user["id"])


@router.get(
    "/readings/history",
    response_model=list[SensorReadingResponse],
)
def read_history(
    limit: int = Query(default=8, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    try:
        result = (
            supabase.table(READINGS_TABLE)
            .select("*")
            .eq("user_id", current_user["id"])
            .order("measured_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as error:
        print(f"Supabase 기록 목록 조회 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="센서 기록 목록을 조회하지 못했습니다.",
        ) from error

    return [
        SensorReadingResponse.model_validate(reading)
        for reading in result.data
    ]


@router.get(
    "/recommendation",
    response_model=Recommendation,
)
def read_recommendation(
    current_user: dict = Depends(get_current_user),
):
    latest_reading = get_latest_reading(current_user["id"])
    return latest_reading.recommendation
