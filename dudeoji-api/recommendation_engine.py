"""두더지 추천 판단 규칙 엔진.

실내 온·습도, 실외 날씨 API, 미세먼지, 풍속, 창문 상태와 에어컨 상태를
종합해 환기/냉방/유지 동작을 결정합니다. 프론트 상태 표시와 같은 기준을
사용할 수 있도록 LOGIC_THRESHOLDS를 공개합니다.
"""
from typing import Optional


LOGIC_THRESHOLDS = {
    "sensor_temperature_min": -10.0,
    "sensor_temperature_max": 50.0,
    "indoor_hot": 26.0,
    "indoor_cold": 18.0,
    "indoor_humidity_high": 70.0,
    "thi_high": 75.0,
    "pm25_bad": 35.0,
    "wind_ventilation": 3.0,
    "wind_strong": 10.0,
    "outdoor_temperature_margin": 2.0,
    "ac_cooldown_min_temperature": 22.0,
}

# 환기가 최적이라는 판단의 액션 집합 — 새 액션 추가 시 환기 계열이면 반드시
# 포함. window_is_open이 이미 True면 이 함수가 "OPEN_WINDOW"를 다시
# 추천하지 않고 "ENJOY"("잘 하고 있다")를 반환하므로 둘 다 포함해야
# 한다. savings.py가 절감 판정에 import해서 사용한다.
VENTILATION_ACTIONS = ("OPEN_WINDOW", "ENJOY")

# 액션(+상태)별 통일된 제목 문구. 예전엔 브랜치마다(자동/수동, 창문 상태
# 앎/모름 등) 제목이 15개 넘게 갈라져 있었는데, 그 뉘앙스는 summary/reason
# 텍스트로 넘기고 제목은 이 표 하나로만 정한다 — determine_action()이 어떤
# 브랜치를 타든 마지막에 이 표로 title을 덮어써서 불일치가 구조적으로
# 불가능하게 만든다(아래 _resolve_title/determine_action 참고).
_TITLES = {
    "USE_AIRCON": "에어컨 켤 타이밍이에요!",
    "OPEN_WINDOW": "지금은 창문 열 타이밍이에요!",
    "CLOSE_WINDOW": "창문 닫을 타이밍이에요!",
    "ENJOY_AIRCON": "에어컨이 켜져 있어요! 시원한 바람 즐기는 중",
    "ENJOY_WINDOW": "창문이 열려 있어요! 자연 바람 즐기는 중",
    "MAINTAIN": "딱 좋은 상태 유지 중",
    # jh 수정함 - 재실 낭비 방지(사람 없음)와 환기 충분(바람 좋음) 두 트리거가
    # 결과적으로 같은 조치(에어컨 끄기)라 액션/제목을 하나로 합쳤다. 왜
    # 끄라는 건지는 summary/reason에서만 갈린다.
    "TURN_OFF_AIRCON": "에어컨 끌 타이밍이에요!",
    "ERROR": "어라, 센서가 이상해요!",
}


def _resolve_title(
    action: str,
    is_ac_on: Optional[bool],
    window_is_open: Optional[bool],
) -> str:
    """액션(+ENJOY의 경우 실제 에어컨/창문 상태)으로 통일된 제목을 고른다.

    ENJOY는 에어컨 유지 중/창문 유지 중/그냥 쾌적함(할 일 없음) 세 가지
    서로 다른 상황을 하나의 action으로 묶어서 반환하므로, 제목만은
    is_ac_on/window_is_open을 보고 그중 하나로 갈라준다. 둘 다 True인
    드문 경우(에어컨 켠 채로 창문도 열어둔 경우)는 에너지 낭비 쪽을
    먼저 알려주는 게 유용해서 에어컨 문구를 우선한다.
    """
    if action == "ENJOY":
        if is_ac_on is True:
            return _TITLES["ENJOY_AIRCON"]
        if window_is_open is True:
            return _TITLES["ENJOY_WINDOW"]
        return _TITLES["MAINTAIN"]

    return _TITLES.get(action, _TITLES["MAINTAIN"])


def calculate_thi(temp: float, humidity: float) -> float:
    return (
        1.8 * temp
        - 0.55 * (1 - humidity / 100.0) * (1.8 * temp - 26.0)
        + 32.0
    )


