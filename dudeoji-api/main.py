import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import Client, create_client

# minzoo 브랜치에서 이식한 통합 판단 규칙 엔진(THI, 미세먼지, 강풍 등 고려)
from processor import determine_action

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

SESSION_DAYS = 30
RESET_TOKEN_MINUTES = 15
PBKDF2_ITERATIONS = 310_000

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

RecommendationAction = Literal[
    "OPEN_WINDOW",
    "USE_AIRCON",
    "MAINTAIN",
]
PowerSource = Literal["database", "user_input", "estimated"]


class SensorReadingCreate(BaseModel):
    indoor_temperature: float = Field(ge=-50, le=80)
    indoor_humidity: float = Field(ge=0, le=100)
    outdoor_temperature: float = Field(ge=-50, le=80)
    outdoor_humidity: float = Field(ge=0, le=100)

    # 아래 3개는 선택 항목입니다. '위치/실외 날씨' 기능(담당: 나)에서
    # 값을 채워 보내면 추천 정확도가 올라가고, 안 보내면 기본값으로 동작합니다.
    weather_condition: Optional[str] = Field(default="맑음", max_length=10)
    pm25: Optional[float] = Field(default=None, ge=0, le=1000)
    wind_speed: Optional[float] = Field(default=None, ge=0, le=100)


class SavingsEstimate(BaseModel):
    power_saved_kwh: float
    time_applied_hours: float
    cost_won: int
    message: str


class Recommendation(BaseModel):
    action: RecommendationAction
    title: str
    summary: str
    reason: str
    # 아래 2개는 선택 항목입니다. 기존 프론트는 무시해도 되고,
    # '예상 절감(1일/1주/1달)' 기능(담당: 나)에서 사용할 예정입니다.
    warning: Optional[str] = None
    savings: Optional[SavingsEstimate] = None


class SensorReadingResponse(SensorReadingCreate):
    id: int
    measured_at: datetime
    recommendation: Recommendation


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


class UserAirconCreate(BaseModel):
    nickname: str = Field(min_length=1, max_length=30)
    aircon_model_id: Optional[int] = None
    manufacturer: str = Field(min_length=1, max_length=100)
    product_name: Optional[str] = Field(default=None, max_length=150)
    model_number: Optional[str] = Field(default=None, max_length=100)
    aircon_type: Optional[str] = Field(default=None, max_length=50)
    rated_cooling_power_w: int = Field(ge=1, le=20_000)
    power_source: PowerSource
    verification_status: Optional[str] = Field(default=None, max_length=50)
    estimated_min_power_w: Optional[int] = Field(default=None, ge=1, le=20_000)
    estimated_max_power_w: Optional[int] = Field(default=None, ge=1, le=20_000)


class PlaceCreate(BaseModel):
    place_name: str = Field(min_length=1, max_length=50)
    aircons: list[UserAirconCreate] = Field(min_length=1, max_length=20)


class CompleteSignupRequest(SignupRequest):
    place_name: str = Field(min_length=1, max_length=50)
    aircons: list[UserAirconCreate] = Field(min_length=1, max_length=20)


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


