"""장소(place) · 에어컨 등록 API.

담당: 류은

'장소/기기 등록' 화면과 연결됩니다. 회원가입 완료(auth_router의
signup_complete)에서도 이 파일의 create_place_with_aircons_for_user를
같이 사용합니다.

참고(정현 - 위치 기능): 여기 있는 "장소(place)"는 원래 에어컨을 등록하는
단위입니다. '위치 추가/실외 날씨/위치 관리'(집, 회사 등 여러 곳을 선택하는 것)를
만들 때 이 places 테이블/엔드포인트를 그대로 재사용할 수도 있으니, 새로
만들기 전에 먼저 상의해 주세요.
"""
import os
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from auth_utils import get_current_user
from db import AIRCON_MODELS_TABLE, PLACES_TABLE, USER_AIRCONS_TABLE, supabase

router = APIRouter(prefix="/api", tags=["places"])

PowerSource = Literal["database", "user_input", "estimated"]

# jh 수정함 - GET /places/geocode, /places/reverse-geocode에서 쓰는 카카오 로컬 API 설정
# (주소 검색으로 결과가 없으면 키워드/장소 검색으로 폴백)
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY")
KAKAO_ADDRESS_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/address.json"
KAKAO_KEYWORD_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
KAKAO_COORD_TO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json"
KAKAO_REQUEST_TIMEOUT = 5.0


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
    # jh 수정함 - 회원가입 흐름은 그대로 두기 위해 lat/lon을 선택값으로 추가
    lat: Optional[float] = None
    lon: Optional[float] = None
    aircons: list[UserAirconCreate] = Field(min_length=1, max_length=20)


# jh 수정함 - PATCH /places/{place_id}에서 lat/lon만 갱신할 때 쓰는 스키마
class PlaceLocationUpdate(BaseModel):
    lat: float
    lon: float


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
                    # jh 수정함 - 회원가입 시 lat/lon 없으면 None으로 저장됨
                    "lat": payload.lat,
                    "lon": payload.lon,
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


@router.get("/aircon-models")
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


@router.post("/places", status_code=status.HTTP_201_CREATED)
def create_place(
    payload: PlaceCreate,
    current_user: dict = Depends(get_current_user),
):
    return create_place_with_aircons_for_user(
        current_user["id"],
        payload,
    )


@router.get("/places")
def read_my_places(current_user: dict = Depends(get_current_user)):
    place_result = (
        supabase.table(PLACES_TABLE)
        # jh 수정함 - 위치 기능에 필요한 lat/lon도 응답에 포함
        .select("id,name,lat,lon,created_at")
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


# jh 수정함 - 로그인 후 위치(lat/lon)를 별도로 설정/수정하는 엔드포인트
@router.patch("/places/{place_id}")
def update_place_location(
    place_id: int,
    payload: PlaceLocationUpdate,
    current_user: dict = Depends(get_current_user),
):
    place_result = (
        supabase.table(PLACES_TABLE)
        .select("id")
        .eq("id", place_id)
        .eq("user_id", current_user["id"])
        .limit(1)
        .execute()
    )
    if not place_result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="장소를 찾을 수 없습니다.",
        )

    update_result = (
        supabase.table(PLACES_TABLE)
        .update({"lat": payload.lat, "lon": payload.lon})
        .eq("id", place_id)
        .execute()
    )
    return update_result.data[0]


