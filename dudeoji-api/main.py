# Render에 등록한 환경변수를 읽기 위해 가져온다.
import os

from dotenv import load_dotenv #dotenv 라이브러리 불러오기
load_dotenv()

from datetime import datetime

# Supabase에서 받은 날짜 문자열을 날짜 형식으로 변환하기 위해 사용한다.
from datetime import datetime

# 추천 결과에 허용되는 문자열을 제한하기 위해 가져온다.
from typing import Literal

# FastAPI 서버와 오류 처리 기능을 가져온다.
from fastapi import FastAPI, HTTPException, Query, status

# React 프론트엔드의 요청을 허용하기 위한 기능이다.
from fastapi.middleware.cors import CORSMiddleware

# 입력 데이터의 형식과 범위를 검사한다.
from pydantic import BaseModel, Field

# Supabase DB에 연결하기 위한 기능이다.
from supabase import Client, create_client

# 통합 판단 규칙 엔진을 가져온다.
from processor import determine_action

# MQTT 실행 함수
from mqtt_handler import start_mqtt


# ---------------------------------------------------------
# Supabase 연결
# ---------------------------------------------------------

# Render Environment에 등록한 Supabase 주소를 가져온다.
SUPABASE_URL = os.getenv("SUPABASE_URL")

# Render Environment에 등록한 서버 전용 Secret key를 가져온다.
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")


# 환경변수가 등록되지 않았다면 서버 시작을 중단한다.
# 키가 없는 상태로 서버가 잘못 실행되는 것을 방지한다.
if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    raise RuntimeError(
        "SUPABASE_URL 또는 SUPABASE_SECRET_KEY "
        "환경변수가 설정되지 않았습니다."
    )


# Supabase DB와 통신할 클라이언트를 만든다.
supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
)


# 실제 센서 기록을 저장할 Supabase 테이블 이름이다.
READINGS_TABLE = "readings"


# ---------------------------------------------------------
# FastAPI 앱 생성
# ---------------------------------------------------------

app = FastAPI(
    title="두더지 API",
    description="실내외 온습도를 분석하여 냉방 방법을 추천하는 API",
    version="0.3.0",
)


# ---------------------------------------------------------
# CORS 설정
# ---------------------------------------------------------

# React 프론트엔드의 요청을 허용할 주소 목록이다.
allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",

    # Render에 배포된 React 프론트엔드 주소이다.
    "https://dudeoji-web.onrender.com",
]


# Render 환경변수에 별도로 등록한 프론트엔드 주소를 가져온다.
frontend_url = os.getenv("FRONTEND_URL")


# FRONTEND_URL이 등록되어 있으면 CORS 허용 목록에 추가한다.
if frontend_url:
    allowed_origins.append(
        frontend_url.rstrip("/")
    )


# React 프론트엔드가 백엔드 API에 접근할 수 있도록 허용한다.
app.add_middleware(
    CORSMiddleware,

    # 로컬 주소와 배포된 프론트엔드 주소를 허용한다.
    allow_origins=allowed_origins,

    # 쿠키와 인증 정보가 포함된 요청을 허용한다.
    allow_credentials=True,

    # GET과 POST를 포함한 모든 요청 방식을 허용한다.
    allow_methods=["*"],

    # 모든 요청 헤더를 허용한다.
    allow_headers=["*"],
)


# ---------------------------------------------------------
# API 데이터 형식
# ---------------------------------------------------------

# 추천 결과로 허용되는 세 가지 값이다.
RecommendationAction = Literal[
    "OPEN_WINDOW",
    "USE_AIRCON",
    "MAINTAIN",
    "CLOSE_WINDOW",
    "ENJOY"
]


# 프론트엔드 또는 ESP32가 전송할 센서 데이터 형식이다.
class SensorReadingCreate(BaseModel):
    indoor_temperature: float = Field(
        ge=-50,
        le=80,
        description="실내 온도",
    )

    indoor_humidity: float = Field(
        ge=0,
        le=100,
        description="실내 습도",
    )

    outdoor_temperature: float = Field(
        ge=-50,
        le=80,
        description="실외 온도",
    )

    outdoor_humidity: float = Field(
        ge=0,
        le=100,
        description="실외 습도",
    )

class Savings(BaseModel):
    power_saved_kwh: float
    time_applied_hours: int
    cost_won: int
    message: str

# 백엔드가 계산하는 추천 결과의 형식이다.
class Recommendation(BaseModel):
    action: str
    title: str
    summary: str
    reason: str
    savings: Savings | None = None  # 프론트엔드로 절감 데이터를 보내기 위해 추가!


# Supabase에 저장된 센서 기록의 전체 응답 형식이다.
class SensorReadingResponse(SensorReadingCreate):
    id: int
    measured_at: datetime
    recommendation: Recommendation


# ---------------------------------------------------------
# Supabase 조회 함수
# ---------------------------------------------------------

def get_latest_reading() -> SensorReadingResponse:
    """
    Supabase에서 가장 최근 센서 기록 한 개를 가져온다.
    """

    try:
        # measured_at을 기준으로 내림차순 정렬한 뒤 한 개만 조회한다.
        result = (
            supabase
            .table(READINGS_TABLE)
            .select("*")
            .order("measured_at", desc=True)
            .limit(1)
            .execute()
        )

    except Exception as error:
        # 자세한 오류는 Render 로그에서 확인할 수 있도록 출력한다.
        print(f"Supabase 최신 기록 조회 오류: {error}")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase에서 최신 기록을 조회하지 못했습니다.",
        )

    # 조회된 데이터가 없으면 404 오류를 반환한다.
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="저장된 센서 기록이 없습니다.",
        )

    # Supabase 딕셔너리를 API 응답 형식으로 변환한다.
    return SensorReadingResponse.model_validate(
        result.data[0]
    )


