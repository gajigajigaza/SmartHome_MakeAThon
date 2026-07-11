# dudeoji-api/dev_tools/mock_simulator.py
#
# 담당: 민주 (사전 준비 코드) — 실제 하드웨어 연결·전환은 특정 담당자
# 없이 대면 3박4일 현장에서 하드웨어를 세팅하는 사람이 진행합니다.
# (현장에서 붙일 때는 이 스크립트 대신 mqtt_handler.py로 실제 데이터가
# 들어오도록 바꾸고, main.py에서 MQTT_ENABLED=true로 켭니다.)
#
# 그 전까지 서버/프론트를 테스트할 땐 이 스크립트로 가짜 센서 값을
# 계속 흘려보내면 됩니다. 앱 화면(UI)에는 전혀 연결되어 있지 않습니다 —
# 그냥 "python dev_tools/mock_simulator.py"로 따로 실행하는 도구예요.
#
# 사용법:
#   1) 서버(main.py)를 먼저 켠다.
#   2) 프론트/Postman 등으로 로그인해서 액세스 토큰을 하나 받는다.
#   3) 아래처럼 토큰을 넣고 실행한다.
#        AUTH_TOKEN=여기에_토큰 python dev_tools/mock_simulator.py
#
# 지금 API는 로그인 인증이 필요해서(예전 minzoo 버전과 다르게),
# 토큰 없이 실행하면 401 에러가 납니다.
import os
import random
import time

import requests

API_URL = os.getenv("MOCK_API_URL", "http://127.0.0.1:8001/api/readings") #포트 확인하기!
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "")


def run_simulator():
    if not AUTH_TOKEN:
        print(
            "[안내] AUTH_TOKEN 환경변수가 없습니다. "
            "로그인 후 받은 토큰을 AUTH_TOKEN=... 형태로 넣어주세요."
        )

    print("Mock 시뮬레이터 가동 시작... (5초마다 전송)")
    base_temp = 26.0
    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"} if AUTH_TOKEN else {}

    while True:
        # 데이터에 약간의 노이즈(랜덤값)를 섞어 실제 센서처럼 구현
        sensor_data = {
            "indoor_temperature": round(base_temp + random.uniform(-0.5, 0.5), 1),
            "indoor_humidity": random.randint(40, 60),
            "outdoor_temperature": round(base_temp + random.uniform(-2.0, 2.0), 1),
            "outdoor_humidity": random.randint(40, 70),
        }

        try:
            response = requests.post(API_URL, json=sensor_data, headers=headers)
            print(f"[전송 성공] {sensor_data} -> 응답: {response.status_code}")
        except Exception as error:
            print(f"[전송 실패] 서버가 꺼져있습니다. {error}")

        time.sleep(5)  # 5초 대기 후 다시 전송


if __name__ == "__main__":
    run_simulator()
