# 팀 역할 분담 & 파일 구조

역할 분담에 맞춰 폴더와 파일을 분리 

**자기 담당 외의 것을 수정하거나 추가할 때, 꼭! 변경사항 공유하고 구조 고려하기**

## 새 기능 넣을 때 체크리스트 (고장 방지용)

파일 구조를 나눠도, 경계에서 주고받는 값이 어긋나면 에러 없이 잘못된 화면이 뜰 수 있음.

- [ ] 백엔드에 새 값/필드를 추가했다면 → 프론트에서 그 값을 쓰는 곳도 같이 고쳤는가?
      (예: `action`에 새 값 추가 → `RecommendationCard.jsx`의 아이콘/타입 매핑도 같이 수정)
- [ ] 새 API 함수를 추가한다면 → `api.js`에 직접 넣지 말고, 백엔드 라우터와 대응하는
      `features/*/*.Api.js`(`authApi.js`/`placesApi.js`/`readingsApi.js`/`locationApi.js`)에 넣었는가?
      (api.js는 `request()`/토큰 관리 같은 공용 기반만 남겨두는 곳입니다 — 여기 계속 추가하면
      예전처럼 한 파일에 다 모여서 merge 충돌이 잦아집니다.)
- [ ] Supabase 테이블을 바꿨다면 → 팀 채팅방에 한 줄 공유했는가?
- [ ] `.env`에 새 키가 필요해졌다면 → 다른 사람에게 값(또는 어디서 구하는지)을 알려줬는가?

---

## 0. Merge 이전 → 이후 매핑 (기존의 무엇이 새로운 버전에서 어떻게 연결되었는지)

`ryeun` 브랜치를 기반으로, `manong17` 브랜치(예전 `main`)에만 있던 기능을 가지고와서 구조 합침. 
원래 각 브랜치의 파일이 지금 어디로 갔는지는 아래를 참고.

### `ryeun` 브랜치 (기반 · 로그인/장소/센서 API 전체가 이미 구현되어 있던 버전)

| 원래 파일 | 지금 위치 | 비고 |
|---|---|---|
| `dudeoji-api/main.py` (1146줄, 인증·장소·센서 API 전부 포함) | `main.py`(공용, 조립만) + `db.py`(공용) + `auth_utils.py`(류은) + `routers/auth_router.py`(류은) + `routers/places_router.py`(류은) + `routers/readings_router.py`(민주) | 섹션별로 라우터 파일로 쪼갬 |
| `dudeoji-api/database.py` | `database.py` (그대로) | 미사용 레거시라 손 안 댐 |
| `dudeoji-web/src/App.jsx` (747줄, 메뉴·추천·환경·튜토리얼 다 포함) | `App.jsx`(공용, 얇은 shell) + `features/menu/UserMenu.jsx`·`Tutorial.jsx`(류은) + `features/dashboard/RecommendationCard.jsx`(민주) + `features/location/EnvironmentCard.jsx`·`SavingsSummary.jsx`(정현) + `features/sensors/SensorReadings.jsx`(민주) | 화면 섹션별로 컴포넌트 분리 |
| `dudeoji-web/src/TemperatureChart.jsx` | `features/sensors/TemperatureChart.jsx` | 폴더만 이동 |
| `dudeoji-web/src/api.js` (240줄, 토큰 인증 버전) | `api.js` (그대로 base로 사용, 이후 `getReadingHistory` 추가) | |
| `features/auth/FlowApp.jsx`, `features/mypage/MyPage.jsx`, `features/badge/BadgePage.jsx`, `features/background/CrawlingMole.jsx` | 각 폴더 그대로 | 손 안 댐 |

### `manong17` 브랜치 (예전 `main` · 인증 없는 초기 버전, 추천 로직·MQTT가 더 정교했음)