def determine_action(
    indoor_temp: float,
    outdoor_temp: float,
    indoor_humidity: float = 50.0,
    outdoor_humidity: float = 50.0,
    pm25: float = 0.0,
    wind_speed: float = 0.0,
    weather_condition: str = "맑음",
    window_is_open: Optional[bool] = None,
    is_ac_on: Optional[bool] = None,
    current_mode: str = "MANUAL",
    ac_run_time_minutes: int = 0,
    target_cooldown_minutes: int = 30,
    occupancy_signal: Optional[dict] = None,
):
    """_determine_action_core()의 결과에 통일된 title을 덮어써서 반환한다.

    핵심 판단 로직(action/summary/reason/popup 등)은 그대로 _determine_action_core
    쪽에 있고, 여기서는 그 결과의 title 필드만 _resolve_title()로 교체한다
    — 브랜치가 몇 개든 새로 추가되든 title 문구가 갈라질 일이 구조적으로
    없어진다.
    """
    result = _determine_action_core(
        indoor_temp=indoor_temp,
        outdoor_temp=outdoor_temp,
        indoor_humidity=indoor_humidity,
        outdoor_humidity=outdoor_humidity,
        pm25=pm25,
        wind_speed=wind_speed,
        weather_condition=weather_condition,
        window_is_open=window_is_open,
        is_ac_on=is_ac_on,
        current_mode=current_mode,
        ac_run_time_minutes=ac_run_time_minutes,
        target_cooldown_minutes=target_cooldown_minutes,
        occupancy_signal=occupancy_signal,
    )
    result["title"] = _resolve_title(
        result["action"],
        is_ac_on=is_ac_on,
        window_is_open=window_is_open,
    )
    return result


