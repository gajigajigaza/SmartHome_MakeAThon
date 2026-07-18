"""로그인 세션 관리 + 비밀번호 보안 유틸.

담당: 류은

다른 라우터(places_router, readings_router 등)는 여기 있는
get_current_user를 `Depends(get_current_user)`로 가져다 씁니다.
FastAPI가 요청마다 이 함수를 먼저 실행해서 토큰을 검사하고,
문제 없으면 사용자 정보를 엔드포인트 함수에 넣어줍니다.
"""
import base64
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import Header, HTTPException, status

from db import SESSIONS_TABLE, USERS_TABLE, supabase

SESSION_DAYS = 30
RESET_TOKEN_MINUTES = 15
PBKDF2_ITERATIONS = 310_000


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def encode_bytes(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii")


def decode_bytes(value: str) -> bytes:
    return base64.urlsafe_b64decode(value.encode("ascii"))


def hash_secret(value: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        value.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${encode_bytes(salt)}${encode_bytes(digest)}"


def verify_secret(value: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt_text, digest_text = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False

        expected = decode_bytes(digest_text)
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            value.encode("utf-8"),
            decode_bytes(salt_text),
            int(iterations),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def parse_supabase_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def create_session(user_id: int) -> str:
    raw_token = secrets.token_urlsafe(32)
    expires_at = utc_now() + timedelta(days=SESSION_DAYS)

    supabase.table(SESSIONS_TABLE).insert(
        {
            "user_id": user_id,
            "token_hash": token_hash(raw_token),
            "expires_at": expires_at.isoformat(),
        }
    ).execute()

    return raw_token


def get_bearer_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다.",
        )

    return authorization.removeprefix("Bearer ").strip()


def execute_supabase_with_retry(operation, attempts: int = 3):
    """Windows 소켓/Supabase의 순간적인 연결 오류만 짧게 재시도합니다."""
    for attempt in range(attempts):
        try:
            return operation()
        except httpx.TransportError as error:
            if attempt >= attempts - 1:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=(
                        "데이터베이스 연결이 일시적으로 불안정합니다. "
                        "잠시 후 다시 시도해 주세요."
                    ),
                ) from error
            time.sleep(0.15 * (2 ** attempt))


def get_current_user(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    raw_token = get_bearer_token(authorization)
    hashed_token = token_hash(raw_token)

    session_result = execute_supabase_with_retry(
        lambda: (
            supabase.table(SESSIONS_TABLE)
            .select("id,user_id,expires_at")
            .eq("token_hash", hashed_token)
            .limit(1)
            .execute()
        )
    )

    if not session_result.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인 정보가 유효하지 않습니다.",
        )

    session = session_result.data[0]
    if parse_supabase_datetime(session["expires_at"]) <= utc_now():
        execute_supabase_with_retry(
            lambda: (
                supabase.table(SESSIONS_TABLE)
                .delete()
                .eq("id", session["id"])
                .execute()
            )
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 만료되었습니다. 다시 로그인해 주세요.",
        )

    user_result = execute_supabase_with_retry(
        lambda: (
            supabase.table(USERS_TABLE)
            .select("id,username,nickname")
            .eq("id", session["user_id"])
            .limit(1)
            .execute()
        )
    )

    if not user_result.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자 정보를 찾을 수 없습니다.",
        )

    return user_result.data[0]


def get_user_password_hash(user_id: int) -> str:
    result = (
        supabase.table(USERS_TABLE)
        .select("id,password_hash")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자 정보를 찾을 수 없습니다.",
        )

    return result.data[0]["password_hash"]


def verify_current_password(user_id: int, password: str) -> None:
    if not verify_secret(password, get_user_password_hash(user_id)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="현재 비밀번호가 일치하지 않습니다.",
        )
