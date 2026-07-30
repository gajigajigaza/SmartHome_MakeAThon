// src/features/dashboard/devicesApi.js
// 기기 제어(/api/devices/control) API

import { request } from "../../api";

// jh 추가 - source(manual/auto)는 뱃지 퀘스트("첫 수동 조작")가 자동실행
// 카운트다운과 거절 후 수동 버튼 클릭을 구분하려고 추가됨. 기본값은
// 기존 호출부(대부분 수동 버튼)와 맞춰 "manual".
export async function controlDevice(placeId, action, source = "manual", options = {}) {
  return request("/api/devices/control", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ place_id: placeId, action, source }),
    ...options,
  });
}
