"""외부 날씨 API 연동 모듈.

담당: 정현(나)

OpenWeatherMap One Call API 3.0(기온/체감온도/습도/풍속/날씨상태/강수확률) +
Air Pollution API(PM2.5/PM10/AQI)를 호출해서 실외 환경 정보를 가져옵니다.
DB나 다른 테이블은 조회하지 않고, 호출하는 쪽이 넘겨준 위경도를 그대로 씁니다.

반환 딕셔너리 중 weather_condition / pm25 / wind_speed / outdoor_temperature /
outdoor_humidity는 routers/readings_router.py의 SensorReadingCreate 필드명과
그대로 맞춰뒀습니다. 나머지(feels_like, precipitation_probability, pm10, aqi)는
저장 스키마엔 없지만 참고용으로 함께 반환합니다.

실패(타임아웃, API 에러) 시 예외를 그대로 던집니다 — 기본값 처리는 호출하는
쪽(예: readings_router.py에서 값을 채워 보내는 코드) 책임입니다.
"""
import asyncio
import os
import random
from typing import Optional, TypedDict

import httpx

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")

ONE_CALL_URL = "https://api.openweathermap.org/data/3.0/onecall"
AIR_POLLUTION_URL = "https://api.openweathermap.org/data/2.5/air_pollution"
REQUEST_TIMEOUT = 5.0


class OutdoorWeather(TypedDict):
    # SensorReadingCreate(readings_router.py)와 이름을 맞춘 필드
    weather_condition: str
    outdoor_temperature: float
    outdoor_humidity: float
    pm25: Optional[float]
    wind_speed: float
    # 저장 스키마엔 없지만 참고용으로 같이 반환하는 필드
    feels_like: float
    precipitation_probability: float
    pm10: Optional[float]
    aqi: Optional[int]


def _get_api_key() -> str:
    api_key = os.getenv("OPENWEATHER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENWEATHER_API_KEY 환경변수가 설정되어 있지 않습니다.")
    return api_key


def _map_weather_condition(weather_id: int) -> str:
    """OpenWeatherMap 날씨 코드(id)를 recommendation_engine.py가 비교하는
    한글 문자열("비"/"소나기"/"눈"/"태풍"/"맑음"/"흐림")로 변환한다."""
    if weather_id in (771, 781):  # squall, tornado
        return "태풍"
    if 520 <= weather_id <= 531:  # shower rain
        return "소나기"
    if 200 <= weather_id < 600:  # thunderstorm, drizzle, rain
        return "비"
    if 600 <= weather_id < 700:  # snow
        return "눈"
    if 700 <= weather_id < 800:  # mist/fog/haze/dust 등
        return "흐림"
    if weather_id == 800:  # clear
        return "맑음"
    return "흐림"  # clouds(80x)


async def fetch_current_weather(latitude: float, longitude: float) -> dict:
    """One Call API 3.0으로 기온/체감온도/습도/풍속/날씨상태/강수확률을 가져온다."""
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.get(
            ONE_CALL_URL,
            params={
                "lat": latitude,
                "lon": longitude,
                "appid": _get_api_key(),
                "units": "metric",
                "lang": "kr",
                "exclude": "minutely,daily,alerts",
            },
        )
        response.raise_for_status()
        data = response.json()

    current = data["current"]
    weather = current["weather"][0]
    hourly = data.get("hourly") or []
    precipitation_probability = hourly[0]["pop"] if hourly else 0.0

    return {
        "outdoor_temperature": current["temp"],
        "feels_like": current["feels_like"],
        "outdoor_humidity": current["humidity"],
        "wind_speed": current["wind_speed"],
        "weather_condition": _map_weather_condition(weather["id"]),
        "precipitation_probability": precipitation_probability,
    }


async def fetch_air_pollution(latitude: float, longitude: float) -> dict:
    """Air Pollution API로 PM2.5/PM10/AQI를 가져온다."""
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.get(
            AIR_POLLUTION_URL,
            params={"lat": latitude, "lon": longitude, "appid": _get_api_key()},
        )
        response.raise_for_status()
        data = response.json()

    entry = data["list"][0]
    components = entry["components"]

    return {
        "pm25": components["pm2_5"],
        "pm10": components["pm10"],
        "aqi": entry["main"]["aqi"],
    }


async def fetch_outdoor_weather(latitude: float, longitude: float) -> OutdoorWeather:
    """위경도를 받아 실외 날씨 + 미세먼지 정보를 합쳐서 반환한다.

    DB/다른 테이블 조회 없이 받은 위경도로 바로 OpenWeatherMap을 호출한다.
    """
    weather, air_pollution = await asyncio.gather(
        fetch_current_weather(latitude, longitude),
        fetch_air_pollution(latitude, longitude),
    )

    return {**weather, **air_pollution}


def fetch_outdoor_weather_mock(latitude: float, longitude: float) -> OutdoorWeather:
    """fetch_outdoor_weather()와 같은 형태의 가짜 데이터를 반환한다 (테스트용).

    dev_tools/mock_generator.py와 같은 패턴(random 기반)으로, 실제
    OpenWeatherMap 호출 없이 추천 로직/프론트 연동을 테스트할 때 쓴다.
    """
    condition = random.choice(["맑음", "맑음", "맑음", "흐림", "비", "소나기", "눈"])
    is_precipitating = condition in ("비", "소나기", "눈")

    return {
        "outdoor_temperature": round(random.uniform(15.0, 33.0), 1),
        "feels_like": round(random.uniform(14.0, 35.0), 1),
        "outdoor_humidity": round(random.uniform(30.0, 90.0), 1),
        "wind_speed": round(random.uniform(0.5, 10.0), 1),
        "weather_condition": condition,
        "precipitation_probability": round(
            random.uniform(0.5, 1.0) if is_precipitating else random.uniform(0.0, 0.2), 2
        ),
        "pm25": round(random.uniform(5.0, 80.0), 1),
        "pm10": round(random.uniform(10.0, 120.0), 1),
        "aqi": random.randint(1, 5),
    }
