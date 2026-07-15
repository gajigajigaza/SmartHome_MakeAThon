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
│   ├── weather.py                 [정현] 날씨 API 연동 (구현 완료 · OpenWeatherMap Current Weather API 2.5(무료, 카드 등록 불필요)/Air Pollution)
│   ├── mqtt_handler.py            [민주] MQTT 사전 준비 코드 (실제 하드웨어 연결은 현장에서 진행)
│   ├── routers/
│   │   ├── auth_router.py         [류은] 회원가입/로그인/마이페이지 API
│   │   ├── places_router.py       [류은] 장소·에어컨 등록 API
│   │   ├── readings_router.py     [민주] 센서 기록/추천 API
│   │   ├── weather_router.py      [정현] GET /api/weather(lat, lon) — weather.py를 그대로 노출, main.py에 연결됨. EnvironmentCard.jsx 표시 전용이고 readings/추천 파이프라인과는 무관
│   │   └── locations_router.py    [정현] 위치 저장/조회 API (추가 예정 · 아직 main.py에 연결 안 됨 — 위치 기능 자체는 places_router.py 쪽으로 구현 완료됨)
│   ├── dev_tools/                 [민주] 하드웨어 없이 테스트하는 개발용 스크립트 (현장 하드웨어 연결과는 별개)
│   │   ├── mock_simulator.py      서버로 가짜 센서값 계속 전송 (터미널에서 직접 실행)
│   │   └── mock_generator.py      가짜 시계열 데이터 생성 함수
│   ├── requirements.txt / pyproject.toml / uv.lock
│   └── .env                       ← 각자 로컬에 직접 생성 (Supabase 키, OPENWEATHER_API_KEY, KAKAO_REST_API_KEY 등, git에 안 올라감)
│
└── dudeoji-web/                   [프론트 · React + Vite]
    └── src/
        ├── App.jsx                ** 공용 - 어느 화면을 보여줄지만 담당하는 얇은 shell ** (대시보드 return이 LocationProvider로 감싸여 있음 — jh 수정함)
        ├── api.js                 ** 공용 - fetch 공통 헬퍼(request)·토큰 관리만. 실제 API 함수는 아래 각 Api.js에 있음 **
        ├── App.css / DashboardOverrides.css / FlowApp.css   공용 스타일
        ├── shared/
        │   └── profileBadges.jsx  뱃지 데이터/아이콘 (메뉴 ↔ 뱃지페이지 공용)
        └── features/
            ├── auth/
            │   ├── FlowApp.jsx           [류은] 로그인/회원가입 진입점
            │   └── authApi.js            [류은] 회원가입/로그인/마이페이지 API (auth_router.py 대응)
            ├── places/
            │   └── placesApi.js          [류은] 장소/에어컨 등록 API (places_router.py 대응). `updatePlaceLocation`는 jh 수정함.
            ├── menu/
            │   ├── UserMenu.jsx           [류은] 아바타 버튼 + 드롭다운 메뉴
            │   └── Tutorial.jsx           [류은] 첫 방문 튜토리얼
            ├── mypage/MyPage.jsx          [류은] 마이페이지
            ├── location/
            │   ├── LocationSwitcher.jsx      [정현] 좌측 상단 위치 버튼
            │   ├── LocationListPanel.jsx     [정현] 위치 목록/추가 패널
            │   ├── useSelectedLocation.js    [정현] 선택된 위치 목록/선택 상태 관리 훅(GET /api/places 기반, 선택된 id만 localStorage)
            │   ├── LocationContext.jsx       [정현] 위 훅을 감싸는 Context(Provider는 App.jsx에서 씀) — 여러 컴포넌트가 각자 훅을 불러서 서로 다른 위치를 가리키던 문제를 고치려고 도입
            │   ├── LocationSearchPopover.jsx [정현] EnvironmentCard의 "+" 버튼용 경량 위치 검색 팝오버(주소/현재 위치 → lat/lon, 에어컨 등록 없음)
            │   ├── EnvironmentCard.jsx       [정현] 실시간 실내외 환경 카드 — 실외는 GET /api/weather로 실제 날씨 표시
            │   └── SavingsSummary.jsx        [정현] 예상 절감(1일/1주/1달)
            │   (locationApi.js는 만들지 않기로 확정 — placesApi.js의 fetchMyPlaces/createPlaceWithAircons/updatePlaceLocation을 그대로 재사용)
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
| `main.py` | FastAPI 앱을 만들고, CORS를 설정하고, 아래 라우터들(auth/places/readings/weather)을 `app.include_router()`로 연결하는 역할만 함. 실제 로직은 여기 안 씀 | 공용 |
| `db.py` | Supabase 클라이언트 생성 + 테이블 이름 상수(`USERS_TABLE`, `READINGS_TABLE` 등) | 공용 |
| `database.py` | 예전 SQLite 버전의 흔적으로, 지금 서비스에서는 어디서도 호출되지 않는 미사용 파일 | - |
| `auth_utils.py` | 비밀번호 해시, 세션 토큰 생성/검증, `get_current_user`(로그인한 사용자인지 확인하는 함수). 다른 라우터들이 이걸 가져다 씀 | **류은** |
| `routers/auth_router.py` | `/api/auth/*` — 회원가입, 로그인, 로그아웃, 아이디 중복확인, 비번 찾기, 닉네임/비번/복구정보 변경, 탈퇴 | **류은** |
| `routers/places_router.py` | `/api/aircon-models`, `/api/places`(GET/POST), `/api/places/{place_id}`(PATCH, 위치만 갱신), `/api/places/geocode`, `/api/places/reverse-geocode` — 에어컨 제품 검색, 장소+에어컨 등록/조회, 주소·현재위치 ↔ 위경도 변환(카카오 로컬 API). `places` 테이블에 `lat`/`lon`(nullable) 컬럼 있음(`supabase/004_add_place_location.sql`) | **류은** |
| `routers/readings_router.py` | `/api/readings/*`, `/api/recommendation` — 센서 기록 저장/조회, 추천 결과 조회. MQTT/dev_tools로 들어오는 센서 데이터도 결국 여기로 저장됨 | **민주** |
| `recommendation_engine.py` | 실내외 온습도 + 날씨/미세먼지/바람을 보고 "창문 열기/에어컨/유지"를 판단하는 규칙 엔진 (`determine_action`) | **민주** |
| `savings.py` | 판단된 행동(action)에 대해 절감 전력(kWh)·시간·비용(원)·멘트를 계산 (`estimate_savings`) | **정현** |
| `weather.py` | 외부 날씨 API 연동. 구현 완료 — `fetch_outdoor_weather(lat, lon)`이 OpenWeatherMap Current Weather API 2.5(무료, 카드 등록 불필요)/Air Pollution API를 호출해 실외 날씨+미세먼지를 반환(`precipitation_probability`는 이 API엔 없어서 항상 `None`). `routers/weather_router.py`를 통해 프론트에 노출되지만, 아직 `readings_router.py`가 이 함수를 호출하지 않아서 센서 기록/추천 파이프라인에는 연결 안 됨(아래 참고) | **정현** |
| `routers/weather_router.py` | `GET /api/weather?lat=&lon=` — 로그인 필요, `weather.py`의 `fetch_outdoor_weather`를 그대로 감싸서 반환, 실패 시 502(콘솔에 원본 에러 로그 남김). `EnvironmentCard.jsx`가 실외 날씨 표시에 씀 — **표시 전용이고, `readings`/`recommendation_engine.py`가 쓰는 실외값과는 별개의 소스**(아래 6번 참고) | **정현** |
| `routers/locations_router.py` | 위치(집/회사) 저장/조회/선택 API. `추가 예정` — 아직 엔드포인트가 없고 `main.py`에도 연결 안 됨. 류은의 `places_router.py`와의 통합 방향은 이미 실행됨(→ `places` 테이블에 `lat`/`lon` 컬럼 추가, 위치 검색은 `places_router.py`의 `geocode`/`reverse-geocode`로 구현됨) — 이 파일 자체는 여전히 빈 뼈대 상태 | **정현** |
| `mqtt_handler.py` | 라즈베리파이 게이트웨이가 MQTT로 보내는 실제 센서 데이터를 받아서 저장까지 연결하는 코드(사전 준비) | **민주** (실제 하드웨어 연결·전환은 특정 담당자 없이 대면 현장에서 진행) |
| `dev_tools/mock_simulator.py` | 하드웨어 없을 때 터미널에서 실행해서 가짜 센서값을 5초마다 서버로 계속 보내는 스크립트(지금 단계 테스트용) | **민주** (실제 하드웨어 연결·전환은 특정 담당자 없이 대면 현장에서 진행) |
| `dev_tools/mock_generator.py` | 온도 그래프 화면 테스트용 가짜 시계열 데이터 생성 함수 | **민주** |

