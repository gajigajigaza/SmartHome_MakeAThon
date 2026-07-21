# 두더지 (Dudeoji)

실내/실외 온습도와 날씨·미세먼지·풍속 데이터를 종합 분석해서
**"창문을 열까, 에어컨을 켤까, 지금 상태를 유지할까"**를 추천해주고,
그 선택으로 아낀(혹은 쓴) 전력량과 비용까지 보여주는 스마트홈 해커톤 프로젝트입니다.

센서(또는 시뮬레이션된 값)로 실내 환경을, 외부 API로 실외 환경을 읽어 규칙 기반 엔진이
`창문 열기 / 에어컨 사용 / 유지 / 창문 닫기 / (이미 좋은 상태) 유지 중`을 판단하고,
사용자는 대시보드에서 그 추천과 이유, 그리고 하루/주/달 단위 절감 전력·비용을 확인할 수 있습니다.

## 팀 구성

- **인증·장소/에어컨 등록** (류은) — 회원가입/로그인, 에어컨 등록 관리, mock 데이터
- **추천 판단 엔진** (민주) — 추천 규칙 엔진
- **날씨 연동·절감량 계산·장소 기능** (정현) — 실외 API, 전력 계산, 위치 선택/검색 UI


## 개발 환경

| 구분 | 스택 |
|---|---|
| 백엔드 | Python 3.13+, FastAPI, `supabase-py`(ORM 없이 직접 사용), httpx |
| DB | Supabase (Postgres) |
| 프론트엔드 | React 19, Vite, ESLint |
| 하드웨어 연동 | MQTT (`paho-mqtt`, 기본 비활성화) |
| 외부 API | 기상청 초단기실황조회, OpenWeatherMap Air Pollution, 카카오 로컬(geocode) |
| 배포 | 백엔드: Render / 프론트엔드: 별도 정적 호스팅 |

### 실행 방법

**백엔드** (`dudeoji-api/`, `.env` 필요)
```bash
cd dudeoji-api
pip install -r requirements.txt   
fastapi dev main.py
```

**프론트엔드** (`dudeoji-web/`, `.env`/`.env.local` 필요)
```bash
cd dudeoji-web
npm install
npm run dev      
npm run build     
npm run lint
```

필요한 환경변수(`.env`)는 다음과 같습니다.

