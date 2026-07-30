"""회원가입 · 로그인 · 마이페이지(별명/비번/복구정보/탈퇴) API.

담당: 류은
"""
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from pydantic import BaseModel, Field

from auth_utils import (
    RESET_TOKEN_MINUTES,
    create_session,
    get_bearer_token,
    get_current_user,
    hash_secret,
    invalidate_session_cache_token,
    invalidate_session_cache_user,
    parse_supabase_datetime,
    password_hash_needs_upgrade,
    token_hash,
    utc_now,
    verify_current_password,
    verify_secret,
)
from db import PLACES_TABLE, RESET_TOKENS_TABLE, SESSIONS_TABLE, USERS_TABLE, supabase
from device_auth import (
    create_device_token,
    list_device_tokens,
    revoke_device_token,
)
from rate_limit import (
    check_login_allowed,
    client_ip_from_request,
    record_login_failure,
    record_login_success,
)
from routers.places_router import PlaceCreate, UserAirconCreate, create_place_with_aircons_for_user
from routers.readings_router import get_place_for_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=12)
    username: str = Field(min_length=4, max_length=20, pattern=r"^[A-Za-z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)
    recovery_item: str = Field(min_length=1, max_length=30)
    recovery_pin: str = Field(pattern=r"^\d{4}$")


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=128)


class AuthUser(BaseModel):
    id: int
    username: str
    nickname: str


class AuthResponse(BaseModel):
    token: str
    user: AuthUser


class NicknameUpdateRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=12)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class RecoveryUpdateRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    recovery_item: str = Field(min_length=1, max_length=30)
    recovery_pin: str = Field(pattern=r"^\d{4}$")


class AccountDeleteRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class UsernameCheckResponse(BaseModel):
    username: str
    available: bool
    message: str


class RecoveryVerifyRequest(BaseModel):
    username: str = Field(min_length=1, max_length=20)
    recovery_item: str = Field(min_length=1, max_length=30)
    recovery_pin: str = Field(pattern=r"^\d{4}$")


class RecoveryVerifyResponse(BaseModel):
    recovery_token: str
    expires_in_minutes: int


class PasswordResetRequest(BaseModel):
    recovery_token: str = Field(min_length=20)
    new_password: str = Field(min_length=8, max_length=128)


class CompleteSignupRequest(SignupRequest):
    place_name: str = Field(min_length=1, max_length=50)
    aircons: list[UserAirconCreate] = Field(min_length=1, max_length=20)


@router.get("/check-username", response_model=UsernameCheckResponse)
def check_username(
    username: str = Query(
        min_length=4,
        max_length=20,
        pattern=r"^[A-Za-z0-9_-]+$",
    ),
):
    normalized_username = username.strip().lower()

    result = (
        supabase.table(USERS_TABLE)
        .select("id")
        .eq("username", normalized_username)
        .limit(1)
        .execute()
    )

    is_available = not bool(result.data)

    return UsernameCheckResponse(
        username=normalized_username,
        available=is_available,
        message=(
            "사용 가능한 아이디입니다."
            if is_available
            else "이미 사용 중인 아이디입니다."
        ),
    )


@router.post(
    "/signup",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
def signup(payload: SignupRequest):
    username = payload.username.strip().lower()

    existing = (
        supabase.table(USERS_TABLE)
        .select("id")
        .eq("username", username)
        .limit(1)
        .execute()
    )

    if existing.data:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 아이디입니다.",
        )

    try:
        result = (
            supabase.table(USERS_TABLE)
            .insert(
                {
                    "username": username,
                    "nickname": payload.nickname.strip(),
                    "password_hash": hash_secret(payload.password),
                    "recovery_item": payload.recovery_item,
                    "recovery_pin_hash": hash_secret(payload.recovery_pin),
                }
            )
            .execute()
        )
    except Exception as error:
        print(f"회원가입 저장 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="계정을 만들지 못했습니다.",
        ) from error

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="계정 저장 결과를 확인하지 못했습니다.",
        )

    user = result.data[0]
    session_token = create_session(user["id"])

    return AuthResponse(
        token=session_token,
        user=AuthUser(
            id=user["id"],
            username=user["username"],
            nickname=user["nickname"],
        ),
    )


