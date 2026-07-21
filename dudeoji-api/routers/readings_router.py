import asyncio
import math
import random
import time
from datetime import datetime, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from auth_utils import get_current_user
from db import READINGS_TABLE, PLACES_TABLE, supabase
from recommendation_engine import LOGIC_THRESHOLDS, determine_action
from weather import fetch_air_pollution, fetch_current_weather
from savings import get_rated_power, get_cumulative_kwh, estimate_savings, get_savings_summary
router = APIRouter(prefix="/api", tags=["readings"])

WEATHER_CACHE_TTL_SECONDS = 10 * 60
_weather_cache: dict[str, dict] = {}
_weather_status_cache: dict[str, dict] = {}
RecommendationAction = Literal[
    "OPEN_WINDOW",
    "USE_AIRCON",
    "MAINTAIN",
    "CLOSE_WINDOW",
    "ENJOY",
    "ERROR",
]
class SensorReadingCreate(BaseModel):
    # 실내값은 센서 또는 테스트 생성기가 제공합니다.
    indoor_temperature: float = Field(ge=-50, le=80)
    indoor_humidity: float = Field(ge=0, le=100)

    # 실외값은 요청에서 받아도 저장에 사용하지 않습니다.
    # save_reading_for_user가 선택 장소 좌표의 날씨 API 결과로 전부 덮어씁니다.
    outdoor_temperature: Optional[float] = Field(default=None, ge=-50, le=80)
    outdoor_humidity: Optional[float] = Field(default=None, ge=0, le=100)
    weather_condition: Optional[str] = Field(default=None, max_length=30)
    pm25: Optional[float] = Field(default=None, ge=0, le=1000)
    wind_speed: Optional[float] = Field(default=None, ge=0, le=100)

    # None은 창문 센서 미연결/값 없음입니다. 닫힘(False)으로 추정하지 않습니다.
    window_is_open: Optional[bool] = None

    # 에어컨 전원 센서도 창문과 동일하게 None이면 미연결/값 없음입니다.
    # DB에 새 열을 만들지 않고 recommendation JSONB 메타데이터에 저장합니다.
    ac_is_on: Optional[bool] = None
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

    # 별도 DB 열을 추가하지 않고 recommendation JSONB에 기록 메타데이터를 저장합니다.
    reading_source: Literal[
        "SENSOR", "TEST_MANUAL", "TEST_AUTO", "UNKNOWN"
    ] = "UNKNOWN"
    outdoor_data_source: Literal["WEATHER_API", "UNKNOWN"] = "UNKNOWN"
    outdoor_data_valid: bool = False
    window_data_available: bool = False
    ac_data_available: bool = False
    ac_is_on: Optional[bool] = None
    control_context: Literal[
        "AIRCON", "VENTILATION", "COMFORT", "SAFETY", "UNKNOWN"
    ] = "UNKNOWN"

    # 날씨 데이터가 언제 관측/조회되었는지와 캐시 사용 여부를 함께 남깁니다.
    weather_observed_at: Optional[str] = None
    air_quality_observed_at: Optional[str] = None
    weather_fetched_at: Optional[str] = None
    weather_cache_used: bool = False
    kma_status: Literal["OK", "ERROR", "UNKNOWN"] = "UNKNOWN"
    air_quality_status: Literal["OK", "ERROR", "UNKNOWN"] = "UNKNOWN"


class SensorReadingResponse(SensorReadingCreate):
    id: int
    place_id: Optional[int] = None
    measured_at: datetime
    recommendation: Recommendation


# 기기 제어를 위한 데이터 모델
class DeviceControl(BaseModel):
    place_id: int
    action: str
class SavingsSummaryResponse(BaseModel):
    period: str
    power_saved_kwh: float
    cost_won: int
