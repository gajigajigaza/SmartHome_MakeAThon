# dudeoji-api/mqtt_handler.py
import paho.mqtt.client as mqtt
import json

BROKER_ADDRESS = "test.mosquitto.org" # 대회장에서는 내부 IP나 지정된 브로커 사용
TOPIC = "smarthome/dudeoji/sensor"

def on_connect(client, userdata, flags, rc):
    print(f"MQTT 브로커 연결 성공! (코드: {rc})")
    client.subscribe(TOPIC)

def on_message(client, userdata, msg):
    payload = msg.payload.decode('utf-8')
    print(f"[MQTT 수신] 토픽: {msg.topic}, 데이터: {payload}")
    
    # TODO: 수신한 payload(JSON)를 파싱해서 
    # FastAPI의 create_reading() 로직처럼 DB에 저장하는 코드 연결

def start_mqtt():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    
    client.connect(BROKER_ADDRESS, 1883, 60)
    client.loop_start() # 백그라운드에서 계속 메시지 수신 대기

if __name__ == "__main__":
    start_mqtt()