@router.post(
    "/signup-complete",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
def signup_complete(payload: CompleteSignupRequest):
    """계정, 장소, 에어컨을 모두 저장한 뒤에만 회원가입을 확정한다."""
    username = payload.username.strip().lower()
    existing_result = (
        supabase.table(USERS_TABLE)
        .select(
            "id,username,nickname,password_hash,recovery_item,recovery_pin_hash"
        )
        .eq("username", username)
        .limit(1)
        .execute()
    )

    created_new_user = False
    registration = None

    if existing_result.data:
        user = existing_result.data[0]
        place_result = (
            supabase.table(PLACES_TABLE)
            .select("id")
            .eq("user_id", user["id"])
            .limit(1)
            .execute()
        )

        if place_result.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="이미 사용 중인 아이디입니다.",
            )

        credentials_match = (
            verify_secret(payload.password, user["password_hash"])
            and user["recovery_item"] == payload.recovery_item
            and verify_secret(
                payload.recovery_pin,
                user["recovery_pin_hash"],
            )
        )

        if not credentials_match:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "이 아이디로 시작된 미완료 가입이 있습니다. "
                    "기존 비밀번호로 로그인해 에어컨 등록을 이어서 완료해 주세요."
                ),
            )
    else:
        try:
            user_result = (
                supabase.table(USERS_TABLE)
                .insert(
                    {
                        "username": username,
                        "nickname": payload.nickname.strip(),
                        "password_hash": hash_secret(payload.password),
                        "recovery_item": payload.recovery_item,
                        "recovery_pin_hash": hash_secret(
                            payload.recovery_pin
                        ),
                    }
                )
                .execute()
            )
        except Exception as error:
            print(f"회원가입 저장 오류: {error}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="계정을 만들지 못했습니다.",
            ) from error

        if not user_result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="계정 저장 결과를 확인하지 못했습니다.",
            )

        user = user_result.data[0]
        created_new_user = True

    try:
        registration = create_place_with_aircons_for_user(
            user["id"],
            PlaceCreate(
                place_name=payload.place_name,
                aircons=payload.aircons,
            ),
        )
        session_token = create_session(user["id"])
    except HTTPException:
        if created_new_user:
            supabase.table(USERS_TABLE).delete().eq(
                "id", user["id"]
            ).execute()
        raise
    except Exception as error:
        print(f"회원가입 완료 처리 오류: {error}")

        if registration:
            supabase.table(PLACES_TABLE).delete().eq(
                "id", registration["place"]["id"]
            ).execute()

        if created_new_user:
            supabase.table(USERS_TABLE).delete().eq(
                "id", user["id"]
            ).execute()

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="회원가입을 완료하지 못했습니다.",
        ) from error

    return AuthResponse(
        token=session_token,
        user=AuthUser(
            id=user["id"],
            username=user["username"],
            nickname=user["nickname"],
        ),
    )


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, request: Request):
    username = payload.username.strip().lower()

    # jh 추가 - PBKDF2 반복 횟수를 낮춘 것에 대한 보완책(rate_limit.py 참고).
    # 실패 횟수만 세므로 정상 사용자는 걸리지 않는다.
    client_ip = client_ip_from_request(request)
    retry_after = check_login_allowed(username, client_ip)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "로그인 시도가 너무 많습니다. "
                f"{retry_after}초 후에 다시 시도해 주세요."
            ),
            headers={"Retry-After": str(retry_after)},
        )

    result = (
        supabase.table(USERS_TABLE)
        .select("id,username,nickname,password_hash")
        .eq("username", username)
        .limit(1)
        .execute()
    )

    if not result.data:
        record_login_failure(username, client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="없는 아이디입니다.",
        )

    if not verify_secret(
        payload.password,
        result.data[0]["password_hash"],
    ):
        record_login_failure(username, client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="비밀번호가 일치하지 않습니다.",
        )

    record_login_success(username, client_ip)
    user = result.data[0]

    # jh 추가 - PBKDF2_ITERATIONS를 낮춰도 기존 사용자는 자기 해시에 적힌 옛
    # 횟수로 계속 검증되므로 전혀 빨라지지 않는다. 로그인이 성공한 지금
    # (평문 비밀번호를 가진 유일한 시점) 현재 설정값으로 다시 해시해 저장한다.
    # 실패해도 로그인 자체를 막지 않는다 — 다음 로그인에서 또 시도된다.
    if password_hash_needs_upgrade(user["password_hash"]):
        try:
            supabase.table(USERS_TABLE).update(
                {"password_hash": hash_secret(payload.password)}
            ).eq("id", user["id"]).execute()
        except Exception as error:
            print(f"[auth] 비밀번호 해시 재계산 실패(로그인은 정상 처리): {error}")

    session_token = create_session(user["id"])

    return AuthResponse(
        token=session_token,
        user=AuthUser(
            id=user["id"],
            username=user["username"],
            nickname=user["nickname"],
        ),
    )


