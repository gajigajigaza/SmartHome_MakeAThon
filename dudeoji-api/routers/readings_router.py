import asyncio
import math
import time
from datetime import datetime, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field, ValidationError
from auth_utils import execute_supabase_with_retry, get_current_user
from db import (
    READINGS_TABLE,
    PLACES_TABLE,
    DEVICE_CONTROL_EVENTS_TABLE,
    RECOMMENDATION_REFRESH_EVENTS_TABLE,
    supabase,
)
from device_connection_hub import DeviceConnectionError, device_hub
from occupancy_engine import (
    get_prediction_state,
    resolve_occupancy_signal,
    respond_to_prediction,
)
from recommendation_engine import LOGIC_THRESHOLDS, determine_action
from sensor_realtime_hub import reading_hub
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
    "TURN_OFF_AIRCON",
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

    # jh 수정함 - 현장 하드웨어(전력 측정 모듈/PIR 재실 센서) 수신용.
    # 008 마이그레이션으로 readings에 같은 이름 top-level 컬럼을 추가함.
    # 미연결 시 None 유지(ac_is_on/window_is_open과 동일한 규칙).
    power_watt: Optional[float] = Field(default=None, ge=0, le=20000)
    person_detected: Optional[bool] = None


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

    # 별도 DB 열을 추가하지 않고 recommendation JSONB에 기록 메타데이터를 저장합니다.
    reading_source: Literal[
        "SENSOR", "TEST_MANUAL", "TEST_AUTO", "UNKNOWN"
    ] = "UNKNOWN"
    outdoor_data_source: Literal["WEATHER_API", "UNKNOWN"] = "UNKNOWN"
    outdoor_data_valid: bool = False
    window_data_available: bool = False
    ac_data_available: bool = False
    ac_is_on: Optional[bool] = None
    # occupancy_engine.resolve_occupancy_signal()의 결과를 그대로 투명하게
    # 노출 — 데모/디버깅 시 "지금 이 판단이 실측(LIVE)인지 학습된 패턴
    # (PATTERN)인지" 바로 확인할 수 있다.
    occupancy_present: Optional[bool] = None
    occupancy_source: Literal["LIVE", "PATTERN", "UNKNOWN"] = "UNKNOWN"
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


def _build_reading_insert_payload(
    sensor_data: SensorReadingCreate,
) -> dict:
    """DB top-level 센서 필드를 만들되 기존 ac_is_on 저장 방식을 유지합니다."""

    reading_payload = sensor_data.model_dump(exclude={"ac_is_on"})
    if reading_payload.get("window_is_open") is None:
        reading_payload["window_is_open"] = False
    return reading_payload


# 기기 제어를 위한 데이터 모델
DeviceControlAction = Literal[
    "OPEN_WINDOW",
    "CLOSE_WINDOW",
    "TURN_ON_AIRCON",
    "TURN_OFF_AIRCON",
]


class DeviceControl(BaseModel):
    place_id: int = Field(ge=1)
    action: DeviceControlAction
    # jh 추가 - 프로필(뱃지) 퀘스트("첫 수동 조작")가 자동실행 카운트다운
    # 완료(auto)와 거절 후 HeaderQuickControls 버튼 클릭(manual)을 구분해야
    # 해서 추가. 프론트가 안 보내는 구버전 호출과의 호환을 위해 기본값은
    # "manual"로 둔다(카운트다운 자동실행 쪽만 명시적으로 "auto"를 보낸다).
    source: Literal["manual", "auto"] = "manual"
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
        query = query.order("measured_at", desc=True).limit(100)

        result = execute_supabase_with_retry(lambda: query.execute())
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
    occupancy_signal: Optional[dict] = None,
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
        occupancy_signal=occupancy_signal,
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
    )


# jh 수정함 - occupancy_router.py에 있던 _compute_prediction_preview를 여기로
# 옮겼다. occupancy_router.py는 이미 이 파일(get_latest_reading 등)을 import하고
# 있어서, 반대 방향(이 파일이 occupancy_router.py를 import)은 순환참조가 된다.
# background_occupancy_control_enabled(웹 앱 없이 서버가 재실 예측을 바로
# 수락·실행)도 이 프리뷰 계산이 그대로 필요해서, occupancy_router.py가 이제
# 여기서 가져다 쓰는 쪽으로 방향을 뒤집었다.
#
# 예측 프리뷰용 문구. determine_action()의 title/reason은 "지금 켤까요?" 톤이라
# 그대로 쓰면 "아직 안 왔는데 지금 켜라는 거야?"처럼 들린다. reason(수치 근거)은
# 이미 정확해서 그대로 재사용하고, title/summary만 "예상" 톤으로 바꿔 붙인다.
PREDICTION_COPY = {
    ("ARRIVAL", "USE_AIRCON"): "곧 오실 시간이에요, 미리 에어컨을 켜둘까요?",
    ("ARRIVAL", "OPEN_WINDOW"): "곧 오실 시간이에요, 미리 창문을 열어둘까요?",
    ("DEPARTURE", "TURN_OFF_AIRCON"): "곧 자리를 비우실 시간이에요, 에어컨을 미리 꺼둘까요?",
}


