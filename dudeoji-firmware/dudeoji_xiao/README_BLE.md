# XIAO ESP32S3 BLE 펌웨어

이 펌웨어는 XIAO의 Wi-Fi를 사용하지 않습니다.

## 핀

| 부품 | XIAO 핀 |
|---|---|
| SG90 신호 | D0 |
| 릴레이 IN | D1 |
| 리드 스위치 | D2–GND |
| BME280 SDA | D4 |
| BME280 SCL | D5 |
| 수동 팬 버튼 | D8–GND |

BME280는 `3V3`, 서보와 릴레이는 장치 규격에 맞는 `5V` 전원을 사용하고
모든 전원의 GND를 공통으로 연결합니다. 서보와 팬의 부하 전류를 XIAO의
3.3V 핀에서 공급하면 안 됩니다.

## BLE 규격

| 항목 | UUID | 방식 |
|---|---|---|
| Service | `7d2ea28a-f7bd-485a-bd9d-92ad6ecfe93e` | GATT Service |
| Sensor | `7d2ea28b-f7bd-485a-bd9d-92ad6ecfe93e` | Read + Notify |
| Control | `7d2ea28c-f7bd-485a-bd9d-92ad6ecfe93e` | Write |
| Result | `7d2ea28d-f7bd-485a-bd9d-92ad6ecfe93e` | Notify |

## Arduino 라이브러리

```powershell
arduino-cli lib install "Adafruit BME280 Library"
arduino-cli lib install "Adafruit Unified Sensor"
arduino-cli lib install "ArduinoJson"
arduino-cli lib install "ESP32Servo"
```

BLE 헤더는 `esp32:esp32` 보드 코어에 포함되어 있습니다.

## 컴파일

프로젝트 루트에서:

```powershell
arduino-cli compile `
  --fqbn esp32:esp32:XIAO_ESP32S3 `
  "dudeoji-firmware\dudeoji_xiao"
```

## BME280가 아직 인식되지 않을 때

펌웨어는 `bme_ok=false`와 함께 리드 스위치·릴레이 상태를 계속
Notification합니다. 새 게이트웨이와 FastAPI는 이 상태를 온습도와
분리하므로 BLE와 기기 제어가 중단되지 않습니다.

온습도 저장 경로까지 임시 시험할 때는 펌웨어를 다시 올리지 말고
`dudeoji-gateway/.env`에서 다음 옵션을 사용합니다.

```dotenv
DUDEOJI_DEMO_FALLBACK_BME=true
DUDEOJI_DEMO_TEMPERATURE=25.0
DUDEOJI_DEMO_HUMIDITY=50.0
```

시험 후 반드시 `DUDEOJI_DEMO_FALLBACK_BME=false`로 되돌립니다.
펌웨어의 `DEMO_USE_FAKE_BME`는 `false`로 유지합니다.

## 정상 시리얼 로그

부팅:

```text
두더지 XIAO BLE 펌웨어 시작
[BLE] Advertising 시작: DUDEOJI-XIAO
```

게이트웨이 연결과 명령:

```text
[BLE] 게이트웨이 연결됨
[BLE RX] command_id=..., action=OPEN_WINDOW
[BLE TX] {"type":"result",...}
```

USB 장치가 Windows에 보이는 것만으로 BLE가 연결된 것은 아닙니다. 실제
BLE 연결은 XIAO의 `[BLE] 게이트웨이 연결됨`과 게이트웨이의
`XIAO BLE 연결 완료` 로그를 함께 확인합니다.
