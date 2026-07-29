# Windows 2-ESP 실기 점검표

현재 노트북이 Raspberry Pi 역할을 대신합니다. 실제 토큰은 명령 출력,
로그, 화면 공유에 표시하지 않습니다.

## 1. 설정 검사

`.env`에 장소와 두 BLE 이름을 설정합니다.

```dotenv
DUDEOJI_PLACE_ID=54
DUDEOJI_SENSE_BLE_NAME=DUDEOJI-SENSE
DUDEOJI_CONTROL_BLE_NAME=DUDEOJI-CONTROL
DUDEOJI_BLE_STATE_STALE_SECONDS=30
```

검사:

```powershell
cd C:\Users\rrkdf\makerthon\dudeoji-gateway
.\.venv\Scripts\python.exe .\check_gateway_env.py
```

정상 출력:

```text
PLACE_ID = 54
TOKEN_CONFIGURED = True
BLE_MODE = 2-ESP
SENSE_BLE_NAME = DUDEOJI-SENSE
CONTROL_BLE_NAME = DUDEOJI-CONTROL
GATEWAY_ENV_CHECK_OK
```

검사기는 토큰 원문과 토큰 길이를 출력하지 않습니다.

## 2. 두 ESP 연결

```powershell
.\run_gateway.cmd
```

정상 시작 기준:

```text
FastAPI WebSocket 인증 완료
BLE 연결 완료: device_id=sense-01 name=DUDEOJI-SENSE
BLE 연결 완료: device_id=control-01 name=DUDEOJI-CONTROL
```

Windows의 `USB JTAG/serial debug unit`은 USB 시리얼 장치이지 BLE 연결
표시가 아닙니다. Windows 설정에서 수동 페어링할 필요는 없습니다.

## 3. Sense 데이터

ESP-SENSE에서 다음을 확인합니다.

- BME280가 있으면 온도·습도가 `sensor_reading`에 포함됨
- 카메라 초기화 상태가 `camera_ready`로 수신됨
- 사람 감지 결과가 `person_detected`로 수신됨
- BME280가 없으면 `sensor_reading`을 만들지 않음

2-ESP 모드에서는 `DUDEOJI_DEMO_FALLBACK_BME`를 사용하지 않습니다.

## 4. Control 데이터와 명령

리드 스위치와 팬 상태를 바꿨을 때 다음 로그가 나와야 합니다.

```text
Control 상태 수신: window_open=... fan_on=... ina_available=...
```

웹에서 창문과 에어컨 버튼을 각각 눌러 같은 `command_id`로 다음 세 로그가
이어지는지 확인합니다.

```text
BLE 제어 명령 전달: device_id=control-01
Control BLE 명령 결과 수신
명령 결과 WebSocket 전달 완료
```

명령은 ESP-CONTROL에만 전달되어야 하며 ESP-SENSE에는 GATT Write가
발생하지 않아야 합니다.

## 5. 독립 재연결

게이트웨이와 Render 연결을 유지한 채 ESP-SENSE 전원만 끕니다.

- `sense_connected=False`
- `control_connected=True`
- Control 상태와 웹 명령이 계속 동작
- `device_state.bme_available=false`

Sense를 다시 켜면 `sense-01`만 검색·재연결되어야 합니다.

그다음 ESP-CONTROL 전원만 끕니다.

- `sense_connected=True`
- `control_connected=False`
- Sense BLE와 Render WebSocket은 유지
- 웹 명령은 `control_ble_not_connected` 실패 결과를 받음

Control을 다시 켜면 `control-01`만 재연결되어야 합니다. 인터넷을 잠깐
끊었다 복구했을 때도 두 BLE 작업과 독립적으로 WebSocket이 재인증되어야
합니다.

## 6. stale 확인

한 ESP의 Notification을
`DUDEOJI_BLE_STATE_STALE_SECONDS`보다 오래 멈춥니다. 오래된 Sense와 새
Control 또는 오래된 Control과 새 Sense를 합친 `sensor_reading`이 새로
생기지 않아야 합니다.

## 7. 1-ESP 하위 호환

별도 하위 호환 점검이 필요할 때 새 BLE 이름 두 개를 모두 제거하고 다음만
사용합니다.

```dotenv
DUDEOJI_BLE_DEVICE_NAME=DUDEOJI-XIAO
```

기존 통합 `sensor` Notification과 다음 검사가 계속 통과해야 합니다.

```powershell
.\run_sensorless_live_test.cmd
```

## 8. 실물에서 별도로 남는 항목

- 같은 Service UUID를 광고하는 두 ESP가 이름으로 정확히 구분되는지
- XIAO ESP32S3 Sense 내장 카메라 초기화와 사람 감지 주기
- BME280 실제 온도·습도
- 리드 스위치 자석 방향과 열림/닫힘 극성
- SG90 각도와 외부 5V 전원
- 릴레이 active-low/active-high 극성
- INA219 전압·전류·전력 단위와 실제 부하
- 팬 전원과 장시간 운전
- Raspberry Pi에서 동시 BLE 연결, systemd, 전원 복구