### 새 엔드포인트를 추가할 때

- 회원가입/로그인/마이페이지 관련이면 → `routers/auth_router.py`
- 장소/에어컨 등록 관련이면 → `routers/places_router.py`
- 센서 기록/추천/최근 온도변화 관련이면 → `routers/readings_router.py` (민주)
- `main.py`는 건드릴 일이 거의 없을 듯. 완전히 새로운 영역이 생기면 그때 `routers/` 안에 파일을 하나 더 만들고 `main.py`에 `include_router` 한 줄만 추가하면 됨(`weather_router.py`가 이 패턴의 실제 예시).

---

## 3. 위치 파트 구조에 대한 설명

- `useSelectedLocation.js` — 저장된 위치 목록/선택 상태 관리 훅. **이제 `localStorage` 임시 버전이 아님** — `GET /api/places`(류은의 장소 등록 기능, `placesApi.js`의 `fetchMyPlaces`)로 목록을 서버에서 불러온다. 선택된 위치의 id만 여전히 `localStorage`에 남아 있음(서버에 저장할 개념이 아니라서).
- `LocationContext.jsx` — 위 훅을 감싸는 Context(`LocationProvider`/`useLocationContext`). `App.jsx`의 대시보드 return을 `LocationProvider`로 한 번만 감싸고, `LocationSwitcher`/`LocationListPanel`/`EnvironmentCard`가 각자 `useSelectedLocation()`을 따로 부르지 않고 `useLocationContext()`로 같은 값을 공유한다. (예전엔 각자 따로 불러서 헤더에서 위치를 바꿔도 다른 컴포넌트가 그 변경을 못 보는 문제가 있었음 — 지금은 해결됨.)
- `LocationSwitcher.jsx` — 헤더 좌측 상단에 보이는 버튼. 누르면 `LocationListPanel`이 열림.
- `LocationListPanel.jsx` — 위치 목록을 보여주고 선택. "+ 장소 추가"를 누르면 `features/places/AirconPage.jsx`를 `variant="modal"`로 띄워서 이름+위치검색+에어컨 등록까지 받은 뒤 `POST /api/places`로 저장(`createPlaceWithAircons`).
- `LocationSearchPopover.jsx` — `EnvironmentCard.jsx` 실외 카드의 "+" 버튼으로 여는 훨씬 가벼운 팝오버. "새 장소를 에어컨과 함께 등록"하는 `LocationListPanel`의 흐름과 달리, **이미 선택된 장소의 위치(lat/lon)만 나중에 채워 넣는 용도**라 에어컨 등록 없이 주소/현재 위치 검색만 하고 `PATCH /api/places/{id}`(`placesApi.js`의 `updatePlaceLocation`)로 저장한다.
- `EnvironmentCard.jsx` — 실내는 `sensorData`(readings 테이블, App.jsx가 내려줌)를 그대로 표시. **실외는 `GET /api/weather`(아래 `weather_router.py`)를 선택된 위치의 lat/lon으로 호출해 실제 날씨를 표시** — 위치가 없으면 "위치를 설정해 주세요" + "+" 버튼(`LocationSearchPopover`)을 보여준다.

