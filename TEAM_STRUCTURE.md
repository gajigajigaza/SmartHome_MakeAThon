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
│   ├── 004_add_place_location.sql     places 테이블에 lat/lon(nullable) 컬럼 추가
│   ├── 005_add_place_default.sql      places 테이블에 is_default(not null default false) 컬럼 추가
│   └── 006_backfill_default_place.sql is_default가 하나도 없는 사용자에게 가장 오래된 장소를 기본으로 채움(1회성, 적용 여부 확인 필요)
│
├── dudeoji-api/                   [백엔드 · FastAPI]
│   ├── main.py                    ** 공용 - 라우터를 연결만 하는 앱 조립 파일 **
│   ├── db.py                      ** 공용 - Supabase 클라이언트 + 테이블 이름 상수 **
│   ├── database.py                (미사용 SQLite 코드, 실제 서비스는 Supabase 사용)
│   ├── auth_utils.py              [류은] 세션/비밀번호 보안 유틸 + 인증 dependency
│   ├── recommendation_engine.py   [민주] 판단 규칙 엔진 (자동제어/쿨다운 로직 추가하며 전면 재작성됨 — 이 과정에서 savings.py 연동이 빠짐, 아래 참고)
│   ├── savings.py                 [정현] 절감량(전력·시간·비용) 계산 — ⚠️ 지금 recommendation_engine.py가 이 파일을 import도 안 해서 실제 응답에 절감량이 안 실림(연결 복구 필요, 민주와 상의)
│   ├── weather.py                 [정현] 날씨 API 연동 (구현 완료 · 기상청 초단기실황조회 getUltraSrtNcst로 기온/습도/풍속/강수형태 + OpenWeatherMap Air Pollution으로 미세먼지. KMA_SERVICE_KEY 환경변수 필요)
│   ├── mqtt_handler.py            [민주] MQTT 사전 준비 코드 (실제 하드웨어 연결은 현장에서 진행)
│   ├── routers/
│   │   ├── auth_router.py         [류은] 회원가입/로그인/마이페이지 API
│   │   ├── places_router.py       [류은] 장소·에어컨 등록 API + 정현이 추가한 위치/기본장소/삭제 엔드포인트 + 민주가 추가한 cooldown 엔드포인트(담당자 셋 다 코드 있는 파일, 아래 2번 참고)
│   │   ├── readings_router.py     [민주] 센서 기록/추천 API (이제 weather.py를 실제로 호출함, /api/devices/control 스텁 포함 — 아래 3번의 "실외 날씨 두 소스" 항목 참고)
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
        ├── App.jsx                ** 공용 - 어느 화면을 보여줄지만 담당하는 얇은 shell ** (대시보드 return과 마이페이지 return 둘 다 LocationProvider로 감싸여 있음 — jh 수정함, 마이페이지의 "장소 정보" 섹션이 useLocationContext()를 쓰게 되면서 범위 확장)
        ├── api.js                 ** 공용 - fetch 공통 헬퍼(request)·토큰 관리만. 실제 API 함수는 아래 각 Api.js에 있음 **
        ├── App.css / DashboardOverrides.css / FlowApp.css   공용 스타일
        ├── shared/
        │   └── profileBadges.jsx  뱃지 데이터/아이콘 (메뉴 ↔ 뱃지페이지 공용)
        └── features/
            ├── auth/
            │   ├── FlowApp.jsx           [류은] 로그인/회원가입 진입점
            │   └── authApi.js            [류은] 회원가입/로그인/마이페이지 API (auth_router.py 대응)
            ├── places/
            │   ├── placesApi.js          [류은] 장소/에어컨 등록 API (places_router.py 대응). `updatePlaceLocation`/`updatePlaceDetails`/`deletePlaceItem`은 jh 수정함(승인받음).
            │   ├── AirconPage.jsx        [류은] 장소 이름+위치검색+에어컨 등록 폼. variant="signup"(회원가입)|"modal"(대시보드/마이페이지에서 재사용). "모달" 헤더의 설명 문구만 jh 수정함(류은 승인).
            │   └── CooldownSettings.jsx  [민주] 에어컨 최소 가동 시간 설정 UI(장소 정보 대시보드 카드 아래). ⚠️ `placeId` 기본값이 `1`로 하드코딩(선택된 위치 반영 안 됨), `http://127.0.0.1:8000`을 직접 fetch(배포 환경에서 안 붙음) — 둘 다 아직 안 고쳐짐
            ├── menu/
            │   ├── UserMenu.jsx           [류은] 아바타 버튼 + 드롭다운 메뉴
            │   └── Tutorial.jsx           [류은] 첫 방문 튜토리얼
            ├── mypage/MyPage.jsx          [류은] 마이페이지 — 단, "장소 정보" 섹션(장소 목록/이름·위치 변경/기본 장소 지정/삭제/장소 추가) 전체는 정현이 승인받아 만든 부분(jh 수정함). 닉네임/비밀번호/복구/탈퇴/에어컨 정보는 류은 담당 그대로.
            ├── location/
            │   ├── LocationSwitcher.jsx      [정현] 좌측 상단 위치 버튼
            │   ├── LocationListPanel.jsx     [정현] 위치 목록 표시/선택 패널. "+ 장소 추가" 버튼은 없앰 — 장소 추가는 이제 마이페이지 "장소 정보" 섹션에서만 한다(중복 제거).
            │   ├── useSelectedLocation.js    [정현] 선택된 위치 목록/선택 상태 관리 훅(GET /api/places 기반, 선택된 id만 localStorage). `isDefault` 필드 포함, `setDefaultLocation`/`savePlaceDetails`/`removeLocation` 제공. 초기 선택 로직: localStorage에 유효한 선택이 없으면 `is_default` 장소를 우선 선택.
            │   ├── LocationContext.jsx       [정현] 위 훅을 감싸는 Context(Provider는 App.jsx에서 씀, 이제 대시보드뿐 아니라 마이페이지 return도 감쌈) — 여러 컴포넌트가 각자 훅을 불러서 서로 다른 위치를 가리키던 문제를 고치려고 도입. `addressCache`(장소별 reverse-geocode 결과 캐시)도 여기서 관리.
            │   ├── LocationSearchPopover.jsx [정현] 위치 검색 UI(주소로 찾기/현재 위치로 찾기). `embedded` prop으로 두 가지 모드 지원 — 기본(팝오버 껍데기+자체 닫기버튼, EnvironmentCard의 "+"용)과 embedded(안쪽 검색 UI만, 마이페이지 모달 안에 넣어서 씀).
            │   ├── buildPlacePayload.js      [정현] AirconPage의 registeredAircons(슬롯)를 POST /api/places 요청 형태로 바꾸는 매핑 함수. 원래 LocationListPanel.jsx 안에 있었는데 MyPage.jsx도 같이 쓰게 되면서 별도 파일로 뺌.
            │   ├── EnvironmentCard.jsx       [정현] 실시간 실내외 환경 카드 — 실외는 GET /api/weather로 실제 날씨 표시
            │   └── SavingsSummary.jsx        [정현] 예상 절감(1일/1주/1달) — 아직 placeholder(위 savings.py 연동 복구 후 진행 가능)
            │   (locationApi.js는 만들지 않기로 확정 — placesApi.js의 fetchMyPlaces/createPlaceWithAircons/updatePlaceDetails 등을 그대로 재사용)
            ├── dashboard/
            │   ├── RecommendationCard.jsx [민주] 현재 추천 + 이유
            │   └── RecommendationPopup.jsx [민주] 자동제어(AUTO 모드) 추천 확인 팝업 — ⚠️ `place_id: 1`이 하드코딩돼 있고, `http://127.0.0.1:8000`을 `request()` 대신 직접 fetch해서 배포 환경에서 안 붙음(고쳐야 함)
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
| `routers/places_router.py` | `/api/aircon-models`, `/api/places`(GET/POST — GET 응답에 `is_default` 포함, POST는 유저의 첫 장소면 자동으로 `is_default: true`), `/api/places/{place_id}`(PATCH — `name`/`lat`/`lon` 각각 선택 필드, 이름만/위치만/둘다 가능; DELETE — 소유자 확인 후 삭제, `user_aircons`는 DB `ON DELETE CASCADE`로 자동 정리됨, 삭제한 게 기본 장소였으면 남은 것 중 가장 오래된 걸 새 기본 장소로 재할당), `/api/places/{place_id}/default`(PATCH, 기본 장소 지정 — 같은 유저 다른 place는 자동 false), `/api/places/{place_id}/cooldown`(PATCH, 에어컨 최소 가동시간 — **민주 작성**), `/api/places/geocode`, `/api/places/reverse-geocode` — 카카오 로컬 API. `places` 테이블에 `lat`/`lon`(nullable, `004_add_place_location.sql`)/`is_default`(not null default false, `005_add_place_default.sql`) 컬럼. **담당자 셋 다 코드 있는 파일**(핵심 CRUD=류은, 위치/기본장소/삭제=정현이 추가, cooldown=민주) | **류은**(+정현 일부) |
| `routers/readings_router.py` | `/api/readings/*`, `/api/recommendation`, `/api/devices/control`(스텁, 로그만 남기고 실제 제어 없음) — 센서 기록 저장/조회, 추천 결과 조회. MQTT/dev_tools로 들어오는 센서 데이터도 결국 여기로 저장됨. `save_reading_for_user()`가 이제 `weather.py`의 `fetch_outdoor_weather`를 직접 호출해서 저장 전 실외값을 채우는데, 사용자의 장소를 `user_id`로만 조회해 `.limit(1)` — **`is_default`나 선택된 위치를 안 보고 그냥 아무 장소나(사실상 첫 번째) 씀**. 다중 위치 사용자는 엉뚱한 장소 기준 날씨로 추천받을 수 있는 알려진 버그(아래 6번 참고). `calculate_ac_run_time()`으로 에어컨 누적 가동시간을 추정해 `target_cooldown_minutes`와 비교 판단 | **민주** |
| `recommendation_engine.py` | 실내외 온습도 + 날씨/미세먼지/바람 + 에어컨 가동 상태(`is_ac_on`/`ac_run_time_minutes`/`target_cooldown_minutes`)를 보고 판단하는 규칙 엔진(`determine_action`). 자동제어/쿨다운 로직 추가하며 전면 재작성됨 — THI 공식이 바뀌었고, 센서 이상값용 `ERROR` 액션이 새로 생겼고, **`savings.py` import/호출이 빠졌음**(아래 `savings.py` 행 참고) | **민주** |
| `savings.py` | 판단된 행동(action)에 대해 절감 전력(kWh)·시간·비용(원)·멘트를 계산 (`estimate_savings`) — ⚠️ 지금 `recommendation_engine.py`가 이 함수를 아예 안 부르고 있어서(import도 없음) 실제 추천 응답에 절감량이 안 실림. 프론트 `SavingsSummary.jsx`도 아직 placeholder라 당장 화면이 깨지진 않지만, 절감량 기능을 만들려면 이 연동부터 복구해야 함(민주와 상의 필요) | **정현** |
| `weather.py` | 외부 날씨 API 연동. `fetch_outdoor_weather(lat, lon)`이 기상청 초단기실황조회(getUltraSrtNcst, 기온/습도/풍속/강수형태)와 OpenWeatherMap Air Pollution API(미세먼지)를 합쳐서 반환(`precipitation_probability`는 둘 다 없어서 항상 `None`). 위경도→기상청 격자좌표 변환(`latlon_to_kma_grid`, 순수함수)/발표시각 역산(`_get_kma_base_datetime`) 등 헬퍼 포함. `KMA_SERVICE_KEY` 환경변수 필요(`.env.example` 참고, data.go.kr에서 이 API에 대한 활용신청 승인이 별도로 필요할 수 있음). `routers/weather_router.py`(표시 전용)와 `routers/readings_router.py`(추천 파이프라인) 양쪽에서 호출됨 | **정현** |
| `routers/weather_router.py` | `GET /api/weather?lat=&lon=` — 로그인 필요, `weather.py`의 `fetch_outdoor_weather`를 그대로 감싸서 반환, 실패 시 502(콘솔에 원본 에러 로그 남김). `EnvironmentCard.jsx`가 실외 날씨 표시에 씀. `readings_router.py`도 이제 같은 함수를 직접 호출하지만 **서로 다른 위경도를 쓸 수 있다** — 이 라우터는 프론트가 넘긴(현재 선택된 위치의) lat/lon을 쓰고, `readings_router.py`는 사용자의 아무 장소나 고정으로 쓴다(위 `readings_router.py` 행·아래 6번 참고) | **정현** |
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

