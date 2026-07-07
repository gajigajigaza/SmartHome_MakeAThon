# dudeoji-api/mock_simulator.py
import time
import requests
import random

# 로컬 테스트용 (배포 후에는 Render 주소로 변경)
API_URL = "http://127.0.0.1:8000/api/readings"

def run_simulator():
    print("Mock 시뮬레이터 가동 시작... (5초마다 전송)")
    base_temp = 26.0
    
    while True:
        # 데이터에 약간의 노이즈(랜덤값)를 섞어 실제 센서처럼 구현
        sensor_data = {
            "indoor_temperature": round(base_temp + random.uniform(-0.5, 0.5), 1),
            "indoor_humidity": random.randint(40, 60),
            "outdoor_temperature": round(base_temp + random.uniform(-2.0, 2.0), 1),
            "outdoor_humidity": random.randint(40, 70)
        }
        
        try:
            response = requests.post(API_URL, json=sensor_data)
            print(f"[전송 성공] {sensor_data} -> 응답: {response.status_code}")
        except Exception as e:
            print(f"[전송 실패] 서버가 꺼져있습니다. {e}")
            
        time.sleep(5) # 5초 대기 후 다시 전송

if __name__ == "__main__":
    run_simulator()