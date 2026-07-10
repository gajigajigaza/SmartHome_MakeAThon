# 역할별 파일 구조 안내

ryeun 브랜치를 기준으로 병합하면서, 3명이 겹치지 않고 작업할 수 있도록
`dudeoji-web/src` 안을 기능 폴더(`features/*`)로 나눴습니다.
**원칙: 자기 화면 폴더 안의 파일만 고치면 다른 사람 코드와 거의 겹치지 않습니다.**

## 류은 — 회원가입/로그인, 메뉴바, 마이페이지
- `dudeoji-web/src/features/auth/FlowApp.jsx` — 회원가입/로그인 플로우 (기존)
- `dudeoji-web/src/features/mypage/MyPage.jsx` — 마이페이지 (기존)
- `dudeoji-web/src/features/menu/UserMenu.jsx` — 새싹 아이콘 + 드롭다운 메뉴 (신규 분리)
- `dudeoji-web/src/features/menu/Tutorial.jsx` — 첫 방문 튜토리얼 (신규 분리)
- `dudeoji-web/src/features/background/CrawlingMole.jsx` — 배경 캐릭터 (기존)

## 나 — 위치, 실외 날씨, 실내외 환경, 예상 절감
- `dudeoji-web/src/features/location/LocationBar.jsx` — 위치 추가 버튼 + 실외 날씨 입력 (신규 뼈대, 지금은 localStorage에만 저장)
- `dudeoji-web/src/features/location/EnvironmentCard.jsx` — 실시간 실내외 온습도 카드 (신규 분리)
- `dudeoji-web/src/features/location/SavingsSummary.jsx` — 예상 절감(1일/1주/1달) 자리 (신규, 지금은 placeholder)
- 백엔드: `dudeoji-api/main.py`의 `SensorReadingCreate.weather_condition / pm25 / wind_speed` 필드에
  실외 날씨 값을 채워 `/api/readings`로 보내면 추천 정확도가 올라갑니다.

## 민주 — 현재 추천 + 이유, 센서 측정값, 뱃지
- `dudeoji-web/src/features/dashboard/RecommendationCard.jsx` — 추천 카드 (신규 분리)
- `dudeoji-web/src/features/sensors/SensorReadings.jsx` — 센서 측정값 전체 화면 (신규 뼈대)
- `dudeoji-web/src/features/sensors/TemperatureChart.jsx` — 최근 온도 변화 그래프 (기존, 폴더만 이동)
- `dudeoji-web/src/features/badge/BadgePage.jsx` — 뱃지 (기존, 추후 확장)

## 공용 (수정 전 서로 확인)
- `dudeoji-web/src/App.jsx` — 위 컴포넌트들을 조립하는 얇은 shell. 화면 자체 로직보다는
  "어느 페이지를 보여줄지" 상태 전환만 담당합니다. 새 메뉴/페이지를 추가할 때만 건드리면 됩니다.
- `dudeoji-web/src/api.js` — 백엔드 호출 함수 모음. 새 엔드포인트를 쓸 때 함수 추가.
- `dudeoji-web/src/shared/profileBadges.js` — 프로필 뱃지 데이터/아이콘 (헤더 메뉴 ↔ 뱃지 페이지 공용)
- `dudeoji-api/main.py`, `processor.py`, `database.py` — 백엔드 공통

## 백엔드에서 이번에 추가된 것 (minzoo 브랜치에서 이식)
- `dudeoji-api/processor.py` — 불쾌지수(THI) + 미세먼지 + 강풍/강우/태풍까지 고려하는
  더 정교한 추천 엔진. `main.py`의 `calculate_recommendation()`이 이걸 사용하도록 교체했습니다.
- `dudeoji-api/mqtt_handler.py` — 라즈베리파이 게이트웨이가 보내는 MQTT 데이터를 받는 코드.
  기본은 꺼져 있고(`MQTT_ENABLED=true`로 켜야 동작), place_id → user_id 매핑은
  '위치 추가' 기능이 붙기 전까지 임시로 payload에 place_id를 함께 보내는 방식입니다.
- `dudeoji-web/src/api.js`에 `getReadingHistory()` 추가 (센서 측정값 화면에서 사용).

## 이번에 제외한 것 (요청대로 제거)
- `mock_generator.py`, `mock_simulator.py` — 가상 센서 테스트용 스크립트
- minzoo 브랜치 `App.jsx`의 "가상 센서 테스트" 입력 폼, "백엔드 연결됨" 큰 배너
  (ryeun 쪽엔 이미 작은 연결 상태 점(●)만 있어 그대로 유지)