- 백엔드: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`(필수), `FRONTEND_URL`, `MQTT_ENABLED`, `OPENWEATHER_API_KEY`, `KMA_SERVICE_KEY`, `KAKAO_REST_API_KEY`
- 프론트엔드: `VITE_API_BASE_URL`(생략 시 배포된 백엔드 주소를 기본값으로 사용)

하드웨어 없이 센서 데이터를 채워보고 싶다면 `dudeoji-api/dev_tools/mock_simulator.py`를 돌리거나,
로그인 후 대시보드 환경 카드의 "테스트 모드" 토글 → "가짜 데이터 받기" 버튼을 눌러 한 건씩 생성할 수 있습니다.

## 프로젝트 구조

```
SmartHome_MakeAThon/
├── CLAUDE.md                 아키텍처/담당 범위 상세 문서
├── TEAM_STRUCTURE.md          팀 역할 분담 상세 표
├── supabase/                  DB 마이그레이션 SQL (수동 적용)
│
├── dudeoji-api/                FastAPI 백엔드
│   ├── main.py                  앱 조립(CORS, 라우터 연결)만 담당
│   ├── db.py                    Supabase 클라이언트 + 테이블명 상수
│   ├── auth_utils.py             세션 토큰 검증(해시/만료)
│   ├── recommendation_engine.py 추천 판단 규칙 엔진 (핵심 로직)
│   ├── savings.py                절감 전력/비용 계산
│   ├── weather.py                기상청/OpenWeatherMap 연동
│   ├── mqtt_handler.py           하드웨어 게이트웨이용 MQTT 리스너 (기본 비활성화)
│   ├── routers/                  기능별 API 라우터
│   │   ├── auth_router.py         /api/auth/*
│   │   ├── places_router.py       /api/places*, /api/aircon-models
│   │   ├── readings_router.py     /api/readings*, /api/recommendation, /api/savings/summary
│   │   └── weather_router.py      /api/weather
│   └── dev_tools/                 하드웨어 없이 테스트하는 모의 데이터 스크립트
│
└── dudeoji-web/                React + Vite 프론트엔드
    └── src/
        ├── App.jsx                최상위 화면 전환만 담당하는 얇은 shell
        ├── api.js                 공용 fetch 헬퍼 + 인증 토큰 저장
        └── features/
            ├── auth/               로그인/회원가입/비밀번호 복구 플로우
            ├── dashboard/          추천 카드, 자동제어 팝업
            ├── location/           위치 스위처, 환경(실내/실외) 카드, 절감 요약, 위치 검색
            ├── places/             장소·에어컨 등록, 쿨다운 설정
            ├── sensors/            센서 측정값 화면, 온도 그래프
            ├── mypage/             닉네임/비밀번호/장소 정보/탈퇴
            ├── badge/              프로필 뱃지 선택
            ├── menu/                아바타 메뉴, 첫 방문 튜토리얼
            └── background/         배경 장식 캐릭터
```

## 섹션별 주요 기능

**로그인 / 회원가입** (`features/auth/`)
- 아이디/비밀번호 로그인, 회원가입(닉네임 → 장소+에어컨 등록 2단계), 비밀번호 찾기(복구 토큰 방식)
- 회원가입 중 위치 검색(주소/현재 위치 → 위경도)까지 한 흐름으로 처리
  <img width="1892" height="897" alt="스크린샷 2026-07-21 232628" src="https://github.com/user-attachments/assets/c907e46e-cd5b-4323-bac7-d925448a3f97" />


**대시보드** (`features/dashboard/`, `features/location/`)
- 현재 추천(창문 열기/에어컨 사용/유지 등)과 그 이유를 보여주는 추천 카드, "추천 시작" 버튼으로 결과 노출
- 실내/실외 온습도·날씨를 보여주는 환경 카드, 위치별 전환(LocationSwitcher)
- 하루/주/달 단위 절감 전력·비용 요약
- 자동제어 모드일 때 뜨는 확인 팝업(에어컨/창문 동작 전 사용자 확인)
  <img width="1917" height="906" alt="스크린샷 2026-07-21 232444" src="https://github.com/user-attachments/assets/865373e3-f4e6-464c-a706-bef46ca259c0" />


**센서 측정값** (`features/sensors/`)
- 시간대별 실내 온도 그래프, 측정 이력 조회
  <img width="1881" height="900" alt="스크린샷 2026-07-21 232709" src="https://github.com/user-attachments/assets/67bb2e40-7240-4055-9668-b8efb9815773" />


**마이페이지** (`features/mypage/`)
- 닉네임/비밀번호 변경, 계정 복구 설정, 탈퇴
- 장소 정보 관리(장소별 이름·위치 수정, 기본 장소 지정, 장소 추가/삭제)
  <img width="1877" height="883" alt="스크린샷 2026-07-21 232736" src="https://github.com/user-attachments/assets/a2f0e9b9-9a5a-4764-98cf-667b48b56393" />


**뱃지 / 메뉴** (`features/badge/`, `features/menu/`)
- 프로필 뱃지 선택, 헤더 아바타 드롭다운, 첫 방문 튜토리얼

## 앞으로 생각할 점 (센서 연결 & 개선 방향)

- **실제 하드웨어 연결**: 지금은 실내 센서값을 수동 입력/모의 생성기로 대체하고 있음. 실제 온습도 센서를 붙일 때는
  `mqtt_handler.py`(현재 `MQTT_ENABLED=false`로 기본 비활성화)를 통해 `/api/readings`와 동일한 저장 경로(`save_reading_for_user()`)로
  들어오게 되어 있어, 브로커 연결과 페이로드 포맷만 맞추면 됨. 창문 개폐 센서·에어컨 전원 센서도 아직 값이 거의 항상 `None`(미연결) 상태로 들어오는데, 실제로 연결되면 추천 엔진의 조건 분기(쿨다운, 창문 상태 기반 분기)가 훨씬 정교하게 동작.
- **실외 날씨 좌표 불일치**: `weather_router.py`(화면 표시용)와 `readings_router.py`(실제 추천 계산용)가 서로 다른 로직으로 위경도를 가져와, 다중 장소 사용자는 화면에 보이는 실외 날씨와 추천 이유의 실외 조건이 다를 수 있는 알려진 버그가 존재-정리가 필요
- **에어컨 끄기 추천 부재**: 추천 엔진에 "에어컨을 꺼도 됩니다"라는 액션이 없어서, 과냉방 상황에서도 능동적으로 끄라고 안내하지 못함.
- **하드코딩된 place_id**: `CooldownSettings.jsx`, `RecommendationPopup.jsx`가 `place_id`를 `1`로 고정하고 로컬 주소로 직접 fetch하는 부분이 남아 있어, 다중 장소·배포 환경에서 정리가 필요.
- **테스트/린트 부재**: 백엔드·프론트 모두 자동화된 테스트 스위트가 없음. 해커톤 이후 실제 서비스로 이어간다면 핵심 추천 로직(THI 계산, 규칙 엔진 분기)부터 테스트를 붙이는 게 우선순위.

