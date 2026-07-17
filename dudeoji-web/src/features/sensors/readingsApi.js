// src/features/sensors/readingsApi.js
// 담당: 민주
//
// 백엔드 routers/readings_router.py(/api/readings/*, /api/recommendation)에
// 1:1로 대응합니다. App.jsx(대시보드)와 SensorReadings.jsx가 여기서
// 가져다 씁니다.
import { request } from "../../api";

export async function getLatestReading() {
  return request("/api/readings/latest", { auth: true });
}

// minzoo 브랜치에서 이식: 최근 센서 기록 여러 개 조회 (센서 측정값 화면)
export async function getReadingHistory(limit = 8) {
  return request(`/api/readings/history?limit=${limit}`, { auth: true });
}

export async function getRecommendation() {
  return request("/api/recommendation", { auth: true });
}

// jh 수정함 - GET /api/savings/summary 대응. SavingsSummary.jsx(예상
// 절감 카드)가 period="day"|"week"|"month"로 호출한다.
export async function getSavingsSummary(period) {
  return request(`/api/savings/summary?period=${period}`, { auth: true });
}

// jh 수정함 - POST /api/dev/mock-reading 대응(민주 승인받음). EnvironmentCard.jsx의
// "테스트 모드" 버튼이 가짜 센서값 하나를 만들어 저장할 때 호출한다.
export async function createMockReading() {
  return request("/api/dev/mock-reading", { method: "POST", auth: true });
}
