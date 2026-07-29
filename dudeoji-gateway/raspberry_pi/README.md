# Raspberry Pi 2-ESP 게이트웨이 이전 안내

Raspberry Pi 한 대가 ESP-SENSE와 ESP-CONTROL에 동시에 BLE로 연결되고,
Render에는 WebSocket 하나만 유지합니다. XIAO 두 대는 Wi-Fi를 사용하지
않습니다. Pi에는 유선 LAN, Wi-Fi 또는 USB 테더링 중 하나가 필요합니다.

## 1. 사전 준비

Raspberry Pi OS:

```bash
sudo apt update
sudo apt install -y python3-venv bluez bluetooth
sudo rfkill unblock bluetooth
bluetoothctl show
```

Python 3.10 이상과 동시 BLE 연결이 가능한 Pi Bluetooth 어댑터가
필요합니다.

## 2. 설치와 설정

```bash
cd ~/makerthon/dudeoji-gateway
bash install_gateway_linux.sh
nano .env
```

```dotenv
DUDEOJI_PLACE_ID=54
DUDEOJI_AUTH_TOKEN=실제_토큰
DUDEOJI_SENSE_BLE_NAME=DUDEOJI-SENSE
DUDEOJI_CONTROL_BLE_NAME=DUDEOJI-CONTROL
DUDEOJI_BLE_STATE_STALE_SECONDS=30
```

토큰은 로그, 화면 공유, GitHub에 노출하지 않습니다.

## 3. 전면 실행 검증

같은 ESP에 연결 중인 Windows 게이트웨이가 있다면 먼저 종료합니다.

```bash
bash run_gateway_linux.sh
```

정상 로그:

```text
GATEWAY_ENV_CHECK_OK
FastAPI WebSocket 인증 완료
BLE 연결 완료: device_id=sense-01 name=DUDEOJI-SENSE
BLE 연결 완료: device_id=control-01 name=DUDEOJI-CONTROL
```

웹에서 창문 또는 에어컨 버튼을 눌러 Control 왕복도 확인합니다.

```text
BLE 제어 명령 전달: device_id=control-01
Control BLE 명령 결과 수신
명령 결과 WebSocket 전달 완료
```

## 4. 독립 장애 검증

1. ESP-SENSE만 끄고 Control 상태·웹 명령·Render 연결이 유지되는지 확인
2. Sense를 켜고 `sense-01`만 자동 재연결되는지 확인
3. ESP-CONTROL만 끄고 Sense·Render 연결이 유지되는지 확인
4. 이때 웹 명령이 `control_ble_not_connected`로 실패하는지 확인
5. Control을 켜고 `control-01`만 자동 재연결되는지 확인

한 장치의 연결 실패가 다른 BLE 작업이나 WebSocket 작업을 종료시키면
안 됩니다.

## 5. systemd 자동 실행

전면 실행과 독립 장애 검증이 끝난 뒤:

```bash
bash raspberry_pi/install_service.sh
sudo systemctl status dudeoji-gateway.service
sudo journalctl -u dudeoji-gateway.service -f
```

중지·재시작:

```bash
sudo systemctl stop dudeoji-gateway.service
sudo systemctl restart dudeoji-gateway.service
```

## 실물에서 반드시 확인할 항목

- 같은 Service UUID를 쓰는 두 ESP가 광고 이름으로 정확히 구분되는지
- Pi에서 두 BLE 연결을 장시간 동시에 유지할 수 있는지
- 한 ESP 전원 복구 후 다른 연결을 끊지 않고 재연결하는지
- Pi 재부팅 후 systemd 자동 시작
- 설치 장소 네트워크와 Render 재연결
- BME280·카메라·리드 스위치·서보·릴레이·INA219·팬 실제 동작

코드 테스트만으로 Bluetooth 무선 품질, 전원, 배선과 기계 동작까지
검증할 수는 없습니다.
