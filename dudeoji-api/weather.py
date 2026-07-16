"""외부 날씨 API 연동 모듈.

담당: 정현(나)

실외 기온/습도/풍속/강수형태는 기상청 초단기실황조회(getUltraSrtNcst)로,
미세먼지(PM2.5/PM10/AQI)는 OpenWeatherMap Air Pollution API로 가져와서
합쳐 반환합니다. DB나 다른 테이블은 조회하지 않고, 호출하는 쪽이 넘겨준
위경도를 그대로 씁니다.

반환 딕셔너리 중 weather_condition / pm25 / wind_speed / outdoor_temperature /
outdoor_humidity는 routers/readings_router.py의 SensorReadingCreate 필드명과
그대로 맞춰뒀습니다. 나머지(feels_like, precipitation_probability, pm10, aqi,
observed_at)는 저장 스키마엔 없지만 참고용으로 함께 반환합니다.
precipitation_probability는 초단기실황에 없는 값이라 항상 None입니다.

실패(타임아웃, API 에러) 시 예외를 그대로 던집니다 — 기본값 처리는 호출하는
쪽(예: readings_router.py에서 값을 채워 보내는 코드) 책임입니다.
"""
import asyncio
import math
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Optional, TypedDict

import httpx

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
KMA_SERVICE_KEY = os.getenv("KMA_SERVICE_KEY")

KMA_ULTRA_SRT_NCST_URL = (
    "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
)
AIR_POLLUTION_URL = "https://api.openweathermap.org/data/2.5/air_pollution"
REQUEST_TIMEOUT = 5.0

KST = timezone(timedelta(hours=9))


class OutdoorWeather(TypedDict):
    # SensorReadingCreate(readings_router.py)와 이름을 맞춘 필드
    weather_condition: str
    outdoor_temperature: float
    outdoor_humidity: float
    pm25: Optional[float]
    wind_speed: float
    # 저장 스키마엔 없지만 참고용으로 같이 반환하는 필드
    feels_like: float
    # 초단기실황(getUltraSrtNcst)엔 강수확률이 없어서 항상 None
    precipitation_probability: Optional[float]
    pm10: Optional[float]
    aqi: Optional[int]
    # 기상청 관측 시각(base_date + base_time), "YYYY-MM-DD HH:MM" 형식
    observed_at: str


def _get_api_key() -> str:
    api_key = os.getenv("OPENWEATHER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENWEATHER_API_KEY 환경변수가 설정되어 있지 않습니다.")
    return api_key


def _get_kma_service_key() -> str:
    service_key = os.getenv("KMA_SERVICE_KEY")
    if not service_key:
        raise RuntimeError("KMA_SERVICE_KEY 환경변수가 설정되어 있지 않습니다.")
    return service_key


def latlon_to_kma_grid(lat: float, lon: float) -> tuple[int, int]:
    """위경도(WGS84)를 기상청 격자좌표(nx, ny)로 변환한다.

    기상청 공식 변환 로직(Lambert Conformal Conic 투영) 그대로 옮긴 순수
    함수 — 외부 API 호출 없이 계산만 한다.
    """
    RE = 6371.00877  # 지구 반지름(km)
    GRID = 5.0  # 격자 간격(km)
    SLAT1 = 30.0  # 투영 위도1(degree)
    SLAT2 = 60.0  # 투영 위도2(degree)
    OLON = 126.0  # 기준점 경도(degree)
    OLAT = 38.0  # 기준점 위도(degree)
    XO = 43  # 기준점 X좌표(GRID)
    YO = 136  # 기준점 Y좌표(GRID)

    DEGRAD = math.pi / 180.0

    re = RE / GRID
    slat1 = SLAT1 * DEGRAD
    slat2 = SLAT2 * DEGRAD
    olon = OLON * DEGRAD
    olat = OLAT * DEGRAD

    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5)
    sf = math.pow(sf, sn) * math.cos(slat1) / sn
    ro = math.tan(math.pi * 0.25 + olat * 0.5)
    ro = re * sf / math.pow(ro, sn)

    ra = math.tan(math.pi * 0.25 + lat * DEGRAD * 0.5)
    ra = re * sf / math.pow(ra, sn)
    theta = lon * DEGRAD - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn

    x = ra * math.sin(theta) + XO
    y = ro - ra * math.cos(theta) + YO

    nx = int(x + 1.5)
    ny = int(y + 1.5)
    return nx, ny


def _get_kma_base_datetime(now: Optional[datetime] = None) -> tuple[str, str]:
    """초단기실황(getUltraSrtNcst)의 base_date/base_time을 현재 시각 기준으로 역산한다.

    초단기실황은 매시 정각 데이터가 40분에 생성되어 10분 단위로 제공된다.
    즉 XX:40이 지나야 그 시각(XX:00)의 관측값을 조회할 수 있으므로, 아직
    40분이 안 지났으면 한 시간 전 정시 값을 쓴다(예: 14:25 → 1300).
    기상청 API는 KST 기준이라 서버 timezone과 무관하게 KST로 계산한다.
    """
    if now is None:
        now = datetime.now(KST)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=KST)
    else:
        now = now.astimezone(KST)

    base_dt = now if now.minute >= 40 else now - timedelta(hours=1)

    base_date = base_dt.strftime("%Y%m%d")
    base_time = base_dt.strftime("%H00")
    return base_date, base_time


