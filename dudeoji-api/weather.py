"""외부 날씨 API 연동 모듈.

담당: 정현(나)

여기서 기상청/OpenWeather 같은 외부 API를 호출해서, 선택된 위치
(features/location/ 참고) 기준의 실외 날씨 정보를 가져옵니다.
가져온 값은 routers/readings_router.py의 SensorReadingCreate에 있는
weather_condition / pm25 / wind_speed 필드에 채워서 /api/readings로
보내면, recommendation_engine.py(담당: 민주)의 판단 정확도가 올라갑니다.

TODO(정현):
- 사용할 날씨 API 선정 (기상청 API, OpenWeatherMap 등)
- API 키는 .env에 WEATHER_API_KEY 같은 이름으로 넣고 os.getenv()로 읽기
- 위치(위경도 또는 지역 코드) → 실외 온습도/날씨상태/미세먼지/풍속 조회 함수 작성
- 외부 API 실패 시 에러 처리(무엇을 기본값으로 둘지) 결정
"""
import os
from typing import Optional, TypedDict

WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")


class OutdoorWeather(TypedDict):
    weather_condition: str
    outdoor_temperature: Optional[float]
    outdoor_humidity: Optional[float]
    pm25: Optional[float]
    wind_speed: Optional[float]


def fetch_outdoor_weather(latitude: float, longitude: float) -> OutdoorWeather:
    """위경도를 받아 실외 날씨 정보를 반환한다. (아직 미구현)"""
    raise NotImplementedError("TODO(정현): 실제 날씨 API 호출 로직 작성")