def _determine_action_core(
    indoor_temp: float,
    outdoor_temp: float,
    indoor_humidity: float = 50.0,
    outdoor_humidity: float = 50.0,
    pm25: float = 0.0,
    wind_speed: float = 0.0,
    weather_condition: str = "맑음",
    window_is_open: Optional[bool] = None,
    is_ac_on: Optional[bool] = None,
    current_mode: str = "MANUAL",
    ac_run_time_minutes: int = 0,
    target_cooldown_minutes: int = 30,
    occupancy_signal: Optional[dict] = None,
):
    """현재 환경을 기준으로 추천 동작을 반환합니다.

    window_is_open=None은 창문 센서가 연결되지 않았거나 값을 받지 못한 상태입니다.
    is_ac_on=None은 에어컨 전원 센서가 연결되지 않았거나 값을 받지 못한 상태입니다.
    추천 action으로 에어컨 전원 상태를 추정하지 않습니다.
    이 경우 닫힘으로 단정하지 않고, 필요한 동작은 조건부 문구로 안내합니다.

    occupancy_signal은 occupancy_engine.resolve_occupancy_signal()이 미리
    구해서 넘기는 값(이 함수 자체는 DB에 접근하지 않음)입니다.
    {"present": bool, "source": "LIVE"|"PATTERN"} 또는 None(재실 신호 없음/
    콜드스타트). "present": False일 때만 의미가 있으며, "present": True는
    현재 로직에서 별도 분기가 없습니다(기존 엔진이 이미 재실을 기본 가정).
    """
    thresholds = LOGIC_THRESHOLDS
    thi = calculate_thi(indoor_temp, indoor_humidity)
    is_auto = current_mode == "AUTO"
    window_state_known = window_is_open is not None
    window_open = window_is_open is True

    if (
        indoor_temp > thresholds["sensor_temperature_max"]
        or indoor_temp < thresholds["sensor_temperature_min"]
    ):
        return {
            "action": "ERROR",
            "title": "센서 점검 필요 🚨",
            "summary": "실내 온도 센서 값이 비정상적입니다.",
            "reason": f"현재 측정된 온도가 {indoor_temp}도로 오류가 의심됩니다.",
            "show_popup": False,
            "popup_message": None,
            "is_auto_triggered": False,
        }

    is_bad_weather = (
        "비" in weather_condition
        or "Rain" in weather_condition
        or "눈" in weather_condition
        or wind_speed >= thresholds["wind_strong"]
    )
    is_bad_air = pm25 > thresholds["pm25_bad"]

    if is_bad_weather or is_bad_air:
        warn_msg = (
            "비가 들이치거나 강한 바람이 유입될 수 있습니다."
            if is_bad_weather
            else "미세먼지 수치가 높습니다."
        )

        if window_open:
            return {
                "action": "CLOSE_WINDOW",
                "title": "창문 단속 제안 🚪" if not is_auto else "자동으로 창문 단속 완료! 🚪",
                "summary": "지금 밖에 비가 오거나 공기가 좋지 않아요.",
                "reason": f"{warn_msg} 창문을 닫아주세요.",
                "show_popup": not is_auto,
                "popup_message": "실외 환경이 좋지 않습니다. 창문을 닫으시겠습니까?",
                "is_auto_triggered": is_auto,
            }

        if indoor_temp >= thresholds["indoor_hot"] or thi >= thresholds["thi_high"]:
            if is_ac_on:
                return {
                    "action": "ENJOY",
                    "title": "시원한 냉기가 집안을 채우는 중 ❄️",
                    "summary": "안전하고 시원하게 온도를 조절하고 있어요.",
                    "reason": (
                        f"실내 불쾌지수가 {thi:.1f}로 높지만 실외 환경이 좋지 않아 "
                        "에어컨을 유지합니다."
                    ),
                    "show_popup": False,
                    "popup_message": None,
                    "is_auto_triggered": False,
                }

            return {
                "action": "USE_AIRCON",
                "title": "에어컨 냉방 추천 ❄️" if not is_auto else "지능형 에어컨 가동 시작! ❄️",
                "summary": "창문을 열 수 없는 실외 환경입니다. 에어컨을 켤까요?",
                "reason": (
                    f"실내가 {indoor_temp}도(불쾌지수 {thi:.1f})로 덥지만 "
                    "실외 날씨나 공기질이 좋지 않아 에어컨 사용을 권장합니다."
                ),
                "show_popup": not is_auto,
                "popup_message": "실외 환경이 좋지 않아 환기하기 어렵습니다. 에어컨을 켜시겠습니까?",
                "is_auto_triggered": is_auto,
            }

        if not window_state_known:
            return {
                "action": "MAINTAIN",
                "title": "창문 상태 확인 필요 🪟",
                "summary": "실외 환경이 좋지 않지만 창문 센서 상태를 확인할 수 없어요.",
                "reason": f"{warn_msg} 창문이 열려 있다면 닫아주세요.",
                "show_popup": False,
                "popup_message": None,
                "is_auto_triggered": False,
            }

        return {
            "action": "MAINTAIN",
            "title": "안전하게 실내 보호 중 😌",
            "summary": "창문이 닫혀 있어 실외 환경으로부터 안전해요.",
            "reason": "실외 환경은 좋지 않지만 실내는 쾌적하게 유지되고 있습니다.",
            "show_popup": False,
            "popup_message": None,
            "is_auto_triggered": False,
        }

    if is_ac_on and occupancy_signal and occupancy_signal.get("present") is False:
        occupancy_source = occupancy_signal.get("source")
        return {
            "action": "TURN_OFF_AIRCON",
            "title": "에어컨 끌 타이밍이에요!",
            "summary": "지금 이 장소에는 아무도 없는 것 같아요.",
            "reason": (
                (
                    "실시간 재실 감지 결과 사람이 없습니다."
                    if occupancy_source == "LIVE"
                    else "이 시간대에는 평소 자리를 비우는 패턴이 학습되었습니다."
                )
                + " 에어컨을 꺼서 전력 낭비를 줄일까요?"
            ),
            "show_popup": not is_auto,
            "popup_message": "지금 자리를 비우신 것 같아요. 에어컨을 끌까요?",
            "is_auto_triggered": is_auto,
        }

    # jh 추가 - 에어컨 켜진 채 창문도 열려 있으면 냉기가 그대로 새는
    # 낭비 상황이다. 재실 낭비 방지(위 분기)보다는 덜 급하지만(사람은
    # 있으니까), 쿨다운 유지 로직보다는 먼저 잡아야 한다 — 쿨다운 중이라고
    # 이 낭비를 눈감아주면 오히려 더 오래 새게 두는 꼴이라서.
    #
    # jh 수정함 - 무조건 "창문을 닫으라"고 하면 안 된다. 바람이 좋거나
    # 애초에 안 더운 날은 자연환기만으로 충분한데 에어컨까지 켜둔 거라
    # "에어컨을 끄라"고 해야 맞다(창문은 이미 잘 열어둔 상태니까). 반대로
    # 정말 더워서(그리고 습해서) 에어컨이 필요한 상황이면 "창문을 닫으라"고
    # 해야 한다 — 아래 hot/humidity/wind 분기와 같은 기준으로 판단한다.
    if is_ac_on and window_open:
        is_hot = indoor_temp >= thresholds["indoor_hot"] or thi >= thresholds["thi_high"]
        humidity_high = indoor_humidity >= thresholds["indoor_humidity_high"]
        wind_is_helpful_now = (
            wind_speed >= thresholds["wind_ventilation"]
            and outdoor_temp <= indoor_temp + thresholds["outdoor_temperature_margin"]
        )
        outdoor_cooler_now = outdoor_temp < indoor_temp
        ventilation_sufficient = not is_hot or (
            not humidity_high and (wind_is_helpful_now or outdoor_cooler_now)
        )

        if ventilation_sufficient:
            return {
                "action": "TURN_OFF_AIRCON",
                "title": "에어컨 끌 타이밍이에요!",
                "summary": "지금은 자연 바람만으로 충분히 시원해요.",
                "reason": (
                    "실외 조건이 좋아 창문만으로도 충분한데 에어컨도 같이 "
                    "켜져 있어요. 에어컨을 끄고 자연 바람을 즐겨보세요."
                ),
                "show_popup": not is_auto,
                "popup_message": "자연 바람으로 충분해요. 에어컨을 끌까요?",
                "is_auto_triggered": is_auto,
            }

        return {
            "action": "CLOSE_WINDOW",
            "title": "창문 닫을 타이밍이에요!",
            "summary": "에어컨이 켜진 채 창문이 열려 있어요.",
            "reason": (
                "냉방한 공기가 열린 창문으로 빠져나가 전력이 낭비되고 "
                "있어요. 창문을 닫아 주세요."
            ),
            "show_popup": not is_auto,
            "popup_message": "에어컨이 켜진 채 창문이 열려 있어요. 창문을 닫을까요?",
            "is_auto_triggered": is_auto,
        }

    if is_ac_on and ac_run_time_minutes < target_cooldown_minutes:
        if indoor_temp >= thresholds["ac_cooldown_min_temperature"]:
            return {
                "action": "ENJOY",
                "title": "냉기가 집안에 자리 잡는 중 ❄️",
                "summary": (
                    f"에어컨 가동 {ac_run_time_minutes}분 차, "
                    f"목표 시간({target_cooldown_minutes}분)까지 유지하고 있어요."
                ),
                "reason": (
                    "에어컨은 일정 시간 유지하는 것이 효율적입니다. "
                    f"설정한 최소 가동 시간({target_cooldown_minutes}분) 동안 유지합니다."
                ),
                "show_popup": False,
                "popup_message": None,
                "is_auto_triggered": False,
            }

    if indoor_temp >= thresholds["indoor_hot"] or thi >= thresholds["thi_high"]:
        if indoor_humidity >= thresholds["indoor_humidity_high"]:
            if is_ac_on:
                return {
                    "action": "ENJOY",
                    "title": "시원한 냉기가 집안을 채우는 중 ❄️",
                    "summary": "높은 습도를 에어컨으로 조절하고 있어요.",
                    "reason": (
                        f"실내 습도가 {indoor_humidity}%로 높습니다. "
                        "에어컨을 유지해 주세요."
                    ),
                    "show_popup": False,
                    "popup_message": None,
                    "is_auto_triggered": False,
                }

            return {
                "action": "USE_AIRCON",
                "title": "습도 조절 냉방 추천 ❄️" if not is_auto else "쾌적 제습 가동 시작! ❄️",
                "summary": "실내 습도가 높아요. 에어컨을 켤까요?",
                "reason": (
                    f"실내 습도가 {indoor_humidity}%로 높습니다. "
                    "제습과 냉방을 위해 에어컨 가동을 추천합니다."
                ),
                "show_popup": not is_auto,
                "popup_message": "실내가 습합니다. 에어컨을 켜시겠습니까?",
                "is_auto_triggered": is_auto,
            }

        wind_is_helpful = (
            wind_speed >= thresholds["wind_ventilation"]
            and outdoor_temp
            <= indoor_temp + thresholds["outdoor_temperature_margin"]
        )

        if wind_is_helpful:
            if window_open:
                return {
                    "action": "ENJOY",
                    "title": "현재 바깥 바람을 안으로 초대하는 중 🍃",
                    "summary": "자연 바람이 실내를 식히고 있어요.",
                    "reason": (
                        f"풍속 {wind_speed}m/s이고 실외 온도도 환기에 적합해 "
                        "현재 상태를 유지합니다."
                    ),
                    "show_popup": False,
                    "popup_message": None,
                    "is_auto_triggered": False,
                }

            unknown_note = (
                " 창문 센서가 연결되지 않았으므로 닫혀 있다면 열어주세요."
                if not window_state_known
                else ""
            )
            return {
                "action": "OPEN_WINDOW",
                "title": "환기 상태 확인 제안 🪟" if not window_state_known else (
                    "천연 에어컨 작동 제안 🪟" if not is_auto else "천연 에어컨 가동(창문 열기)! 🪟"
                ),
                "summary": "시원한 바람이 불어 자연 환기가 유리해요.",
                "reason": (
                    f"풍속 {wind_speed}m/s이고 실외 온도가 환기 가능한 범위입니다."
                    f"{unknown_note}"
                ),
                "show_popup": not is_auto and window_state_known,
                "popup_message": (
                    "에어컨 대신 창문을 여시겠습니까?"
                    if window_state_known
                    else None
                ),
                "is_auto_triggered": is_auto and window_state_known,
            }

        if outdoor_temp < indoor_temp:
            if window_open:
                return {
                    "action": "ENJOY",
                    "title": "기분 좋은 환기 진행 중 🍃",
                    "summary": "시원한 실외 공기가 들어오고 있어요.",
                    "reason": "실외 온도가 더 낮아 계속 열어두는 것을 추천합니다.",
                    "show_popup": False,
                    "popup_message": None,
                    "is_auto_triggered": False,
                }

            unknown_note = (
                " 창문 센서가 연결되지 않았으므로 닫혀 있다면 열어주세요."
                if not window_state_known
                else ""
            )
            return {
                "action": "OPEN_WINDOW",
                "title": "환기 상태 확인 제안 🪟" if not window_state_known else (
                    "자연 환기 추천 🪟" if not is_auto else "시원한 공기 유입(창문 열기)! 🪟"
                ),
                "summary": "실외 공기가 더 시원해 자연 환기가 유리해요.",
                "reason": (
                    f"실외({outdoor_temp}도)가 실내({indoor_temp}도)보다 시원합니다."
                    f"{unknown_note}"
                ),
                "show_popup": not is_auto and window_state_known,
                "popup_message": (
                    "실외가 더 시원합니다. 창문을 여시겠습니까?"
                    if window_state_known
                    else None
                ),
                "is_auto_triggered": is_auto and window_state_known,
            }

        if is_ac_on:
            return {
                "action": "ENJOY",
                "title": "시원한 냉기가 집안을 채우는 중 ❄️",
                "summary": "에어컨으로 더위를 식히고 있어요.",
                "reason": "바람이 약하고 실외도 더워 에어컨 유지가 적합합니다.",
                "show_popup": False,
                "popup_message": None,
                "is_auto_triggered": False,
            }

        return {
            "action": "USE_AIRCON",
            "title": "에어컨 냉방 가동 추천 ❄️" if not is_auto else "스마트 냉방 가동 시작! ❄️",
            "summary": "바람이 약하고 실외도 더워요. 에어컨을 켤까요?",
            "reason": "실내외 온도가 모두 높아 에어컨이 가장 확실한 냉방 방법입니다.",
            "show_popup": not is_auto,
            "popup_message": "자연풍을 기대하기 어렵습니다. 에어컨을 켜시겠습니까?",
            "is_auto_triggered": is_auto,
        }

    if indoor_temp < thresholds["indoor_cold"]:
        if window_open:
            return {
                "action": "CLOSE_WINDOW",
                "title": "실내 온기 보호 🚪" if not is_auto else "온기 보호를 위해 창문 폐쇄! 🚪",
                "summary": "실내가 쌀쌀해요. 창문을 닫을까요?",
                "reason": f"실내 온도가 {indoor_temp}도로 낮아 창문을 닫아주세요.",
                "show_popup": not is_auto,
                "popup_message": "실내가 쌀쌀합니다. 창문을 닫으시겠습니까?",
                "is_auto_triggered": is_auto,
            }

        if not window_state_known:
            return {
                "action": "CLOSE_WINDOW",
                "title": "창문 상태 확인 제안 🪟",
                "summary": "실내가 쌀쌀하지만 창문 센서가 연결되지 않았어요.",
                "reason": (
                    f"실내 온도가 {indoor_temp}도로 낮습니다. "
                    "창문이 열려 있다면 닫아주세요."
                ),
                "show_popup": False,
                "popup_message": None,
                "is_auto_triggered": False,
            }

        return {
            "action": "MAINTAIN",
            "title": "따뜻하고 아늑하게 유지 중 😌",
            "summary": "현재 창문이 닫혀 있어 온기를 유지하고 있어요.",
            "reason": "실내가 다소 쌀쌀하지만 창문이 닫혀 있습니다.",
            "show_popup": False,
            "popup_message": None,
            "is_auto_triggered": False,
        }

    window_note = (
        " 창문 상태는 센서 미연결로 확인할 수 없습니다."
        if not window_state_known
        else ""
    )
    return {
        "action": "ENJOY",
        "title": "쾌적함 100% 🍃",
        "summary": "현재 실내 환경이 쾌적해요.",
        "reason": (
            f"현재 실내 {indoor_temp}도, 습도 {indoor_humidity}%로 "
            f"추천 기준상 쾌적한 상태입니다.{window_note}"
        ),
        "show_popup": False,
        "popup_message": None,
        "is_auto_triggered": False,
    }
