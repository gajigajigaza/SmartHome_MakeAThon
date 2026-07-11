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
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from auth_utils import get_current_user
from db import AIRCON_MODELS_TABLE, PLACES_TABLE, USER_AIRCONS_TABLE, supabase

router = APIRouter(prefix="/api", tags=["places"])

PowerSource = Literal["database", "user_input", "estimated"]


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