@router.get("/me", response_model=AuthUser)
def read_me(current_user: dict = Depends(get_current_user)):
    return AuthUser.model_validate(current_user)


@router.patch("/me/nickname", response_model=AuthUser)
def update_my_nickname(
    payload: NicknameUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    nickname = payload.nickname.strip()

    result = (
        supabase.table(USERS_TABLE)
        .update(
            {
                "nickname": nickname,
                "updated_at": utc_now().isoformat(),
            }
        )
        .eq("id", current_user["id"])
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="별명을 변경하지 못했습니다.",
        )

    # jh 추가 - 세션 캐시에 별명이 함께 들어 있어서(get_current_user가 nickname을
    # 같이 조회함) 비워주지 않으면 /api/auth/me가 최대 TTL 동안 옛 별명을 준다.
    invalidate_session_cache_user(current_user["id"])

    return AuthUser.model_validate(result.data[0])


@router.patch("/me/password")
def update_my_password(
    payload: PasswordChangeRequest,
    current_user: dict = Depends(get_current_user),
):
    verify_current_password(current_user["id"], payload.current_password)

    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="새 비밀번호는 현재 비밀번호와 다르게 설정해 주세요.",
        )

    supabase.table(USERS_TABLE).update(
        {
            "password_hash": hash_secret(payload.new_password),
            "updated_at": utc_now().isoformat(),
        }
    ).eq("id", current_user["id"]).execute()

    return {"message": "비밀번호가 변경되었습니다."}


