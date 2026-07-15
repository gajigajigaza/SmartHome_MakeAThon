from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field

from auth_utils import get_current_user
from db import READINGS_TABLE, PLACES_TABLE, supabase
# 원래 약속된 이름인 determine_action
from recommendation_engine import determine_action
from weather import fetch_outdoor_weather

router = APIRouter(prefix="/api", tags=["readings"])

RecommendationAction = Literal[
    "OPEN_WINDOW",
    "USE_AIRCON",
    "MAINTAIN",
    "CLOSE_WINDOW",
    "ENJOY",
]

# ---------------------------------------------------------
# 데이터 모델 정의 (Pydantic)
# ---------------------------------------------------------
class SensorReadingCreate(BaseModel):
    indoor_temperature: float = Field(ge=-50, le=80)
    indoor_humidity: float = Field(ge=0, le=100)
    outdoor_temperature: float = Field(ge=-50, le=80)
    outdoor_humidity: float = Field(ge=0, le=100)

    weather_condition: Optional[str] = Field(default="맑음", max_length=10)
    pm25: Optional[float] = Field(default=None, ge=0, le=1000)
    wind_speed: Optional[float] = Field(default=None, ge=0, le=100)

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
    warning: Optional[str] = None
    savings: Optional[SavingsEstimate] = None
    is_auto_triggered: bool = False

class SensorReadingResponse(SensorReadingCreate):
    id: int
    measured_at: datetime
    recommendation: Recommendation

# 기기 제어를 위한 데이터 모델
class DeviceControl(BaseModel):
    place_id: int
    action: str

# ---------------------------------------------------------
# 💡 [새로 추가된 헬퍼 함수]: 에어컨 누적 가동 시간(분) 연산 장치
# ---------------------------------------------------------
def calculate_ac_run_time(user_id: int) -> tuple[bool, int]:
    """과거 센서 기록들을 역추적하여 에어컨이 현재 가동 중인지 여부와 누적 가동 시간(분)을 계산합니다."""
    try:
        # 최근 30개의 센서 측정 및 추천 이력을 시간순으로 조회합니다.
        result = (
            supabase.table(READINGS_TABLE)
            .select("measured_at, recommendation")
            .eq("user_id", user_id)
            .order("measured_at", desc=True)
            .limit(30)
            .execute()
        )
        
        if not result.data:
            return False, 0

        history = result.data
        latest_rec = history[0].get("recommendation", {})
        latest_action = latest_rec.get("action")

        # 최신 추천 행동이 에어컨 유지(ENJOY 상태 중 에어컨 상태이거나) 또는 에어컨 가동인 경우 작동 중으로 간주합니다.
        is_ac_on = latest_action in ["USE_AIRCON", "ENJOY"]
        
        if not is_ac_on:
            return False, 0

        # 에어컨이 최초로 켜진 시점(USE_AIRCON)을 뒤로 거슬러 올라가며 탐색합니다.
        started_at_str = history[0]["measured_at"]
        for record in history:
            rec_action = record.get("recommendation", {}).get("action")
            if rec_action in ["USE_AIRCON", "ENJOY"]:
                started_at_str = record["measured_at"]
            else:
                # 에어컨을 켜지 않았던 순간을 만나는 즉시 탐색을 멈춥니다.
                break

        # 시간 차이를 분 단위로 변환하여 반환합니다.
        started_at = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        duration_minutes = int((now - started_at).total_seconds() / 60)
        
        return True, max(0, duration_minutes)

    except Exception as e:
        print(f"에어컨 누적 가동 시간 계산 중 오류 발생: {e}")
        return False, 0

