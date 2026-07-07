# dudeoji-api/mock_generator.py
import random
from datetime import datetime, timedelta

def generate_mock_history(hours=24, interval_min=30):
    """최근 온도 변화 화면을 위한 가상 시계열 데이터 생성 (경향성 반영)"""
    data = []
    current_time = datetime.now() - timedelta(hours=hours)
    
    # 초기값 설정
    temp_in = 26.0
    humidity_in = 55.0

    for _ in range(int((hours * 60) / interval_min)):
        # 시간에 따른 약간의 랜덤 변화 (경향성)
        temp_in += random.uniform(-0.5, 0.5)
        humidity_in += random.uniform(-2.0, 2.0)
        
        # 비현실적인 값 방어
        temp_in = max(18.0, min(35.0, temp_in))
        humidity_in = max(20.0, min(90.0, humidity_in))

        data.append({
            "timestamp": current_time.strftime("%Y-%m-%dT%H:%M:%S"),
            "temp_in": round(temp_in, 1),
            "humidity_in": round(humidity_in, 1),
            "window_open": random.choice([True, False])
        })
        current_time += timedelta(minutes=interval_min)
        
    return data
    