| 원래 파일 | 지금 위치 | 비고 |
|---|---|---|
| `dudeoji-api/main.py` (410줄, 인증 없는 버전) | 파일 자체는 사용 안 함 | `fetch_real_weather()` 아이디어만 `weather.py`로 흔적 남김 |
| `dudeoji-api/processor.py` (판단 로직 + 절감량 계산이 한 파일) | `recommendation_engine.py`(민주) + `savings.py`(정현) | ryeun 스키마에 맞게 다시 작성 + 담당자별로 분리 |
| `dudeoji-api/mqtt_handler.py` | `mqtt_handler.py`(민주) | 실제 DB 저장까지 연결, 기본 비활성화 |
| `dudeoji-api/mock_generator.py` | `dev_tools/mock_generator.py`(민주) | 개발용 폴더로 분리 |
| `dudeoji-api/mock_simulator.py` | `dev_tools/mock_simulator.py`(민주) | 로그인 토큰 넣는 부분 추가 수정 |
| `dudeoji-web/src/api.js`의 `getReadingHistory()` | `api.js`에 이식 | ryeun의 인증 패턴에 맞춰 재작성 |
| `dudeoji-web/src/App.jsx`의 "가상 센서 테스트" 입력폼, "백엔드 연결됨" 배너 | **제외** | 요청에 따라 병합 안 함 |
| `dudeoji-web/src/TemperatureChart.jsx` | 사용 안 함 (ryeun 것과 내용 동일) | diff 없어서 ryeun 파일 그대로 유지 |

이후 추가된 파일(`weather.py`, `routers/locations_router.py` 등)은 두 브랜치에 없던, 새로 만든 뼈대 파일. 아래 섹션들의 담당 표시를 참고.

---

## 1. 새로운 전체 폴더 구조

```
merged/
├── TEAM_STRUCTURE.md              이 문서
├── supabase/
│   ├── 002_user_readings.sql          DB 마이그레이션 SQL
│   ├── 003_sensor_engine_fields.sql   readings 테이블에 날씨/미세먼지/바람/창문상태 컬럼 추가
│   └── 004_add_place_location.sql     places 테이블에 lat/lon(nullable) 컬럼 추가
│
├── dudeoji-api/                   [백엔드 · FastAPI]
│   ├── main.py                    ** 공용 - 라우터를 연결만 하는 앱 조립 파일 **
│   ├── db.py                      ** 공용 - Supabase 클라이언트 + 테이블 이름 상수 **
│   ├── database.py                (미사용 SQLite 코드, 실제 서비스는 Supabase 사용)
│   ├── auth_utils.py              [류은] 세션/비밀번호 보안 유틸 + 인증 dependency
│   ├── recommendation_engine.py   [민주] 판단 규칙 엔진
│   ├── savings.py                 [정현] 절감량(전력·시간·비용) 계산
│   ├── weather.py                 [정현] 날씨 API 연동 (구현 완료 · OpenWeatherMap One Call/Air Pollution)
│   ├── mqtt_handler.py            [민주] MQTT 사전 준비 코드 (실제 하드웨어 연결은 현장에서 진행)
│   ├── routers/
│   │   ├── auth_router.py         [류은] 회원가입/로그인/마이페이지 API
│   │   ├── places_router.py       [류은] 장소·에어컨 등록 API
│   │   ├── readings_router.py     [민주] 센서 기록/추천 API
│   │   └── locations_router.py    [정현] 위치 저장/조회 API (추가 예정 · 아직 main.py에 연결 안 됨)
│   ├── dev_tools/                 [민주] 하드웨어 없이 테스트하는 개발용 스크립트 (현장 하드웨어 연결과는 별개)
│   │   ├── mock_simulator.py      서버로 가짜 센서값 계속 전송 (터미널에서 직접 실행)
│   │   └── mock_generator.py      가짜 시계열 데이터 생성 함수
│   ├── requirements.txt / pyproject.toml / uv.lock
│   └── .env                       ← 각자 로컬에 직접 생성 (Supabase 키, OPENWEATHER_API_KEY, KAKAO_REST_API_KEY 등, git에 안 올라감)
│
└── dudeoji-web/                   [프론트 · React + Vite]
    └── src/
        ├── App.jsx                ** 공용 - 어느 화면을 보여줄지만 담당하는 얇은 shell **
        ├── api.js                 ** 공용 - fetch 공통 헬퍼(request)·토큰 관리만. 실제 API 함수는 아래 각 Api.js에 있음 **
        ├── App.css / DashboardOverrides.css / FlowApp.css   공용 스타일
        ├── shared/
        │   └── profileBadges.jsx  뱃지 데이터/아이콘 (메뉴 ↔ 뱃지페이지 공용)
        └── features/
            ├── auth/
            │   ├── FlowApp.jsx           [류은] 로그인/회원가입 진입점
            │   └── authApi.js            [류은] 회원가입/로그인/마이페이지 API (auth_router.py 대응)
            ├── places/
            │   └── placesApi.js          [류은] 장소/에어컨 등록 API (places_router.py 대응)
            ├── menu/
            │   ├── UserMenu.jsx           [류은] 아바타 버튼 + 드롭다운 메뉴
            │   └── Tutorial.jsx           [류은] 첫 방문 튜토리얼
            ├── mypage/MyPage.jsx          [류은] 마이페이지
            ├── location/
            │   ├── LocationSwitcher.jsx   [정현] 좌측 상단 위치 버튼
            │   ├── LocationListPanel.jsx  [정현] 위치 목록/추가 패널
            │   ├── useSelectedLocation.js [정현] 선택된 위치 상태 관리 훅
            │   ├── EnvironmentCard.jsx    [정현] 실시간 실내외 환경 카드
            │   ├── SavingsSummary.jsx     [정현] 예상 절감(1일/1주/1달)
            │   └── locationApi.js         [정현] 위치 API (추가 예정 · locations_router.py 완성되면 작성)
            ├── dashboard/
            │   └── RecommendationCard.jsx [민주] 현재 추천 + 이유
            ├── sensors/
            │   ├── SensorReadings.jsx     [민주] 센서 측정값 전체 화면
            │   ├── TemperatureChart.jsx   [민주] 최근 온도 변화 그래프
            │   └── readingsApi.js         [민주] 센서 기록/추천 API (readings_router.py 대응)
            ├── badge/BadgePage.jsx        [민주, 여유 있으면] 뱃지
            └── background/CrawlingMole.jsx  공용 배경 캐릭터
```

