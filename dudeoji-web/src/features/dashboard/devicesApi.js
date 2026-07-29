// src/features/dashboard/devicesApi.js
// 기기 제어(/api/devices/control) API

import { request } from "../../api";

export async function controlDevice(placeId, action, options = {}) {
  return request("/api/devices/control", {
    method: "POST",
    auth: true,
    body: JSON.stringify({ place_id: placeId, action }),
    ...options,
  });
}