def get_current_user(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    raw_token = get_bearer_token(authorization)

    session_result = (
        supabase.table(SESSIONS_TABLE)
        .select("id,user_id,expires_at")
        .eq("token_hash", token_hash(raw_token))
        .limit(1)
        .execute()
    )

    if not session_result.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인 정보가 유효하지 않습니다.",
        )

    session = session_result.data[0]
    if parse_supabase_datetime(session["expires_at"]) <= utc_now():
        supabase.table(SESSIONS_TABLE).delete().eq("id", session["id"]).execute()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 만료되었습니다. 다시 로그인해 주세요.",
        )

    user_result = (
        supabase.table(USERS_TABLE)
        .select("id,username,nickname")
        .eq("id", session["user_id"])
        .limit(1)
        .execute()
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


def calculate_recommendation(sensor_data: SensorReadingCreate) -> Recommendation:
    """실내외 온습도 + (있다면) 날씨/미세먼지/바람 데이터를 종합해 추천을 만든다.

    핵심 판단 로직은 processor.determine_action()에 있다. 이 함수는
    ryeun의 Recommendation 스키마(및 하위 호환)에 맞게 결과를 감싸는 역할만 한다.
    """
    result = determine_action(
        indoor_temperature=sensor_data.indoor_temperature,
        indoor_humidity=sensor_data.indoor_humidity,
        outdoor_temperature=sensor_data.outdoor_temperature,
        outdoor_humidity=sensor_data.outdoor_humidity,
        weather_condition=sensor_data.weather_condition or "맑음",
        pm25=sensor_data.pm25,
        wind_speed=sensor_data.wind_speed,
    )

    return Recommendation(
        action=result["action"],
        title=result["title"],
        summary=result["summary"],
        reason=result["reason"],
        warning=result["warning"],
        savings=SavingsEstimate(**result["savings"]),
    )


def get_latest_reading(user_id: int) -> SensorReadingResponse:
    try:
        result = (
            supabase.table(READINGS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("measured_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as error:
        print(f"Supabase 최신 기록 조회 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase에서 최신 기록을 조회하지 못했습니다.",
        ) from error

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="저장된 센서 기록이 없습니다.",
        )

    return SensorReadingResponse.model_validate(result.data[0])


def create_place_with_aircons_for_user(
    user_id: int,
    payload: PlaceCreate,
) -> dict:
    """장소와 에어컨을 함께 저장하고 실패하면 생성한 장소를 되돌린다."""
    place = None

    try:
        place_result = (
            supabase.table(PLACES_TABLE)
            .insert(
                {
                    "user_id": user_id,
                    "name": payload.place_name.strip(),
                }
            )
            .execute()
        )

        if not place_result.data:
            raise RuntimeError("장소 저장 결과가 없습니다.")

        place = place_result.data[0]
        rows_to_insert = []

        for aircon in payload.aircons:
            row = aircon.model_dump()

            if aircon.power_source == "database":
                if not aircon.aircon_model_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="제품 DB에서 선택한 에어컨 정보가 올바르지 않습니다.",
                    )

                model_result = (
                    supabase.table(AIRCON_MODELS_TABLE)
                    .select(
                        "id,manufacturer,product_name,model_number,"
                        "aircon_type,rated_cooling_power_w,verification_status"
                    )
                    .eq("id", aircon.aircon_model_id)
                    .limit(1)
                    .execute()
                )

                if not model_result.data:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="선택한 에어컨 제품을 찾을 수 없습니다.",
                    )

                model = model_result.data[0]
                row.update(
                    {
                        "manufacturer": model["manufacturer"],
                        "product_name": model.get("product_name"),
                        "model_number": model["model_number"],
                        "aircon_type": model.get("aircon_type"),
                        "rated_cooling_power_w": model[
                            "rated_cooling_power_w"
                        ],
                        "verification_status": model.get(
                            "verification_status"
                        ),
                        "estimated_min_power_w": None,
                        "estimated_max_power_w": None,
                    }
                )

            row.update(
                {
                    "user_id": user_id,
                    "place_id": place["id"],
                }
            )
            rows_to_insert.append(row)

        aircon_result = (
            supabase.table(USER_AIRCONS_TABLE)
            .insert(rows_to_insert)
            .execute()
        )

        return {
            "place": place,
            "aircons": aircon_result.data or [],
        }
    except HTTPException:
        if place:
            supabase.table(PLACES_TABLE).delete().eq(
                "id", place["id"]
            ).execute()
        raise
    except Exception as error:
        print(f"장소/에어컨 저장 오류: {error}")
        if place:
            supabase.table(PLACES_TABLE).delete().eq(
                "id", place["id"]
            ).execute()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="장소와 에어컨을 저장하지 못했습니다.",
        ) from error


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


@app.get(
    "/api/auth/check-username",
    response_model=UsernameCheckResponse,
)
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