def compute_prediction_preview(user_id: int, place: dict, direction: str, eta_minutes: int) -> dict:
    """지금 실측 센서값으로 determine_action()을 그대로 돌려서 "무엇을 준비할지" 정한다.

    recommendation_engine은 건드리지 않는다 — ARRIVAL이면 재실 신호를 주지 않아
    지금 조건(덥다/습하다/바람 등)만으로 자연스럽게 USE_AIRCON/OPEN_WINDOW/MAINTAIN이
    나오고, DEPARTURE면 이미 있는 "재실 없음" 분기(occupancy_signal.present=False)를
    그대로 태워 TURN_OFF_AIRCON을 재사용한다. 하드웨어가 on/off 명령만 지원해서
    "25도로 예열" 같은 목표온도 지정은 불가능 — PRE_COOL 같은 새 액션 없이 기존
    USE_AIRCON/TURN_OFF_AIRCON을 그대로 쓰고, "미리" 톤은 title/summary 문구로만
    표현한다(PREDICTION_COPY 참고).
    """
    try:
        latest = get_latest_reading(user_id, place["id"])
    except HTTPException:
        return {"action": "MAINTAIN", "title": "", "summary": "", "reason": ""}

    if (
        latest.outdoor_temperature is None
        or latest.outdoor_humidity is None
        or latest.pm25 is None
        or latest.wind_speed is None
        or not latest.weather_condition
    ):
        return {"action": "MAINTAIN", "title": "", "summary": "", "reason": ""}

    actual_ac_state, ac_run_time_minutes = calculate_ac_run_time(
        user_id, place["id"], latest.recommendation.ac_is_on
    )
    occupancy_hypothesis = (
        None if direction == "ARRIVAL" else {"present": False, "source": "PATTERN"}
    )

    result = determine_action(
        indoor_temp=latest.indoor_temperature,
        outdoor_temp=latest.outdoor_temperature,
        indoor_humidity=latest.indoor_humidity,
        outdoor_humidity=latest.outdoor_humidity,
        pm25=latest.pm25,
        wind_speed=latest.wind_speed,
        weather_condition=latest.weather_condition,
        window_is_open=latest.window_is_open,
        is_ac_on=actual_ac_state,
        current_mode="MANUAL",
        ac_run_time_minutes=ac_run_time_minutes,
        target_cooldown_minutes=place.get("target_cooldown_minutes") or 30,
        occupancy_signal=occupancy_hypothesis,
    )

    action = result["action"]
    title = PREDICTION_COPY.get((direction, action))
    if title is None:
        # USE_AIRCON/OPEN_WINDOW/TURN_OFF_AIRCON 외 결과(MAINTAIN/ENJOY/ERROR
        # 등)는 "이미 괜찮거나 준비할 게 없다"는 뜻 — occupancy_engine이 이
        # action을 보고 EXPIRED 처리한다.
        return {"action": action, "title": "", "summary": "", "reason": ""}

    if direction == "ARRIVAL":
        summary = f"평소 이 시간대에 오시는 패턴이에요. 약 {eta_minutes}분 후 도착 예상이에요."
    else:
        summary = f"평소 이 시간대에 자리를 비우시는 패턴이에요. 약 {eta_minutes}분 후 예상이에요."

    return {"action": action, "title": title, "summary": summary, "reason": result["reason"]}


# jh 추가 - 마이페이지의 "백그라운드 자동 제어" 두 동의 플래그(웹 앱 없이도
# 서버가 알아서 기기를 조작하는 것)를 실제로 실행하는 부분. 기존 5초
# 카운트다운 자동실행(RecommendationCard.jsx)이나 재실 예측 팝업과는 완전히
# 별개 경로다 — 둘 다 웹 브라우저가 열려 있어야만 동작하는데, 이건 실제
# 하드웨어가 웹 앱과 무관하게 계속 보내는 reading 저장 시점에 걸려서
# 웹 앱이 꺼져 있어도 동작한다.
_ACTION_TO_DEVICE_COMMAND = {
    "USE_AIRCON": "TURN_ON_AIRCON",
    "TURN_OFF_AIRCON": "TURN_OFF_AIRCON",
    "OPEN_WINDOW": "OPEN_WINDOW",
    "CLOSE_WINDOW": "CLOSE_WINDOW",
}


