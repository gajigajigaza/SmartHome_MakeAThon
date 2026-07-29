# 두더지 BLE ↔ WebSocket 게이트웨이

이 프로그램은 XIAO ESP32S3와 Render FastAPI 사이를 연결합니다.

```text
센서·서보·릴레이
  ↕ GPIO / I2C
XIAO ESP32S3
  ↕ BLE
Windows 노트북 또는 Raspberry Pi
  ↕ 인터넷 WebSocket
Render FastAPI
  ↕ WebSocket
두더지 React 웹
```

XIAO는 Wi-Fi를 사용하지 않습니다. 게이트웨이 장치에는 Render 접속을
위한 인터넷이 필요하므로 Wi-Fi를 쓰지 않을 경우 유선 LAN 또는 USB
테더링을 사용합니다.

## 구현된 통신

| 방향 | 내용 |
|---|---|
| XIAO → 게이트웨이 | 온습도, 리드 스위치, 릴레이 상태 BLE Notification |
| 게이트웨이 → FastAPI | `sensor_reading`, `device_state`, `command_result` |
| 웹 → FastAPI → 게이트웨이 | 창문·에어컨 제어 명령 |
| 게이트웨이 → XIAO | BLE Write |
| XIAO → 게이트웨이 → FastAPI → 웹 요청 | 동일 `command_id` 결과 확인 |

BLE와 WebSocket은 각각 자동 재연결합니다. 서버가 잠시 끊기면 주기
센서값과 기기 상태는 종류별 최신 1건만 남기고, 명령 결과는 제거하지
않습니다.

## BME280가 없을 때

BME280가 없어도 다음은 계속 동작합니다.

- XIAO ↔ 게이트웨이 BLE 연결
- 리드 스위치와 릴레이 상태
- 창문·에어컨 명령
- XIAO 명령 결과

온도·습도 DB 기록만 만들지 않습니다. 새 FastAPI와 웹이 배포되면
`device_state` 메시지로 창문·에어컨 상태를 별도로 표시합니다.

## Windows 설치

PowerShell:

```powershell
cd C:\Users\rrkdf\makerthon\dudeoji-gateway
.\install_gateway.cmd
```

직접 PowerShell 스크립트를 실행하려면:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_gateway.ps1
```

생성된 `.env`에서 실제 값을 설정합니다.

```dotenv
DUDEOJI_PLACE_ID=54
DUDEOJI_AUTH_TOKEN=실제_로그인_토큰
```

`.env`와 토큰은 GitHub, 채팅, 화면 공유에 올리지 않습니다.

## 설정 확인과 실행

```powershell
.\.venv\Scripts\python.exe .\check_gateway_env.py
.\run_gateway.cmd
```

`run_gateway.cmd`는 PowerShell 실행 정책의 영향을 받지 않습니다.

정상 연결 핵심 로그:

```text
GATEWAY_ENV_CHECK_OK
FastAPI WebSocket 인증 완료
XIAO BLE 연결 완료
BLE 센서 상태 수신
```

웹에서 제어 버튼을 누른 뒤 다음 세 로그가 같은 `command_id`로 나와야
완전한 왕복입니다.

```text
BLE 제어 명령 전달
XIAO BLE 명령 결과 수신
명령 결과 WebSocket 전달 완료
```

상세 실기 순서는 `WINDOWS_LIVE_TEST.md`를 따릅니다.

## BME 저장 경로의 임시 시연

BME280 없이 온습도 저장·웹 표시 경로를 확인할 때만 `.env`에서:

```dotenv
DUDEOJI_DEMO_FALLBACK_BME=true
DUDEOJI_DEMO_TEMPERATURE=25.0
DUDEOJI_DEMO_HUMIDITY=50.0
```

게이트웨이를 재시작하면 펌웨어 재업로드 없이 시연할 수 있습니다. 이 값은
실제 센서값이 아니므로 시험 후 반드시
`DUDEOJI_DEMO_FALLBACK_BME=false`로 되돌립니다.

## 현재 Render와 새 코드의 차이

게이트웨이는 현재 배포된 구버전 서버와도 연결됩니다. 구버전 인증 응답에
`capabilities`가 없으면 `sensor_reading`과 `command_result`만 사용합니다.

이 수정본의 FastAPI가 배포되면 인증 로그에 다음이 표시됩니다.

```text
capabilities=command_result,device_state,sensor_reading
```

`device_state`와 HTTP 제어 요청의 XIAO 결과 대기는 백엔드·웹 배포 후
활성화됩니다. 로컬 파일 적용만으로 이미 실행 중인 Render가 바뀌지는
않습니다.

## Raspberry Pi

Pi 준비 파일은 `raspberry_pi/README.md`에 있습니다.

```bash
bash install_gateway_linux.sh
bash run_gateway_linux.sh
```

실기 왕복을 먼저 확인한 뒤 `raspberry_pi/install_service.sh`로 부팅 자동
실행을 등록합니다.

## 메시지 예

XIAO BLE:

```json
{
  "type": "sensor",
  "temperature": null,
  "humidity": null,
  "window_open": false,
  "fan_on": true,
  "bme_ok": false
}
```

BME와 독립적인 FastAPI WebSocket 상태:

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

현재 백엔드 계약에서 `ac_is_on`은 시연용 팬 릴레이 상태입니다.

## 실물 센서 없이 Render ↔ 웹 확인

XIAO나 BME280을 연결하지 않고도 센서 역할 WebSocket 인증과
`device_state`의 웹 전달을 한 번에 확인할 수 있습니다.

```powershell
.\run_sensorless_live_test.cmd
```

정상 결과:

```text
WEB_WEBSOCKET_OK role=web place_id=54
RENDER_SENSOR_WEBSOCKET_OK role=sensor place_id=54 capability=device_state
WEB_DEVICE_STATE_OK ... gateway_connected=true
SENSORLESS_LIVE_TEST_OK db_sensor_reading_created=false
```

이 검사는 가상 `device_state`만 전송하므로 DB 온습도 기록을 생성하지
않습니다. 센서 역할 연결은 사용자당 하나이므로, 실행 중인 실제
게이트웨이 연결이 있다면 검사 중 잠시 교체될 수 있습니다. 일반
게이트웨이는 연결이 끊기면 자동으로 재접속합니다.
