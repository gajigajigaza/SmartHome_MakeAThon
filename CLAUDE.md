# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 담당 범위 (매우 중요 — 항상 지킬 것)

이 저장소는 3인 해커톤 팀 공용입니다. 나는 **정현** 담당입니다.

**수정 가능한 파일/폴더:**
- `dudeoji-api/savings.py`
- `dudeoji-api/weather.py`
- `dudeoji-api/routers/locations_router.py`
- `dudeoji-web/src/features/location/*`

**다른 담당자 파일:** 읽고 참고하는 것은 자유롭게 하되, **직접 수정하지 마세요.** 수정이 필요하면 코드를 고치는 대신 "이 부분을 이렇게 바꿔야 할 것 같다"고 먼저 알려주세요.

이 경계를 지켜야 하는 이유: 팀원들이 각자 파일을 동시에 작업 중이라, 담당 외 파일이 바뀌면 merge 충돌 및 예기치 않은 동작이 생깁니다. (자세한 담당 표는 `TEAM_STRUCTURE.md` 참고)


## 프로젝트 개요

두더지(Dudeoji) — 실내/실외 온습도(및 날씨/미세먼지/풍속)를 받아 "창문 열기 vs 에어컨 사용 vs 유지"를 추천하고, 예상 절감 전력/비용을 함께 보여주는 해커톤 스마트홈 앱입니다. 두 개의 앱으로 구성됩니다.

- `dudeoji-api/` — FastAPI 백엔드. Render에 배포되며, Supabase(Postgres, ORM 없이 `supabase-py` 직접 사용)를 저장소로 씁니다.
- `dudeoji-web/` — React 19 + Vite 프론트엔드. 별도로 배포되며 `VITE_API_BASE_URL`을 통해 백엔드와 통신합니다.

이 저장소는 여러 브랜치를 합친 해커톤 코드베이스입니다(`TEAM_STRUCTURE.md` 참고). 각 파일/폴더는 모듈 docstring에 담당자(류은/정현/민주)가 명시되어 있습니다. 새로운 최상위 구조를 만들기보다는 아래 설명된 기능 영역에 맞는 폴더 안에서 수정하는 것을 우선하세요.


## 명령어

백엔드 (`dudeoji-api/`, 로컬 `.env` 필요 — 아래 환경변수 섹션 참고):
```
pip install -r requirements.txt   # 또는: uv sync (pyproject.toml/uv.lock 존재)
fastapi dev main.py               # reload가 켜진 개발 서버
```
백엔드에는 테스트 스위트나 린터가 설정되어 있지 않습니다.

프론트엔드 (`dudeoji-web/`, 로컬 `.env` 필요 — 아래 환경변수 섹션 참고):
```
npm install
npm run dev       # vite 개발 서버
npm run build     # 프로덕션 빌드
npm run lint      # eslint .
npm run preview   # 프로덕션 빌드 미리보기
```
프론트엔드에도 테스트 스위트가 설정되어 있지 않습니다.

하드웨어 없이 센서 데이터 시뮬레이션 (`dudeoji-api/`에서, 백엔드 서버가 실행 중이어야 함):
```
$env:AUTH_TOKEN="<로그인 토큰>"
python dev_tools/mock_simulator.py
```
몇 초마다 `/api/readings`로 가짜 센서값을 POST해서 대시보드에 실시간처럼 데이터가 보이게 합니다.

## 아키텍처

### 백엔드 요청 흐름

`main.py`는 앱을 조립만 합니다(CORS 설정, `include_router`) — 비즈니스 로직은 여기 없습니다. 라우터는 `routers/` 안에 있고, 각각 하나의 기능 영역에 대응합니다.

