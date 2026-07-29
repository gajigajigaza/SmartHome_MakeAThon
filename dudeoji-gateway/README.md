# 두더지 다중 BLE ↔ WebSocket 게이트웨이

Windows 또는 Raspberry Pi 한 대가 두 ESP의 BLE 연결을 독립적으로
관리하면서 Render FastAPI에는 WebSocket 하나만 유지합니다.

```text
ESP-SENSE (DUDEOJI-SENSE, sense-01)
  ├─ XIAO ESP32S3 Sense 내장 카메라
  └─ BME280
            ↘ BLE
              Raspberry Pi 또는 Windows 게이트웨이
            ↗ BLE                  ↕ WebSocket 1개
ESP-CONTROL (DUDEOJI-CONTROL, control-01)          Render
  ├─ 리드 스위치
  ├─ 서보
  ├─ 릴레이
  ├─ INA219
  └─ 팬
```

두 BLE 장치는 별도 asyncio 작업으로 검색·연결·재연결됩니다. 한 장치가
끊겨도 다른 장치와 Render WebSocket 연결은 유지됩니다.

## 2-ESP 설정

`.env`에 두 이름을 모두 설정하면 2-ESP 모드가 활성화됩니다.

```dotenv
DUDEOJI_WEBSOCKET_URL=wss://dudeoji-makerthon.onrender.com/ws/sensors
DUDEOJI_PLACE_ID=54
DUDEOJI_AUTH_TOKEN=실제_로그인_토큰

DUDEOJI_SENSE_BLE_NAME=DUDEOJI-SENSE
DUDEOJI_CONTROL_BLE_NAME=DUDEOJI-CONTROL
DUDEOJI_BLE_STATE_STALE_SECONDS=30
```

두 이름 중 하나만 설정하면 구성 오류로 종료합니다. 같은 이름도 허용하지
않습니다. 실제 토큰은 `.env`에만 저장하고 GitHub, 로그, 채팅, 화면 공유에
노출하지 않습니다.

`DUDEOJI_BLE_STATE_STALE_SECONDS`보다 오래된 장치 상태는 다른 장치의
새 데이터와 합치지 않습니다.

## 1-ESP 하위 호환

새 이름 두 개를 모두 설정하지 않으면 기존 이름을 사용합니다.

```dotenv
DUDEOJI_BLE_DEVICE_NAME=DUDEOJI-XIAO
```

기존 `sensor` BLE 메시지, BME 시연값, 명령·결과 왕복과 sensorless 라이브
테스트는 그대로 유지됩니다. `DUDEOJI_BLE_DEVICE_NAME`은 아직 제거하지
않습니다.

## BLE 입력

ESP-SENSE:

```json
{
  "type": "environment",
  "device_id": "sense-01",
  "temperature": 25.2,
  "humidity": 48.5,
  "bme_ok": true,
  "camera_ready": true,
  "person_detected": false
}
```

ESP-CONTROL:

```json
{
  "type": "control_state",
  "device_id": "control-01",
  "window_open": false,
  "fan_on": true,
  "ina_available": true,
  "bus_voltage": 12.0,
  "current_ma": 500.0,
  "power_watt": 6.0
}
```

ESP-SENSE는 센서 Notification만 구독합니다. ESP-CONTROL은 상태와 명령
결과 Notification을 구독하고 제어 명령 Write를 받습니다. 두 장치가 같은
Service UUID를 사용하므로 2-ESP 모드 검색은 광고 이름이 정확히 일치하는
장치만 선택합니다.

## Render 데이터 통합

Sense와 Control의 최신 상태가 모두 연결 상태이고 stale이 아니며 BME 값이
유효할 때 다음 `sensor_reading`을 전송합니다.

```json
{
  "type": "sensor_reading",
  "data": {
    "indoor_temperature": 25.2,
    "indoor_humidity": 48.5,
    "window_is_open": false,
    "ac_is_on": true,
    "power_watt": 6.0,
    "person_detected": false
  }
}
```

Control 상태가 들어오면 BME 유무와 관계없이 `device_state`를 즉시
전송합니다.

```json
{
  "type": "device_state",
  "data": {
    "window_is_open": false,
    "ac_is_on": true,
    "bme_available": false
  }
}
```

BME가 없거나 Sense 캐시가 stale이면 `sensor_reading`은 만들지 않지만,
Control의 `device_state`는 계속 전송합니다. 서버가 잠시 끊겼을 때 대기열은
메시지 type만 보지 않고 장치 ID와 데이터 종류별 최신값을 보존합니다.
`command_result`는 최신값 정리 대상에서 제외됩니다.

## 명령 라우팅

다음 네 명령은 전부 `control-01`로만 전송됩니다.

- `OPEN_WINDOW`
- `CLOSE_WINDOW`
- `TURN_ON_AIRCON`
- `TURN_OFF_AIRCON`

Sense에는 제어 Write를 하지 않습니다. Control BLE가 끊겼으면 동일한
`command_id`를 가진 실패 `command_result`를 Render에 돌려줍니다.

## Windows 설치와 실행

```powershell
cd C:\Users\rrkdf\makerthon\dudeoji-gateway
.\install_gateway.cmd
.\.venv\Scripts\python.exe .\check_gateway_env.py
.\run_gateway.cmd
```

정상 2-ESP 시작 로그의 핵심:

```text
BLE_MODE = 2-ESP
FastAPI WebSocket 인증 완료
BLE 연결 완료: device_id=sense-01
BLE 연결 완료: device_id=control-01
```

자세한 실기 순서는 `WINDOWS_LIVE_TEST.md`를 따릅니다.

## Raspberry Pi

```bash
cd ~/makerthon/dudeoji-gateway
bash install_gateway_linux.sh
nano .env
bash run_gateway_linux.sh
```

전면 실행으로 두 ESP와 명령 왕복을 확인한 뒤에만 systemd 서비스를
설치합니다.

```bash
bash raspberry_pi/install_service.sh
sudo journalctl -u dudeoji-gateway.service -f
```

상세 내용은 `raspberry_pi/README.md`를 확인합니다.

## 테스트

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

실물 없이 가능한 테스트는 프로토콜 변환, 독립 연결 상태, Control 전용
명령, 캐시 통합·stale, 대기열 병합과 1-ESP 하위 호환입니다. BLE 광고,
실제 GATT Notification/Write, Raspberry Pi Bluetooth와 장시간 재연결은
실물에서 별도로 확인해야 합니다.

기존 1-ESP sensorless Render ↔ 웹 검사는 다음과 같습니다.

```powershell
.\run_sensorless_live_test.cmd
```
