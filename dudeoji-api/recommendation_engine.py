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
from typing import Literal, Optional

from savings import estimate_savings

Mode = Literal["MANUAL", "AUTO"]


def calculate_thi(temp: float, humidity: float) -> float:
    """불쾌지수(THI) 계산 공식."""
    return 0.81 * temp + 0.01 * humidity * (0.99 * temp - 14.3) + 46.3


def determine_action(
    indoor_temperature: float,
    indoor_humidity: float,
    outdoor_temperature: float,
    outdoor_humidity: float,
    weather_condition: str = "맑음",
    pm25: Optional[float] = None,
    wind_speed: Optional[float] = None,
    window_is_open: bool = False,
    current_mode: Mode = "MANUAL",
) -> dict:
    """
    통합 판단 규칙 엔진
    실내외 환경 및 창문 개폐 여부를 기반으로 최적의 액션과 멘트를 반환합니다.

    (minzoo 브랜치 processor.py의 determine_action() 원문 그대로.
    인자 전달 방식만 env_data 딕셔너리 대신 개별 파라미터로 바꿨습니다.)
    """

    pm25_value = 10.0 if pm25 is None else pm25
    wind_speed_value = 2.0 if wind_speed is None else wind_speed

    thi_in = calculate_thi(indoor_temperature, indoor_humidity)

    # 2. 창문 개방 불가 조건 확인 (외부 악천후 및 오염)
    is_raining = weather_condition in ("비", "소나기")
    is_snowing = weather_condition in ("눈",)
    is_typhoon = weather_condition in ("태풍",)
    is_dusty = pm25_value > 35.0  # 미세먼지 나쁨 기준
    is_windy = wind_speed_value > 8.0  # 강풍 기준
    is_too_hot = outdoor_temperature >= indoor_temperature  # 밖이 안보다 덥거나 같음

    bad_outdoor_condition = (
        is_raining or is_snowing or is_typhoon or is_dusty or is_windy or is_too_hot
    )

    # 경고 메시지 로직
    warning_msg = None
    if is_typhoon:
        warning_msg = "🚨 [경고] 태풍이 불고 있습니다!"
    elif is_dusty:
        warning_msg = "🚨 [경고] 외부 미세먼지 수치가 나쁩니다."
    elif is_windy:
        warning_msg = "🚨 [강풍 주의] 강한 바람이 불고 있습니다."

    action = "MAINTAIN"
    message = "현재 온도가 아주 쾌적합니다. 지금 상태를 유지하세요."

    # 3. 로직 분기
    if window_is_open:
        # 창문이 열려있을 때 사람이 수행한 결과 피드백 포함
        if bad_outdoor_condition:
            action = "CLOSE_WINDOW"
            if is_typhoon:
                message = "태풍이 불어요! 창문이 깨질 수 있으니 당장 닫아주세요."
            elif is_windy:
                message = "바람이 너무 많이 불어요. 창문을 닫는 게 좋겠어요."
            elif is_dusty:
                message = "미세먼지가 너무 많아요. 창문을 닫고 공기를 정화해주세요."
            elif is_raining:
                message = "비가 오고 있어요. 빗물이 들어오기 전에 창문을 닫아주세요."
            elif is_snowing:
                message = "눈이 내려요. 실내 온도가 떨어지니 창문을 닫아주세요."
            elif is_too_hot:
                message = "바깥이 더 더워요! 뜨거운 공기가 들어오고 있으니 창문을 닫아주세요."
        else:
            action = "ENJOY"  # 긍정적 피드백
            if wind_speed_value >= 2.0:
                message = "선선한 바람이 들어오고 있어요. 두두가 상쾌한 바람을 마시고 있어요!"
            else:
                message = "맑은 공기가 들어오고 있어요. 환기하기 딱 좋은 시간이네요."
    else:
        # 창문이 닫혀있을 때 추천
        if indoor_temperature >= 26.0 or thi_in >= 75:  # 덥거나 불쾌지수가 높음
            if bad_outdoor_condition:
                action = "USE_AIRCON"
                reason_str = (
                    "미세먼지 때문에"
                    if is_dusty
                    else ("비가 와서" if is_raining else "바깥 날씨가 궂어서")
                )
                message = (
                    f"{reason_str} 창문을 여는 건 불가능해요. "
                    "에어컨을 틀어서 실내를 시원하게 만들어보세요."
                )
            else:
                action = "OPEN_WINDOW"
                message = (
                    "바깥에 좋은 바람이 살살 불어요. "
                    "전력을 아끼기 위해 에어컨 대신 창문을 열어보는 건 어떨까요?"
                )

    # 자동 모드 제어 트리거
    control_trigger = current_mode == "AUTO" and action not in ("MAINTAIN", "ENJOY")

    # 절감량 계산은 savings.py(담당: 정현)에 위임
    savings = estimate_savings(action)

    # ryeun의 Recommendation 스키마(title/summary/reason)에 맞추기 위해
    # 구조만 감싸고, 실제 문구(message)는 원문 그대로 summary/reason 둘 다에 넣는다.
    # (title은 원본에 없던 항목이라, 문구를 새로 짓지 않고 액션별 짧은 표시용
    # 라벨만 붙였다 — 이 라벨은 민주의 멘트가 아니라 UI용 구조 텍스트다.)
    title_by_action = {
        "MAINTAIN": "현재 상태 유지",
        "OPEN_WINDOW": "창문 열기 추천",
        "USE_AIRCON": "에어컨 사용 추천",
        "CLOSE_WINDOW": "창문 닫기 추천",
        "ENJOY": "환기 유지",
    }

    return {
        "action": action,
        "title": title_by_action[action],
        "summary": message,
        "reason": message,
        "warning": warning_msg,
        "savings": savings,
        "is_auto_triggered": control_trigger,
    }