@app.post(
    "/api/auth/signup",
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


@app.post(
    "/api/auth/signup-complete",
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


@app.post("/api/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest):
    username = payload.username.strip().lower()
    result = (
        supabase.table(USERS_TABLE)
        .select("id,username,nickname,password_hash")
        .eq("username", username)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="없는 아이디입니다.",
        )

    if not verify_secret(
        payload.password,
        result.data[0]["password_hash"],
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="비밀번호가 일치하지 않습니다.",
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


@app.get("/api/auth/me", response_model=AuthUser)
def read_me(current_user: dict = Depends(get_current_user)):
    return AuthUser.model_validate(current_user)


@app.patch("/api/auth/me/nickname", response_model=AuthUser)
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

    return AuthUser.model_validate(result.data[0])


@app.patch("/api/auth/me/password")
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


@app.patch("/api/auth/me/recovery")
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


@app.delete("/api/auth/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_account(
    payload: AccountDeleteRequest,
    current_user: dict = Depends(get_current_user),
):
    verify_current_password(current_user["id"], payload.password)

    supabase.table(USERS_TABLE).delete().eq(
        "id", current_user["id"]
    ).execute()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(authorization: Optional[str] = Header(default=None)):
    raw_token = get_bearer_token(authorization)

    supabase.table(SESSIONS_TABLE).delete().eq(
        "token_hash", token_hash(raw_token)
    ).execute()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post(
    "/api/auth/recovery/verify",
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


@app.post("/api/auth/recovery/reset")
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

    return {"message": "비밀번호가 변경되었습니다."}


@app.get("/api/aircon-models")
def read_aircon_models(
    search: str = Query(default="", max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
):
    try:
        result = (
            supabase.table(AIRCON_MODELS_TABLE)
            .select(
                "id,manufacturer,product_name,model_number,"
                "aircon_type,rated_cooling_power_w,verification_status"
            )
            .limit(500)
            .execute()
        )
    except Exception as error:
        print(f"에어컨 제품 조회 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="에어컨 제품 목록을 불러오지 못했습니다.",
        ) from error

    rows = result.data or []
    keyword = search.strip().lower()

    if keyword:
        rows = [
            row
            for row in rows
            if keyword
            in " ".join(
                [
                    str(row.get("manufacturer") or ""),
                    str(row.get("product_name") or ""),
                    str(row.get("model_number") or ""),
                    str(row.get("aircon_type") or ""),
                ]
            ).lower()
        ]

    rows.sort(
        key=lambda row: (
            str(row.get("manufacturer") or ""),
            str(row.get("model_number") or ""),
        )
    )
    return rows[:limit]


@app.post("/api/places", status_code=status.HTTP_201_CREATED)
def create_place(
    payload: PlaceCreate,
    current_user: dict = Depends(get_current_user),
):
    return create_place_with_aircons_for_user(
        current_user["id"],
        payload,
    )


@app.get("/api/places")
def read_my_places(current_user: dict = Depends(get_current_user)):
    place_result = (
        supabase.table(PLACES_TABLE)
        .select("id,name,created_at")
        .eq("user_id", current_user["id"])
        .order("created_at")
        .execute()
    )

    places = []
    for place in place_result.data or []:
        aircon_result = (
            supabase.table(USER_AIRCONS_TABLE)
            .select("*")
            .eq("place_id", place["id"])
            .order("created_at")
            .execute()
        )
        places.append({**place, "aircons": aircon_result.data or []})

    return places


def save_reading_for_user(user_id: int, sensor_data_dict: dict) -> SensorReadingResponse:
    """센서 값 dict를 받아 추천을 계산하고 Supabase에 저장한다.

    REST API(/api/readings)와 MQTT 수신 핸들러가 이 함수를 공유한다.
    """
    sensor_data = SensorReadingCreate.model_validate(sensor_data_dict)
    recommendation = calculate_recommendation(sensor_data)
    reading_data = {
        **sensor_data.model_dump(),
        "user_id": user_id,
        "recommendation": recommendation.model_dump(),
    }

    try:
        result = supabase.table(READINGS_TABLE).insert(reading_data).execute()
    except Exception as error:
        print(f"Supabase 센서 기록 저장 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="센서 기록을 Supabase에 저장하지 못했습니다.",
        ) from error

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="저장 결과를 확인하지 못했습니다.",
        )

    return SensorReadingResponse.model_validate(result.data[0])


@app.post(
    "/api/readings",
    response_model=SensorReadingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_reading(
    sensor_data: SensorReadingCreate,
    current_user: dict = Depends(get_current_user),
):
    return save_reading_for_user(current_user["id"], sensor_data.model_dump())


@app.get(
    "/api/readings/latest",
    response_model=SensorReadingResponse,
)
def read_latest(current_user: dict = Depends(get_current_user)):
    return get_latest_reading(current_user["id"])


@app.get(
    "/api/readings/history",
    response_model=list[SensorReadingResponse],
)
def read_history(
    limit: int = Query(default=8, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    try:
        result = (
            supabase.table(READINGS_TABLE)
            .select("*")
            .eq("user_id", current_user["id"])
            .order("measured_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as error:
        print(f"Supabase 기록 목록 조회 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="센서 기록 목록을 조회하지 못했습니다.",
        ) from error

    return [
        SensorReadingResponse.model_validate(reading)
        for reading in result.data
    ]


@app.get(
    "/api/recommendation",
    response_model=Recommendation,
)
def read_recommendation(
    current_user: dict = Depends(get_current_user),
):
    latest_reading = get_latest_reading(current_user["id"])
    return latest_reading.recommendation


# ---------------------------------------------------------
# MQTT 게이트웨이 연동 (선택 사항)
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
