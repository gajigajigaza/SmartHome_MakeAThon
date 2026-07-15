"""판단 규칙 엔진 (창문 환기 vs 에어컨 판단).

담당: 민주

minzoo 브랜치의 processor.py 로직을 옮겨왔습니다. 온습도만 보던 ryeun의
단순 로직 대신 불쾌지수(THI) + 미세먼지 + 강풍 + 강우/강설/태풍 여부까지
함께 고려하고, **창문이 이미 열려있는 상태**까지 구분해서 판단합니다.

- window_is_open=False (창문이 닫혀있을 때) → MAINTAIN / USE_AIRCON / OPEN_WINDOW 중 판단
- window_is_open=True (창문이 이미 열려있을 때) → 계속 열어둬도 되면 ENJOY,
  날씨가 나빠졌으면 CLOSE_WINDOW로 전환 추천

지금은 창문 개폐 센서가 없어서 readings_router.py가 항상
window_is_open=False로 호출하기 때문에, CLOSE_WINDOW/ENJOY는 아직 실제로는
나오지 않습니다. 이건 버그가 아니라 "창문센서 확장 시 로직 분기"(민주의
다음 작업)를 위해 미리 준비해 둔 부분입니다. 창문 개폐 센서가 들어오면
readings_router.py에서 실제 창문 상태를 window_is_open에 넣어주면 됩니다.

current_mode="AUTO"일 때 is_auto_triggered=True가 되는 것도 같은 이유로
미리 준비된 자리입니다 — 자동으로 창문/에어컨을 제어하는 기능이 생기면
이 값을 보고 실행 여부를 결정하면 됩니다. 지금은 항상 MANUAL이라 항상
False입니다.

TODO(민주): "판단 우선순위 확정(전력 우선 규칙 반영)"은 아래 조건문
순서를 조정하면 됩니다. 절감량 수치 자체는 이 파일이 아니라
savings.py(담당: 정현)에서 계산합니다.
"""
def calculate_thi(temp: float, humidity: float) -> float:
    return 1.8 * temp - 0.55 * (1 - humidity / 100.0) * (1.8 * temp - 26.0) + 32.0