---

## 2. 백엔드 파일별 설명

| 파일 | 무슨 역할 | 담당 |
|---|---|---|
| `main.py` | FastAPI 앱을 만들고, CORS를 설정하고, 아래 세 라우터를 `app.include_router()`로 연결하는 역할만 함. 실제 로직은 여기 안 씀 | 공용 |
| `db.py` | Supabase 클라이언트 생성 + 테이블 이름 상수(`USERS_TABLE`, `READINGS_TABLE` 등) | 공용 |
| `database.py` | 예전 SQLite 버전의 흔적으로, 지금 서비스에서는 어디서도 호출되지 않는 미사용 파일 | - |
| `auth_utils.py` | 비밀번호 해시, 세션 토큰 생성/검증, `get_current_user`(로그인한 사용자인지 확인하는 함수). 다른 라우터들이 이걸 가져다 씀 | **류은** |
| `routers/auth_router.py` | `/api/auth/*` — 회원가입, 로그인, 로그아웃, 아이디 중복확인, 비번 찾기, 닉네임/비번/복구정보 변경, 탈퇴 | **류은** |
| `routers/places_router.py` | `/api/aircon-models`, `/api/places`(GET/POST), `/api/places/{place_id}`(PATCH, 위치만 갱신), `/api/places/geocode`, `/api/places/reverse-geocode` — 에어컨 제품 검색, 장소+에어컨 등록/조회, 주소·현재위치 ↔ 위경도 변환(카카오 로컬 API). `places` 테이블에 `lat`/`lon`(nullable) 컬럼 있음(`supabase/004_add_place_location.sql`) | **류은** |
| `routers/readings_router.py` | `/api/readings/*`, `/api/recommendation` — 센서 기록 저장/조회, 추천 결과 조회. MQTT/dev_tools로 들어오는 센서 데이터도 결국 여기로 저장됨 | **민주** |
| `recommendation_engine.py` | 실내외 온습도 + 날씨/미세먼지/바람을 보고 "창문 열기/에어컨/유지"를 판단하는 규칙 엔진 (`determine_action`) | **민주** |
| `savings.py` | 판단된 행동(action)에 대해 절감 전력(kWh)·시간·비용(원)·멘트를 계산 (`estimate_savings`) | **정현** |
| `weather.py` | 외부 날씨 API 연동. 구현 완료 — `fetch_outdoor_weather(lat, lon)`이 OpenWeatherMap One Call/Air Pollution API를 호출해 실외 날씨+미세먼지를 반환. 다만 아직 `readings_router.py`가 이 함수를 호출하지 않아서 실제 파이프라인에는 연결 안 됨 | **정현** |
| `routers/locations_router.py` | 위치(집/회사) 저장/조회/선택 API. `추가 예정` — 아직 엔드포인트가 없고 `main.py`에도 연결 안 됨. 류은의 `places_router.py`와의 통합 방향은 이미 실행됨(→ `places` 테이블에 `lat`/`lon` 컬럼 추가, 위치 검색은 `places_router.py`의 `geocode`/`reverse-geocode`로 구현됨) — 이 파일 자체는 여전히 빈 뼈대 상태 | **정현** |
| `mqtt_handler.py` | 라즈베리파이 게이트웨이가 MQTT로 보내는 실제 센서 데이터를 받아서 저장까지 연결하는 코드(사전 준비) | **민주** (실제 하드웨어 연결·전환은 특정 담당자 없이 대면 현장에서 진행) |
| `dev_tools/mock_simulator.py` | 하드웨어 없을 때 터미널에서 실행해서 가짜 센서값을 5초마다 서버로 계속 보내는 스크립트(지금 단계 테스트용) | **민주** (실제 하드웨어 연결·전환은 특정 담당자 없이 대면 현장에서 진행) |
| `dev_tools/mock_generator.py` | 온도 그래프 화면 테스트용 가짜 시계열 데이터 생성 함수 | **민주** |