async def _maybe_send_background_command(
    user_id: int,
    place_id: int,
    device_command: Optional[str],
) -> None:
    """기기 명령을 보내되, 실패해도 reading 저장 자체는 절대 막지 않는다.

    background_* 플래그는 사람이 지켜보지 않는 상황에서 도는 기능이라, 통신
    실패를 사용자에게 즉시 알릴 방법이 없다(RecommendationCard처럼 화면에
    에러를 띄울 대상이 없음) — 다음 reading이 들어올 때 같은 조건이면
    자연스럽게 다시 시도된다.
    """
    if not device_command:
        return
    try:
        await device_hub.send_command(
            user_id=user_id,
            requested_place_id=place_id,
            action=device_command,
        )
    except (ValueError, DeviceConnectionError) as error:
        print(
            f"[백그라운드 자동 제어] place_id={place_id} "
            f"명령={device_command} 전송 실패: {error}"
        )
        return

    # jh 추가 - device_control_events(뱃지 퀘스트용, control_device 엔드포인트가
    # source="manual"/"auto"로 남기는 것과 같은 표)에 그대로 함께 남긴다.
    # 이 경로는 웹 앱 없이 서버가 스스로 실행하는 것이라 "auto"가 맞고, 새 표를
    # 따로 안 만들어도 된다. 로깅은 어디까지나 부가 기능이라, 이게 실패해도
    # (예: 마이그레이션 순서상 아직 테이블이 없는 경우) 이미 성공한 기기 제어
    # 자체나 reading 저장 흐름을 막으면 안 된다.
    try:
        await asyncio.to_thread(
            lambda: execute_supabase_with_retry(
                lambda: (
                    supabase.table(DEVICE_CONTROL_EVENTS_TABLE)
                    .insert(
                        {
                            "place_id": place_id,
                            "user_id": user_id,
                            "action": device_command,
                            "source": "auto",
                        }
                    )
                    .execute()
                )
            )
        )
    except Exception as error:
        # jh 수정함 - APIError(스키마 캐시 지연 등)만 잡고 있었는데,
        # execute_supabase_with_retry는 순간적인 네트워크 문제가 재시도
        # 끝에도 안 풀리면 HTTPException을 던진다(APIError가 아님). 이 함수의
        # 목적 자체가 "로깅 실패로 기기 제어/reading 저장 흐름을 절대 막지
        # 않는다"라서, 예외 타입을 좁게 잡으면 그 목적이 깨진다.
        print(
            f"[백그라운드 자동 제어] device_control_events 기록 실패"
            f"(기기 명령 자체는 이미 성공): {error}"
        )


async def _apply_background_condition_control(
    user_id: int,
    place_id: int,
    recommendation: Recommendation,
    window_is_open: Optional[bool],
    ac_is_on: Optional[bool],
) -> None:
    """지속적인 현재 상태(반응형) 추천을 사람 확인 없이 그대로 실행한다.

    센서가 미연결(None)이면 지금 실제 상태를 모르는 것이라 함부로 조작하지
    않는다 — RecommendationCard의 5초 카운트다운도 같은 이유로 센서 에러
    상태(ERROR)에서는 실행 후보 자체가 없다(getDeviceCommandForAction이
    ERROR를 안 다룸).
    """
    device_command = _ACTION_TO_DEVICE_COMMAND.get(recommendation.action)
    if not device_command:
        return

    # 이미 그 상태면 또 명령을 보내지 않는다(중복 명령으로 인한 기기/네트워크
    # 부담 방지). 창문/에어컨 둘 다 센서로 실측된 값이 있어야 비교 가능하다.
    if device_command in ("OPEN_WINDOW", "CLOSE_WINDOW"):
        if window_is_open is None:
            return
        already_matches = (device_command == "OPEN_WINDOW") == window_is_open
    else:
        if ac_is_on is None:
            return
        already_matches = (device_command == "TURN_ON_AIRCON") == ac_is_on

    if already_matches:
        return

    await _maybe_send_background_command(user_id, place_id, device_command)


