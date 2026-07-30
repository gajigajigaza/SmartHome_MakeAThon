// src/features/location/occupancyApi.js
// 재실 감지(카메라) 최신 상태 조회 API (occupancy_router.py의 GET /api/occupancy/latest 대응)

import { request } from "../../api";

export async function getLatestOccupancy(placeId) {
  return request(`/api/occupancy/latest?place_id=${placeId}`, {
    auth: true,
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