- `useSelectedLocation.js` — 저장된 위치 목록/선택 상태 관리 훅. **이제 `localStorage` 임시 버전이 아님** — `GET /api/places`(류은의 장소 등록 기능, `placesApi.js`의 `fetchMyPlaces`)로 목록을 서버에서 불러온다. 선택된 위치의 id만 여전히 `localStorage`에 남아 있음(서버에 저장할 개념이 아니라서). `isDefault` 필드가 각 위치에 포함되고, 로컬에 유효한 선택이 없으면(첫 로그인, 선택했던 장소가 삭제됨 등) `is_default` 장소를 우선 선택한 뒤 없으면 첫 번째 장소로 폴백한다. `setDefaultLocation`/`savePlaceDetails`(이름+위치 부분 업데이트)/`removeLocation`도 여기서 제공.
- `LocationContext.jsx` — 위 훅을 감싸는 Context(`LocationProvider`/`useLocationContext`). `App.jsx`가 **대시보드 return과 마이페이지 return 둘 다**를 `LocationProvider`로 감싸고(마이페이지 "장소 정보" 섹션이 추가되며 범위 확장됨), `LocationSwitcher`/`LocationListPanel`/`EnvironmentCard`/`MyPage`가 각자 `useSelectedLocation()`을 따로 부르지 않고 `useLocationContext()`로 같은 값을 공유한다. 장소별 주소 캐시(`addressCache`/`setCachedAddress`, reverse-geocode 결과 캐싱)도 여기서 관리 — 위치가 바뀌면 그 장소의 캐시만 무효화됨.
- `LocationSwitcher.jsx` — 헤더 좌측 상단에 보이는 버튼. 누르면 `LocationListPanel`이 열림.
- `LocationListPanel.jsx` — 위치 목록을 보여주고 선택하는 역할만 한다. **"+ 장소 추가" 버튼은 없앴다** — 장소 추가는 이제 마이페이지 "장소 정보" 섹션에서만 한다(대시보드/마이페이지 두 군데서 같은 기능을 따로 구현하던 걸 하나로 합침).
- `LocationSearchPopover.jsx` — 위치 검색 UI(주소로 찾기/현재 위치로 찾기). `embedded` prop으로 두 모드를 지원한다: 기본 모드(팝오버 껍데기+자체 닫기버튼, `EnvironmentCard.jsx`의 "+" 버튼용, 고르는 즉시 `PATCH /api/places/{id}`로 저장)와 `embedded` 모드(안쪽 검색 UI만 반환, 마이페이지의 "장소 정보 변경하기" 모달 안에 들어가서 씀 — 고른 값은 바로 저장 안 되고 "저장하기"를 눌러야 저장됨).
- `buildPlacePayload.js` — `AirconPage`가 관리하는 `registeredAircons`(슬롯) 배열을 `POST /api/places`가 기대하는 payload로 바꾸는 매핑 함수. 원래 `LocationListPanel.jsx` 안에 있었는데, 마이페이지의 "장소 추가" 버튼도 같은 로직이 필요해지면서 컴포넌트 파일 밖으로 뺐다(컴포넌트 파일이 비-컴포넌트를 export하면 Vite fast refresh가 깨진다는 lint 경고 때문이기도 함).
- `EnvironmentCard.jsx` — 실내는 `sensorData`(readings 테이블, App.jsx가 내려줌)를 그대로 표시. **실외는 `GET /api/weather`(아래 `weather_router.py`)를 선택된 위치의 lat/lon으로 호출해 실제 날씨를 표시** — 위치가 없으면 "위치를 설정해 주세요" + "+" 버튼(`LocationSearchPopover`, 기본 모드)을 보여준다.
- `features/mypage/MyPage.jsx`의 **"장소 정보" 섹션(정현 담당, 류은 승인)** — 마이페이지 안에서 장소 목록 전체 CRUD를 다룬다:
  - 목록: 기본 장소가 항상 맨 위(정렬은 화면 표시용 파생값일 뿐, 서버에 정렬을 저장하진 않음), 3개 초과면 "더보기"로 접고 펼침, "+ 장소 추가"(대시보드 드롭다운에서 빠진 그 기능이 여기로 옴) 버튼이 나란히 있음.
  - 각 장소 행: 기본 장소 지정(별표, `setDefaultLocation` 호출 시 `selectLocation`도 같이 호출돼서 즉시 대시보드 선택 위치로도 바뀜), "변경"(이름+위치를 한 모달에서 같이 수정, 바뀐 필드만 `savePlaceDetails`로 저장), "삭제"(확인 다이얼로그, 장소 1개 남으면 비활성화).
  - "장소 추가"/"변경" 모달 둘 다 `AirconPage`(variant="modal")가 쓰는 것과 같은 `location-add-modal-*` CSS 클래스를 재사용해서 디자인이 통일돼 있고, 스크롤 위치에 따라 모달이 밀리던 버그 때문에 `createPortal`로 `document.body`에 직접 마운트한다.
  - 이름 인라인 편집은 없앴다(별명 변경 등 마이페이지의 다른 편집이 전부 모달 방식이라 그게 더 일관적이라고 판단함) — 이름도 이제 "변경" 모달 안에서 위치와 같이 수정한다.