- `routers/auth_router.py` — `/api/auth/*`: 회원가입, 로그인, 로그아웃, 비밀번호/닉네임 변경, 탈퇴. 세션 토큰은 JWT가 아니라 무작위 문자열이며, `auth_utils.py`가 이를 해시(SHA-256)해서 `sessions` 테이블에 저장(만료 30일)합니다. 다른 모든 라우터는 `auth_utils.get_current_user`를 `Depends`로 사용해 `Authorization: Bearer <token>` 헤더를 `sessions`와 대조 검증합니다.
- `routers/places_router.py` — `/api/places`, `/api/aircon-models`: 등록된 장소("집"/"회사")와 그 장소의 에어컨 목록.
- `routers/readings_router.py` — `/api/readings*`, `/api/recommendation`: 센서 데이터 파이프라인의 핵심. `save_reading_for_user()`가 REST 엔드포인트와 `mqtt_handler.py` 양쪽에서 공유하는 단일 진입점으로, 센서값을 검증하고 추천을 계산한 뒤 `readings` 테이블에 저장합니다(추천 결과 JSON도 원본 측정값과 함께 저장됨). 조회(`/latest`, `/history`)는 항상 Supabase에서 그대로 읽어오며 재계산하지 않습니다.
- `routers/locations_router.py` — 아직 뼈대만 있고 `main.py`에 연결되지 않음. 본격적으로 구현하기 전에, `places_router.py`의 `places` 테이블과의 의도적인 중복을 확인하세요(`TEAM_STRUCTURE.md` §6 참고) — 별도 테이블을 새로 만들기보다 `places`에 위경도 컬럼을 추가해 확장하는 방향이 의도된 것입니다.

라우터 외부의 비즈니스 로직:
- `recommendation_engine.py` — `determine_action()`: 불쾌지수(THI) + 날씨/미세먼지/풍속 임계값을 이용한 규칙 엔진으로 `MAINTAIN` / `OPEN_WINDOW` / `USE_AIRCON` / `CLOSE_WINDOW` / `ENJOY` 중 하나를 판단합니다. `window_is_open`(현재는 항상 `False` — 창문 센서가 아직 없어서 `CLOSE_WINDOW`/`ENJOY`는 미래의 창문 센서를 위해 미리 준비된, 지금은 도달하지 않는 분기)과 `current_mode`(`MANUAL`/`AUTO`, 아직 구현되지 않은 자동 제어 기능을 위한 `is_auto_triggered` 계산에 사용)로 분기합니다.
- `savings.py` — `estimate_savings(action)`: 액션을 전력/비용/시간 절감 추정치로 변환합니다. 현재 `OPEN_WINDOW`에 대해서만 고정값을 반환하며, 일/주/월 누적 계산은 아직 구현되지 않았습니다.
- `weather.py` — OpenWeatherMap One Call API 3.0(기온/체감온도/습도/풍속/날씨상태/강수확률) + Air Pollution API(PM2.5/PM10/AQI)를 비동기(`httpx.AsyncClient`)로 호출해 `fetch_outdoor_weather(lat, lon)`가 실외 정보를 반환합니다. DB 조회 없이 파라미터로 받은 위경도만 사용하고, 실패 시 예외를 그대로 던집니다(호출부가 처리). `weather_condition`은 OpenWeatherMap 코드값을 `recommendation_engine.py`가 비교하는 한글 문자열(`맑음`/`흐림`/`비`/`소나기`/`눈`/`태풍`)로 매핑해서 반환합니다. 테스트용으로 동일한 형태를 반환하는 동기 함수 `fetch_outdoor_weather_mock`도 같은 파일에 있습니다. **아직 `readings_router.py`(담당: 민주)의 `/api/readings`가 이 함수를 호출하지 않으므로, 실제 파이프라인에 연결하려면 그쪽에서 위경도를 받아 호출하고 결과를 요청에 병합하는 작업이 필요합니다.**
- `mqtt_handler.py` — 하드웨어 게이트웨이용 선택적 MQTT 리스너로, `MQTT_ENABLED=true` 환경변수로 켤 수 있습니다. 기본은 비활성화이며, 브로커에 연결 실패해도 API 전체가 죽지 않고 로그만 남깁니다.
- `db.py` — Supabase 클라이언트를 생성하고 테이블명 상수(`READINGS_TABLE`, `USERS_TABLE` 등)를 정의하는 유일한 곳. 새 테이블명은 다른 곳에 인라인으로 쓰지 말고 여기에 추가하세요.
- `database.py` — 예전 SQLite 코드의 흔적으로, 아무 데서도 import되지 않는 미사용 파일입니다.