### 새 엔드포인트를 추가할 때

- 회원가입/로그인/마이페이지 관련이면 → `routers/auth_router.py`
- 장소/에어컨 등록 관련이면 → `routers/places_router.py`
- 센서 기록/추천/최근 온도변화 관련이면 → `routers/readings_router.py` (민주)
- `main.py`는 건드릴 일이 거의 없을 듯. 완전히 새로운 영역이 생기면 그때 `routers/` 안에 파일을 하나 더 만들고 `main.py`에 `include_router` 한 줄만 추가하면 됨.

---

## 3. 위치 파트 구조에 대한 설명

- `useSelectedLocation.js` — 저장된 위치 목록, 현재 선택된 위치를 관리하는 훅. 지금도 `localStorage`에 저장하는 임시 버전 그대로임(아직 API 연동 안 됨)
- `LocationSwitcher.jsx` — 헤더 좌측 상단에 보이는 버튼. 누르면 `LocationListPanel`이 열림.
- `LocationListPanel.jsx` — 위치 목록을 보여주고, 선택/추가하는 패널. 지금도 이름만 받는 자유 텍스트 폼이고, 주소 검색/좌표 연결은 아직 안 붙어 있음.

**참고할 점:** 류은이 만든 장소(place) 등록 기능(`/api/places`)도 개념적으로
"집/회사 같은 장소 여러 개"를 다룸. 아래 두 가지는 이미 진행됨:
- `places` 테이블에 `lat`/`lon`(nullable) 컬럼 추가(`supabase/004_add_place_location.sql`)
- 주소/현재 위치를 위경도로 바꿔주는 `GET /places/geocode`, `GET /places/reverse-geocode`(카카오 로컬 API 연동)를 `places_router.py`에 구현

다만 이 검색 UI는 여기(`features/location/`)가 아니라 `features/auth/FlowApp.jsx`의
`AirconPage`(회원가입 2단계 '에어컨 등록' 화면, 장소를 처음 등록하는 시점)에 붙어
있습니다. 여러 위치를 저장해두고 전환하는 `LocationSwitcher.jsx`/
`LocationListPanel.jsx`/`useSelectedLocation.js` 쪽에는 아직 이 검색 UI가
적용되지 않았습니다 — 같은 검색 UI를 여기에도 적용할지는 아직 미정.

선택된 위치가 정해지면, 그 위치의 실외 날씨를 API로 받아서
`SensorReadingCreate`의 `weather_condition`/`pm25`/`wind_speed`에 실어
`/api/readings`로 보내기 (아직 미착수)

---

## 4. 프론트 파일별 설명