**참고할 점:** 류은이 만든 장소(place) 등록 기능(`/api/places`)이 곧 "위치" 기능이다.
별도의 `locations` 테이블/엔드포인트를 새로 만들지 않고, `places` 테이블을 확장하는
방향으로 통합이 끝났다(`routers/locations_router.py`는 여전히 빈 뼈대로 남아 있고 안 씀):
- `places` 테이블에 `lat`/`lon`(nullable, `004_add_place_location.sql`)/`is_default`(not null default false, `005_add_place_default.sql`) 컬럼 추가. `006_backfill_default_place.sql`은 `is_default`가 하나도 없는 기존 사용자들에게 가장 오래된 장소를 기본으로 채워주는 1회성 백필 — **아직 Supabase에 적용 안 했으면 적용 필요**.
- 주소/현재 위치를 위경도로 바꿔주는 `GET /places/geocode`, `GET /places/reverse-geocode`(카카오 로컬 API 연동), 위치+이름 갱신하는 `PATCH /places/{place_id}`, 삭제하는 `DELETE /places/{place_id}`, 기본 장소 지정하는 `PATCH /places/{place_id}/default`가 전부 `places_router.py`에 구현(정현이 승인받아 추가, `jh 수정함` 표시).

이 검색 UI(주소로 찾기/현재 위치로 찾기 탭)는 이제 세 군데서 쓰인다:
`features/places/AirconPage.jsx`(장소를 **새로 등록**할 때, `variant="signup"|"modal"`, 자체 구현)와
`features/location/LocationSearchPopover.jsx`(기본 모드 — `EnvironmentCard`의 "+"용, embedded 모드 — 마이페이지 "장소 정보 변경하기"용).
`AirconPage.jsx`는 여전히 별도 구현이라 `LocationSearchPopover`와 로직을 공유하지 않지만,
`LocationSearchPopover` 자체는 `embedded` prop 덕분에 `EnvironmentCard`/마이페이지 두 곳에서 로직을 공유한다.