DB 스키마/마이그레이션은 저장소 루트의 `supabase/*.sql`에 있으며, Supabase 프로젝트에 수동으로 적용합니다(별도 마이그레이션 러너 없음).

### 프론트엔드 구조

`App.jsx`는 얇은 shell입니다. 어떤 최상위 화면(`dashboard` / `mypage` / `badges` / `sensors`)을 보여줄지만 관리하고 기능 컴포넌트들을 조립합니다 — 기능 로직을 추가할 곳이 아닙니다.

`api.js`는 공용 `request()` fetch 헬퍼와 인증 토큰 저장(`localStorage`)만 담당합니다. 의도적으로 API 호출 함수가 없으며, 그 함수들은 백엔드 라우터 하나당 하나씩 `features/<영역>/*Api.js`에 있습니다.
- `features/auth/authApi.js` ↔ `auth_router.py`
- `features/places/placesApi.js` ↔ `places_router.py`
- `features/sensors/readingsApi.js` ↔ `readings_router.py`
- `features/location/locationApi.js` — 아직 없음. `useSelectedLocation.js`는 `locations_router.py`가 생기기 전까지 임시로 `localStorage`에 저장하는 방식을 씁니다.

프론트가 렌더링해야 하는 새 백엔드 필드를 추가할 때(예: 새로운 `action` 값)는 양쪽을 함께 수정하세요 — `dudeoji-api`의 라우터/스키마와, 그에 대응하는 소비처(예: `action` 값의 아이콘/타입 매핑을 담당하는 `RecommendationCard.jsx`).

`src/features/` 아래 기능 폴더: `auth/`, `places/`, `menu/`(아바타 + 드롭다운 + 첫 방문 튜토리얼), `mypage/`, `location/`(위치 스위처/패널, 환경 카드, 절감 요약 — 위의 중복 관련 참고 사항 참조), `dashboard/`(추천 카드), `sensors/`(측정값 화면 + 온도 그래프), `badge/`, `background/`(배경 장식 캐릭터). `shared/profileBadges.jsx`는 헤더 아바타(menu)와 뱃지 페이지가 함께 쓰므로, 뱃지 데이터 구조를 바꿀 때는 양쪽 사용처를 모두 확인해야 합니다.

## 환경변수

백엔드 `.env`(커밋되지 않음): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`(필수 — 없으면 `db.py`가 import 시점에 예외 발생), `FRONTEND_URL`(추가 CORS origin), `MQTT_ENABLED`, `OPENWEATHER_API_KEY`(OpenWeatherMap One Call/Air Pollution API 키, `weather.py`가 사용).

프론트엔드 `.env`/`.env.local`: `VITE_API_BASE_URL`(설정하지 않으면 배포된 Render 백엔드 주소를 기본값으로 사용하므로, 로컬 백엔드를 띄우지 않아도 프론트가 프로덕션 API에 대해 동작합니다).

## 프론트엔드/백엔드 경계에서 작업할 때

양쪽 모두 기능별로 파일이 나뉘어 있고 공유되는 타입 시스템이 없기 때문에, 한쪽에 필드를 추가했는데 다른 쪽이 깨져도 에러 없이 그냥 화면이 잘못 나옵니다. 작업을 마치기 전에 `TEAM_STRUCTURE.md`의 "새 기능 넣을 때 체크리스트"를 확인하세요 — 새 백엔드 필드는 대응하는 프론트 소비처 수정이 필요하고, 새 프론트 API 호출은 `api.js`에 직접 넣지 말고 대응하는 `features/*/*.Api.js`에 넣어야 하며, Supabase 스키마 변경은 별도로 공유하지 않으면 팀원에게 보이지 않습니다(`supabase/`의 원본 SQL 파일 외에는 마이그레이션 추적 수단이 없음).