# jh 수정함 - 카카오 로컬 API(주소/키워드/좌표->주소 검색)를 호출하는 공용 헬퍼.
# 셋 다 인증 헤더와 에러 처리가 동일해서 분리함(요청 파라미터만 다름)
async def _call_kakao_local_api(
    client: httpx.AsyncClient, url: str, params: dict
) -> dict:
    try:
        response = await client.get(
            url,
            params=params,
            headers={"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"},
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as error:
        print(f"카카오 로컬 API 오류({url}): {error}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"카카오 로컬 API가 오류를 반환했습니다 ({error.response.status_code}).",
        ) from error
    except httpx.HTTPError as error:
        print(f"카카오 로컬 API 호출 실패({url}): {error}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="카카오 로컬 API 호출에 실패했습니다.",
        ) from error


# jh 수정함 - 위치 설정/회원가입 화면에서 주소 검색 -> 위경도 변환에 쓰는 엔드포인트.
# 회원가입 도중(로그인 전)에도 호출해야 해서 인증은 요구하지 않고,
# 대신 남용 방지를 위해 검색어 최소 길이만 검증한다.
@router.get("/places/geocode")
async def geocode_address(
    query: str = Query(max_length=200),
):
    """카카오 로컬 API로 주소/장소 문자열을 위경도로 변환한다.

    먼저 주소 검색(/search/address.json)을 시도하고, 결과가 없으면(예:
    "강남역 스타벅스"처럼 지번/도로명 주소가 아닌 장소명 검색어) 키워드
    검색(/search/keyword.json)으로 한 번 더 시도한다. 두 API 모두 좌표를
    x=경도(lon), y=위도(lat) 순서로 반환하므로 여기서 lat/lon으로 맞춰서
    돌려준다. 키워드 검색 결과는 address_name(주소)이 비어 있을 수 있어
    place_name(장소명)을 우선 사용한다.
    """
    # jh 수정함 - 로그인 없이도 호출 가능하므로 최소한의 남용 방지 검증만 둠
    if len(query.strip()) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="검색어는 2자 이상 입력해 주세요.",
        )

    if not KAKAO_REST_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="KAKAO_REST_API_KEY 환경변수가 설정되어 있지 않습니다.",
        )

    async with httpx.AsyncClient(timeout=KAKAO_REQUEST_TIMEOUT) as client:
        address_data = await _call_kakao_local_api(
            client, KAKAO_ADDRESS_SEARCH_URL, {"query": query}
        )
        address_documents = address_data.get("documents", [])

        if address_documents:
            return [
                {
                    "address": document["address_name"],
                    "lat": float(document["y"]),
                    "lon": float(document["x"]),
                }
                for document in address_documents
            ]

        # jh 수정함 - 주소 검색 결과가 없으면 키워드(장소) 검색으로 폴백
        keyword_data = await _call_kakao_local_api(
            client, KAKAO_KEYWORD_SEARCH_URL, {"query": query}
        )
        keyword_documents = keyword_data.get("documents", [])

        return [
            {
                "address": document.get("place_name")
                or document.get("address_name")
                or "",
                "lat": float(document["y"]),
                "lon": float(document["x"]),
            }
            for document in keyword_documents
        ]


# jh 수정함 - "현재 위치로 찾기"에서 받은 lat/lon을 사람이 읽을 주소로 바꿔주는 엔드포인트.
# geocode와 동일한 이유로 로그인 전(회원가입 도중)에도 호출해야 해서 인증을 요구하지 않는다.
@router.get("/places/reverse-geocode")
async def reverse_geocode(
    lat: float = Query(...),
    lon: float = Query(...),
):
    """카카오 좌표->주소 변환 API(coord2address)로 위경도를 주소 문자열로 바꾼다.

    좌표에 대응하는 주소가 없으면(예: 바다 위, 국외 좌표) address를 null로 반환한다
    (geocode와 달리 이건 남용 여지가 적어 좌표 형식 검증 외에 별도 최소 길이 검증은 두지 않았다).
    도로명 주소(road_address)가 있으면 그걸 우선 쓰고, 없으면 지번 주소(address)를 쓴다.
    """
    if not KAKAO_REST_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="KAKAO_REST_API_KEY 환경변수가 설정되어 있지 않습니다.",
        )

    async with httpx.AsyncClient(timeout=KAKAO_REQUEST_TIMEOUT) as client:
        # jh 수정함 - 카카오 좌표 파라미터는 x=경도(lon), y=위도(lat) 순서
        data = await _call_kakao_local_api(
            client, KAKAO_COORD_TO_ADDRESS_URL, {"x": lon, "y": lat}
        )

    documents = data.get("documents", [])

    if not documents:
        return {"address": None}

    document = documents[0]
    road_address = document.get("road_address")
    lot_address = document.get("address")

    address_name = None
    if road_address:
        address_name = road_address.get("address_name")
    if not address_name and lot_address:
        address_name = lot_address.get("address_name")

    return {"address": address_name}