**실외 날씨 두 가지 소스 — 예전엔 완전히 분리였는데, 이제 연결은 됐지만 값이 다를 수 있음:**
`EnvironmentCard.jsx`가 보여주는 실외 온습도/날씨는 `GET /api/weather`(프론트가 선택한 위치의 lat/lon으로 즉시 조회, 표시 전용)에서 오고,
`recommendation_engine.py`/`RecommendationCard.jsx`가 쓰는 실외값은 `readings` 테이블에 저장된 값에서 온다.
`readings_router.py`의 `save_reading_for_user()`가 이제 실제로 `weather.py`를 호출해서 저장 시점에 채우긴 하지만,
**어느 장소의 lat/lon을 쓸지는 `is_default`도, 프론트가 선택한 위치도 안 보고 그냥 그 사용자의 아무 장소나(사실상 첫 번째)를 쓴다** — 다중 위치를 등록한 사용자는 화면의 "실외" 카드와 추천 이유의 실외 조건이 서로 다른 장소 기준일 수 있다. `save_reading_for_user()`가 요청 시점에 현재 선택된(또는 `is_default`) 장소의 lat/lon을 명시적으로 받도록 고쳐야 완전히 해결됨(민주와 상의 필요, 아래 6번 참고).

---

## 4. 프론트 파일별 설명