**참고할 점:** 류은이 만든 장소(place) 등록 기능(`/api/places`)이 곧 "위치" 기능이다.
별도의 `locations` 테이블/엔드포인트를 새로 만들지 않고, 아래처럼 `places` 테이블을 확장하는
방향으로 통합이 이미 끝났다(`routers/locations_router.py`는 여전히 빈 뼈대로 남아 있고 안 씀):
- `places` 테이블에 `lat`/`lon`(nullable) 컬럼 추가(`supabase/004_add_place_location.sql`)
- 주소/현재 위치를 위경도로 바꿔주는 `GET /places/geocode`, `GET /places/reverse-geocode`(카카오 로컬 API 연동)를 `places_router.py`에 구현
- 위치만 갱신하는 `PATCH /places/{place_id}`도 `places_router.py`에 구현(정현이 승인받아 추가, `jh 수정함` 표시)

이 검색 UI(주소로 찾기/현재 위치로 찾기 탭)는 이제 두 군데서 쓰인다:
`features/places/AirconPage.jsx`(장소를 **새로 등록**할 때, `variant="signup"|"modal"`)와
`features/location/LocationSearchPopover.jsx`(이미 있는 장소의 위치만 **나중에 채워 넣을 때**).
둘 다 같은 백엔드 엔드포인트(geocode/reverse-geocode)를 쓰지만 구현은 각자 따로다(하나를 리팩터링해서
공유하지 않음).