# ---------------------------------------------------------
# API 주소
# ---------------------------------------------------------

# 백엔드 기본 주소이다.
@app.get("/")
def root():
    return {
        "service": "두더지 API",
        "status": "running",
        "storage": "supabase",
    }


# 서버와 Supabase DB가 정상 작동 중인지 확인한다.
@app.get("/health")
def health_check():
    try:
        # 전체 행 개수를 정확히 계산한다.
        # 실제 데이터는 한 개까지만 받아 불필요한 전송을 줄인다.
        result = (
            supabase
            .table(READINGS_TABLE)
            .select("id", count="exact")
            .limit(1)
            .execute()
        )

        # count 값이 없을 경우에는 0으로 처리한다.
        record_count = result.count or 0

    except Exception as error:
        print(f"Supabase 상태 확인 오류: {error}")

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase DB에 연결할 수 없습니다.",
        )

    return {
        "status": "healthy",
        "record_count": record_count,
        "database": "supabase",
    }


def fetch_real_weather():
    """
    외부 날씨 API (기상청 등) 연동을 위한 함수입니다.
    # TODO: 추후 여기에 실제 기상청/OpenWeather API 호출 로직을 연결하면 됩니다.
    """
    # 임시 mock 데이터 (현재는 고정값, 나중에 동적으로 교체)
    return {
        "weather": "맑음", # 맑음, 비, 눈, 태풍 등
        "pm25": 15.0,
        "wind_speed": 3.5
    }


# 새로운 센서값과 추천 결과를 Supabase에 저장한다.
@app.post("/api/readings", response_model=SensorReadingResponse, status_code=status.HTTP_201_CREATED)
def create_reading(sensor_data: SensorReadingCreate):
    
    # 1. 외부 날씨 API 데이터 가져오기 (가상 또는 실제)
    weather_info = fetch_real_weather()

    # 2. 통합 엔진에 맞게 데이터 조립
    env_data = {
        "indoor_temperature": sensor_data.indoor_temperature,
        "indoor_humidity": sensor_data.indoor_humidity,
        "outdoor_temperature": sensor_data.outdoor_temperature,
        "outdoor_humidity": sensor_data.outdoor_humidity,
        "weather": weather_info["weather"],
        "pm25": weather_info["pm25"],
        "wind_speed": weather_info["wind_speed"]
    }

    # 3. 통합 엔진(processor.py) 호출! (기본 수동모드로 테스트, 창문은 닫혀있다고 가정)
    # TODO: 센서 추가 시 window_is_open 값은 실제 창문 센서값과 연동하세요.
    recommendation_result = determine_action(env_data, window_is_open=False, current_mode="MANUAL")

    # 4. Supabase에 저장할 데이터 조립
    reading_data = {
        **sensor_data.model_dump(),
        "recommendation": {
            "action": recommendation_result["action"],
            "title": "두더지 스마트홈 추천", 
            "summary": recommendation_result["message"],
            "reason": recommendation_result["warning"] if recommendation_result["warning"] else "현재 상태 정상",
            "savings": recommendation_result["savings"]
        }
    }

    try:
        # 센서값과 추천 결과를 Supabase에 저장한다.
        result = (
            supabase
            .table(READINGS_TABLE)
            .insert(reading_data)
            .execute()
        )

    except Exception as error:
        print(f"Supabase 센서 기록 저장 오류: {error}")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="센서 기록을 Supabase에 저장하지 못했습니다.",
        )

    # 저장된 데이터가 반환되지 않은 경우 오류로 처리한다.
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="저장 결과를 확인하지 못했습니다.",
        )

    # Supabase가 반환한 저장 결과를 API 응답 형식으로 변환한다.
    return SensorReadingResponse.model_validate(
        result.data[0]
    )


# 가장 최근 센서 기록 한 개를 조회한다.
@app.get(
    "/api/readings/latest",
    response_model=SensorReadingResponse,
)
def read_latest():
    return get_latest_reading()


# 최근 센서 기록 여러 개를 조회한다.
@app.get(
    "/api/readings/history",
    response_model=list[SensorReadingResponse],
)
def read_history(
    # 기본 8개, 최소 1개, 최대 100개까지 조회할 수 있다.
    limit: int = Query(
        default=8,
        ge=1,
        le=100,
    ),
):
    try:
        # 최근 측정 시간 순서로 지정된 개수만 조회한다.
        result = (
            supabase
            .table(READINGS_TABLE)
            .select("*")
            .order("measured_at", desc=True)
            .limit(limit)
            .execute()
        )

    except Exception as error:
        print(f"Supabase 기록 목록 조회 오류: {error}")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="센서 기록 목록을 조회하지 못했습니다.",
        )

    # 각 Supabase 행을 FastAPI 응답 형식으로 변환한다.
    return [
        SensorReadingResponse.model_validate(reading)
        for reading in result.data
    ]


# 가장 최근 센서 기록의 추천 결과만 조회한다.
@app.get(
    "/api/recommendation",
    response_model=Recommendation,
)
def read_recommendation():
    latest_reading = get_latest_reading()

    return latest_reading.recommendation


# FastAPI 서버가 시작될 때 MQTT도 같이 실행되도록 설정
@app.on_event("startup")
def startup_event():
    print("FastAPI 서버 시작: MQTT 수신기를 가동합니다.")
    start_mqtt()