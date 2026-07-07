# dudeoji-api/processor.py

def calculate_thi(temp, humidity):
    """불쾌지수(THI) 계산 공식"""
    return 0.81 * temp + 0.01 * humidity * (0.99 * temp - 14.3) + 46.3

def estimate_savings(action):
    """에너지 절감량 계산"""
    if action == "OPEN_WINDOW":
        return {
            "kwh": 0.5,
            "cost_won": 150,
            "message": "창문 열기로 국밥 한 그릇 값 아끼기 성공!"
        }
    return {"kwh": 0.0, "cost_won": 0, "message": "에너지 절감 대기 중입니다."}

def determine_action(env_data, window_is_open, current_mode="MANUAL"):
    """통합 판단 규칙 엔진 (알림/경고 + 기기 제어 + 모드 반영)"""
    
    # 1. 환경 데이터 파싱
    temp_in = env_data.get("indoor_temperature", 25.0)
    humidity_in = env_data.get("indoor_humidity", 50.0)
    temp_out = env_data.get("outdoor_temperature", 25.0)
    humidity_out = env_data.get("outdoor_humidity", 50.0)
    
    is_raining = env_data.get("is_raining", False)
    pm25_bad = env_data.get("pm25_bad", False)
    wind_speed = env_data.get("wind_speed", 3.0)

    thi_in = calculate_thi(temp_in, humidity_in)

    # 2. 알림/경고 조건 로직 (Extreme Condition)
    warning_msg = None
    if pm25_bad:
        warning_msg = "🚨 [경고] 외부 미세먼지 수치가 매우 높습니다!"
    elif temp_in >= 32.0:
        warning_msg = "🚨 [폭염 주의] 실내 온도가 위험 수준입니다."
    elif wind_speed >= 9.0:
        warning_msg = "🚨 [강풍 주의] 태풍급 강풍이 불고 있습니다."

    # 3. 절대 창문 개방 불가 조건 (Hard Blockers)
    hard_block = is_raining or pm25_bad or wind_speed >= 9.0 or (temp_out >= temp_in)
    no_wind = wind_speed < 1.0

    # 4. 핵심 판단 로직
    action = "MAINTAIN"
    message = "현재 온도와 습도가 아주 완벽해요! 지금 상태를 유지하세요."

    # Case A: 외부 환경이 나쁘거나 너무 덥고 습한 경우 (에어컨 필요)
    if hard_block or no_wind or thi_in >= 75 or temp_in >= 27.0:
        if window_is_open:
            action = "CLOSE_WINDOW_AND_AC"
            message = "바깥 날씨가 창문을 열기 부적합합니다. 창문을 닫고 에어컨을 켜는 것을 추천해요."
        else:
            action = "USE_AIRCON"
            message = "실내가 다소 덥거나 습합니다. 에어컨을 켜서 온도를 낮춰주세요."

    # Case B: 창문 열기 좋은 날 (전력 절감 최우선)
    elif (temp_in - temp_out >= 2.0) and (humidity_out <= 70.0):
        if not window_is_open:
            action = "OPEN_WINDOW"
            message = "시원한 바람이 붑니다! 에어컨 대신 창문을 열면 두두에게 줄 보상을 얻을 수 있어요."

    # 5. 자동/수동 모드 분기 로직 (하드웨어 제어 트리거)
    # 현재 상태(MAINTAIN)가 아니고, 모드가 AUTO일 때만 하드웨어 액션 발생
    control_trigger = False
    if current_mode == "AUTO" and action != "MAINTAIN":
        control_trigger = True

    # 6. 절감액 계산 결합
    savings = estimate_savings(action)

    return {
        "action": action,
        "message": message,
        "warning": warning_msg,
        "is_auto_triggered": control_trigger,
        "savings": savings
    }