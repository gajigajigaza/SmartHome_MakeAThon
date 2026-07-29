# Raspberry Pi 이전 안내

라즈베리파이는 노트북 대신 계속 켜 두는 BLE ↔ WebSocket 게이트웨이입니다.
XIAO는 Wi-Fi를 쓰지 않지만, Raspberry Pi가 Render 서버에 접속하려면
인터넷은 필요합니다. Wi-Fi를 전혀 쓰지 않을 경우 유선 LAN 또는 USB
테더링을 사용하세요.

## 1. 사전 준비

Raspberry Pi OS에서:

```bash
sudo apt update
sudo apt install -y python3-venv bluez bluetooth
bluetoothctl show
```

게이트웨이는 Python 3.10 이상을 사용합니다.

Bluetooth가 차단되어 있으면:

```bash
sudo rfkill unblock bluetooth
```

## 2. 게이트웨이 설치

`dudeoji-gateway` 폴더 전체를 Pi로 복사한 뒤:

```bash
cd ~/makerthon/dudeoji-gateway
bash install_gateway_linux.sh
nano .env
```

`.env`에는 실제 장소 ID와 토큰을 설정합니다. 토큰은 화면 공유, 로그,
GitHub에 노출하지 않습니다.

```dotenv
DUDEOJI_PLACE_ID=54
DUDEOJI_AUTH_TOKEN=실제_토큰
```

## 3. 먼저 전면 실행으로 검증

노트북에서 실행 중인 게이트웨이를 `Ctrl+C`로 끈 다음 실행합니다. XIAO는
BLE Central 한 대만 연결하는 구성이므로 노트북과 Pi 게이트웨이를 동시에
실행하지 않습니다.

```bash
bash run_gateway_linux.sh
```

다음 로그를 확인합니다.

```text
GATEWAY_ENV_CHECK_OK
FastAPI WebSocket 인증 완료
XIAO BLE 연결 완료
BLE 센서 상태 수신
```

웹에서 창문 또는 에어컨 버튼을 눌러 다음 로그까지 확인해야 이전 검증이
완료됩니다.

```text
BLE 제어 명령 전달
XIAO BLE 명령 결과 수신
명령 결과 WebSocket 전달 완료
```

## 4. 부팅 시 자동 실행

전면 실행 검증이 끝난 뒤:

```bash
bash raspberry_pi/install_service.sh
```

상태와 로그:

```bash
sudo systemctl status dudeoji-gateway.service
sudo journalctl -u dudeoji-gateway.service -f
```

중지 또는 재시작:

```bash
sudo systemctl stop dudeoji-gateway.service
sudo systemctl restart dudeoji-gateway.service
```

`active (running)` 상태에서 실제 웹 제어 왕복까지 확인한 후에는 노트북을
꺼도 통신이 유지됩니다. 단, Pi 전원·Pi의 인터넷·XIAO 전원·Render 서버 중
하나라도 끊기면 통신도 끊깁니다.

## 아직 Pi 없이 확인할 수 없는 것

- Pi 내장 Bluetooth와 XIAO의 실제 연결
- Pi 재부팅 후 systemd 자동 재시작
- 설치 장소의 유선 LAN 또는 USB 테더링 안정성
- 장시간 운전과 전원 복구

스크립트와 서비스 템플릿은 준비되어 있지만 위 항목은 Pi가 생긴 뒤 실제
장비에서 반드시 확인해야 합니다.
