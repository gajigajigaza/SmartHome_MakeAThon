# 두더지 (Dudeoji)

실내/실외 온습도(및 날씨/미세먼지/풍속)를 분석해 "창문 열기 vs 에어컨 사용 vs 유지"를 추천하고,
예상 절감 전력/비용을 보여주는 스마트홈 해커톤 프로젝트입니다.

## 구성

- `dudeoji-api/` — FastAPI 백엔드 (Supabase 사용)
- `dudeoji-web/` — React + Vite 프론트엔드

## 실행 방법

### 백엔드
```
cd dudeoji-api
pip install -r requirements.txt
fastapi dev main.py
```
`.env` 필요 (`.env.example` 참고).

### 프론트엔드
```
cd dudeoji-web
npm install
npm run dev
```

## 더 자세한 내용

- 아키텍처, 담당 범위, 환경변수 등은 [`CLAUDE.md`](./CLAUDE.md) 참고
- 팀 구조/담당표는 [`TEAM_STRUCTURE.md`](./TEAM_STRUCTURE.md) 참고

---
*초안 — 추후 스크린샷, 배포 링크, 기능 소개 등 보강 예정*
