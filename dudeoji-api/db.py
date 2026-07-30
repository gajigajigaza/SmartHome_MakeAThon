"""Supabase 클라이언트 초기화 + 테이블 이름 상수.

담당: 공용 (모든 라우터가 여기서 supabase 클라이언트를 가져다 씀)
새 테이블을 추가할 때만 이 파일에 상수를 추가하면 됩니다.
"""
import os

import httpx
from dotenv import load_dotenv
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    raise RuntimeError(
        "SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 설정되지 않았습니다."
    )

# jh 수정함 - 이슈 #38. 옵션을 안 주면 postgrest 타임아웃이 기본값
# 120초(postgrest.constants.DEFAULT_POSTGREST_CLIENT_TIMEOUT)다. 여기에
# auth_utils.execute_supabase_with_retry()의 재시도 3회가 곱해지면 한 번
# 막힌 쿼리가 최대 6분까지 붙잡힌다 — 관측된 "15초간 0 bytes" 증상이 그 정도로
# 길어질 수 있었던 이유이고, DB 호출을 워커 스레드로 옮긴 뒤에도 스레드풀을
# 말려버리는 원인이 된다. 실패는 빨리 드러나는 게 낫다.
SUPABASE_TIMEOUT_SECONDS = float(os.getenv("SUPABASE_TIMEOUT_SECONDS", "10"))

# jh 수정함 - 이슈 #38. supabase-py가 기본으로 만드는 httpx 클라이언트 설정
# 두 가지가 이 워크로드(5초 주기 센서 + 장소별 팬아웃)와 정면으로 안 맞았다.
#
# 1) http2=True: httpcore는 HTTP/2 커넥션이 "열려 있으면" 항상 재사용 가능이라
#    판단해서 두 번째 커넥션을 아예 열지 않는다. 그리고 그 하나뿐인 커넥션의
#    소켓 read는 내부 lock으로 직렬화된다. 즉 DB 호출을 워커 스레드로 옮겨도
#    (이벤트 루프는 풀리지만) DB 병렬성이 거의 안 생긴다. HTTP/1.1로 두면
#    커넥션 풀이 실제로 여러 개로 펼쳐진다.
# 2) keepalive_expiry=5.0: 게이트웨이 발행 주기가 정확히 5초라 커넥션이 매번
#    만료 경계에 걸려 회수된다 — reading마다 TLS 핸드셰이크를 새로 하는 셈이고,
#    0.1 vCPU(Render 무료 플랜)에서 그 비용은 무시할 수 없다.
_supabase_http_client = httpx.Client(
    http2=False,
    limits=httpx.Limits(
        max_connections=20,
        max_keepalive_connections=20,
        keepalive_expiry=60.0,
    ),
    timeout=httpx.Timeout(SUPABASE_TIMEOUT_SECONDS, connect=5.0),
    follow_redirects=True,
)

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    options=SyncClientOptions(
        httpx_client=_supabase_http_client,
        # httpx_client을 안 타는 경로(storage/functions)를 위한 보험.
        postgrest_client_timeout=SUPABASE_TIMEOUT_SECONDS,
        storage_client_timeout=SUPABASE_TIMEOUT_SECONDS,
        function_client_timeout=SUPABASE_TIMEOUT_SECONDS,
    ),
)

# jh 수정함 - Client.postgrest는 lock 없이 늦게 초기화되는 property다
# (`if self._postgrest is None:`). 이제 여러 워커 스레드가 동시에 첫 쿼리를
# 던질 수 있어서, 그대로 두면 스레드마다 SyncPostgrestClient(각자 httpx 커넥션
# 풀)를 만들고 하나만 남고 나머지는 소켓이 새는 경합이 생긴다. import 시점
# (아직 단일 스레드)에 한 번 만들어두면 그 경합 자체가 없어진다.
_ = supabase.postgrest

READINGS_TABLE = "readings"
USERS_TABLE = "users"
SESSIONS_TABLE = "sessions"
RESET_TOKENS_TABLE = "password_reset_tokens"
AIRCON_MODELS_TABLE = "aircon_models"
PLACES_TABLE = "places"
USER_AIRCONS_TABLE = "user_aircons"
OCCUPANCY_LOGS_TABLE = "occupancy_logs"
OCCUPANCY_MODELS_TABLE = "occupancy_models"
OCCUPANCY_PREDICTIONS_TABLE = "occupancy_predictions"
RECOMMENDATION_REFRESH_EVENTS_TABLE = "recommendation_refresh_events"
DEVICE_CONTROL_EVENTS_TABLE = "device_control_events"
DEVICE_TOKENS_TABLE = "device_tokens"