# ---------------------------------------------------------
# 핵심 로직 함수
# ---------------------------------------------------------
def calculate_recommendation(
    sensor_data: SensorReadingCreate, 
    previous_action: str = "MAINTAIN", 
    target_cooldown_minutes: int = 30,
    is_ac_on: bool = False,               # 💡 [보완]: 파라미터 추가
    ac_run_time_minutes: int = 0         # 💡 [보완]: 파라미터 추가
) -> Recommendation:
    """실내외 환경 데이터를 종합해 추천 엔진을 돌리고 결과를 반환합니다."""
    
    # 💡 [개선]: determine_action에 누적 시간과 에어컨 실시간 구동 상태를 명시적으로 주입합니다.
    result = determine_action(
        indoor_temp=sensor_data.indoor_temperature,
        indoor_humidity=sensor_data.indoor_humidity,
        outdoor_temp=sensor_data.outdoor_temperature,
        outdoor_humidity=sensor_data.outdoor_humidity,
        weather_condition=sensor_data.weather_condition or "맑음",
        pm25=sensor_data.pm25 or 0.0,
        wind_speed=sensor_data.wind_speed or 0.0,
        window_is_open=sensor_data.window_is_open,
        is_ac_on=is_ac_on,                                    # 💡 연동 완료
        current_mode=sensor_data.current_mode,
        ac_run_time_minutes=ac_run_time_minutes,              # 💡 연동 완료
        target_cooldown_minutes=target_cooldown_minutes 
    )
    
    savings_obj = None
    if result.get("savings"):
        savings_obj = SavingsEstimate(**result["savings"])

    return Recommendation(
        action=result["action"],
        title=result["title"],
        summary=result["summary"],
        reason=result["reason"],
        warning=result.get("warning"),
        savings=savings_obj,
        is_auto_triggered=result.get("is_auto_triggered", False),
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

async def save_reading_for_user(user_id: int, sensor_data_dict: dict) -> SensorReadingResponse:
    sensor_data = SensorReadingCreate.model_validate(sensor_data_dict)
    
    previous_action = "MAINTAIN"
    target_cooldown = 30
    
    try:
        latest = get_latest_reading(user_id)
        previous_action = latest.recommendation.action
    except HTTPException:
        pass 
        
    try:
        place_result = (
            supabase.table(PLACES_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if place_result.data:
            place = place_result.data[0]
            target_cooldown = place.get("target_cooldown_minutes") or 30
            
            lat = place.get("lat") or place.get("latitude")
            lon = place.get("lon") or place.get("longitude")
            
            if lat is not None and lon is not None:
                outdoor_weather = await fetch_outdoor_weather(lat, lon)
                
                sensor_data.weather_condition = outdoor_weather.get("weather_condition", "맑음")
                sensor_data.pm25 = outdoor_weather.get("pm25")
                sensor_data.wind_speed = outdoor_weather.get("wind_speed")
                if outdoor_weather.get("outdoor_temperature") is not None:
                    sensor_data.outdoor_temperature = outdoor_weather["outdoor_temperature"]
                if outdoor_weather.get("outdoor_humidity") is not None:
                    sensor_data.outdoor_humidity = outdoor_weather["outdoor_humidity"]
    except Exception as e:
        print(f"날씨 데이터 연동 중 오류 발생: {e}")

    # 💡 [개선]: 누적 에어컨 작동 상태 및 분 단위를 연산해 옵니다.
    is_ac_on, ac_run_time_minutes = calculate_ac_run_time(user_id)

    # 💡 [개선]: 보완된 파라미터들을 calculate_recommendation 호출 시 정확하게 흘려보냅니다.
    recommendation = calculate_recommendation(
        sensor_data=sensor_data, 
        previous_action=previous_action, 
        target_cooldown_minutes=target_cooldown,
        is_ac_on=is_ac_on,
        ac_run_time_minutes=ac_run_time_minutes
    )
    
    reading_data = {
        **sensor_data.model_dump(),
        "user_id": user_id,
        "recommendation": recommendation.model_dump(),
    }

    try:
        result = supabase.table(READINGS_TABLE).insert(reading_data).execute()
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="센서 기록을 Supabase에 저장하지 못했습니다.",
        ) from error

    return SensorReadingResponse.model_validate(result.data[0])


# ---------------------------------------------------------
# API 라우터 (Endpoints)
# ---------------------------------------------------------
@router.post("/readings", response_model=SensorReadingResponse, status_code=status.HTTP_201_CREATED)
async def create_reading(sensor_data: SensorReadingCreate, current_user: dict = Depends(get_current_user)):
    return await save_reading_for_user(current_user["id"], sensor_data.model_dump())

@router.get("/readings/latest", response_model=SensorReadingResponse)
def read_latest(current_user: dict = Depends(get_current_user)):
    return get_latest_reading(current_user["id"])

@router.get("/readings/history", response_model=list[SensorReadingResponse])
def read_history(limit: int = Query(default=8, ge=1, le=100), current_user: dict = Depends(get_current_user)):
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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="기록 목록 조회 실패") from error

    return [SensorReadingResponse.model_validate(reading) for reading in result.data]

@router.get("/recommendation", response_model=Recommendation)
def read_recommendation(current_user: dict = Depends(get_current_user)):
    latest_reading = get_latest_reading(current_user["id"])
    return latest_reading.recommendation

@router.post("/devices/control")
def control_device(command: DeviceControl, current_user: dict = Depends(get_current_user)):
    action_name = "알 수 없는 동작"
    if command.action in ["TURN_ON_AC", "USE_AIRCON"]:
        action_name = "에어컨 가동"
    elif command.action == "OPEN_WINDOW":
        action_name = "창문 열기"
    elif command.action == "CLOSE_WINDOW":
        action_name = "창문 닫기"

    print(f"[기기 제어 실행] 사용자: {current_user['id']}, 장소: {command.place_id}, 동작: {action_name}")
    
    return {
        "status": "success", 
        "message": f"{action_name} 명령이 전달되었습니다.",
        "action_executed": command.action
    }