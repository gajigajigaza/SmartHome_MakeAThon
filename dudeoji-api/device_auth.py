"""게이트웨이(라즈베리파이) 전용 인증 토큰.

담당: 공용

## 왜 있는가

게이트웨이는 지금까지 사람이 웹에서 로그인해 만든 **세션 토큰**을
localStorage에서 꺼내 `.env`의 `DUDEOJI_AUTH_TOKEN`에 넣어 쓰고 있었다.
그런데 `/api/auth/logout`은 그 `token_hash` 행을 `sessions`에서 지운다 —
즉 **브라우저에서 로그아웃하면 게이트웨이가 같이 죽는다.** 2026-07-30에 이
증상이 하루에도 여러 번 났고(401 → WS 재연결 무한 반복 → 센서값 저장 중단),
그때마다 다시 로그인해 토큰을 손으로 옮겨 심어야 했다.

사람 세션과 기기 자격증명은 수명이 애초에 다르다. 사람 세션은 로그아웃으로
즉시 끊을 수 있어야 하고, 기기 자격증명은 사람이 뭘 하든 계속 붙어 있어야
한다. 같은 표를 공유한 게 원인이라 표를 분리했다(`supabase/017_device_tokens.sql`).

## 권한 범위 (least privilege)

이 토큰으로는 게이트웨이가 실제로 쓰는 **두 경로만** 통한다.

- `WS /ws/sensors` (센서값 송신 + 제어 명령 수신)
- `POST /api/occupancy/logs` (재실 감지 결과 전송)

비밀번호 변경·회원탈퇴 같은 계정 조작은 할 수 없다. 벽에 붙어 있는 기기의
`.env` 파일에 평문으로 들어가는 값이므로 사람 세션과 같은 권한을 주면 안 된다.
그래서 `get_current_user`를 고치는 대신 별도 의존성(`get_device_or_user`)을
만들어 그 두 곳에만 붙였다.

## 하위호환

토큰이 `dudeoji_dev_` 접두사로 시작할 때만 이 경로를 탄다. 접두사가 없으면
기존과 똑같이 사람 세션으로 검증하므로, 아직 기기 토큰을 안 만든 게이트웨이도
그대로 동작한다. 마이그레이션 017을 적용하기 전에도 서버는 정상 동작한다
(그 경우 기기 토큰 발급만 실패한다).
"""
import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import Header, HTTPException, status

from auth_utils import get_bearer_token, get_current_user, token_hash
from db import DEVICE_TOKENS_TABLE, supabase

# 이 접두사로 사람 세션 토큰과 구분한다. 접두사가 있으면 sessions는 조회조차
# 하지 않으므로, 일반 사용자 요청에 부담이 전혀 늘지 않는다.
DEVICE_TOKEN_PREFIX = "dudeoji_dev_"

# last_used_at을 매 요청마다 쓰면 5초 주기 스트리밍에서 DB 쓰기가 그만큼 늘어난다.
# "이 기기가 아직 살아 있나"를 보려는 용도라 5분 해상도면 충분하다.
LAST_USED_UPDATE_INTERVAL_SECONDS = 300

_last_used_marks: dict[str, float] = {}
_last_used_lock = threading.Lock()


def generate_device_token() -> str:
    return DEVICE_TOKEN_PREFIX + secrets.token_urlsafe(32)


def looks_like_device_token(raw_token: str) -> bool:
    return raw_token.startswith(DEVICE_TOKEN_PREFIX)


def _should_touch_last_used(hashed_token: str) -> bool:
    now = time.monotonic()
    with _last_used_lock:
        previous = _last_used_marks.get(hashed_token)
        if previous is not None and now - previous < LAST_USED_UPDATE_INTERVAL_SECONDS:
            return False
        _last_used_marks[hashed_token] = now
        return True


def _touch_last_used(hashed_token: str) -> None:
    """부가 기능이라 실패해도 인증 자체를 막지 않는다."""
    if not _should_touch_last_used(hashed_token):
        return
    try:
        (
            supabase.table(DEVICE_TOKENS_TABLE)
            .update({"last_used_at": datetime.now(timezone.utc).isoformat()})
            .eq("token_hash", hashed_token)
            .execute()
        )
    except Exception as error:
        print(f"[device_auth] last_used_at 갱신 실패(인증은 정상): {error}")


def resolve_device_token(raw_token: str) -> Optional[dict]:
    """기기 토큰이면 소유자 정보를 돌려주고, 아니면 None.

    반환 형태는 get_current_user()와 같은 모양({"id": ...})으로 맞춘다 —
    호출부가 사람인지 기기인지 신경 쓰지 않고 그대로 쓸 수 있게 하려는 것이다.
    구분이 필요하면 "is_device" 키를 보면 된다.
    """
    if not looks_like_device_token(raw_token):
        return None

    hashed_token = token_hash(raw_token)
    result = (
        supabase.table(DEVICE_TOKENS_TABLE)
        .select("id,user_id,place_id,label,revoked_at")
        .eq("token_hash", hashed_token)
        .limit(1)
        .execute()
    )

    if not result.data:
        return None

    row = result.data[0]
    if row.get("revoked_at"):
        return None

    _touch_last_used(hashed_token)
    return {
        "id": row["user_id"],
        "is_device": True,
        "device_token_id": row["id"],
        "device_place_id": row.get("place_id"),
        "device_label": row.get("label") or "",
    }


def authenticate_device_or_user(raw_token: str) -> dict:
    """기기 토큰이면 기기로, 아니면 기존 사람 세션으로 인증한다.

    WebSocket 경로처럼 Authorization 헤더가 아니라 첫 메시지로 토큰을 받는
    곳에서도 쓸 수 있게, 헤더가 아닌 raw token을 받는다.
    """
    if looks_like_device_token(raw_token):
        device = resolve_device_token(raw_token)
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="기기 토큰이 유효하지 않거나 폐기되었습니다.",
            )
        return device

    return get_current_user(f"Bearer {raw_token}")


def get_device_or_user(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """FastAPI 의존성. 게이트웨이가 호출하는 엔드포인트에만 붙인다."""
    return authenticate_device_or_user(get_bearer_token(authorization))


# ---------------------------------------------------------
# 발급 / 조회 / 폐기 (사람 세션으로만 호출 가능)
# ---------------------------------------------------------
def create_device_token(
    user_id: int,
    place_id: Optional[int],
    label: str,
) -> str:
    """새 기기 토큰을 만들고 **원문을 한 번만** 돌려준다.

    DB에는 해시만 저장하므로 이 반환값을 놓치면 다시 볼 수 없다 — 새로
    발급받아야 한다(sessions와 같은 방식).
    """
    raw_token = generate_device_token()
    (
        supabase.table(DEVICE_TOKENS_TABLE)
        .insert(
            {
                "user_id": user_id,
                "place_id": place_id,
                "token_hash": token_hash(raw_token),
                "label": label,
            }
        )
        .execute()
    )
    return raw_token


def list_device_tokens(user_id: int) -> list[dict]:
    """원문 토큰은 절대 포함하지 않는다(해시조차 내보내지 않는다)."""
    result = (
        supabase.table(DEVICE_TOKENS_TABLE)
        .select("id,place_id,label,created_at,last_used_at,revoked_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def revoke_device_token(user_id: int, token_id: int) -> bool:
    """폐기. 다른 사용자의 토큰은 건드릴 수 없도록 user_id도 함께 건다."""
    result = (
        supabase.table(DEVICE_TOKENS_TABLE)
        .update({"revoked_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", token_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(result.data)