async def _apply_background_occupancy_control(
    user_id: int,
    place: dict,
) -> None:
    """재실 예측에 따른 사전조치를, 팝업으로 사람에게 묻는 대신 바로 수락·실행한다.

    occupancy_router.py의 GET /api/occupancy/prediction과 완전히 같은
    get_prediction_state()를 재사용한다 — transition_key 기준 중복 계산/중복
    실행 방지 로직을 그대로 물려받기 위함이다(같은 전환에 대해 두 번 실행되지
    않음). PENDING_CONFIRM이 뜬 경우에만, 사람이 "예"를 누른 것과 동일하게
    respond_to_prediction(accept=True)을 호출한다.
    """
    place_id = place["id"]

    def preview(direction: str, eta_minutes: int) -> dict:
        return compute_prediction_preview(user_id, place, direction, eta_minutes)

    state = get_prediction_state(place_id, preview)
    if not state or state.get("status") != "PENDING_CONFIRM":
        return

    try:
        result = respond_to_prediction(place_id, state["transition_key"], True)
    except ValueError:
        # 다른 경로(예: 사용자가 마침 그 순간 웹에서 팝업에 응답)와 겹쳤을
        # 뿐이니 조용히 넘어간다 — 다음 reading에서 다시 평가된다.
        return

    device_command = _ACTION_TO_DEVICE_COMMAND.get(result["action"])
    await _maybe_send_background_command(user_id, place_id, device_command)


def _infer_control_context(
    action: str,
    sensor_data: SensorReadingCreate,
    recommendation: Recommendation,
) -> str:
    """ENJOY? ??? ??? ???? ??? ?? ??? ??? ?????."""
    # TODO(정현): 이 docstring과 ENJOY 분기의 키워드 튜플("???", "??", "??")이
    # 인코딩 깨짐(mojibake)으로 원래 의도한 한글 키워드가 소실된 상태다.
    # 실제 문자열과 절대 매칭되지 않아서 ENJOY의 control_context는 사실상
    # 항상 "COMFORT"로만 나온다(ac_is_on/window_is_open 분기 다 죽어있음).
    # 지금 당장 쓰는 곳은 없어서 안 고쳤지만, 나중에 소비 리포트 등에서
    # control_context를 쓸 계획이면 원래 의도(ac_is_on=True면 "AIRCON",
    # window_is_open=True면 "VENTILATION")대로 키워드를 복구하거나, 애초에
    # 키워드 매칭 없이 ac_is_on/window_is_open만으로 판단하도록 다시 짜야 한다.
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
            keyword in combined_text for keyword in ("???", "??", "??")
        ):
            return "AIRCON"
        if sensor_data.window_is_open is True and any(
            keyword in combined_text for keyword in ("??", "??", "??")
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
            result = execute_supabase_with_retry(
                lambda: (
                    supabase.table(PLACES_TABLE)
                    .select("*")
                    .eq("user_id", user_id)
                    .eq("id", place_id)
                    .limit(1)
                    .execute()
                )
            )
            if not result.data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="선택한 장소를 찾을 수 없습니다.",
                )
            return result.data[0]

        default_result = execute_supabase_with_retry(
            lambda: (
                supabase.table(PLACES_TABLE)
                .select("*")
                .eq("user_id", user_id)
                .eq("is_default", True)
                .limit(1)
                .execute()
            )
        )
        if default_result.data:
            return default_result.data[0]

        first_result = execute_supabase_with_retry(
            lambda: (
                supabase.table(PLACES_TABLE)
                .select("*")
                .eq("user_id", user_id)
                .order("id")
                .limit(1)
                .execute()
            )
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
    query = (
        supabase.table(READINGS_TABLE)
        .select("*")
        .eq("user_id", user_id)
    )
    if place_id is not None:
        query = query.eq("place_id", place_id)
    query = query.order("measured_at", desc=True).limit(1)

    try:
        result = execute_supabase_with_retry(lambda: query.execute())
    except HTTPException:
        raise
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

    try:
        return SensorReadingResponse.model_validate(result.data[0])
    except ValidationError as error:
        # jh 수정함 - 엔진 재작성 이전 등 구조가 다른 legacy row는 "없는 것"과
        # 동일하게 404로 취급한다. 그래야 _save_reading_to_place()의 404
        # 폴백(첫 reading과 동일 취급)이 그대로 재사용되고, 팬아웃 루프
        # 전체가 이 한 장소의 legacy row 때문에 500으로 죽지 않는다.
        prefix = "선택한 장소에 " if place_id is not None else ""
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{prefix}저장된 센서 기록의 형식이 올바르지 않습니다.",
        ) from error


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


# jh 수정함 - 팬아웃 전용 스킵 예외. HTTPException(422/503)과 구분해서
# fan-out 루프가 "이 장소만 건너뛰기"로 처리할 수 있게 표시만 해준다.
class _PlaceSaveSkipped(Exception):
    def __init__(self, place_id, detail: str):
        super().__init__(detail)
        self.place_id = place_id
        self.detail = detail


