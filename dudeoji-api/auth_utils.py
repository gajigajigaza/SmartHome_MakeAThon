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
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import Header, HTTPException, status

from db import SESSIONS_TABLE, USERS_TABLE, supabase

SESSION_DAYS = 30
RESET_TOKEN_MINUTES = 15

# jh 수정함 - 값은 그대로 두고 환경변수로만 조정할 수 있게 했다.
#
# 왜 문제인가: PBKDF2는 의도적으로 CPU를 태우는 함수이고, 이 서비스는 Render
# 무료 플랜(0.1 vCPU)에서 돈다. 이 머신에서 310,000회가 197ms인데, 0.1 CPU
# cgroup에서는 100ms 주기마다 10ms만 쓰고 90ms 스로틀되는 식으로 실행돼서
# 체감 수 초가 된다(로그인 1회당 1번, 회원가입은 2번). "로그인이 가끔 느리다"의
# 주된 원인이다.
#
# 이 값을 낮추는 것은 기존 사용자와 호환된다 — 해시 문자열이 자기 반복 횟수를
# 안에 담고 있고(hash_secret 참고) verify_secret이 그 값을 읽어서 검증한다.
# 다만 낮추기만 하면 **기존 사용자는 전혀 빨라지지 않는다**(저장된 해시가 여전히
# 310000이라고 적혀 있으므로). 그래서 로그인 성공 시 현재 설정값으로 다시
# 해시해 저장하는 password_hash_needs_upgrade() 경로를 함께 넣었다.
#
# ⚠️ 낮추면 오프라인 대입 공격 비용도 그만큼 싸진다(310k→29k는 약 10.7배).
# 이건 의식적인 트레이드오프이고, 보완책으로 /login에 실패 횟수 기반 rate
# limit을 함께 넣었다(rate_limit.py) — 이전에는 rate limit이 전혀 없었다.
# 온라인 대입은 rate limit이 막고, 오프라인 대입은 DB가 유출된 경우에만
# 성립하는 위협이다.
PBKDF2_ITERATIONS = int(os.getenv("PBKDF2_ITERATIONS", "29000"))

# ---------------------------------------------------------
# 세션 조회 캐시 (jh 추가 - 이슈 #38)
# ---------------------------------------------------------
# get_current_user()는 인증이 필요한 **모든** 요청에서 한 번씩 돌고, 그때마다
# Supabase를 2번 왕복한다(sessions 조회 → users 조회, 두 번째가 첫 번째 결과에
# 의존해서 병렬화도 불가). 실측으로 왕복 1회가 약 0.17초라 요청마다 고정
# 0.34초이고, 대시보드 1회 로드에 인증 요청이 9건이라 여기서만 약 20왕복이 든다.
# 버튼 누를 때도 이 0.34초가 명령이 나가기 전에 먼저 붙는다.
#
# 토큰 만료(30일)에 비하면 몇 초 캐시는 의미 있는 지연이 아니다. 다만 로그아웃은
# "즉시" 무효화돼야 하므로 TTL에만 의존하지 않고, 세션을 삭제하는 모든 경로에서
# 명시적으로 캐시를 비운다(invalidate_session_cache_* 참고).
#
# ⚠️ 이 캐시는 프로세스 메모리라서 **워커 1개** 전제에서만 정확하다. 지금 배포는
# `uvicorn main:app`(워커 1개)이다. 나중에 --workers를 2 이상으로 올리면 한
# 워커에서 로그아웃해도 다른 워커의 캐시가 최대 TTL 동안 토큰을 유효하다고
# 볼 수 있다 — 그때는 이 캐시를 지우거나 외부 저장소로 옮겨야 한다.
# (참고: device_hub/reading_hub도 같은 이유로 이미 워커 1개 전제다.)
SESSION_CACHE_TTL_SECONDS = float(os.getenv("SESSION_CACHE_TTL_SECONDS", "10"))

_session_cache: dict[str, dict] = {}
_session_cache_lock = threading.Lock()


def _cached_session_user(hashed_token: str) -> Optional[dict]:
    """캐시에 살아 있는 세션이면 사용자 정보를 돌려준다.

    만료 시각은 캐시된 값으로 매번 다시 검사한다 — TTL이 만료 판정을 가리지
    않게 하려는 것이라, 만료 처리 동작은 캐시가 없을 때와 완전히 같다.
    """
    with _session_cache_lock:
        entry = _session_cache.get(hashed_token)
        if entry is None:
            return None
        if time.monotonic() - entry["stored_monotonic"] >= SESSION_CACHE_TTL_SECONDS:
            _session_cache.pop(hashed_token, None)
            return None
        if entry["expires_at"] <= utc_now():
            # 만료된 세션은 캐시로 통과시키지 않고, DB 경로가 세션 행 삭제까지
            # 처리하도록 넘긴다.
            _session_cache.pop(hashed_token, None)
            return None
        return dict(entry["user"])


def _store_session_in_cache(
    hashed_token: str,
    expires_at: datetime,
    user: dict,
) -> None:
    with _session_cache_lock:
        _session_cache[hashed_token] = {
            "user": dict(user),
            "expires_at": expires_at,
            "stored_monotonic": time.monotonic(),
        }


def invalidate_session_cache_token(raw_token: str) -> None:
    """로그아웃처럼 특정 토큰 하나만 무효화할 때 쓴다."""
    with _session_cache_lock:
        _session_cache.pop(token_hash(raw_token), None)


def invalidate_session_cache_user(user_id: int) -> None:
    """비밀번호 재설정·회원탈퇴·닉네임 변경처럼 그 사용자의 모든 세션에 영향을 줄 때."""
    with _session_cache_lock:
        for key in [
            key
            for key, entry in _session_cache.items()
            if entry["user"].get("id") == user_id
        ]:
            _session_cache.pop(key, None)


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


def password_hash_needs_upgrade(stored_hash: str) -> bool:
    """저장된 해시가 현재 설정된 반복 횟수와 다르면 True.

    PBKDF2_ITERATIONS를 바꿔도 기존 사용자는 자기 해시에 적힌 옛 횟수로 계속
    검증되기 때문에(=옛 비용을 계속 지불), 로그인에 성공한 시점에 새 설정값으로
    다시 해시해 저장해야 실제로 빨라진다. 이 함수는 그 판정만 한다.
    """
    try:
        algorithm, iterations, _salt_text, _digest_text = stored_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    try:
        return int(iterations) != PBKDF2_ITERATIONS
    except ValueError:
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

    cached_user = _cached_session_user(hashed_token)
    if cached_user is not None:
        return cached_user

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

    user = user_result.data[0]
    _store_session_in_cache(
        hashed_token,
        parse_supabase_datetime(session["expires_at"]),
        user,
    )
    return user


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