| 파일 | 무슨 역할 | 담당 |
|---|---|---|
| `App.jsx` | "지금 어느 화면(대시보드/마이페이지/뱃지/센서측정값)을 보여줄지" 상태만 관리하는 shell. 각 화면 컴포넌트를 조립만 함 | 공용 (새 페이지 추가할 때만 같이 상의 후 수정) |
| `api.js` | `request()`(fetch 공통 헬퍼) + 로그인 토큰 저장/조회만 있음. **실제 API 호출 함수는 여기 없음** — 아래 각 `*Api.js` 참고 | 공용 (여기에 새 API 함수를 직접 추가하지 말 것) |
| `features/auth/authApi.js` | 회원가입/로그인/마이페이지 API (`/api/auth/*`). 백엔드 `auth_router.py`와 1:1 대응 | **류은** |
| `features/places/placesApi.js` | 장소/에어컨 등록 API (`/api/places`, `/api/aircon-models`). 백엔드 `places_router.py`와 1:1 대응. `updatePlaceLocation`/`updatePlaceDetails`(이름+위치 부분 업데이트)/`deletePlaceItem`은 정현이 승인받아 추가(`jh 수정함` 표시) | **류은** |
| `features/places/AirconPage.jsx` | 장소 이름+위치검색+에어컨 등록 폼. `variant="signup"`(회원가입)\|`"modal"`(대시보드/마이페이지에서 재사용). "모달" 헤더 설명 문구만 정현이 승인받아 수정 | **류은** |
| `features/places/CooldownSettings.jsx` | 에어컨 최소 가동 시간 설정 UI. ⚠️ `placeId` 기본값 `1` 하드코딩(선택된 위치 반영 안 됨), `http://127.0.0.1:8000` 직접 fetch(배포 환경에서 안 붙음) — 둘 다 미해결 | **민주** |
| `features/sensors/readingsApi.js` | 센서 기록/추천 API (`/api/readings/*`, `/api/recommendation`). 백엔드 `readings_router.py`와 1:1 대응 | **민주** |
| `shared/profileBadges.jsx` | 뱃지 목록 데이터 + 아이콘 렌더링. 헤더 아바타(류은)와 뱃지 페이지(민주)가 같이 씀 | 공용 (수정 전 서로 확인) |
| `features/auth/FlowApp.jsx` | 로그인/회원가입 화면 흐름, 앱 진입점(`main.jsx`가 이걸 렌더링). `handleLogin`에 로그인마다 `localStorage`의 선택된 위치를 지우는 한 줄만 정현이 승인받아 추가(로그인할 때마다 기본 장소가 자동 선택되게) | **류은** |
| `features/menu/UserMenu.jsx` | 새싹 아이콘(아바타) 버튼 + 마이페이지/센서측정값/뱃지/로그아웃 드롭다운 메뉴 | **류은** |
| `features/menu/Tutorial.jsx` | 처음 접속했을 때 나오는 단계별 튜토리얼 | **류은** |
| `features/mypage/MyPage.jsx` | 닉네임/비번/복구정보/탈퇴, 에어컨 정보 표시는 류은 담당. **"장소 정보" 섹션(장소 목록/이름·위치 변경/기본 장소 지정/삭제/장소 추가)은 정현이 승인받아 만듦** — 아래 3번 참고 | **류은**(+정현, 섹션 단위로 나뉨) |
| `features/location/LocationSwitcher.jsx` | 좌측 상단 위치 선택 버튼 | **정현** |
| `features/location/LocationListPanel.jsx` | 위치 목록 보기/선택 패널. "+ 장소 추가"는 없앰(마이페이지로 이동) | **정현** |
| `features/location/useSelectedLocation.js` | 위치 목록/선택 상태 관리 훅. `GET /api/places` 기반, 선택 id만 localStorage. `isDefault`/`setDefaultLocation`/`savePlaceDetails`/`removeLocation` 포함 | **정현** |
| `features/location/LocationContext.jsx` | `useSelectedLocation()`을 감싸는 Context — `App.jsx`가 대시보드+마이페이지를 `LocationProvider`로 감쌈. `addressCache`도 여기서 관리 | **정현** |
| `features/location/LocationSearchPopover.jsx` | 위치 검색 UI. `embedded` prop으로 기본(팝오버, `EnvironmentCard`용)/embedded(마이페이지 모달용) 두 모드 지원 | **정현** |
| `features/location/buildPlacePayload.js` | `registeredAircons` 슬롯 배열 → `POST /api/places` payload 매핑 함수(`LocationListPanel.jsx`에서 분리됨) | **정현** |
| `features/location/EnvironmentCard.jsx` | 실시간 실내외 카드. 실내는 `sensorData`, 실외는 `GET /api/weather`로 실제 날씨 표시 | **정현** |
| `features/location/SavingsSummary.jsx` | "오늘의 예상 절감" 자리 (지금은 placeholder — `savings.py` 연동 복구 후 진행 가능) | **정현** |
| `features/dashboard/RecommendationCard.jsx` | 현재 추천 + 이유 카드. `MAINTAIN`/`OPEN_WINDOW`/`USE_AIRCON`/`CLOSE_WINDOW`/`ENJOY`/`ERROR` 액션 아이콘·타입 매핑 | **민주** |
| `features/dashboard/RecommendationPopup.jsx` | 자동제어(AUTO 모드) 추천 확인 팝업. ⚠️ `place_id: 1` 하드코딩, `http://127.0.0.1:8000` 직접 fetch — 둘 다 미해결 | **민주** |
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
dudeoji-api/savings.py                    → ⚠️ recommendation_engine.py가 호출 안 해서 파이프라인에서 빠진 상태(재연결 필요)
dudeoji-api/weather.py                    → 기상청 초단기실황조회(getUltraSrtNcst)로 교체됨(기온/습도/풍속/강수형태) + OpenWeatherMap Air Pollution(미세먼지). KMA_SERVICE_KEY 필요
dudeoji-api/routers/weather_router.py     → GET /api/weather, main.py에 연결됨(표시 전용)
dudeoji-api/routers/locations_router.py   → 여전히 뼈대만 있고 main.py에 연결 안 됨(위치 통합은 places_router.py 쪽에서 진행됨)
dudeoji-api/routers/places_router.py      → 승인받아 geocode/reverse-geocode/PATCH(이름+위치)/DELETE/PATCH default 엔드포인트 추가(류은 담당 파일 일부, jh 수정함 표시. cooldown 엔드포인트는 민주가 같은 파일에 추가함)
dudeoji-api/main.py, dudeoji-api/db.py    → 앱 전반 골격/에러 처리 패턴, 새 라우터 연결(공용 파일 수정함)
dudeoji-web/src/features/location/        → 위치 목록/선택은 GET /api/places 기반. LocationContext로 컴포넌트 간 공유(대시보드+마이페이지 둘 다). isDefault/기본 장소 지정/삭제/addressCache 전부 포함. buildPlacePayload.js 신규
dudeoji-web/src/features/mypage/MyPage.jsx의 "장소 정보" 섹션 → 승인받아 통째로 만듦(류은 담당 파일 일부, jh 수정함 표시) — 장소 목록/이름·위치 변경/기본 지정/삭제/장소 추가
dudeoji-web/src/features/places/placesApi.js → updatePlaceLocation/updatePlaceDetails/deletePlaceItem 함수만 승인받아 추가(류은 담당 파일, jh 수정함 표시)
dudeoji-web/src/features/places/AirconPage.jsx → "모달" 헤더 설명 문구 한 줄만 승인받아 수정(류은 담당 파일, jh 수정함 표시)
dudeoji-web/src/features/auth/FlowApp.jsx → handleLogin에 로그인 시 위치 선택 초기화 한 줄만 승인받아 추가(류은 담당 파일, jh 수정함 표시)
dudeoji-web/src/App.jsx                   → 대시보드 return과 마이페이지 return을 LocationProvider로 감싸는 부분만 승인받아 추가(공용 파일, jh 수정함 표시)
supabase/005_add_place_default.sql, 006_backfill_default_place.sql → is_default 컬럼 추가 + 기존 사용자 백필(정현 작성)
```

### 민주
```
dudeoji-api/recommendation_engine.py      → 자동제어/쿨다운 로직 추가하며 전면 재작성됨(savings.py 연동 빠짐, 위 참고)
dudeoji-api/routers/readings_router.py    → weather.py를 실제로 호출하도록 연결함(단, "아무 장소나" 쓰는 버그 있음), /api/devices/control 스텁 추가
dudeoji-api/routers/places_router.py      → cooldown 엔드포인트(PATCH /places/{id}/cooldown)만 추가(류은 담당 파일 일부)
dudeoji-api/mqtt_handler.py
dudeoji-api/dev_tools/
dudeoji-web/src/features/dashboard/       → RecommendationCard.jsx, RecommendationPopup.jsx(신규, ⚠️ place_id/URL 하드코딩 미해결)
dudeoji-web/src/features/places/CooldownSettings.jsx → 신규(류은 담당 폴더 안, ⚠️ placeId/URL 하드코딩 미해결)
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
`useSelectedLocation.js`, `LocationContext.jsx`, `LocationSearchPopover.jsx`,
`buildPlacePayload.js`) + 마이페이지 "장소 정보" 섹션이 이 역할을 담당합니다. 진행 상황:

