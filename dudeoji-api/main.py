# 배포 환경변수를 읽기 위해 가져온다.
import os

# 앱 시작 시 데이터베이스를 준비하는 lifespan에 사용한다.
from contextlib import asynccontextmanager

# 현재 시각을 기록하기 위해 가져온다.
from datetime import datetime, timezone

# 추천 결과에 허용되는 문자열을 제한하기 위해 가져온다.
from typing import Literal

# FastAPI 서버와 오류 처리 기능을 가져온다.
from fastapi import FastAPI, HTTPException, Query, status

# React 프론트엔드의 요청을 허용하기 위한 기능이다.
from fastapi.middleware.cors import CORSMiddleware

# 입력 데이터의 형식과 범위를 검사한다.
from pydantic import BaseModel, Field

# database.py에서 SQLite 관련 함수들을 가져온다.
from database import (
    count_readings,
    fetch_latest_reading,
    fetch_reading_history,
    initialize_database,
    insert_reading,
)


# FastAPI 서버가 시작될 때 SQLite 테이블을 준비한다.
@asynccontextmanager
async def lifespan(app: FastAPI):
    # sensor_readings 테이블이 없으면 자동으로 만든다.
    initialize_database()

    # 서버가 실행되는 동안 여기에서 대기한다.
    yield


# FastAPI 백엔드 애플리케이션 생성
app = FastAPI(
    title="두더지 API",
    description="실내외 온습도를 분석하여 냉방 방법을 추천하는 API",
    version="0.2.0",
    lifespan=lifespan,
)


# React 프론트엔드의 요청을 허용할 주소 목록
allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",

    # Render에 배포한 프론트엔드 주소
    "https://dudeoji-web.onrender.com",
]


# Render 환경변수에서 배포된 프론트엔드 주소를 가져온다.
#
# Render에 다음과 같이 등록할 예정이다.
# Key: FRONTEND_URL
# Value: https://실제주소.vercel.app
frontend_url = os.getenv("FRONTEND_URL")


# 배포된 프론트엔드 주소가 등록되어 있다면
# CORS 허용 목록에 추가한다.
if frontend_url:
    # 주소 마지막의 /를 제거한다.
    # CORS에서는 주소가 정확하게 일치해야 하기 때문이다.
    allowed_origins.append(
        frontend_url.rstrip("/")
    )


# React 프론트엔드가 이 백엔드에 접근할 수 있도록 허용한다.
app.add_middleware(
    CORSMiddleware,

    # 로컬 주소와 배포된 Vercel 주소를 허용한다.
    allow_origins=allowed_origins,

    # 쿠키와 인증 정보를 포함한 요청을 허용한다.
    allow_credentials=True,

    # GET, POST 등 모든 요청 방식을 허용한다.
    allow_methods=["*"],

    # 모든 요청 헤더를 허용한다.
    allow_headers=["*"],
)


# 추천 결과로 허용되는 세 가지 값
RecommendationAction = Literal[
    "OPEN_WINDOW",
    "USE_AIRCON",
    "MAINTAIN",
]


# 프론트엔드나 ESP32가 보낼 센서 데이터 형식
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


# 추천 결과의 데이터 형식
class Recommendation(BaseModel):
    action: RecommendationAction
    title: str
    summary: str
    reason: str


# 저장된 센서 기록의 전체 형식
class SensorReadingResponse(SensorReadingCreate):
    id: int
    measured_at: datetime
    recommendation: Recommendation


# 실내외 온습도를 분석하여 추천 결과를 만드는 함수
def calculate_recommendation(
    sensor_data: SensorReadingCreate,
) -> Recommendation:
    # 실내 온도에서 실외 온도를 뺀다.
    temperature_difference = (
        sensor_data.indoor_temperature
        - sensor_data.outdoor_temperature
    )

    # 실외가 2℃ 이상 낮고 습도가 70% 이하이면 창문 열기
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

    # 실내가 27℃ 이상이고 창문 열기 조건이 아니면 에어컨 사용
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

    # 위 조건에 해당하지 않으면 현재 상태 유지
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


# SQLite에서 가장 최근 기록을 가져오는 함수
def get_latest_reading() -> SensorReadingResponse:
    # database.py를 통해 최신 기록을 조회한다.
    latest_reading = fetch_latest_reading()

    # 저장된 기록이 없으면 404 오류를 반환한다.
    if latest_reading is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="저장된 센서 기록이 없습니다.",
        )

    # SQLite 딕셔너리를 Pydantic 응답 객체로 변환한다.
    return SensorReadingResponse.model_validate(
        latest_reading
    )


# 백엔드 기본 주소
@app.get("/")
async def root():
    return {
        "service": "두더지 API",
        "status": "running",
        "storage": "sqlite",
    }


# 서버와 데이터베이스가 정상 작동 중인지 확인하는 주소
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",

        # SQLite에 저장된 전체 기록 수를 가져온다.
        "record_count": count_readings(),

        "database": "sqlite",
    }


# 새로운 센서값을 받고 추천 결과와 함께 SQLite에 저장한다.
@app.post(
    "/api/readings",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reading(
    sensor_data: SensorReadingCreate,
):
    # 입력된 센서값으로 추천 결과를 계산한다.
    recommendation = calculate_recommendation(
        sensor_data
    )

    # UTC 기준 현재 시각을 만든다.
    measured_at = datetime.now(timezone.utc)

    # 센서값과 추천 결과를 SQLite에 저장한다.
    saved_reading = insert_reading(
        sensor_data=sensor_data.model_dump(),
        recommendation=recommendation.model_dump(),
        measured_at=measured_at.isoformat(),
    )

    # 저장된 SQLite 데이터를 API 응답 형식으로 변환한다.
    return SensorReadingResponse.model_validate(
        saved_reading
    )


# 가장 최근 센서 기록 조회
@app.get(
    "/api/readings/latest",
    response_model=SensorReadingResponse,
)
async def read_latest():
    return get_latest_reading()


# 최근 센서 기록 여러 개 조회
@app.get(
    "/api/readings/history",
    response_model=list[SensorReadingResponse],
)
async def read_history(
    # 기본 8개, 최소 1개, 최대 100개까지 조회 가능
    limit: int = Query(
        default=8,
        ge=1,
        le=100,
    ),
):
    # SQLite에서 최근 기록을 조회한다.
    database_readings = fetch_reading_history(
        limit
    )

    # 각 기록을 FastAPI 응답 형식으로 변환한다.
    return [
        SensorReadingResponse.model_validate(
            reading
        )
        for reading in database_readings
    ]


# 가장 최근 추천 결과만 조회
@app.get(
    "/api/recommendation",
    response_model=Recommendation,
)
async def read_recommendation():
    latest_reading = get_latest_reading()

    return latest_reading.recommendation