**중요 — 실외 날씨 두 가지 소스가 따로 존재함:** `EnvironmentCard.jsx`가 보여주는 실외
온습도/날씨는 `GET /api/weather`(실시간 OpenWeatherMap 조회, 표시 전용)에서 오고,
`recommendation_engine.py`/`RecommendationCard.jsx`/`savings.py`가 쓰는 실외값은 여전히
`readings` 테이블에 저장된 값(민주의 `readings_router.py`, `weather.py`를 아직 호출 안 함)에서 온다.
즉 **화면의 "실외" 카드와 추천 이유에 나오는 실외 조건이 서로 다른 값일 수 있다** — 나중에
`readings_router.py`가 `weather.py`를 호출하도록 연결하기 전까지는 이 둘을 같은 값으로 착각하지 말 것.

---

## 4. 프론트 파일별 설명

| 파일 | 무슨 역할 | 담당 |
|---|---|---|
| `App.jsx` | "지금 어느 화면(대시보드/마이페이지/뱃지/센서측정값)을 보여줄지" 상태만 관리하는 shell. 각 화면 컴포넌트를 조립만 함 | 공용 (새 페이지 추가할 때만 같이 상의 후 수정) |
| `api.js` | `request()`(fetch 공통 헬퍼) + 로그인 토큰 저장/조회만 있음. **실제 API 호출 함수는 여기 없음** — 아래 각 `*Api.js` 참고 | 공용 (여기에 새 API 함수를 직접 추가하지 말 것) |
| `features/auth/authApi.js` | 회원가입/로그인/마이페이지 API (`/api/auth/*`). 백엔드 `auth_router.py`와 1:1 대응 | **류은** |
| `features/places/placesApi.js` | 장소/에어컨 등록 API (`/api/places`, `/api/aircon-models`). 백엔드 `places_router.py`와 1:1 대응. `updatePlaceLocation(placeId, lat, lon)`(PATCH, 위치만 갱신)은 정현이 승인받아 추가(`jh 수정함` 표시) | **류은** |
| `features/sensors/readingsApi.js` | 센서 기록/추천 API (`/api/readings/*`, `/api/recommendation`). 백엔드 `readings_router.py`와 1:1 대응 | **민주** |
| `shared/profileBadges.jsx` | 뱃지 목록 데이터 + 아이콘 렌더링. 헤더 아바타(류은)와 뱃지 페이지(민주)가 같이 씀 | 공용 (수정 전 서로 확인) |
| `features/auth/FlowApp.jsx` | 로그인/회원가입 화면 흐름, 앱 진입점(`main.jsx`가 이걸 렌더링) | **류은** |
| `features/menu/UserMenu.jsx` | 새싹 아이콘(아바타) 버튼 + 마이페이지/센서측정값/뱃지/로그아웃 드롭다운 메뉴 | **류은** |
| `features/menu/Tutorial.jsx` | 처음 접속했을 때 나오는 단계별 튜토리얼 | **류은** |
| `features/mypage/MyPage.jsx` | 닉네임/비번/이모지 변경, 탈퇴 | **류은** |
| `features/location/LocationSwitcher.jsx` | 좌측 상단 위치 선택 버튼 | **정현** |
| `features/location/LocationListPanel.jsx` | 위치 목록 보기/새 장소 추가(AirconPage 모달 재사용)/선택 패널 | **정현** |
| `features/location/useSelectedLocation.js` | 위치 목록/선택 상태 관리 훅. `GET /api/places` 기반, 선택 id만 localStorage | **정현** |
| `features/location/LocationContext.jsx` | `useSelectedLocation()`을 감싸는 Context — `App.jsx`가 대시보드 전체를 `LocationProvider`로 감쌈 | **정현** |
| `features/location/LocationSearchPopover.jsx` | 이미 선택된 장소의 위치(lat/lon)만 나중에 채워 넣는 경량 검색 팝오버 (에어컨 등록 없음) | **정현** |
| `features/location/EnvironmentCard.jsx` | 실시간 실내외 카드. 실내는 `sensorData`, 실외는 `GET /api/weather`로 실제 날씨 표시 | **정현** |
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
dudeoji-api/weather.py                    → 구현 완료(OpenWeatherMap Current Weather API 2.5 연동)
dudeoji-api/routers/weather_router.py     → GET /api/weather, main.py에 연결됨(표시 전용, 추천 파이프라인과는 무관)
dudeoji-api/routers/locations_router.py   → 여전히 뼈대만 있고 main.py에 연결 안 됨(위치 통합은 places_router.py 쪽에서 진행됨)
dudeoji-api/main.py, dudeoji-api/db.py    → 앱 전반 골격/에러 처리 패턴, 새 라우터 연결(공용 파일 수정함)
dudeoji-web/src/features/location/        → 위치 목록/선택은 GET /api/places 기반(더 이상 localStorage 임시 버전 아님, 선택 id만 localStorage). LocationContext로 컴포넌트 간 공유. LocationSearchPopover(위치만 채우기)와 features/auth/FlowApp.jsx의 AirconPage(장소+에어컨 신규 등록) 두 갈래로 위치 검색 UI가 나뉘어 있음
dudeoji-web/src/features/places/placesApi.js → updatePlaceLocation 함수만 승인받아 추가(류은 담당 파일, jh 수정함 표시)
dudeoji-web/src/App.jsx                   → 대시보드 return을 LocationProvider로 감싸는 부분만 승인받아 추가(공용 파일, jh 수정함 표시)
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
`useSelectedLocation.js`, `LocationContext.jsx`, `LocationSearchPopover.jsx`)가
이 역할을 담당합니다. 진행 상황:

**완료됨**
- **류은의 장소(place) 등록 기능과 조율 완료.** 새 위치 시스템을 따로 만들지 않고, `places` 테이블에 `lat`/`lon`(nullable) 컬럼을 추가하는 방향으로 진행함(`supabase/004_add_place_location.sql`). 주소/현재 위치를 위경도로 바꿔주는 `GET /places/geocode`, `GET /places/reverse-geocode`(카카오 로컬 API), 위치만 갱신하는 `PATCH /places/{place_id}`도 `places_router.py`에 구현됨.
- **`useSelectedLocation.js`가 `localStorage` 임시 버전에서 벗어났습니다.** 위치 목록은 `GET /api/places`로 서버에서 불러오고, 선택된 위치의 id만 `localStorage`에 남습니다(서버에 저장할 개념이 아니라서).
- **"위치 선택 → 화면 전환" 방식이 정해졌습니다.** 새 페이지가 아니라 `LocationListPanel`(헤더 버튼 → 패널) 방식으로 구현됨. 새 장소를 등록할 땐 `AirconPage`를 `variant="modal"`로 띄우고, 이미 있는 장소의 위치만 나중에 채울 땐 `EnvironmentCard`의 "+" 버튼 → `LocationSearchPopover`(경량, 에어컨 등록 없음)를 씀 — 검색 UI가 이 두 갈래로 나뉘어 있고 서로 공유하지 않는 별도 구현입니다.
- **여러 컴포넌트가 위치 상태를 공유하는 문제도 해결됨.** `LocationContext.jsx`를 추가해서 `LocationSwitcher`/`LocationListPanel`/`EnvironmentCard`가 `useLocationContext()`로 같은 인스턴스를 본다(예전엔 각자 `useSelectedLocation()`을 따로 호출해서 헤더에서 위치를 바꿔도 다른 컴포넌트가 못 보는 문제가 있었음).
- **실외 날씨 실시간 조회도 붙음.** `EnvironmentCard.jsx`가 선택된 위치의 lat/lon으로 `GET /api/weather`(`weather_router.py`)를 불러서 실제 온도/습도/날씨를 보여줌.

**아직 안 됨**
- **`EnvironmentCard.jsx`의 실외 날씨(`GET /api/weather`)는 표시 전용입니다.** `recommendation_engine.py`/`RecommendationCard.jsx`/`savings.py`가 쓰는 실외값은 여전히 `readings` 테이블에 저장된 값이고, `readings_router.py`는 아직 `weather.py`를 호출하지 않습니다. 즉 화면의 "실외" 카드와 추천 이유의 실외 조건이 서로 다른 값일 수 있습니다 — `readings_router.py`에서 lat/lon을 받아 `weather.py`를 호출하고 결과를 요청에 병합해야 두 값이 하나로 합쳐집니다(민주와 상의 필요).
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

