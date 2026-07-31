// src/features/location/occupancyApi.js
// 재실 감지(카메라) 최신 상태 조회 API (occupancy_router.py의 GET /api/occupancy/latest 대응)

import { request } from "../../api";

export async function getLatestOccupancy(placeId) {
  return request(`/api/occupancy/latest?place_id=${placeId}`, {
    auth: true,
  });
}

// jh 수정함 - 테스트 모드에서 "사람 있음/없음"을 재현하기 위해 occupancy_router.py의
// POST /api/occupancy/logs를 그대로 호출한다. 원래 카메라/센서 보드가 감지할 때마다
// 부르는 엔드포인트라, 진짜 재실 기록으로 남아서 추천 엔진(occupancy_present)에도
// 실제로 반영된다 — 화면 아이콘만 바뀌는 가짜 표시가 아니다.
export async function createOccupancyLog(placeId, personDetected) {
  return request("/api/occupancy/logs", {
    method: "POST",
    auth: true,
    body: JSON.stringify({
      place_id: placeId,
      person_detected: personDetected,
    }),
  });
}

// 재실 패턴 예측(도착/퇴근 전 사전조치) API — occupancy_router.py의
// /api/occupancy/prediction* 엔드포인트에 대응.
export async function getOccupancyPrediction(placeId, options = {}) {
  const endpoint = `/api/occupancy/prediction?place_id=${encodeURIComponent(placeId)}`;
  return request(endpoint, { auth: true, ...options });
}

export async function respondOccupancyPrediction(
  placeId,
  transitionKey,
  accept,
  options = {},
) {
  return request("/api/occupancy/prediction/respond", {
    method: "POST",
    auth: true,
    body: JSON.stringify({
      place_id: placeId,
      transition_key: transitionKey,
      accept,
    }),
    ...options,
  });
}
