# dudeoji-api/mqtt_handler.py
"""라즈베리파이 게이트웨이가 MQTT로 보내는 센서 데이터를 수신하는 모듈.

minzoo 브랜치의 mqtt_handler.py를 옮겨오면서, 실제 저장까지 연결했습니다.
단, ryeun 스키마는 센서 기록에 user_id가 필요합니다(사용자별 데이터 분리).
지금은 place_id -> user_id 매핑이 아직 없으므로(= '위치 추가' 기능,
담당: 나), 페이로드에 place_id를 함께 보내도록 임시로 정해두었습니다.
위치 기능이 붙으면 아래 TODO만 교체하면 됩니다.

기본적으로 비활성화되어 있습니다. 실제 브로커/하드웨어가 준비되면
환경변수 MQTT_ENABLED=true 로 켜세요.
"""
import json
import os

BROKER_ADDRESS = os.getenv("MQTT_BROKER_ADDRESS", "test.mosquitto.org")
BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))
TOPIC = os.getenv("MQTT_TOPIC", "smarthome/dudeoji/sensor")


def _resolve_user_id_for_place(supabase, place_id: int):
    """place_id로 해당 장소를 등록한 user_id를 찾는다.

    TODO(나 - 위치 추가 기능): 장치(device)를 place에 직접 매핑하는
    테이블이 생기면 place_id 대신 device_token으로 조회하도록 변경.
    """
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
    """MQTT로 들어온 페이로드 1건을 검증하고 DB 저장 함수를 호출한다.

    save_reading_fn(user_id, sensor_data_dict) 형태의 콜백을 받는다.
    main.py 쪽에서 create_reading과 같은 로직을 재사용하도록 주입한다.
    """
    place_id = payload.get("place_id")

    if place_id is None:
        print("[MQTT] place_id가 없는 페이로드는 무시합니다:", payload)
        return

    user_id = _resolve_user_id_for_place(supabase, place_id)

    if user_id is None:
        print(f"[MQTT] place_id={place_id}에 해당하는 사용자를 찾지 못했습니다.")
        return

    sensor_data = {
        "indoor_temperature": payload.get("indoor_temperature"),
        "indoor_humidity": payload.get("indoor_humidity"),
        "outdoor_temperature": payload.get("outdoor_temperature"),
        "outdoor_humidity": payload.get("outdoor_humidity"),
        "weather_condition": payload.get("weather_condition", "맑음"),
        "pm25": payload.get("pm25"),
        "wind_speed": payload.get("wind_speed"),
    }

    save_reading_fn(user_id, sensor_data)


def start_mqtt(supabase, save_reading_fn):
    """MQTT 브로커에 연결하고 백그라운드에서 메시지를 계속 수신한다."""
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
        except Exception as error:  # 게이트웨이 연결이 서버 전체를 죽이면 안 됨
            print(f"[MQTT] 저장 중 오류: {error}")

    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(BROKER_ADDRESS, BROKER_PORT, 60)
    client.loop_start()

    return client
