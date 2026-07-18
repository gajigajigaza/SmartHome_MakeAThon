"""FastAPI 앱 조립 파일.

담당: 공용 (여기는 라우터를 연결하는 곳이지, 로직을 직접 작성하는 곳이
아닙니다. 새 엔드포인트는 아래 routers/ 안의 자기 담당 라우터 파일에
추가하고, 여기서는 app.include_router()만 하면 됩니다.)

- 회원가입/로그인/마이페이지 → routers/auth_router.py (류은)
- 장소/에어컨 등록 → routers/places_router.py (류은)
- 센서 기록/추천 → routers/readings_router.py (민주)
- 판단 규칙 엔진 → recommendation_engine.py (민주)
- 절감량 계산 → savings.py (정현)
- MQTT 게이트웨이 수신 → mqtt_handler.py (민주)
"""
import os

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from db import READINGS_TABLE, supabase
from routers.auth_router import router as auth_router
from routers.places_router import router as places_router
from routers.readings_router import router as readings_router
from routers.readings_router import save_reading_for_user
from routers.weather_router import router as weather_router

app = FastAPI(
    title="두더지 API",
    description="계정, 에어컨 등록, 센서 추천을 제공하는 API",
    version="1.1.0",
)

allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    # jh 수정함 - 정현 직접 요청으로 추가(main.py 담당 공용이라 원래 범위 밖,
    # 팀원들에게 공유 필요). 로컬 백엔드(8001)와 같은 오리진에서 프론트를
    # 띄워 테스트하는 경우 대비.
    "http://localhost:8001",
    "http://127.0.0.1:8001",
    "https://dudeoji-web.onrender.com",
]

frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    allowed_origins.append(frontend_url.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(places_router)
app.include_router(readings_router)
app.include_router(weather_router)


@app.get("/")
def root():
    return {
        "service": "두더지 API",
        "status": "running",
        "storage": "supabase",
        "version": "1.1.0",
    }


@app.get("/health")
def health_check():
    try:
        result = (
            supabase.table(READINGS_TABLE)
            .select("id", count="exact")
            .limit(1)
            .execute()
        )
        record_count = result.count or 0
    except Exception as error:
        print(f"Supabase 상태 확인 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase DB에 연결할 수 없습니다.",
        ) from error

    return {
        "status": "healthy",
        "record_count": record_count,
        "database": "supabase",
    }


# ---------------------------------------------------------
# MQTT 게이트웨이 연동 (선택 사항, 담당: 민주)
# ---------------------------------------------------------
# 하드웨어(센서 노드 + 게이트웨이)가 실제로 붙기 전까지는 꺼둡니다.
# 대면 해커톤에서 게이트웨이가 연결되면 환경변수만 켜면 됩니다.
@app.on_event("startup")
def start_mqtt_listener_if_enabled():
    if os.getenv("MQTT_ENABLED", "false").lower() != "true":
        print("[MQTT] MQTT_ENABLED=false 라서 비활성화 상태입니다.")
        return

    try:
        from mqtt_handler import start_mqtt

        start_mqtt(supabase, save_reading_for_user)
    except Exception as error:
        # 브로커 연결 실패로 서버 전체가 죽으면 안 되므로 로그만 남긴다.
        print(f"[MQTT] 시작 실패, REST API는 정상 동작합니다: {error}")
