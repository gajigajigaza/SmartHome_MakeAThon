def calculate_thi(temp, humidity):
    """불쾌지수(THI) 계산 공식"""
    return 0.81 * temp + 0.01 * humidity * (0.99 * temp - 14.3) + 46.3

def estimate_savings(action):
    """에너지 절감량 및 멘트 구체화"""
    if action == "OPEN_WINDOW":
        return {
            "power_saved_kwh": 0.5,
            "time_applied_hours": 1,
            "cost_won": 150,
            "message": "창문 열기로 에어컨 대비 약 150원의 전기료를 아꼈어요! 두두가 상쾌한 바람을 즐깁니다."
        }
    return {
        "power_saved_kwh": 0.0,
        "time_applied_hours": 0,
        "cost_won": 0,
        "message": "전력 절감을 위해 외부 공기가 시원해지기를 기다리고 있어요."
    }

def determine_action(env_data, window_is_open, current_mode="MANUAL"):
    """
    통합 판단 규칙 엔진
    실내외 환경 및 창문 개폐 여부를 기반으로 최적의 액션과 멘트를 반환합니다.
    """
    
    # 1. 데이터 추출
    temp_in = env_data.get("indoor_temperature", 25.0)
    humidity_in = env_data.get("indoor_humidity", 50.0)
    temp_out = env_data.get("outdoor_temperature", 25.0)
    
    # 기상 API에서 받아올 데이터들
    weather_condition = env_data.get("weather", "맑음") # 맑음, 비, 눈, 태풍 등
    pm25 = env_data.get("pm25", 10.0)
    wind_speed = env_data.get("wind_speed", 2.0)

    thi_in = calculate_thi(temp_in, humidity_in)

    # 2. 창문 개방 불가 조건 확인 (외부 악천후 및 오염)
    is_raining = weather_condition in ['비', '소나기']
    is_snowing = weather_condition in ['눈']
    is_typhoon = weather_condition in ['태풍']
    is_dusty = pm25 > 35.0 # 미세먼지 나쁨 기준
    is_windy = wind_speed > 8.0 # 강풍 기준
    is_too_hot = temp_out >= temp_in # 밖이 안보다 덥거나 같음

    bad_outdoor_condition = is_raining or is_snowing or is_typhoon or is_dusty or is_windy or is_too_hot

    # 경고 메시지 로직
    warning_msg = None
    if is_typhoon: warning_msg = "🚨 [경고] 태풍이 불고 있습니다!"
    elif is_dusty: warning_msg = "🚨 [경고] 외부 미세먼지 수치가 나쁩니다."
    elif is_windy: warning_msg = "🚨 [강풍 주의] 강한 바람이 불고 있습니다."

    action = "MAINTAIN"
    message = "현재 온도가 아주 쾌적합니다. 지금 상태를 유지하세요."

    # 3. 로직 분기
    if window_is_open:
        # 창문이 열려있을 때 사람이 수행한 결과 피드백 포함
        if bad_outdoor_condition:
            action = "CLOSE_WINDOW"
            if is_typhoon: message = "태풍이 불어요! 창문이 깨질 수 있으니 당장 닫아주세요."
            elif is_windy: message = "바람이 너무 많이 불어요. 창문을 닫는 게 좋겠어요."
            elif is_dusty: message = "미세먼지가 너무 많아요. 창문을 닫고 공기를 정화해주세요."
            elif is_raining: message = "비가 오고 있어요. 빗물이 들어오기 전에 창문을 닫아주세요."
            elif is_snowing: message = "눈이 내려요. 실내 온도가 떨어지니 창문을 닫아주세요."
            elif is_too_hot: message = "바깥이 더 더워요! 뜨거운 공기가 들어오고 있으니 창문을 닫아주세요."
        else:
            action = "ENJOY" # 긍정적 피드백
            if wind_speed >= 2.0:
                message = "선선한 바람이 들어오고 있어요. 두두가 상쾌한 바람을 마시고 있어요!"
            else:
                message = "맑은 공기가 들어오고 있어요. 환기하기 딱 좋은 시간이네요."
    else:
        # 창문이 닫혀있을 때 추천
        if temp_in >= 26.0 or thi_in >= 75: # 덥거나 불쾌지수가 높음
            if bad_outdoor_condition:
                action = "USE_AIRCON"
                reason_str = "미세먼지 때문에" if is_dusty else ("비가 와서" if is_raining else "바깥 날씨가 궂어서")
                message = f"{reason_str} 창문을 여는 건 불가능해요. 에어컨을 틀어서 실내를 시원하게 만들어보세요."
            else:
                action = "OPEN_WINDOW"
                message = "바깥에 좋은 바람이 살살 불어요. 전력을 아끼기 위해 에어컨 대신 창문을 열어보는 건 어떨까요?"

    # 자동 모드 제어 트리거
    control_trigger = current_mode == "AUTO" and action not in ["MAINTAIN", "ENJOY"]
    savings = estimate_savings(action)

    return {
        "action": action,
        "message": message,
        "warning": warning_msg,
        "is_auto_triggered": control_trigger,
        "savings": savings
    }