def _calculate_feels_like(temp: float, humidity: float, wind_speed: float) -> float:
    """기온/습도/풍속만으로 체감온도를 근사 계산한다(호주 기상청 AT 공식).

    getUltraSrtNcst엔 체감온도 필드가 없어서 직접 계산한다. 수분압(e)으로
    습도를, -0.70*wind_speed 항으로 바람에 의한 체감 저하를 반영하는
    간단한 공식이라 겨울철 강풍 체감온도(윈드칠) 정밀도는 떨어질 수 있다.
    """
    vapor_pressure = (humidity / 100.0) * 6.105 * math.exp(17.27 * temp / (237.7 + temp))
    return round(temp + 0.33 * vapor_pressure - 0.70 * wind_speed - 4.00, 1)


# 초단기실황 PTY(강수형태) 코드 → recommendation_engine.py가 비교하는 한글 문자열
_PTY_TO_CONDITION = {
    "0": "맑음",
    "1": "비",
    "2": "비/눈",
    "3": "눈",
    "4": "소나기",
    "5": "비",  # 빗방울
    "6": "비/눈",  # 빗방울눈날림
    "7": "눈",  # 눈날림
}


def _map_pty_to_condition(pty_code: str) -> str:
    """PTY가 0(강수 없음)이면 "맑음"으로 기본 처리한다.

    한계: getUltraSrtNcst엔 하늘상태(SKY, 맑음/구름많음/흐림 구분) 카테고리가
    없다 — 그건 getUltraSrtFcst/getVilageFcst(예보) 쪽에만 있다. 그래서 비/눈이
    아니면 실제로 흐리거나 구름이 많아도 항상 "맑음"으로 표시된다.
    """
    return _PTY_TO_CONDITION.get(pty_code, "맑음")


async def fetch_current_weather(latitude: float, longitude: float) -> dict:
    """기상청 초단기실황조회(getUltraSrtNcst)로 기온/습도/풍속/강수형태를 가져온다.

    이 API엔 강수확률이 없어서 precipitation_probability는 항상 None이고,
    체감온도도 없어서 _calculate_feels_like()로 근사 계산한다.
    """
    nx, ny = latlon_to_kma_grid(latitude, longitude)
    base_date, base_time = _get_kma_base_datetime()

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.get(
            KMA_ULTRA_SRT_NCST_URL,
            params={
                "serviceKey": _get_kma_service_key(),
                "dataType": "JSON",
                "numOfRows": 10,
                "pageNo": 1,
                "base_date": base_date,
                "base_time": base_time,
                "nx": nx,
                "ny": ny,
            },
        )
        response.raise_for_status()
        data = response.json()

    header = data["response"]["header"]
    if header.get("resultCode") != "00":
        # api.data.go.kr은 서비스키 오류 등에서도 HTTP 200을 주고 이 필드로만
        # 실패를 알리기 때문에 raise_for_status()로는 못 잡는다.
        raise RuntimeError(f"기상청 API 오류({header.get('resultCode')}): {header.get('resultMsg')}")

    items = data["response"]["body"]["items"]["item"]
    values = {item["category"]: item["obsrValue"] for item in items}

    temp = float(values["T1H"])
    humidity = float(values["REH"])
    wind_speed = float(values["WSD"])
    pty_code = str(values.get("PTY", "0"))

    observed_at = datetime.strptime(f"{base_date}{base_time}", "%Y%m%d%H%M").strftime(
        "%Y-%m-%d %H:%M"
    )

    return {
        "outdoor_temperature": temp,
        "feels_like": _calculate_feels_like(temp, humidity, wind_speed),
        "outdoor_humidity": humidity,
        "wind_speed": wind_speed,
        "weather_condition": _map_pty_to_condition(pty_code),
        "precipitation_probability": None,
        "observed_at": observed_at,
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
    """위경도를 받아 실외 날씨(기상청) + 미세먼지(OpenWeatherMap) 정보를 합쳐서 반환한다.

    DB/다른 테이블 조회 없이 받은 위경도로 바로 두 API를 호출한다.
    """
    weather, air_pollution = await asyncio.gather(
        fetch_current_weather(latitude, longitude),
        fetch_air_pollution(latitude, longitude),
    )

    return {**weather, **air_pollution}


def fetch_outdoor_weather_mock(latitude: float, longitude: float) -> OutdoorWeather:
    """fetch_outdoor_weather()와 같은 형태의 가짜 데이터를 반환한다 (테스트용).

    dev_tools/mock_generator.py와 같은 패턴(random 기반)으로, 실제
    기상청/OpenWeatherMap 호출 없이 추천 로직/프론트 연동을 테스트할 때 쓴다.
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
        "observed_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
    }