**완료됨**
- 류은의 장소(place) 등록 기능과 조율 완료. `places` 테이블에 `lat`/`lon`(`004_add_place_location.sql`)/`is_default`(`005_add_place_default.sql`) 컬럼 추가. geocode/reverse-geocode/`PATCH {place_id}`(이름+위치)/`DELETE {place_id}`/`PATCH {place_id}/default`가 전부 `places_router.py`에 구현됨.
- `useSelectedLocation.js`가 `localStorage` 임시 버전에서 완전히 벗어남. 목록은 `GET /api/places`, 선택 id만 `localStorage`. 로그인할 때마다(`FlowApp.jsx`의 `handleLogin`) 그 선택을 지워서, 로그인 직후엔 항상 `is_default` 장소가 자동 선택됨.
- 여러 컴포넌트가 위치 상태를 공유하는 문제 해결(`LocationContext.jsx`, 대시보드+마이페이지 둘 다 커버). 장소별 reverse-geocode 결과도 캐싱됨(`addressCache`).
- **기본 장소(is_default) 기능 완료.** 별표로 지정, 지정 즉시 대시보드 선택 위치로도 반영, 목록에서 항상 맨 위 정렬, 장소 삭제 시 다른 장소로 자동 재할당(백엔드), 기존 사용자 백필용 `006_backfill_default_place.sql`(적용 여부 확인 필요).
- **마이페이지 "장소 정보" 섹션에서 이름 변경/위치 변경/삭제/장소 추가까지 전부 가능해짐.** 대시보드 헤더 드롭다운(`LocationListPanel`)의 "+ 장소 추가"는 없애고 마이페이지로 통합(중복 제거). 이름+위치 편집은 하나의 모달("장소 정보 변경하기")에서 같이 처리 — 별명 변경 등 마이페이지의 다른 편집과 패턴을 통일함.
- **실외 날씨 실시간 조회 완료.** `EnvironmentCard.jsx`가 선택된 위치의 lat/lon으로 `GET /api/weather`(`weather_router.py`)를 불러서 실제 온도/습도/날씨를 보여줌.
- **`readings_router.py`가 이제 `weather.py`를 실제로 호출합니다**(민주가 연결) — 다만 아래 "아직 안 됨"의 첫 항목처럼 완전히 해결된 건 아님.

