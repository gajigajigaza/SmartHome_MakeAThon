# dudeoji-api/mqtt_handler.py
"""라즈베리파이 게이트웨이의 MQTT 실내 센서값을 장소별로 저장합니다.

실외 온도·습도·풍속·미세먼지·날씨 상태는 MQTT 페이로드를 사용하지 않고,
readings_router.save_reading_for_user()가 장소 좌표의 날씨 API에서만 채웁니다.
"""
import asyncio
import inspect
import json
import os

# jh 수정함 - 공개 테스트 브로커(test.mosquitto.org) 기본값 제거. 인증 없이
# 아무나 같은 토픽에 publish할 수 있는 브로커라, 센서값 위조는 물론 기기
# 제어 토픽(CONTROL_TOPIC)까지 남이 명령을 보낼 수 있는 상태였음. 이제
# MQTT_BROKER_ADDRESS가 없으면 start_mqtt()가 리스너를 아예 시작하지 않음.
BROKER_ADDRESS = os.getenv("MQTT_BROKER_ADDRESS")
BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")
TOPIC = os.getenv("MQTT_TOPIC", "smarthome/dudeoji/sensor")
CONTROL_TOPIC = os.getenv(
    "MQTT_CONTROL_TOPIC",
    "smarthome/dudeoji/control",
)
_mqtt_client = None


def _resolve_user_id_for_place(supabase, place_id: int):
    result = (
        supabase.table("places")
        .select("user_id")
        .eq("id", place_id)
        .limit(1)
        .execute()
    )

    if not result.data:
        return None

    return result.data[0]["user_id"]


def handle_sensor_payload(supabase, payload: dict, save_reading_fn):
    """MQTT 페이로드에서 실내 센서값만 추출해 장소별 저장 함수를 호출합니다."""
    place_id = payload.get("place_id")

    if place_id is None:
        print("[MQTT] place_id가 없는 페이로드는 무시합니다:", payload)
        return

    user_id = _resolve_user_id_for_place(supabase, place_id)

    if user_id is None:
        print(f"[MQTT] place_id={place_id}에 해당하는 사용자를 찾지 못했습니다.")
        return

    # 실외값은 의도적으로 전달하지 않습니다. 서버가 선택 장소 좌표 기준
    # 기상·대기질 API를 성공적으로 조회해야만 하나의 reading이 저장됩니다.
    sensor_data = {
        "indoor_temperature": payload.get("indoor_temperature"),
        "indoor_humidity": payload.get("indoor_humidity"),
        # 키가 없으면 None을 유지해 '닫힘'으로 오판하지 않습니다.
        "window_is_open": payload.get("window_is_open"),
        "ac_is_on": payload.get("ac_is_on"),
        "current_mode": payload.get("current_mode", "MANUAL"),
    }

    save_result = save_reading_fn(
        user_id,
        sensor_data,
        place_id=place_id,
        reading_source="SENSOR",
    )

    if inspect.isawaitable(save_result):
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            asyncio.run(save_result)
        else:
            running_loop.create_task(save_result)



def publish_device_command(place_id: int, action: str) -> dict:
    # ESP32가 구독하는 MQTT 제어 토픽으로 명령을 발행합니다.
    allowed_actions = {
        "OPEN_WINDOW",
        "CLOSE_WINDOW",
        "TURN_ON_AIRCON",
        "TURN_OFF_AIRCON",
    }

    if action not in allowed_actions:
        raise ValueError("지원하지 않는 기기 제어 명령입니다.")

    client = _mqtt_client
    if client is None or not client.is_connected():
        raise RuntimeError(
            "MQTT가 연결되어 있지 않습니다. "
            "MQTT_ENABLED=true와 브로커 연결 상태를 확인해 주세요."
        )

    payload = {
        "place_id": int(place_id),
        "action": action,
    }

    publish_result = client.publish(
        CONTROL_TOPIC,
        json.dumps(payload, ensure_ascii=False),
        qos=1,
        retain=False,
    )

    if publish_result.rc != 0:
        raise RuntimeError(
            f"MQTT 명령 발행에 실패했습니다. 오류 코드: {publish_result.rc}"
        )

    return {
        "accepted": True,
        "topic": CONTROL_TOPIC,
        "place_id": int(place_id),
        "action": action,
    }

def start_mqtt(supabase, save_reading_fn):
    global _mqtt_client
    """MQTT 브로커에 연결하고 백그라운드에서 센서값을 수신합니다."""
    # jh 수정함 - MQTT_BROKER_ADDRESS 없이는 리스너를 시작하지 않음
    # (예전엔 test.mosquitto.org 공개 브로커로 조용히 연결됐음).
    if not BROKER_ADDRESS:
        print(
            "[MQTT] MQTT_BROKER_ADDRESS 환경변수가 설정되어 있지 않아 "
            "MQTT 리스너를 시작하지 않습니다. 현장 브로커 주소를 .env에 "
            "설정한 뒤 다시 시작해 주세요."
        )
        return None

    import paho.mqtt.client as mqtt

    def on_connect(client, userdata, flags, rc):
        print(f"[MQTT] 브로커 연결 성공 (코드: {rc}), 토픽 구독: {TOPIC}")
        client.subscribe(TOPIC)

    def on_message(client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            print(f"[MQTT] 페이로드 파싱 실패: {error}")
            return

        print(f"[MQTT 수신] 토픽: {msg.topic}, 데이터: {payload}")

        try:
            handle_sensor_payload(supabase, payload, save_reading_fn)
        except Exception as error:
            print(f"[MQTT] 저장 중 오류: {error}")

    client = mqtt.Client()
    # jh 수정함 - USERNAME/PASSWORD 둘 다 있을 때만 인증 설정(사설 브로커가
    # 인증 없이 운영되는 경우도 허용하기 위해 선택 사항으로 둠).
    if MQTT_USERNAME and MQTT_PASSWORD:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(BROKER_ADDRESS, BROKER_PORT, 60)
    client.loop_start()
    _mqtt_client = client
    return client
