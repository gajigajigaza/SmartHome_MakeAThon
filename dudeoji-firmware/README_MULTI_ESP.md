# 두더지 2-ESP BLE 펌웨어

기존 `dudeoji_xiao/dudeoji_xiao.ino`는 1-ESP 동작 버전으로 그대로
보존합니다. 새 구성은 센싱과 제어를 두 XIAO로 분리하고, 두 장치가 하나의
Raspberry Pi 게이트웨이에 각각 BLE로 연결되는 구조입니다.

```text
ESP-SENSE
├─ XIAO ESP32S3 Sense 내장 카메라
└─ BME280

ESP-CONTROL
├─ 리드 스위치
├─ 서보
├─ 릴레이
├─ INA219
└─ 팬

두 ESP → BLE → Raspberry Pi 게이트웨이 하나 → Render
```

두 장치는 같은 GATT UUID를 사용하고 BLE 광고 이름과 `device_id`로
구분합니다.

| 역할 | 스케치 | BLE 이름 | `device_id` |
|---|---|---|---|
| 환경·카메라 | `dudeoji_sense/dudeoji_sense.ino` | `DUDEOJI-SENSE` | `sense-01` |
| 창문·팬 제어 | `dudeoji_control/dudeoji_control.ino` | `DUDEOJI-CONTROL` | `control-01` |

## 공통 BLE UUID

`dudeoji-gateway/protocol.py`의 기존 값을 그대로 사용합니다.

| 항목 | UUID | 사용 |
|---|---|---|
| Service | `7d2ea28a-f7bd-485a-bd9d-92ad6ecfe93e` | 두 ESP 공통 서비스 |
| Sensor | `7d2ea28b-f7bd-485a-bd9d-92ad6ecfe93e` | 환경/제어 상태 Read + Notify |
| Control | `7d2ea28c-f7bd-485a-bd9d-92ad6ecfe93e` | CONTROL 명령 Write |
| Result | `7d2ea28d-f7bd-485a-bd9d-92ad6ecfe93e` | CONTROL 명령 결과 Notify |

JSON Notification이 기본 BLE ATT 크기를 넘을 수 있으므로 두 스케치 모두
MTU 247을 요청합니다. 게이트웨이도 연결 후 해당 characteristic을
Notification 구독해야 합니다.

## ESP-SENSE

### 핀 배치

| 부품 | XIAO/ESP32-S3 핀 |
|---|---|
| BME280 SDA | D4 / GPIO5 |
| BME280 SCL | D5 / GPIO6 |
| 카메라 XCLK | GPIO10 |
| 카메라 SIOD / SIOC | GPIO40 / GPIO39 |
| 카메라 Y2–Y9 | GPIO15, 17, 18, 16, 14, 12, 11, 48 |
| 카메라 VSYNC / HREF / PCLK | GPIO38 / GPIO47 / GPIO13 |

BME280은 부팅할 때 `0x76`, `0x77` 순서로 탐색합니다. 둘 다 실패하면
`bme_ok=false`, `temperature=null`, `humidity=null`을 전송하지만
카메라와 BLE는 계속 동작합니다.

카메라는 부팅할 때 초기화한 뒤 QVGA JPEG 시험 프레임 한 장을 획득하고 즉시
반환합니다. 프레임을 BLE 또는 microSD로 전송·저장하지 않습니다. 사람 감지
모델이 아직 없으므로 `person_detected`는 추정값 `false`가 아니라 `null`입니다.

5초 주기 메시지:

```json
{
  "type": "environment",
  "device_id": "sense-01",
  "temperature": 25.3,
  "humidity": 48.2,
  "bme_ok": true,
  "camera_ready": true,
  "person_detected": null
}
```

### 카메라와 microSD 주의

이 스케치는 microSD를 초기화하지 않습니다. XIAO ESP32S3 Sense 확장 보드의
일반적인 microSD SPI 배선은 GPIO7(D8/SCK), GPIO8(D9/MISO),
GPIO9(D10/MOSI), GPIO21(CS)을 사용합니다. 위 카메라 신호 핀과 직접
겹치지는 않지만, microSD를 추가하면 D8–D10과 GPIO21을 다른 주변장치가
동시에 사용하면 안 됩니다.

확장 보드 리비전이나 사용하는 microSD 예제에 따라 핀 정의가 달라질 수
있으므로 카메라와 microSD를 동시에 활성화하기 전에 실제 보드 회로와 예제의
`SD_CS`, `SCK`, `MISO`, `MOSI`를 다시 확인해야 합니다. 또한 카메라 프레임
버퍼와 SD 쓰기를 동시에 사용하면 PSRAM·전원·버스 부하가 커질 수 있습니다.

## ESP-CONTROL

### 핀 배치

| 부품 | XIAO 핀 | 설정 |
|---|---|---|
| 서보 신호 | D0 | 50Hz, 500–2400µs |
| 릴레이 IN / 팬 | D1 | 기본 LOW 트리거 |
| 리드 스위치 | D2–GND | `INPUT_PULLUP` |
| INA219 SDA | D4 | I2C |
| INA219 SCL | D5 | I2C |
| 수동 팬 버튼 | D8–GND | 선택 설치, `INPUT_PULLUP` |

팬과 서보의 부하 전류를 XIAO 3.3V 핀에서 공급하면 안 됩니다. 장치 규격에
맞는 외부 전원을 사용하고 XIAO·서보·릴레이/팬·INA219의 GND를 공통으로
연결합니다. INA219는 팬 전원 경로에 직렬로 배치합니다.

INA219 초기화가 실패해도 리드 스위치, 서보, 릴레이/팬, 수동 버튼, BLE 명령은
계속 동작합니다. 이 경우 `ina_available=false`이고 세 측정값은 `null`입니다.

5초 주기 상태:

```json
{
  "type": "control_state",
  "device_id": "control-01",
  "window_open": false,
  "fan_on": true,
  "ina_available": true,
  "bus_voltage": 5.02,
  "current_ma": 310.0,
  "power_watt": 1.56
}
```

지원 명령은 `OPEN_WINDOW`, `CLOSE_WINDOW`, `TURN_ON_AIRCON`,
`TURN_OFF_AIRCON`입니다. 모든 명령은 받은 `command_id`를 그대로 포함한
결과를 Result characteristic으로 Notification합니다.

```json
{
  "type": "result",
  "device_id": "control-01",
  "command_id": "example-command-id",
  "action": "OPEN_WINDOW",
  "success": true,
  "detail": "servo_open_commanded"
}
```

## Arduino 환경과 라이브러리

보드 코어:

```powershell
arduino-cli core install esp32:esp32
```

필요 라이브러리:

```powershell
arduino-cli lib install "Adafruit BME280 Library"
arduino-cli lib install "Adafruit Unified Sensor"
arduino-cli lib install "Adafruit INA219"
arduino-cli lib install "Adafruit BusIO"
arduino-cli lib install "ArduinoJson"
arduino-cli lib install "ESP32Servo"
```

BLE와 `esp_camera.h`는 `esp32:esp32` 보드 코어에 포함되어 있습니다.

## 컴파일

저장소 루트에서 각각 실행합니다.

```powershell
arduino-cli compile `
  --fqbn esp32:esp32:XIAO_ESP32S3 `
  "dudeoji-firmware\dudeoji_sense"

arduino-cli compile `
  --fqbn esp32:esp32:XIAO_ESP32S3 `
  "dudeoji-firmware\dudeoji_control"
```