# ---------------------------------------------------------
# 💡 helper
# ---------------------------------------------------------
def calculate_ac_run_time(
    user_id: int,
    place_id: Optional[int],
    current_ac_is_on: Optional[bool],
) -> tuple[Optional[bool], int]:
    """실제 에어컨 전원 센서 이력만으로 현재 상태와 가동시간을 계산합니다.

    추천 action(특히 여러 의미를 가진 ENJOY)으로 전원 상태를 추정하지 않습니다.
    """
    if current_ac_is_on is not True:
        return current_ac_is_on, 0

    try:
        query = (
            supabase.table(READINGS_TABLE)
            .select("measured_at, recommendation")
            .eq("user_id", user_id)
        )
        if place_id is not None:
            query = query.eq("place_id", place_id)

        result = query.order("measured_at", desc=True).limit(100).execute()
        started_at = datetime.now(timezone.utc)

        for record in result.data or []:
            recommendation = record.get("recommendation") or {}
            if not recommendation.get("ac_data_available"):
                break
            if recommendation.get("ac_is_on") is not True:
                break

            measured_at = datetime.fromisoformat(
                str(record["measured_at"]).replace("Z", "+00:00")
            )
            if measured_at.tzinfo is None:
                measured_at = measured_at.replace(tzinfo=timezone.utc)
            started_at = measured_at.astimezone(timezone.utc)

        duration_minutes = int(
            (datetime.now(timezone.utc) - started_at).total_seconds() / 60
        )
        return True, max(0, duration_minutes)
    except Exception as error:
        print(f"에어컨 실제 가동 시간 계산 중 오류 발생: {error}")
        return True, 0


