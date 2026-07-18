# dudeoji-api/mqtt_handler.py
"""라즈베리파이 게이트웨이의 MQTT 실내 센서값을 장소별로 저장합니다.

실외 온도·습도·풍속·미세먼지·날씨 상태는 MQTT 페이로드를 사용하지 않고,
readings_router.save_reading_for_user()가 장소 좌표의 날씨 API에서만 채웁니다.
"""
import asyncio
import inspect
import json
import os

BROKER_ADDRESS = os.getenv("MQTT_BROKER_ADDRESS", "test.mosquitto.org")
BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))
TOPIC = os.getenv("MQTT_TOPIC", "smarthome/dudeoji/sensor")


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


def start_mqtt(supabase, save_reading_fn):
    """MQTT 브로커에 연결하고 백그라운드에서 센서값을 수신합니다."""
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
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(BROKER_ADDRESS, BROKER_PORT, 60)
    client.loop_start()
    return client
