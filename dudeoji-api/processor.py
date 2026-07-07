# dudeoji-api/processor.py

def calculate_thi(temp, humidity):
    """불쾌지수(THI) 계산 공식 """
    return 0.81 * temp + 0.01 * humidity * (0.99 * temp - 14.3) + 46.3

def determine_action(env_data, window_is_open):
    """환경 데이터를 바탕으로 에어컨/창문 작동 추천 로직"""
    temp_in = env_data.get("temp_in", 25.0)
    temp_out = env_data.get("temp_out", 25.0)
    humidity_out = env_data.get("humidity_out", 50.0)
    is_raining = env_data.get("is_raining", False)
    pm25_bad = env_data.get("pm25_bad", False)
    wind_speed = env_data.get("wind_speed", 3.0)

    thi_in = calculate_thi(temp_in, env_data.get("humidity_in", 50.0))

    # 1. 절대 창문 개방 불가 조건 (Hard Blockers) [cite: 296]
    hard_block = is_raining or pm25_bad or wind_speed >= 9.0 or (temp_out >= temp_in)
    
    # 2. 무풍 조건 필터링 [cite: 296]
    no_wind = wind_speed < 1.0

    # Case B: 외부 환경이 나쁘거나 너무 덥고 습한 경우 (에어컨 필요) [cite: 301]
    if hard_block or no_wind or thi_in >= 75 or temp_in >= 27.0:
        if window_is_open:
            return {
                "action": "CLOSE_WINDOW_AND_AC",
                "message": "바깥 날씨가 창문을 열기 부적합합니다. 창문을 닫고 에어컨을 켜는 것을 추천해요."
            }
        else:
            return {
                "action": "TURN_ON_AC",
                "message": "실내가 다소 덥거나 습합니다. 에어컨을 켜서 온도를 낮춰주세요."
            }

    # Case A: 창문 열기 좋은 날 (전력 절감 최우선) [cite: 299]
    if (temp_in - temp_out >= 2.0) and (humidity_out <= 70.0):
        if not window_is_open:
            return {
                "action": "OPEN_WINDOW",
                "message": "시원한 바람이 붑니다! 에어컨 대신 창문을 열면 두두에게 줄 보상을 얻을 수 있어요."
            }

    # Case C: 이미 쾌적한 상태 [cite: 305]
    return {
        "action": "MAINTAIN",
        "message": "현재 온도와 습도가 아주 완벽해요! 지금 상태를 유지하세요."
    }

# processor.py 추가할 로직
def estimate_savings(action, consumption_per_hour=0.5):
    # 에어컨(0.5kW/h) 절감 예시
    if action == "OPEN_WINDOW":
        return {
            "kwh": 0.5,
            "cost_won": 150,
            "message": "창문 열기로 국밥 한 그릇 값 아끼기 성공!"
        }
    return {"kwh": 0, "cost_won": 0, "message": "에너지 절감 중입니다."}