# ---------------------------------------------------------
# 핵심 로직 함수
# ---------------------------------------------------------
def calculate_recommendation(
    sensor_data: SensorReadingCreate,
    previous_action: str = "MAINTAIN",
    target_cooldown_minutes: int = 30,
    is_ac_on: Optional[bool] = None,
    ac_run_time_minutes: int = 0,
) -> Recommendation:
    """recommendation_engine의 단일 기준으로 추천 결과를 생성합니다."""
    if (
        sensor_data.outdoor_temperature is None
        or sensor_data.outdoor_humidity is None
        or sensor_data.pm25 is None
        or sensor_data.wind_speed is None
        or not sensor_data.weather_condition
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="실외 날씨 API 데이터가 완전하지 않아 추천을 계산할 수 없습니다.",
        )

    result = determine_action(
        indoor_temp=sensor_data.indoor_temperature,
        indoor_humidity=sensor_data.indoor_humidity,
        outdoor_temp=sensor_data.outdoor_temperature,
        outdoor_humidity=sensor_data.outdoor_humidity,
        weather_condition=sensor_data.weather_condition,
        pm25=sensor_data.pm25,
        wind_speed=sensor_data.wind_speed,
        window_is_open=sensor_data.window_is_open,
        is_ac_on=is_ac_on,
        current_mode=sensor_data.current_mode,
        ac_run_time_minutes=ac_run_time_minutes,
        target_cooldown_minutes=target_cooldown_minutes,
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


def _infer_control_context(
    action: str,
    sensor_data: SensorReadingCreate,
    recommendation: Recommendation,
) -> str:
    """ENJOY를 에어컨 상태로 오인하지 않도록 제어 맥락을 별도로 구분합니다."""
    combined_text = " ".join(
        [recommendation.title, recommendation.summary, recommendation.reason]
    )

    if action == "USE_AIRCON":
        return "AIRCON"
    if action == "CLOSE_WINDOW":
        return "SAFETY"
    if action == "OPEN_WINDOW":
        return "VENTILATION"
    if action == "ENJOY":
        if sensor_data.ac_is_on is True and any(
            keyword in combined_text for keyword in ("에어컨", "냉기", "냉방")
        ):
            return "AIRCON"
        if sensor_data.window_is_open is True and any(
            keyword in combined_text for keyword in ("환기", "바람", "창문")
        ):
            return "VENTILATION"
        return "COMFORT"
    if action == "MAINTAIN":
        return "COMFORT"
    return "UNKNOWN"


def _weather_cache_key(place_id: int, lat: float, lon: float) -> str:
    return f"{place_id}:{float(lat):.5f}:{float(lon):.5f}"


def _describe_weather_error(source: str, error: Exception) -> str:
    message = str(error).strip() or error.__class__.__name__
    lowered = message.lower()

    if "환경변수가 설정되어 있지 않습니다" in message:
        return message
    if "401" in message or "unauthorized" in lowered or "invalid api key" in lowered:
        return f"{source} 인증에 실패했습니다. API 키를 확인해 주세요."
    if "403" in message or "forbidden" in lowered:
        return f"{source} 사용 권한이 없습니다. API 승인 상태를 확인해 주세요."
    if "timeout" in lowered or "timed out" in lowered:
        return f"{source} 요청 시간이 초과되었습니다."
    if "resultcode" in lowered or "기상청 api 오류" in lowered:
        return message
    return f"{source} 연결 실패: {message}"


async def _load_outdoor_weather(
    place_id: int,
    lat: float,
    lon: float,
    *,
    force_refresh: bool = False,
) -> tuple[Optional[dict], dict]:
    """기상청·대기질 API를 각각 확인하고 성공 결과를 10분간 캐시합니다."""
    key = _weather_cache_key(place_id, lat, lon)
    now_monotonic = time.monotonic()
    cached = _weather_cache.get(key)
    recent_status = _weather_status_cache.get(key)

    if (
        not force_refresh
        and not cached
        and recent_status
        and not recent_status.get("combined_valid")
        and now_monotonic - recent_status.get("stored_monotonic", 0) < 30
    ):
        return None, {
            key: value
            for key, value in recent_status.items()
            if key != "stored_monotonic"
        }

    if (
        not force_refresh
        and cached
        and now_monotonic - cached["stored_monotonic"] < WEATHER_CACHE_TTL_SECONDS
    ):
        status_payload = {
            **cached["status"],
            "cache_used": True,
            "cache_ttl_seconds": WEATHER_CACHE_TTL_SECONDS,
        }
        _weather_status_cache[key] = status_payload
        return dict(cached["data"]), status_payload

    weather_result, air_result = await asyncio.gather(
        fetch_current_weather(float(lat), float(lon)),
        fetch_air_pollution(float(lat), float(lon)),
        return_exceptions=True,
    )

    fetched_at = datetime.now(timezone.utc).isoformat()
    kma_ok = not isinstance(weather_result, Exception)
    air_ok = not isinstance(air_result, Exception)
    kma_message = "정상" if kma_ok else _describe_weather_error("기상청 실황 API", weather_result)
    air_message = "정상" if air_ok else _describe_weather_error("OpenWeather 대기질 API", air_result)

    status_payload = {
        "place_id": place_id,
        "coordinates_available": True,
        "combined_valid": bool(kma_ok and air_ok),
        "cache_used": False,
        "cache_ttl_seconds": WEATHER_CACHE_TTL_SECONDS,
        "fetched_at": fetched_at,
        "kma": {
            "status": "OK" if kma_ok else "ERROR",
            "message": kma_message,
            "observed_at": weather_result.get("observed_at") if kma_ok else None,
        },
        "air_quality": {
            "status": "OK" if air_ok else "ERROR",
            "message": air_message,
            "observed_at": air_result.get("air_quality_observed_at") if air_ok else None,
        },
    }

    if not (kma_ok and air_ok):
        errors = [message for ok, message in ((kma_ok, kma_message), (air_ok, air_message)) if not ok]
        status_payload["error_summary"] = " / ".join(errors)
        _weather_status_cache[key] = {
            **status_payload,
            "stored_monotonic": now_monotonic,
        }
        return None, status_payload

    combined = {**weather_result, **air_result}
    combined["weather_fetched_at"] = fetched_at
    _weather_cache[key] = {
        "data": dict(combined),
        "status": dict(status_payload),
        "stored_monotonic": now_monotonic,
    }
    _weather_status_cache[key] = {
        **status_payload,
        "stored_monotonic": now_monotonic,
    }
    return combined, status_payload


def get_place_for_user(
    user_id: int,
    place_id: Optional[int] = None,
) -> Optional[dict]:
    """요청 장소의 소유권을 확인하고, 미지정 시 기본 장소를 선택합니다."""
    try:
        if place_id is not None:
            result = (
                supabase.table(PLACES_TABLE)
                .select("*")
                .eq("user_id", user_id)
                .eq("id", place_id)
                .limit(1)
                .execute()
            )
            if not result.data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="선택한 장소를 찾을 수 없습니다.",
                )
            return result.data[0]

        default_result = (
            supabase.table(PLACES_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        if default_result.data:
            return default_result.data[0]

        first_result = (
            supabase.table(PLACES_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("id")
            .limit(1)
            .execute()
        )
        return first_result.data[0] if first_result.data else None

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="장소 정보를 조회하지 못했습니다.",
        ) from error


def get_latest_reading(
    user_id: int,
    place_id: Optional[int] = None,
) -> SensorReadingResponse:
    try:
        query = (
            supabase.table(READINGS_TABLE)
            .select("*")
            .eq("user_id", user_id)
        )
        if place_id is not None:
            query = query.eq("place_id", place_id)

        result = (
            query
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
        prefix = "선택한 장소에 " if place_id is not None else ""
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{prefix}저장된 센서 기록이 없습니다.",
        )

    return SensorReadingResponse.model_validate(result.data[0])


def _read_required_weather_number(
    weather: dict,
    key: str,
    minimum: float,
    maximum: float,
) -> float:
    value = weather.get(key)
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"날씨 API 응답에 {key} 값이 없습니다.",
        ) from error

    if not math.isfinite(number) or number < minimum or number > maximum:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"날씨 API의 {key} 값이 올바르지 않습니다.",
        )
    return number


