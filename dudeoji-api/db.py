"""Supabase 클라이언트 초기화 + 테이블 이름 상수.

담당: 공용 (모든 라우터가 여기서 supabase 클라이언트를 가져다 씀)
새 테이블을 추가할 때만 이 파일에 상수를 추가하면 됩니다.
"""
import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    raise RuntimeError(
        "SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 설정되지 않았습니다."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

READINGS_TABLE = "readings"
USERS_TABLE = "users"
SESSIONS_TABLE = "sessions"
RESET_TOKENS_TABLE = "password_reset_tokens"
AIRCON_MODELS_TABLE = "aircon_models"
PLACES_TABLE = "places"
USER_AIRCONS_TABLE = "user_aircons"