async def _save_reading_to_place(
    user_id: int,
    base_sensor_data: SensorReadingCreate,
    place: dict,
    reading_source: str,
    cumulative_kwh_this_month: float,
    outdoor_overrides: Optional[dict] = None,
) -> SensorReadingResponse:
    """실내값 하나를 특정 장소 기준으로 저장한다.

    fan-out(모든 장소)/단일 장소 저장 양쪽에서 공유하는 핵심 로직. 장소별로
    실외값·추천·자동제어 모드가 다 다를 수 있어 base_sensor_data를 복사해서
    이 장소 전용으로만 값을 채운다(원본은 다른 장소 처리에 재사용됨).

    jh 수정함 - outdoor_overrides는 /dev/mock-reading(테스트 모드 "실외 직접
    입력") 전용이다. None(기본)이면 기존과 동일하게 날씨 API 값을 그대로
    쓴다. 값이 있으면 날씨 API는 그대로 호출하되(미세먼지/풍속/날씨 상태는
    실데이터 유지) outdoor_temperature/outdoor_humidity만 덮어쓴다. 일반
    센서(/readings)·MQTT·WebSocket 경로는 이 인자를 안 넘기므로 동작이
    바뀌지 않는다.
    """
    sensor_data = base_sensor_data.model_copy()
    resolved_place_id = place["id"]
    lat = place.get("lat") if place.get("lat") is not None else place.get("latitude")
    lon = place.get("lon") if place.get("lon") is not None else place.get("longitude")

    if lat is None or lon is None:
        raise _PlaceSaveSkipped(
            resolved_place_id,
            "선택한 장소의 위치가 설정되지 않아 실외 날씨 API를 "
            "조회할 수 없습니다. 장소 위치를 먼저 설정해 주세요.",
        )

    outdoor_weather, weather_status = await _load_outdoor_weather(
        resolved_place_id,
        float(lat),
        float(lon),
    )
    if not outdoor_weather:
        raise _PlaceSaveSkipped(
            resolved_place_id,
            "날씨 API 실패로 측정 기록을 저장하지 않았습니다. "
            + weather_status.get("error_summary", "API 연결 상태를 확인해 주세요."),
        )

    try:
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
    except HTTPException as error:
        raise _PlaceSaveSkipped(resolved_place_id, str(error.detail)) from error

    if outdoor_overrides:
        if outdoor_overrides.get("outdoor_temperature") is not None:
            sensor_data.outdoor_temperature = outdoor_overrides["outdoor_temperature"]
        if outdoor_overrides.get("outdoor_humidity") is not None:
            sensor_data.outdoor_humidity = outdoor_overrides["outdoor_humidity"]

    # jh 수정함 - current_mode는 더 이상 페이로드를 안 믿고, 이 장소의
    # auto_control_enabled 설정으로 서버가 정한다(실외값을 항상 API 값으로
    # 덮어쓰는 것과 같은 원칙). fan-out이면 장소마다 모드가 다를 수 있다.
    sensor_data.current_mode = "AUTO" if place.get("auto_control_enabled") else "MANUAL"

    previous_action = "MAINTAIN"
    target_cooldown = place.get("target_cooldown_minutes") or 30
    rated_power_w = get_rated_power(resolved_place_id)
    duration_hours = 0.0
    # interval closing: 절감 계산은 지금 이 reading이 아니라 직전 reading이
    # 저장될 때 실제로 확인됐던 상태(window_is_open/ac_is_on)로 정산한다.
    previous_window_is_open: Optional[bool] = None
    previous_ac_is_on: Optional[bool] = None

    try:
        latest = get_latest_reading(user_id, resolved_place_id)
        previous_action = latest.recommendation.action
        previous_window_is_open = latest.window_is_open
        previous_ac_is_on = latest.recommendation.ac_is_on
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
    occupancy_signal = resolve_occupancy_signal(resolved_place_id)

    try:
        recommendation = calculate_recommendation(
            sensor_data=sensor_data,
            previous_action=previous_action,
            target_cooldown_minutes=target_cooldown,
            is_ac_on=actual_ac_state,
            ac_run_time_minutes=ac_run_time_minutes,
            occupancy_signal=occupancy_signal,
        )
    except HTTPException as error:
        # calculate_recommendation()도 실외값 불완전 시 503을 던질 수 있음
        # (정상 경로에선 위에서 이미 검증돼서 거의 안 일어남) — 같은
        # "이 장소만 스킵" 취급으로 맞춘다.
        raise _PlaceSaveSkipped(resolved_place_id, str(error.detail)) from error

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
    recommendation.occupancy_present = (
        occupancy_signal.get("present") if occupancy_signal else None
    )
    recommendation.occupancy_source = (
        occupancy_signal.get("source") if occupancy_signal else "UNKNOWN"
    )
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
        action=previous_action,
        rated_power_w=rated_power_w,
        duration_hours=duration_hours,
        cumulative_kwh_this_month=cumulative_kwh_this_month,
        window_is_open=previous_window_is_open,
        ac_is_on=previous_ac_is_on,
        # jh 수정함 - TURN_OFF_AIRCON 절감 인정용. 구간 시작 시점 상태가
        # 아니라 지금 막 확인된 실제 에어컨 상태(actual_ac_state)를 넘긴다.
        current_ac_is_on=actual_ac_state,
    )
    recommendation.savings = SavingsEstimate(**savings_result)

    # ac_is_on은 기존 readings 테이블에 새 열을 만들지 않고 recommendation JSONB에만 저장합니다.
    reading_payload = _build_reading_insert_payload(sensor_data)

    reading_data = {
        **reading_payload,
        "user_id": user_id,
        "place_id": resolved_place_id,
        "recommendation": recommendation.model_dump(),
    }

    # jh 수정함 - execute_supabase_with_retry()를 여기(insert)엔 안 씀: 응답을
    # 돌려받는 도중 소켓 오류(WinError 10035 등)가 나면 서버는 이미 insert에
    # 성공했을 수 있다. 그 상태에서 재시도하면 같은 reading이 중복 저장돼
    # savings/누적 kWh가 두 배로 잡힐 위험이 있다 — SELECT류(멱등)만 재시도 대상.
    try:
        result = supabase.table(READINGS_TABLE).insert(reading_data).execute()
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="센서 기록을 Supabase에 저장하지 못했습니다.",
        ) from error

    saved_reading = SensorReadingResponse.model_validate(result.data[0])

    # HTTP 또는 센서 WebSocket 중 어느 경로로 저장돼도 웹 구독자에게 즉시 전송합니다.
    await reading_hub.broadcast_reading(
        user_id=user_id,
        place_id=resolved_place_id,
        reading=saved_reading.model_dump(mode="json"),
    )

    # jh 추가 - 마이페이지에서 사용자가 명시적으로 동의한 place에 한해, 웹 앱이
    # 열려 있지 않아도 서버가 알아서 기기를 조작한다. 실제 하드웨어는 이
    # reading 저장 경로를 웹 앱과 무관하게 계속 타므로(BLE→게이트웨이→서버),
    # 이 지점이 곧 "무인 자동 제어"의 주기가 된다 — 별도 스케줄러가 필요 없다.
    if place.get("background_condition_control_enabled"):
        await _apply_background_condition_control(
            user_id,
            resolved_place_id,
            recommendation,
            sensor_data.window_is_open,
            sensor_data.ac_is_on,
        )

    if place.get("background_occupancy_control_enabled"):
        await _apply_background_occupancy_control(user_id, place)

    return saved_reading