async def save_reading_for_user(
    user_id: int,
    sensor_data_dict: dict,
    place_id: Optional[int] = None,
    reading_source: str = "SENSOR",
) -> SensorReadingResponse:
    sensor_data = SensorReadingCreate.model_validate(sensor_data_dict)
    place = get_place_for_user(user_id, place_id)

    if not place:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="실외 날씨 API를 조회할 장소가 등록되어 있지 않습니다.",
        )

    resolved_place_id = place["id"]
    lat = place.get("lat") if place.get("lat") is not None else place.get("latitude")
    lon = place.get("lon") if place.get("lon") is not None else place.get("longitude")

    if lat is None or lon is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "선택한 장소의 위치가 설정되지 않아 실외 날씨 API를 "
                "조회할 수 없습니다. 장소 위치를 먼저 설정해 주세요."
            ),
        )

    outdoor_weather, weather_status = await _load_outdoor_weather(
        resolved_place_id,
        float(lat),
        float(lon),
    )
    if not outdoor_weather:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "날씨 API 실패로 측정 기록을 저장하지 않았습니다. "
                + weather_status.get("error_summary", "API 연결 상태를 확인해 주세요.")
            ),
        )

    sensor_data.outdoor_temperature = _read_required_weather_number(
        outdoor_weather, "outdoor_temperature", -50, 80
    )
    sensor_data.outdoor_humidity = _read_required_weather_number(
        outdoor_weather, "outdoor_humidity", 0, 100
    )
    sensor_data.wind_speed = _read_required_weather_number(
        outdoor_weather, "wind_speed", 0, 100
    )
    sensor_data.pm25 = _read_required_weather_number(
        outdoor_weather, "pm25", 0, 1000
    )
    weather_condition = outdoor_weather.get("weather_condition")
    if not isinstance(weather_condition, str) or not weather_condition.strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="기상청 API 응답에 날씨 상태가 없습니다.",
        )
    sensor_data.weather_condition = weather_condition.strip()

    previous_action = "MAINTAIN"
    target_cooldown = place.get("target_cooldown_minutes") or 30
    rated_power_w = get_rated_power(resolved_place_id)
    duration_hours = 0.0

    try:
        latest = get_latest_reading(user_id, resolved_place_id)
        previous_action = latest.recommendation.action
        elapsed = datetime.now(timezone.utc) - latest.measured_at
        duration_hours = min(max(0.0, elapsed.total_seconds() / 3600), 2.0)
    except HTTPException as error:
        if error.status_code != status.HTTP_404_NOT_FOUND:
            raise

    actual_ac_state, ac_run_time_minutes = calculate_ac_run_time(
        user_id,
        resolved_place_id,
        sensor_data.ac_is_on,
    )
    cumulative_kwh_this_month = get_cumulative_kwh(user_id)

    recommendation = calculate_recommendation(
        sensor_data=sensor_data,
        previous_action=previous_action,
        target_cooldown_minutes=target_cooldown,
        is_ac_on=actual_ac_state,
        ac_run_time_minutes=ac_run_time_minutes,
    )

    normalized_source = (
        reading_source
        if reading_source in {"SENSOR", "TEST_MANUAL", "TEST_AUTO"}
        else "UNKNOWN"
    )
    recommendation.reading_source = normalized_source
    recommendation.outdoor_data_source = "WEATHER_API"
    recommendation.outdoor_data_valid = True
    recommendation.window_data_available = sensor_data.window_is_open is not None
    recommendation.ac_data_available = sensor_data.ac_is_on is not None
    recommendation.ac_is_on = sensor_data.ac_is_on
    recommendation.control_context = _infer_control_context(
        recommendation.action,
        sensor_data,
        recommendation,
    )
    recommendation.weather_observed_at = outdoor_weather.get("observed_at")
    recommendation.air_quality_observed_at = outdoor_weather.get("air_quality_observed_at")
    recommendation.weather_fetched_at = outdoor_weather.get("weather_fetched_at")
    recommendation.weather_cache_used = bool(weather_status.get("cache_used"))
    recommendation.kma_status = weather_status.get("kma", {}).get("status", "UNKNOWN")
    recommendation.air_quality_status = weather_status.get("air_quality", {}).get("status", "UNKNOWN")

    savings_result = estimate_savings(
        action=recommendation.action,
        rated_power_w=rated_power_w,
        duration_hours=duration_hours,
        cumulative_kwh_this_month=cumulative_kwh_this_month,
    )
    recommendation.savings = SavingsEstimate(**savings_result)

    # ac_is_on은 기존 readings 테이블에 새 열을 만들지 않고 recommendation JSONB에만 저장합니다.
    reading_payload = sensor_data.model_dump(exclude={"ac_is_on"})
    if reading_payload.get("window_is_open") is None:
        reading_payload["window_is_open"] = False

    reading_data = {
        **reading_payload,
        "user_id": user_id,
        "place_id": resolved_place_id,
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


# jh 수정함 - 프론트 "테스트 모드" 버튼용 가짜 센서값 생성.
def generate_mock_sensor_reading() -> dict:
    """실내 테스트값만 만듭니다. 실외값은 저장 단계에서 날씨 API로 채웁니다."""
    base_temp = 26.0
    return {
        "indoor_temperature": round(
            base_temp + random.uniform(-0.5, 0.5),
            1,
        ),
        "indoor_humidity": random.randint(40, 60),
        "window_is_open": None,
        "ac_is_on": None,
        "current_mode": "MANUAL",
    }


# ---------------------------------------------------------
# API 라우터 (Endpoints)
# ---------------------------------------------------------
@router.post(
    "/readings",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reading(
    sensor_data: SensorReadingCreate,
    place_id: Optional[int] = Query(default=None, ge=1),
    current_user: dict = Depends(get_current_user),
):
    return await save_reading_for_user(
        current_user["id"],
        sensor_data.model_dump(),
        place_id=place_id,
        reading_source="SENSOR",
    )


@router.post(
    "/dev/mock-reading",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_mock_reading(
    place_id: Optional[int] = Query(default=None, ge=1),
    test_mode: Literal["manual", "auto"] = Query(default="manual"),
    current_user: dict = Depends(get_current_user),
):
    mock_data = generate_mock_sensor_reading()
    source = "TEST_AUTO" if test_mode == "auto" else "TEST_MANUAL"
    return await save_reading_for_user(
        current_user["id"],
        mock_data,
        place_id=place_id,
        reading_source=source,
    )


@router.get("/readings/latest", response_model=SensorReadingResponse)
def read_latest(
    place_id: Optional[int] = Query(default=None, ge=1),
    current_user: dict = Depends(get_current_user),
):
    if place_id is not None:
        get_place_for_user(current_user["id"], place_id)
    return get_latest_reading(current_user["id"], place_id)


@router.get("/readings/history", response_model=list[SensorReadingResponse])
def read_history(
    limit: int = Query(default=8, ge=1, le=1000),
    place_id: Optional[int] = Query(default=None, ge=1),
    after: Optional[datetime] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    if place_id is not None:
        get_place_for_user(current_user["id"], place_id)

    try:
        query = (
            supabase.table(READINGS_TABLE)
            .select("*")
            .eq("user_id", current_user["id"])
        )
        if place_id is not None:
            query = query.eq("place_id", place_id)
        if after is not None:
            normalized_after = (
                after.replace(tzinfo=timezone.utc)
                if after.tzinfo is None
                else after.astimezone(timezone.utc)
            )
            query = query.gte(
                "measured_at",
                normalized_after.isoformat(),
            )

        # 최신순으로 최대 limit건만 가져옵니다. 프론트가 시간 오름차순으로 정렬합니다.
        result = (
            query
            .order("measured_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="기록 목록 조회 실패",
        ) from error

    return [
        SensorReadingResponse.model_validate(reading)
        for reading in result.data
    ]


@router.get("/weather/status")
async def read_weather_status(
    place_id: Optional[int] = Query(default=None, ge=1),
    force_refresh: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
):
    """장소 좌표와 두 외부 API의 상태·관측시각을 각각 반환합니다."""
    place = get_place_for_user(current_user["id"], place_id)
    if not place:
        return {
            "place_id": None,
            "coordinates_available": False,
            "combined_valid": False,
            "kma": {"status": "ERROR", "message": "등록된 장소가 없습니다.", "observed_at": None},
            "air_quality": {"status": "ERROR", "message": "등록된 장소가 없습니다.", "observed_at": None},
        }

    lat = place.get("lat") if place.get("lat") is not None else place.get("latitude")
    lon = place.get("lon") if place.get("lon") is not None else place.get("longitude")
    if lat is None or lon is None:
        return {
            "place_id": place["id"],
            "coordinates_available": False,
            "combined_valid": False,
            "cache_used": False,
            "fetched_at": None,
            "kma": {"status": "ERROR", "message": "장소 위도·경도가 설정되지 않았습니다.", "observed_at": None},
            "air_quality": {"status": "ERROR", "message": "장소 위도·경도가 설정되지 않았습니다.", "observed_at": None},
        }

    _data, status_payload = await _load_outdoor_weather(
        place["id"],
        float(lat),
        float(lon),
        force_refresh=force_refresh,
    )
    return status_payload


@router.get("/readings/logic-thresholds")
def read_logic_thresholds(
    current_user: dict = Depends(get_current_user),
):
    """프론트 상태 카드가 추천 엔진과 같은 기준을 사용하도록 제공합니다."""
    return LOGIC_THRESHOLDS


@router.get("/recommendation", response_model=Recommendation)
def read_recommendation(
    place_id: Optional[int] = Query(default=None, ge=1),
    current_user: dict = Depends(get_current_user),
):
    if place_id is not None:
        get_place_for_user(current_user["id"], place_id)
    latest_reading = get_latest_reading(current_user["id"], place_id)
    return latest_reading.recommendation


@router.get("/savings/summary", response_model=SavingsSummaryResponse)
def read_savings_summary(
    period: str = Query(default="day"),
    place_id: Optional[int] = Query(default=None, ge=1),
    current_user: dict = Depends(get_current_user),
):
    if place_id is not None:
        get_place_for_user(current_user["id"], place_id)
    return get_savings_summary(current_user["id"], period, place_id)
@router.post("/devices/control")
def control_device(command: DeviceControl, current_user: dict = Depends(get_current_user)):
    return {}