**아직 안 됨**
- **`readings_router.py`가 weather.py를 호출할 때 "아무 장소나"(사실상 첫 번째) 씁니다.** `is_default`도, 프론트가 지금 선택한 위치도 안 보고 그냥 `user_id`로만 조회해서 `.limit(1)`한 결과를 씁니다. 위치를 하나만 등록한 사용자는 문제없지만, 여러 개 등록한 사용자는 화면의 "실외" 카드(선택된 위치 기준)와 추천 이유(엉뚱한 위치 기준)가 서로 다른 장소 데이터를 쓸 수 있습니다 — `save_reading_for_user()`가 어떤 장소 기준인지 명시적으로 받도록 고쳐야 함(민주와 상의 필요).
- **`savings.py` 연동이 끊어져 있습니다.** `recommendation_engine.py`가 전면 재작성되면서 `estimate_savings` 호출이 빠졌습니다. `SavingsSummary.jsx`가 실제 절감량을 보여주려면 이 연동부터 복구해야 합니다(민주와 상의 필요).
- **`CooldownSettings.jsx`/`RecommendationPopup.jsx`(민주 작성)가 `placeId`/`place_id`를 `1`로 하드코딩하고, `http://127.0.0.1:8000`을 `request()` 대신 직접 fetch합니다.** 배포 환경에서 안 붙고, 여러 위치를 등록한 사용자에겐 항상 엉뚱한 장소를 대상으로 동작합니다.
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

