# dudeoji-api/dev_tools/mock_generator.py
#
# 담당: 민주
# "센서 측정값 + 최근 온도 변화" 화면을 실제 데이터 없이도 미리 테스트할 때
# 쓰는 가짜 시계열 데이터 생성 함수입니다. main.py의 어떤 엔드포인트에서도
# 자동으로 호출되지 않습니다 — 필요할 때 이 함수를 직접 불러 쓰는 용도입니다.
#
# 예시:
#   from dev_tools.mock_generator import generate_mock_history
#   history = generate_mock_history(hours=24, interval_min=30)
import random
from datetime import datetime, timedelta


def generate_mock_history(hours=24, interval_min=30):
    """최근 온도 변화 화면을 위한 가상 시계열 데이터 생성 (경향성 반영)."""
    data = []
    current_time = datetime.now() - timedelta(hours=hours)

    temp_in = 26.0
    humidity_in = 55.0

    for _ in range(int((hours * 60) / interval_min)):
        temp_in += random.uniform(-0.5, 0.5)
        humidity_in += random.uniform(-2.0, 2.0)

        temp_in = max(18.0, min(35.0, temp_in))
        humidity_in = max(20.0, min(90.0, humidity_in))

        data.append(
            {
                "timestamp": current_time.strftime("%Y-%m-%dT%H:%M:%S"),
                "temp_in": round(temp_in, 1),
                "humidity_in": round(humidity_in, 1),
                "window_open": random.choice([True, False]),
            }
        )
        current_time += timedelta(minutes=interval_min)

    return data