def _get_all_places_for_user(user_id: int) -> list[dict]:
    result = execute_supabase_with_retry(
        lambda: (
            supabase.table(PLACES_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("id")
            .execute()
        )
    )
    return result.data or []


async def save_reading_for_user(
    user_id: int,
    sensor_data_dict: dict,
    place_id: Optional[int] = None,
    reading_source: str = "SENSOR",
    fan_out: bool = True,
    outdoor_overrides: Optional[dict] = None,
) -> SensorReadingResponse:
    """실내값 하나를 저장한다.

    jh 수정함 - 팬아웃 도입: 물리 센서는 사용자당 1개라는 제품 결정에 따라,
    실내값 1건이 들어오면 그 사용자의 모든 장소에 각각 (그 장소 좌표의
    실외값 + 개별 추천) readings 행을 하나씩 만든다. fan_out=False면 옛날
    방식대로 place_id 하나만 저장한다(/dev/mock-reading 전용 — 테스트
    버튼은 "이 카드만" 확인하는 용도라 팬아웃 대상이 아님).

    반환값은 항상 대표 1건: is_default 장소 저장이 성공했으면 그 행,
    아니면(기본장소 없음 또는 기본장소가 스킵됨) 첫 성공 행. 호출부 3곳
    (create_reading/create_mock_reading/realtime_router)의 응답 계약은
    바뀌지 않는다 — fan_out 여부와 무관하게 항상 SensorReadingResponse
    하나를 돌려준다.

    jh 수정함 - outdoor_overrides는 create_mock_reading()만 넘긴다(테스트
    모드 "실외 직접 입력"). 다른 호출부는 안 넘기므로 기본값 None 그대로라
    동작이 바뀌지 않는다 — _save_reading_to_place() 참고.
    """
    base_sensor_data = SensorReadingCreate.model_validate(sensor_data_dict)

    if not fan_out:
        place = get_place_for_user(user_id, place_id)
        if not place:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="실외 날씨 API를 조회할 장소가 등록되어 있지 않습니다.",
            )
        cumulative_kwh_this_month = get_cumulative_kwh(user_id)
        try:
            return await _save_reading_to_place(
                user_id,
                base_sensor_data,
                place,
                reading_source,
                cumulative_kwh_this_month,
                outdoor_overrides,
            )
        except _PlaceSaveSkipped as error:
            status_code = (
                status.HTTP_422_UNPROCESSABLE_ENTITY
                if "위치가 설정되지 않아" in error.detail
                else status.HTTP_503_SERVICE_UNAVAILABLE
            )
            raise HTTPException(status_code=status_code, detail=error.detail) from error

    places = _get_all_places_for_user(user_id)
    if not places:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="실외 날씨 API를 조회할 장소가 등록되어 있지 않습니다.",
        )

    # jh 수정함 - 사용자 전체 기준 값이라 장소마다 다시 계산할 필요 없음.
    # 팬아웃 진입 전 1회만 조회해서 모든 장소의 estimate_savings()에 재사용.
    cumulative_kwh_this_month = get_cumulative_kwh(user_id)

    successes: list[tuple[dict, SensorReadingResponse]] = []
    last_skip_detail = "모든 장소의 실외 날씨 API 조회에 실패했습니다."

    for place in places:
        try:
            saved = await _save_reading_to_place(
                user_id,
                base_sensor_data,
                place,
                reading_source,
                cumulative_kwh_this_month,
                outdoor_overrides,
            )
            successes.append((place, saved))
        except _PlaceSaveSkipped as error:
            last_skip_detail = error.detail
            print(f"[readings] place_id={error.place_id} 저장 스킵: {error.detail}")

    if not successes:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=last_skip_detail,
        )

    for place, saved in successes:
        if place.get("is_default"):
            return saved

    return successes[0][1]


