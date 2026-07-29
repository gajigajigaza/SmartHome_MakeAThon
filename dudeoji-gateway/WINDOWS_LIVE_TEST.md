# Windows 실기 점검표

현재 노트북이 Raspberry Pi 역할을 대신합니다. 아래 검증이 끝나면 Pi 없이
할 수 있는 통신 소프트웨어 점검은 완료된 것입니다.

## 1. 설정 검사

PowerShell:

```powershell
cd C:\Users\rrkdf\makerthon\dudeoji-gateway
.\.venv\Scripts\python.exe .\check_gateway_env.py
```

토큰 원문은 출력되지 않습니다. 다음이 나와야 합니다.

```text
PLACE_ID = 54
TOKEN_CONFIGURED = True
GATEWAY_ENV_CHECK_OK
```

## 2. 게이트웨이 실행

PowerShell 실행 정책과 관계없이:

```powershell
.\run_gateway.cmd
```

정상 시작 기준:

```text
FastAPI WebSocket 인증 완료
XIAO BLE 연결 완료
BLE 센서 상태 수신
```

Windows의 `USB JTAG/serial debug unit`은 USB 시리얼 장치이지 BLE 연결
표시가 아닙니다. BLE 성공 여부는 `XIAO BLE 연결 완료: 주소` 로그로
판단합니다. Windows 설정 화면에서 수동 페어링할 필요는 없습니다.

## 3. BME280 없이 상태 경로 확인

새 백엔드가 배포된 뒤 인증 로그의 capabilities에 `device_state`가
포함되어야 합니다.

```text
capabilities=command_result,device_state,sensor_reading
```

BME280가 없어도 `BLE 센서 상태 수신: BME=미연결`이 한 번 출력되고,
웹의 창문·에어컨 상태는 리드 스위치·릴레이 값을 따라야 합니다. 온습도
기록만 생성되지 않는 것이 정상입니다.

현재 Render가 아직 기존 코드라면 `device_state`가 광고되지 않습니다.
이 경우에도 BLE 제어와 기존 WebSocket은 동작하지만, 이 ZIP의
`dudeoji-api`와 `dudeoji-web` 변경을 팀이 배포하기 전까지 BME 없는
독립 상태 표시는 활성화되지 않습니다.

## 4. 창문·에어컨 명령 왕복

웹에서 창문 버튼과 에어컨 버튼을 각각 한 번 누릅니다. 매번 게이트웨이에
세 로그가 같은 `command_id`로 이어져야 합니다.

```text
BLE 제어 명령 전달
XIAO BLE 명령 결과 수신
명령 결과 WebSocket 전달 완료
```

새 백엔드와 웹까지 배포된 경우 화면에는 `기기 응답 확인`이 표시됩니다.
단순히 첫 번째 로그만 보이면 서버→게이트웨이→BLE 쓰기까지만 확인된
것이며, XIAO 결과 왕복은 아직 확인되지 않은 것입니다.

## 5. BME 저장 경로 임시 시연

BME280 없이 온습도 저장과 웹 표시까지 시험할 때만 `.env`에 아래 값을
설정하고 게이트웨이를 다시 시작합니다.

```dotenv
DUDEOJI_DEMO_FALLBACK_BME=true
DUDEOJI_DEMO_TEMPERATURE=25.0
DUDEOJI_DEMO_HUMIDITY=50.0
```

다음을 확인합니다.

```text
통신 시연용 가상 BME 활성화
BME280 대신 가상값으로 sensor_reading을 전송
센서값 저장 완료
```

이 값은 실제 측정값이 아닙니다. 시험이 끝나면 반드시:

```dotenv
DUDEOJI_DEMO_FALLBACK_BME=false
```

## 6. 자동 재연결

게이트웨이를 실행한 상태에서 XIAO 전원을 한 번 껐다 켭니다. 다음 순서가
확인되어야 합니다.

```text
XIAO BLE 연결이 끊겼습니다
BLE 연결 실패 또는 BLE 검색 중
XIAO BLE 연결 완료
```

인터넷을 잠깐 끊었다 복구했을 때도 `WebSocket 연결 실패` 뒤
`FastAPI WebSocket 인증 완료`가 다시 나와야 합니다.

## 7. 하드웨어에서 별도로 남는 항목

- BME280 실제 온도·습도
- 리드 스위치 자석 방향과 열림/닫힘 극성
- SG90 각도와 외부 5V 전원
- 릴레이의 active-low/active-high 극성
- 팬 또는 실제 부하 전원
- Raspberry Pi에서의 BLE·systemd·유선 네트워크

소프트웨어 로그 성공만으로 위 전기·기계 동작까지 성공했다고 판단하면
안 됩니다.
