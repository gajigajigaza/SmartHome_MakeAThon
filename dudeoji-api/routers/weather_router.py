"""실외 날씨 조회 API.

담당: 정현(나)

weather.py의 fetch_outdoor_weather()를 그대로 감싸서 프론트가 위경도로
실외 날씨를 조회할 수 있게 하는 얇은 라우터입니다.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from auth_utils import get_current_user
from weather import fetch_outdoor_weather

router = APIRouter(prefix="/api", tags=["weather"])


@router.get("/weather")
async def read_weather(
    lat: float,
    lon: float,
    current_user: dict = Depends(get_current_user),
):
    try:
        return await fetch_outdoor_weather(lat, lon)
    except Exception as error:
        print(f"실외 날씨 조회 오류: {error}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="실외 날씨 정보를 가져오지 못했습니다.",
        ) from error
