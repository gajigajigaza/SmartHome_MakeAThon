// src/features/badge/badgesApi.js
// 프로필(뱃지) 잠금 상태 API (GET /api/badges, badges_router.py 대응)

import { request } from "../../api";

export async function getBadges() {
  const response = await request("/api/badges", { auth: true });
  return response.badges;
}