| 파일 | 무슨 역할 | 담당 |
|---|---|---|
| `App.jsx` | "지금 어느 화면(대시보드/마이페이지/뱃지/센서측정값)을 보여줄지" 상태만 관리하는 shell. 각 화면 컴포넌트를 조립만 함 | 공용 (새 페이지 추가할 때만 같이 상의 후 수정) |
| `api.js` | `request()`(fetch 공통 헬퍼) + 로그인 토큰 저장/조회만 있음. **실제 API 호출 함수는 여기 없음** — 아래 각 `*Api.js` 참고 | 공용 (여기에 새 API 함수를 직접 추가하지 말 것) |
| `features/auth/authApi.js` | 회원가입/로그인/마이페이지 API (`/api/auth/*`). 백엔드 `auth_router.py`와 1:1 대응 | **류은** |
| `features/places/placesApi.js` | 장소/에어컨 등록 API (`/api/places`, `/api/aircon-models`). 백엔드 `places_router.py`와 1:1 대응 | **류은** |
| `features/sensors/readingsApi.js` | 센서 기록/추천 API (`/api/readings/*`, `/api/recommendation`). 백엔드 `readings_router.py`와 1:1 대응 | **민주** |
| `shared/profileBadges.jsx` | 뱃지 목록 데이터 + 아이콘 렌더링. 헤더 아바타(류은)와 뱃지 페이지(민주)가 같이 씀 | 공용 (수정 전 서로 확인) |
| `features/auth/FlowApp.jsx` | 로그인/회원가입 화면 흐름, 앱 진입점(`main.jsx`가 이걸 렌더링) | **류은** |
| `features/menu/UserMenu.jsx` | 새싹 아이콘(아바타) 버튼 + 마이페이지/센서측정값/뱃지/로그아웃 드롭다운 메뉴 | **류은** |
| `features/menu/Tutorial.jsx` | 처음 접속했을 때 나오는 단계별 튜토리얼 | **류은** |
| `features/mypage/MyPage.jsx` | 닉네임/비번/이모지 변경, 탈퇴 | **류은** |
| `features/location/LocationSwitcher.jsx` | 좌측 상단 위치 선택 버튼 | **정현** |
| `features/location/LocationListPanel.jsx` | 위치 목록 보기/추가/선택 패널 | **정현** |
| `features/location/useSelectedLocation.js` | 선택된 위치 상태 관리 훅 | **정현** |
| `features/location/EnvironmentCard.jsx` | 실시간 실내외 온습도 카드 | **정현** |
| `features/location/SavingsSummary.jsx` | "오늘의 예상 절감" 자리 (지금은 placeholder) | **정현** |
| `features/dashboard/RecommendationCard.jsx` | 현재 추천 + 이유 카드. `MAINTAIN`/`OPEN_WINDOW`/`USE_AIRCON`/`CLOSE_WINDOW`/`ENJOY` 5개 액션 전부 아이콘·색상 매핑되어 있음 | **민주** |
| `features/sensors/SensorReadings.jsx` | 센서 측정값 전체를 보여주는 화면 (지금은 뼈대) | **민주** |
| `features/sensors/TemperatureChart.jsx` | 최근 온도 변화 그래프 | **민주** |
| `features/badge/BadgePage.jsx` | 뱃지 선택 화면 | **민주** (여유 있으면) |
| `features/background/CrawlingMole.jsx` | 화면 배경에서 기어다니는 캐릭터 | 공용 |

---

## 5. 담당 폴더 한눈에 보기

### 류은
```
dudeoji-api/auth_utils.py
dudeoji-api/routers/auth_router.py
dudeoji-api/routers/places_router.py
dudeoji-web/src/features/auth/          → FlowApp.jsx + authApi.js
dudeoji-web/src/features/places/        → placesApi.js
dudeoji-web/src/features/menu/
dudeoji-web/src/features/mypage/
```

### 정현 (나)
```
dudeoji-api/savings.py
dudeoji-api/weather.py                    → 구현 완료(OpenWeatherMap 연동)
dudeoji-api/routers/locations_router.py   → 여전히 뼈대만 있고 main.py에 연결 안 됨(위치 통합은 places_router.py 쪽에서 진행됨)
dudeoji-api/main.py, dudeoji-api/db.py    → 앱 전반 골격/에러 처리 패턴, 새 라우터 연결
dudeoji-web/src/features/location/        → 위치 저장/전환 UI(useSelectedLocation 등)는 여전히 localStorage 임시 버전. 위치 검색(주소→좌표) UI는 여기가 아니라 features/auth/FlowApp.jsx에 구현됨
```

### 민주
```
dudeoji-api/recommendation_engine.py
dudeoji-api/routers/readings_router.py
dudeoji-api/mqtt_handler.py
dudeoji-api/dev_tools/
dudeoji-web/src/features/dashboard/
dudeoji-web/src/features/sensors/         → SensorReadings.jsx, TemperatureChart.jsx, readingsApi.js
dudeoji-web/src/features/badge/     (여유 있으면)
```

---
## +a

## 6. 아직 안 만들었지만, 나중에 만들 때 주의할 것 (말로만 정해진 것들)

### 뱃지 → 업적/서브게임으로 확장할 때 (민주)

지금 `BadgePage.jsx`는 그냥 보유한 뱃지를 눌러서 아바타로 설정하는 화면이고,
뱃지 데이터(`shared/profileBadges.jsx`)의 `unlocked: true/false`도 지금은
그냥 하드코딩된 값이라 실제로 "달성해서 잠금 해제"되는 로직이 없습니다.
업적 달성형 서브게임으로 만들 때 아래를 고려해 주세요.