# jh 수정함 - 프론트 "테스트 모드" 폼이 직접 입력한 실내값을 받는다(랜덤 생성 제거).
# window_is_open/ac_is_on의 None은 "센서 미연결" 재현용이라 그대로 저장 경로에
# 넘긴다 — 여기서 임의 기본값(False 등)으로 채우지 않는다.
# outdoor_temperature/outdoor_humidity는 "실외 직접 입력(시연용)" 전용 옵션
# 필드다. None(기본)이면 기존대로 날씨 API 실측값을 그대로 쓴다 — 값을
# 넣었을 때만 그 필드만 덮어쓰고 미세먼지/풍속 등은 실데이터를 유지한다.
class MockReadingInput(BaseModel):
    indoor_temperature: float = Field(ge=-50, le=80)
    indoor_humidity: float = Field(ge=0, le=100)
    window_is_open: Optional[bool] = None
    ac_is_on: Optional[bool] = None
    outdoor_temperature: Optional[float] = Field(default=None, ge=-50, le=80)
    outdoor_humidity: Optional[float] = Field(default=None, ge=0, le=100)


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
    # jh 수정함 - fan_out 기본값(True)이라 place_id는 하위호환으로만 받고
    # 실제 저장 대상 결정엔 안 쓰임 — 이 사용자의 모든 장소에 팬아웃 저장됨.
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
    payload: MockReadingInput,
    place_id: Optional[int] = Query(default=None, ge=1),
    test_mode: Literal["manual", "auto"] = Query(default="manual"),
    current_user: dict = Depends(get_current_user),
):
    mock_data = {
        "indoor_temperature": payload.indoor_temperature,
        "indoor_humidity": payload.indoor_humidity,
        "window_is_open": payload.window_is_open,
        "ac_is_on": payload.ac_is_on,
        "current_mode": "MANUAL",
    }
    source = "TEST_AUTO" if test_mode == "auto" else "TEST_MANUAL"
    # jh 수정함 - "실외 직접 입력(시연용)" 값. 둘 다 비우면(None) 저장 경로가
    # 기존대로 날씨 API 실측값만 쓴다 — dev 전용 이 엔드포인트에만 있는
    # 옵션이라 /readings(실제 센서)·MQTT·WebSocket 경로엔 영향 없다.
    outdoor_overrides = {
        "outdoor_temperature": payload.outdoor_temperature,
        "outdoor_humidity": payload.outdoor_humidity,
    }
    # jh 수정함 - 테스트 버튼은 "선택한 장소 카드 확인" 용도라 팬아웃 대상이
    # 아님(결정사항). fan_out=False로 옛날처럼 지정 place 단일 저장 유지.
    return await save_reading_for_user(
        current_user["id"],
        mock_data,
        place_id=place_id,
        reading_source=source,
        fan_out=False,
        outdoor_overrides=outdoor_overrides,
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


# jh 수정함 - 추천은 더 이상 60초 폴링만으로 화면에서 자동 갱신되지 않는다
# (App.jsx/RecommendationCard.jsx 참고). 카운트다운 자동실행/거절 결과가 나온
# 뒤 사용자가 "다시 추천받기"를 눌렀을 때만 이 엔드포인트를 호출한다.
# recommendation_engine 쪽 로직(target_cooldown_minutes 등)은 그대로 두고,
# 대신 "실제로 몇 초 유지했다가 어떤 상황에서 다시 받았는지"를 여기 남겨서
# 나중에 그 임계값을 튜닝할 근거 데이터로 쓴다.
class RecommendationRefreshRequest(BaseModel):
    place_id: int = Field(ge=1)
    previous_action: str
    previous_outcome: Literal[
        "AUTO_EXECUTED",
        "REJECTED_MANUAL",
        "NO_ACTION_NEEDED",
        "AUTO_EXECUTION_FAILED",
    ]
    shown_at: datetime


@router.post("/recommendation/refresh", response_model=SensorReadingResponse)
def refresh_recommendation(
    payload: RecommendationRefreshRequest,
    current_user: dict = Depends(get_current_user),
):
    get_place_for_user(current_user["id"], payload.place_id)
    latest_reading = get_latest_reading(current_user["id"], payload.place_id)

    shown_at = (
        payload.shown_at
        if payload.shown_at.tzinfo is not None
        else payload.shown_at.replace(tzinfo=timezone.utc)
    )
    held_seconds = max(
        0, int((datetime.now(timezone.utc) - shown_at).total_seconds())
    )

    event_row = {
        "place_id": payload.place_id,
        "user_id": current_user["id"],
        "previous_action": payload.previous_action,
        "previous_outcome": payload.previous_outcome,
        "shown_at": shown_at.isoformat(),
        "held_seconds": held_seconds,
        "indoor_temperature": latest_reading.indoor_temperature,
        "indoor_humidity": latest_reading.indoor_humidity,
        "outdoor_temperature": latest_reading.outdoor_temperature,
        "outdoor_humidity": latest_reading.outdoor_humidity,
        "window_is_open": latest_reading.window_is_open,
        "ac_is_on": latest_reading.recommendation.ac_is_on,
    }
    execute_supabase_with_retry(
        lambda: (
            supabase.table(RECOMMENDATION_REFRESH_EVENTS_TABLE)
            .insert(event_row)
            .execute()
        )
    )

    return latest_reading


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
async def control_device(
    command: DeviceControl,
    current_user: dict = Depends(get_current_user),
):
    # 선택 장소가 로그인 사용자의 소유인지 먼저 확인합니다.
    await asyncio.to_thread(
        get_place_for_user,
        current_user["id"],
        command.place_id,
    )

    try:
        result = await device_hub.send_command(
            user_id=current_user["id"],
            requested_place_id=command.place_id,
            action=command.action,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error
    except DeviceConnectionError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error

    # jh 추가 - 명령이 실제로 게이트웨이까지 전송된 뒤에만 기록한다(뱃지
    # 퀘스트 "첫 수동 조작"의 근거 데이터). 기기가 결과를 확인해줬는지
    # (result_received)까지는 안 보고, "사용자가 조작을 시도해 명령이
    # 나갔다"만으로 충분하다고 봤다.
    #
    # jh 수정함 - 위 device_hub.send_command()가 이미 성공해서 실제로 기기가
    # 움직인 뒤다. 이 로깅은 순전히 부가 기능(뱃지 집계용)이라, 여기서 예외가
    # 나도(예: 스키마 캐시 지연으로 인한 APIError, 순간적인 네트워크 문제로
    # execute_supabase_with_retry가 재시도 끝에 던지는 HTTPException 등)
    # 이미 성공한 기기 제어 응답 자체를 실패로 덮어써서 사용자에게 잘못된
    # 오류를 보여주면 안 된다.
    try:
        await asyncio.to_thread(
            lambda: execute_supabase_with_retry(
                lambda: (
                    supabase.table(DEVICE_CONTROL_EVENTS_TABLE)
                    .insert(
                        {
                            "place_id": command.place_id,
                            "user_id": current_user["id"],
                            "action": command.action,
                            "source": command.source,
                        }
                    )
                    .execute()
                )
            )
        )
    except Exception as error:
        print(f"[뱃지] device_control_events 기록 실패(기기 제어 자체는 이미 성공): {error}")

    return result