@router.patch("/me/recovery")
def update_my_recovery(
    payload: RecoveryUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    verify_current_password(current_user["id"], payload.current_password)

    supabase.table(USERS_TABLE).update(
        {
            "recovery_item": payload.recovery_item,
            "recovery_pin_hash": hash_secret(payload.recovery_pin),
            "updated_at": utc_now().isoformat(),
        }
    ).eq("id", current_user["id"]).execute()

    return {"message": "복구 정보가 변경되었습니다."}


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_account(
    payload: AccountDeleteRequest,
    current_user: dict = Depends(get_current_user),
):
    verify_current_password(current_user["id"], payload.password)

    supabase.table(USERS_TABLE).delete().eq(
        "id", current_user["id"]
    ).execute()

    # jh 추가 - 탈퇴한 사용자의 토큰이 세션 캐시 때문에 최대 TTL 동안 계속
    # 통하면 안 된다. 여기서만은 캐시 무효화가 보안 요구사항이다.
    invalidate_session_cache_user(current_user["id"])

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------
# 게이트웨이 전용 기기 토큰 (jh 추가)
# ---------------------------------------------------------
# 왜 필요한지는 device_auth.py 모듈 docstring 참고. 요약하면, 게이트웨이가
# 사람의 세션 토큰을 빌려 쓰고 있어서 브라우저에서 로그아웃할 때마다 같이
# 죽었다. 이 엔드포인트들로 기기 전용 토큰을 따로 발급/폐기한다.
#
# 발급/조회/폐기는 반드시 **사람 세션**으로만 할 수 있다(Depends(get_current_user)).
# 기기 토큰으로 또 기기 토큰을 만들 수 있으면 권한 분리가 무의미해진다.
class DeviceTokenCreateRequest(BaseModel):
    place_id: Optional[int] = Field(default=None, ge=1)
    label: str = Field(default="", max_length=100)


class DeviceTokenCreateResponse(BaseModel):
    id: int
    token: str
    label: str
    place_id: Optional[int] = None
    # 원문은 이 응답에서 딱 한 번만 볼 수 있다(DB엔 해시만 저장).
    notice: str = (
        "이 토큰은 지금 한 번만 표시됩니다. 게이트웨이의 .env에 "
        "DUDEOJI_AUTH_TOKEN 값으로 넣어 주세요."
    )


class DeviceTokenSummary(BaseModel):
    id: int
    label: str = ""
    place_id: Optional[int] = None
    created_at: Optional[str] = None
    last_used_at: Optional[str] = None
    revoked_at: Optional[str] = None


@router.post("/device-tokens", response_model=DeviceTokenCreateResponse)
def issue_device_token(
    payload: DeviceTokenCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    if payload.place_id is not None:
        # 남의 장소에 묶인 토큰을 만들 수 없도록 소유권을 먼저 확인한다.
        get_place_for_user(current_user["id"], payload.place_id)

    raw_token = create_device_token(
        current_user["id"], payload.place_id, payload.label.strip()
    )
    issued = [
        row
        for row in list_device_tokens(current_user["id"])
        if not row.get("revoked_at")
    ]
    return DeviceTokenCreateResponse(
        id=issued[0]["id"] if issued else 0,
        token=raw_token,
        label=payload.label.strip(),
        place_id=payload.place_id,
    )


@router.get("/device-tokens", response_model=list[DeviceTokenSummary])
def read_device_tokens(current_user: dict = Depends(get_current_user)):
    return [
        DeviceTokenSummary.model_validate(row)
        for row in list_device_tokens(current_user["id"])
    ]


@router.delete("/device-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device_token(
    token_id: int,
    current_user: dict = Depends(get_current_user),
):
    if not revoke_device_token(current_user["id"], token_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="해당 기기 토큰을 찾을 수 없습니다.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(authorization: Optional[str] = Header(default=None)):
    raw_token = get_bearer_token(authorization)

    supabase.table(SESSIONS_TABLE).delete().eq(
        "token_hash", token_hash(raw_token)
    ).execute()

    # jh 추가 - get_current_user()의 세션 캐시(TTL 10초)를 즉시 비운다.
    # 이게 없으면 로그아웃 후에도 최대 TTL 동안 토큰이 통한다.
    invalidate_session_cache_token(raw_token)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/recovery/verify",
    response_model=RecoveryVerifyResponse,
)
def verify_recovery(payload: RecoveryVerifyRequest):
    username = payload.username.strip().lower()
    result = (
        supabase.table(USERS_TABLE)
        .select("id,recovery_item,recovery_pin_hash")
        .eq("username", username)
        .limit(1)
        .execute()
    )

    if (
        not result.data
        or result.data[0]["recovery_item"] != payload.recovery_item
        or not verify_secret(
            payload.recovery_pin,
            result.data[0]["recovery_pin_hash"],
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 복구 정보가 일치하지 않습니다.",
        )

    raw_token = secrets.token_urlsafe(32)
    expires_at = utc_now() + timedelta(minutes=RESET_TOKEN_MINUTES)

    supabase.table(RESET_TOKENS_TABLE).insert(
        {
            "user_id": result.data[0]["id"],
            "token_hash": token_hash(raw_token),
            "expires_at": expires_at.isoformat(),
        }
    ).execute()

    return RecoveryVerifyResponse(
        recovery_token=raw_token,
        expires_in_minutes=RESET_TOKEN_MINUTES,
    )


@router.post("/recovery/reset")
def reset_password(payload: PasswordResetRequest):
    result = (
        supabase.table(RESET_TOKENS_TABLE)
        .select("id,user_id,expires_at,used_at")
        .eq("token_hash", token_hash(payload.recovery_token))
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="비밀번호 재설정 정보가 유효하지 않습니다.",
        )

    reset_row = result.data[0]
    if reset_row.get("used_at") or parse_supabase_datetime(reset_row["expires_at"]) <= utc_now():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="비밀번호 재설정 시간이 만료되었습니다.",
        )

    supabase.table(USERS_TABLE).update(
        {
            "password_hash": hash_secret(payload.new_password),
            "updated_at": utc_now().isoformat(),
        }
    ).eq("id", reset_row["user_id"]).execute()

    supabase.table(RESET_TOKENS_TABLE).update(
        {"used_at": utc_now().isoformat()}
    ).eq("id", reset_row["id"]).execute()

    supabase.table(SESSIONS_TABLE).delete().eq(
        "user_id", reset_row["user_id"]
    ).execute()

    # jh 추가 - 비밀번호를 재설정하면 그 사용자의 모든 세션을 끊는 것이 의도이므로
    # 세션 캐시도 사용자 단위로 비운다.
    invalidate_session_cache_user(reset_row["user_id"])

    return {"message": "비밀번호가 변경되었습니다."}