def determine_action(
    indoor_temp: float, 
    outdoor_temp: float, 
    indoor_humidity: float = 50.0,
    pm25: float = 0.0, 
    wind_speed: float = 0.0, 
    weather_condition: str = "맑음",
    window_is_open: bool = False,
    is_ac_on: bool = False,
    current_mode: str = "MANUAL",
    ac_run_time_minutes: int = 0,
    target_cooldown_minutes: int = 30  # ✨ NEW: 사용자가 웹에서 입력한 최소 가동 시간 (기본값 30분)
):
    thi = calculate_thi(indoor_temp, indoor_humidity)
    is_auto = (current_mode == "AUTO")

    # [우선순위 0] 🚨 센서 에러 방어
    if indoor_temp > 50.0 or indoor_temp < -10.0:
        return {
            "action": "ERROR",
            "title": "센서 점검 필요 🚨",
            "summary": "실내 온도 센서 값이 비정상적입니다.",
            "reason": f"현재 측정된 온도가 {indoor_temp}도로 오류가 의심됩니다.",
            "show_popup": False, "popup_message": None, "is_auto_triggered": False
        }

    # [우선순위 1] ⛈️ 악천후 / 미세먼지 최악 (안전 최우선)
    is_bad_weather = "비" in weather_condition or "Rain" in weather_condition or "눈" in weather_condition or wind_speed >= 10.0
    is_bad_air = pm25 > 35.0

    if is_bad_weather or is_bad_air:
        warn_msg = "비가 들이치거나 나쁜 공기가 유입될 수 있습니다." if is_bad_weather else "미세먼지 수치가 매우 높습니다."
        if window_is_open:
            return {
                "action": "CLOSE_WINDOW",
                "title": "창문 단속 제안 🚪" if not is_auto else "자동으로 안전하게 창문 단속 완료! 🚪",
                "summary": "지금 밖에 비가 오거나 공기가 안 좋아요!",
                "reason": f"날씨가 나빠졌습니다. {warn_msg} 창문을 꼭 닫아주세요.",
                "show_popup": not is_auto,
                "popup_message": "지금 비가 오거나 공기가 안 좋습니다. 창문을 닫으시겠습니까?",
                "is_auto_triggered": is_auto
            }
        else:
            if indoor_temp >= 26.0 or thi >= 75.0:
                if is_ac_on:
                    return {
                        "action": "ENJOY",
                        "title": "시원한 냉기가 집안을 채우는 중 ❄️",
                        "summary": "안전하고 시원하게 온도를 조절하고 있어요.",
                        "reason": f"실내 불쾌지수가 {thi:.1f}로 높지만, 바깥 날씨가 나빠 창문을 열 수 없어 에어컨을 가동 중입니다.",
                        "show_popup": False, "popup_message": None, "is_auto_triggered": False
                    }
                else:
                    return {
                        "action": "USE_AIRCON",
                        "title": "에어컨 냉방 추천 ❄️" if not is_auto else "지능형 에어컨 가동 시작! ❄️",
                        "summary": "창문을 열 수 없는 날씨입니다. 에어컨을 켤까요?",
                        "reason": f"실내가 {indoor_temp}도(불쾌지수 {thi:.1f})로 덥지만 바깥 공기질/날씨가 좋지 않아 에어컨 사용을 권장합니다.",
                        "show_popup": not is_auto,
                        "popup_message": "바깥 날씨가 나빠서 환기가 불가능합니다. 에어컨을 켜시겠습니까?",
                        "is_auto_triggered": is_auto
                    }
            else:
                return {
                    "action": "MAINTAIN",
                    "title": "안전하게 실내 보호 중 😌",
                    "summary": "창문이 잘 닫혀있어 바깥 환경으로부터 안전해요.",
                    "reason": "바깥 날씨는 좋지 않지만 실내가 쾌적하게 유지되고 있습니다.",
                    "show_popup": False, "popup_message": None, "is_auto_triggered": False
                }

    # ---------------------------------------------------------
    # ✨ [우선순위 1.5] ⏳ 에어컨 쿨다운 (사용자 맞춤형 시간 적용!)
    # ---------------------------------------------------------
    # 에어컨 가동 시간이 사용자가 설정한 '목표 시간'보다 짧다면?
    if is_ac_on and ac_run_time_minutes < target_cooldown_minutes:
        
        # 단, 실내가 너무 추워졌을 때(예: 22도 미만)는 예외적으로 끄라고 추천
        if indoor_temp >= 22.0:
            return {
                "action": "ENJOY",
                "title": "냉기가 집안에 자리 잡는 중 ❄️",
                "summary": f"에어컨 가동 {ac_run_time_minutes}분 차, 목표 시간({target_cooldown_minutes}분)까지 쾌적함을 굳히고 있어요.",
                "reason": f"에어컨은 일정 시간 유지하는 것이 전기세 절약에 좋습니다. 사용자님이 설정하신 최소 가동 시간({target_cooldown_minutes}분) 동안은 유지합니다.",
                "show_popup": False,
                "popup_message": None,
                "is_auto_triggered": False
            }

    # ---------------------------------------------------------
    # [우선순위 2] ☀️ 그 외 맑고 공기 좋은 날의 일반적인 판단 (기존과 동일)
    # ---------------------------------------------------------
    if indoor_temp >= 26.0 or thi >= 75.0:
        if indoor_humidity >= 70.0:
            if is_ac_on:
                return {
                    "action": "ENJOY",
                    "title": "시원한 냉기가 집안을 채우는 중 ❄️",
                    "summary": "높은 습도를 에어컨으로 뽀송하게 밀어내고 있어요.",
                    "reason": f"실내 습도가 {indoor_humidity}%로 끈적입니다. 에어컨을 유지해 주세요.",
                    "show_popup": False, "popup_message": None, "is_auto_triggered": False
                }
            else:
                return {
                    "action": "USE_AIRCON",
                    "title": "습도 조절 냉방 추천 ❄️" if not is_auto else "쾌적 제습 가동 시작! ❄️",
                    "summary": "너무 끈적거려요! 에어컨을 켤까요?",
                    "reason": f"실내 습도가 {indoor_humidity}%로 매우 높습니다. 제습과 냉방을 위해 에어컨 가동을 추천합니다.",
                    "show_popup": not is_auto,
                    "popup_message": "실내가 너무 습합니다. 에어컨을 켜시겠습니까?",
                    "is_auto_triggered": is_auto
                }

        if wind_speed >= 3.0 and outdoor_temp <= indoor_temp + 2.0:
            if window_is_open:
                return {
                    "action": "ENJOY",
                    "title": "현재 바깥 바람을 안으로 초대하는 중 🍃",
                    "summary": "자연의 시원한 바람이 방 안을 기분 좋게 식히고 있어요.",
                    "reason": f"풍속 {wind_speed}m/s의 기분 좋은 천연 에어컨이 작동 중입니다. 이대로 유지하세요!",
                    "show_popup": False, "popup_message": None, "is_auto_triggered": False
                }
            else:
                return {
                    "action": "OPEN_WINDOW",
                    "title": "천연 에어컨 작동 제안 🪟" if not is_auto else "천연 에어컨 가동(창문 열기)! 🪟",
                    "summary": "바깥에 기분 좋은 시원한 바람이 불고 있어요!",
                    "reason": f"풍속 {wind_speed}m/s의 시원한 바람이 붑니다. 에어컨 대신 창문을 열어 전기세를 아껴보세요.",
                    "show_popup": not is_auto,
                    "popup_message": "에어컨 대신 시원한 바람이 부는 창문을 여시겠습니까?",
                    "is_auto_triggered": is_auto
                }

        if outdoor_temp < indoor_temp:
            if window_is_open:
                return {
                    "action": "ENJOY",
                    "title": "기분 좋은 환기 진행 중 🍃",
                    "summary": "시원한 실외 공기가 천천히 들어오고 있어요.",
                    "reason": "바깥 온도가 더 낮아 계속 열어두시는 것을 추천합니다.",
                    "show_popup": False, "popup_message": None, "is_auto_triggered": False
                }
            else:
                return {
                    "action": "OPEN_WINDOW",
                    "title": "자연 환기 추천 🪟" if not is_auto else "시원한 공기 유입(창문 열기)! 🪟",
                    "summary": "바깥 공기가 더 시원해요. 창문을 열까요?",
                    "reason": f"실외({outdoor_temp}도)가 실내({indoor_temp}도)보다 시원합니다. 문을 열어 방을 식히세요.",
                    "show_popup": not is_auto,
                    "popup_message": "바깥이 더 시원합니다. 창문을 여시겠습니까?",
                    "is_auto_triggered": is_auto
                }

        if is_ac_on:
            return {
                "action": "ENJOY",
                "title": "시원한 냉기가 집안을 채우는 중 ❄️",
                "summary": "가장 쾌적하고 조용한 방법으로 더위를 식히는 중입니다.",
                "reason": "바람이 불지 않고 밖도 더운 날씨라 에어컨 유지가 정답입니다.",
                "show_popup": False, "popup_message": None, "is_auto_triggered": False
            }
        else:
            return {
                "action": "USE_AIRCON",
                "title": "에어컨 냉방 가동 추천 ❄️" if not is_auto else "스마트 냉방 가동 시작! ❄️",
                "summary": "바람을 기대하기 힘들고 밖도 더워요. 에어컨을 켤까요?",
                "reason": f"실내외 온도가 모두 높습니다. 에어컨을 켜는 것이 가장 확실하고 쾌적한 선택입니다.",
                "show_popup": not is_auto,
                "popup_message": "자연풍을 기대하기 힘든 무더위입니다. 에어컨을 켜시겠습니까?",
                "is_auto_triggered": is_auto
            }

    if indoor_temp < 18.0:
        if window_is_open:
            return {
                "action": "CLOSE_WINDOW",
                "title": "실내 온기 보호 🚪" if not is_auto else "온기 보호를 위해 창문 폐쇄! 🚪",
                "summary": "방 안이 조금 쌀쌀해요! 창문을 닫을까요?",
                "reason": f"실내 온도가 {indoor_temp}도로 떨어졌습니다. 체온 보온을 위해 창문을 닫으세요.",
                "show_popup": not is_auto,
                "popup_message": "실내가 다소 쌀쌀합니다. 창문을 닫으시겠습니까?",
                "is_auto_triggered": is_auto
            }
        else:
            return {
                "action": "MAINTAIN",
                "title": "따뜻하고 아늑하게 유지 중 😌",
                "summary": "적정 온도를 잘 지키고 있어요.",
                "reason": "약간 쌀쌀하지만 창문이 잘 닫혀 있어 온기가 유지되고 있습니다.",
                "show_popup": False, "popup_message": None, "is_auto_triggered": False
            }

    return {
        "action": "ENJOY",
        "title": "쾌적함 100% 🍃",
        "summary": "두더지가 보증하는 완벽한 실내 환경입니다.",
        "reason": f"현재 실내 {indoor_temp}도, 습도 {indoor_humidity}%로 아무것도 만지지 않아도 아주 기분 좋은 상태입니다.",
        "show_popup": False, "popup_message": None, "is_auto_triggered": False
    }