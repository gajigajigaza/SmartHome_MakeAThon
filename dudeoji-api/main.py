"""FastAPI 앱 조립 파일.

담당: 공용 (여기는 라우터를 연결하는 곳이지, 로직을 직접 작성하는 곳이
아닙니다. 새 엔드포인트는 아래 routers/ 안의 자기 담당 라우터 파일에
추가하고, 여기서는 app.include_router()만 하면 됩니다.)

- 회원가입/로그인/마이페이지 → routers/auth_router.py (류은)
- 장소/에어컨 등록 → routers/places_router.py (류은)
- 센서 기록/추천 → routers/readings_router.py (민주)
- 판단 규칙 엔진 → recommendation_engine.py (민주)
- 절감량 계산 → savings.py (정현)
- 프로필(뱃지) 잠금 조건 → routers/badges_router.py + badges.py
- MQTT 게이트웨이 수신 → mqtt_handler.py (민주)
- 재실 감지 이력/패턴 학습 → routers/occupancy_router.py + occupancy_engine.py (정현)
"""
import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from db import READINGS_TABLE, supabase
from perf import start_loop_lag_monitor
from routers.auth_router import router as auth_router
from routers.badges_router import router as badges_router
from routers.places_router import router as places_router
from routers.occupancy_router import router as occupancy_router
from routers.readings_router import router as readings_router
from routers.realtime_router import router as realtime_router
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
app.include_router(badges_router)
app.include_router(places_router)
app.include_router(readings_router)
app.include_router(realtime_router)
app.include_router(weather_router)
app.include_router(occupancy_router)


# jh 수정함 - 이슈 #38. 이 앱은 동기 supabase-py 호출을 워커 스레드로 넘겨
# 이벤트 루프를 비우는 구조다(perf.run_blocking). 그런데 asyncio의 기본
# executor는 min(32, cpu_count+4)개라 vCPU 1~2개인 Render 인스턴스에서는
# 5~6개밖에 안 된다. reading 1건이 장소마다 여러 번 DB를 왕복하고, 그게
# 5초 주기로 들어오므로 스레드가 금방 마른다 — 그러면 루프는 안 막혀도
# to_thread가 큐에 쌓여 같은 증상이 조용히 재현된다.
DB_THREAD_POOL_SIZE = int(os.getenv("DB_THREAD_POOL_SIZE", "16"))


@app.on_event("startup")
def configure_thread_pool():
    loop = asyncio.get_running_loop()
    loop.set_default_executor(
        ThreadPoolExecutor(
            max_workers=DB_THREAD_POOL_SIZE,
            thread_name_prefix="dudeoji-db",
        )
    )
    print(f"[perf] DB 워커 스레드풀 {DB_THREAD_POOL_SIZE}개로 설정했습니다.")


@app.on_event("startup")
async def start_perf_monitor():
    start_loop_lag_monitor()


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
    """순수 liveness. DB를 건드리지 않는다.

    jh 수정함 - 이슈 #38. 원래 여기서 readings 전체 COUNT(count="exact")를
    돌렸다. 두 가지가 문제였다.

    1. 이 표는 팬아웃 때문에 계속 커진다(5초 주기 × 장소 수). exact COUNT는
       매번 전체를 세므로 "서버 살아 있나?"를 확인하는 호출이 갈수록 가장
       무거운 쿼리가 된다.
    2. 애초에 이 엔드포인트를 부르는 목적은 "프로세스가 응답하는지"다.
       DB 왕복을 섞어두면 DB가 느릴 때 서버 자체 상태를 판별할 수 없다 —
       이슈 #38을 디버깅할 때 정확히 이게 방해가 됐다.

    DB 연결 확인은 /health/db로 분리했다.
    """
    return {"status": "healthy", "database": "supabase"}


@app.get("/health/db")
def health_check_db():
    """readiness. Supabase까지 실제로 왕복해 본다.

    count="planned"는 플래너 추정치라 표 크기와 무관하게 빠르다(exact처럼
    전체를 세지 않는다). 정확한 행 수가 필요한 화면은 없다.
    """
    try:
        result = (
            supabase.table(READINGS_TABLE)
            .select("id", count="planned")
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
