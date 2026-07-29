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
from typing import Optional
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")


def generate_mock_occupancy_history(
    occupied_windows,
    days: int = 21,
    interval_minutes: int = 15,
    end_time_kst: Optional[datetime] = None,
):
    """place_id 없이 (person_detected, detected_at) 쌍만 만든다.

    occupancy_router.seed_occupancy_history()가 place_id를 채워
    occupancy_logs에 그대로 insert하는 용도. detected_at은 KST 기준으로
    생성한다(occupancy_engine.train_occupancy_pattern()이 학습 시 KST로
    변환하는 것과 같은 타임존 기준을 맞추기 위함 — UTC로 만들면 "평일
    9~12시" 같은 시나리오가 학습 시점엔 다른 시간대로 밀려서 틀어진다).

    occupied_windows: [{"weekdays": [0..6], "start_hour": 9, "end_hour": 12}, ...]
    (weekday: 월=0 ... 일=6, start_hour <= 재실 시각 < end_hour)
    """
    end = end_time_kst or datetime.now(KST)
    start = end - timedelta(days=days)

    logs = []
    current_time = start
    while current_time < end:
        is_occupied = any(
            current_time.weekday() in window["weekdays"]
            and window["start_hour"] <= current_time.hour < window["end_hour"]
            for window in occupied_windows
        )
        logs.append(
            {
                "person_detected": is_occupied,
                "detected_at": current_time.isoformat(),
            }
        )
        current_time += timedelta(minutes=interval_minutes)

    return logs


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
