# Render에 등록한 환경변수를 읽기 위해 가져온다.
import os

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


# 백엔드가 계산하는 추천 결과의 형식이다.
class Recommendation(BaseModel):
    action: RecommendationAction
    title: str
    summary: str
    reason: str


# Supabase에 저장된 센서 기록의 전체 응답 형식이다.
class SensorReadingResponse(SensorReadingCreate):
    id: int
    measured_at: datetime
    recommendation: Recommendation


# ---------------------------------------------------------
# 추천 계산
# ---------------------------------------------------------

def calculate_recommendation(
    sensor_data: SensorReadingCreate,
) -> Recommendation:
    """
    실내외 온도와 습도를 비교해 냉방 방법을 추천한다.
    """

    # 실내 온도에서 실외 온도를 뺀 값이다.
    temperature_difference = (
        sensor_data.indoor_temperature
        - sensor_data.outdoor_temperature
    )

    # 실외가 2℃ 이상 낮고 습도가 70% 이하이면 창문 열기를 추천한다.
    if (
        temperature_difference >= 2
        and sensor_data.outdoor_humidity <= 70
    ):
        return Recommendation(
            action="OPEN_WINDOW",
            title="지금은 창문을 열어보세요",
            summary="실외 공기가 더 시원하고 습도도 적절합니다.",
            reason=(
                f"실외 온도가 실내보다 "
                f"{temperature_difference:.1f}℃ 낮고, "
                f"실외 습도가 "
                f"{sensor_data.outdoor_humidity:.0f}%이므로 "
                f"자연환기가 유리합니다."
            ),
        )

    # 실내가 27℃ 이상이면 에어컨 사용을 추천한다.
    if sensor_data.indoor_temperature >= 27:
        return Recommendation(
            action="USE_AIRCON",
            title="에어컨 사용을 권장해요",
            summary="외부 공기로는 실내를 충분히 식히기 어렵습니다.",
            reason=(
                f"현재 실내 온도는 "
                f"{sensor_data.indoor_temperature:.1f}℃이고, "
                f"실내외 온도 차이는 "
                f"{temperature_difference:.1f}℃입니다. "
                f"자연환기보다 냉방이 적절합니다."
            ),
        )

    # 위 조건에 해당하지 않으면 현재 상태 유지를 추천한다.
    return Recommendation(
        action="MAINTAIN",
        title="현재 상태를 유지해도 좋아요",
        summary="실내 환경이 비교적 쾌적한 범위입니다.",
        reason=(
            f"현재 실내 온도는 "
            f"{sensor_data.indoor_temperature:.1f}℃로 "
            f"냉방이 꼭 필요한 수준은 아닙니다."
        ),
    )


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


# 새로운 센서값과 추천 결과를 Supabase에 저장한다.
@app.post(
    "/api/readings",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_reading(
    sensor_data: SensorReadingCreate,
):
    # 입력된 센서값으로 추천 결과를 계산한다.
    recommendation = calculate_recommendation(
        sensor_data
    )

    # Supabase readings 테이블에 저장할 데이터를 만든다.
    #
    # measured_at은 Supabase 테이블의 default now()가 자동으로 넣는다.
    reading_data = {
        **sensor_data.model_dump(),
        "recommendation": recommendation.model_dump(),
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