- **"달성 조건"은 서버에 있어야 함.** 예를 들어 "일주일 연속 접속", "창문 열기 추천 10번 따르기" 같은 조건은 클라이언트만으로 판단할 수 없고(새로고침하면 사라짐), `readings_router.py`나 별도의 `achievements_router.py`에서 사용자별로 달성 여부를 저장/조회해야 합니다.
- **`shared/profileBadges.jsx`를 손댈 때는 류은과 미리 얘기하기.** 이 파일은 헤더 아바타(류은)와 뱃지 페이지(민주)가 같이 쓰기 때문에, 뱃지 데이터 구조 자체를 바꾸면(예: `unlocked`를 서버에서 받아오는 방식으로 변경) 헤더 쪽 코드도 같이 고쳐야 할 수 있습니다.
- 서브게임 UI가 커지면 `features/badge/` 안에 `BadgePage.jsx` 하나로 몰아넣지 말고, `AchievementList.jsx`(달성 목록), `achievementRules.js`(달성 조건 정의) 정도로 나누는 걸 추천합니다. 지금 미리 만들어두진 않았습니다.

### 위치 추가/관리/설정 (정현)

`features/location/` 구조(`LocationSwitcher.jsx`, `LocationListPanel.jsx`,
`useSelectedLocation.js`)가 이 역할을 위한 뼈대입니다. 진행 상황:

**완료됨**
- **류은의 장소(place) 등록 기능과 조율 완료.** 새 위치 시스템을 따로 만들지 않고, `places` 테이블에 `lat`/`lon`(nullable) 컬럼을 추가하는 방향으로 진행함(`supabase/004_add_place_location.sql`). 주소/현재 위치를 위경도로 바꿔주는 `GET /places/geocode`, `GET /places/reverse-geocode`(카카오 로컬 API)도 `places_router.py`에 구현됨.
- 다만 이 검색 UI는 `features/location/`이 아니라 `features/auth/FlowApp.jsx`의 `AirconPage`(회원가입 2단계, 장소를 처음 등록하는 화면)에 붙어 있습니다. 여러 위치를 저장해두고 전환하는 `LocationSwitcher`/`LocationListPanel`/`useSelectedLocation.js` 쪽에는 아직 이 검색 UI가 적용되지 않았습니다.

**아직 안 됨**
- **`useSelectedLocation.js`는 여전히 브라우저 `localStorage`에만 저장됩니다.** 한 번 설정하면 새로고침해도 유지되지만, 다른 기기/브라우저로 로그인하면 초기화됩니다. `loadLocations`/`saveLocations`/`selectLocation` 부분을 `places` API 호출(`GET /places`, `PATCH /places/{place_id}`)로 바꾸면 서버 저장으로 넘어갈 수 있고, 이 훅을 쓰는 `LocationSwitcher.jsx` 등은 그대로 두면 됩니다.
- **"위치 선택 → 화면 전환"은 지금 App.jsx 라우팅과는 다른 종류의 전환입니다.** 지금 `App.jsx`의 `currentPage`는 "대시보드/마이페이지/뱃지/센서측정값" 같은 큰 화면 전환이고, 위치 선택은 그 안에서 "표시되는 데이터가 바뀌는 것"에 가깝습니다. 새 페이지로 만들지, `LocationListPanel`처럼 패널/모달로 유지할지 먼저 정하고 시작하는 게 좋습니다.
- 위치가 여러 개면 "각 위치마다 최근 센서 기록이 따로 있어야 하는가"도 정해야 합니다. 지금 `readings` 테이블은 장소 구분 없이 사용자 1명당 최신 기록 1줄만 조회하는 구조라, 위치별로 나누려면 `readings` 테이블에도 `place_id`(또는 `location_id`) 컬럼이 필요할 수 있습니다. 이건 민주(`readings_router.py`)와 같이 상의해야 하는 부분입니다.


## 로컬 실행

### 백엔드 (.env파일생성 후)
cd dudeoji-api

pip install -r requirements.txt

fastapi dev main.py

### 프론트 (.env파일 생성 후)
cd dudeoji-web

npm install

npm run dev

cd dudeoji-api

$env:AUTH_TOKEN="로그인 토큰"

python dev_tools\mock_simulator.py

### 로컬말고 배포된 백엔드로 실행하고 싶으면
cd dudeoji-web

npm install

npm run dev

