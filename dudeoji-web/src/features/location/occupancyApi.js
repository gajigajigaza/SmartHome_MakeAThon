// src/features/location/occupancyApi.js
// 재실 감지(카메라) 최신 상태 조회 API (occupancy_router.py의 GET /api/occupancy/latest 대응)

import { request } from "../../api";

export async function getLatestOccupancy(placeId) {
  return request(`/api/occupancy/latest?place_id=${placeId}`, {
    auth: true,
  });
}
