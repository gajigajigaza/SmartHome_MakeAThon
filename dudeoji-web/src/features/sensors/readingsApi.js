// src/features/sensors/readingsApi.js
// 장소별 센서 기록, 추천 기준, 테스트 기록 API

import { request } from "../../api";

function appendQuery(endpoint, key, value) {
  if (value === undefined || value === null || value === "") {
    return endpoint;
  }

  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function appendPlaceId(endpoint, placeId) {
  return appendQuery(endpoint, "place_id", placeId);
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timerId = window.setTimeout(resolve, milliseconds);

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timerId);
          reject(new DOMException("요청이 취소되었습니다.", "AbortError"));
        },
        { once: true },
      );
    }
  });
}

function isRetryableReadError(error) {
  if (error?.name === "AbortError") {
    return false;
  }

  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("temporarily") ||
    message.includes("일시적으로") ||
    message.includes("503") ||
    message.includes("500")
  );
}

async function requestReadWithRetry(endpoint, options = {}, attempts = 3) {
  let lastError;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await request(endpoint, options);
    } catch (error) {
      lastError = error;
      if (!isRetryableReadError(error) || index === attempts - 1) {
        throw error;
      }
      await wait(250 * 2 ** index, options.signal);
    }
  }

  throw lastError;
}

export async function getLatestReading(placeId = null, options = {}) {
  return requestReadWithRetry(appendPlaceId("/api/readings/latest", placeId), {
    auth: true,
    ...options,
  });
}

export async function getReadingHistory(
  limit = 8,
  placeId = null,
  after = null,
  options = {},
) {
  let endpoint = `/api/readings/history?limit=${encodeURIComponent(limit)}`;
  endpoint = appendPlaceId(endpoint, placeId);
  endpoint = appendQuery(endpoint, "after", after);

  return requestReadWithRetry(endpoint, { auth: true, ...options });
}

export async function getLogicThresholds(options = {}) {
  return requestReadWithRetry("/api/readings/logic-thresholds", {
    auth: true,
    ...options,
  });
}

export async function getWeatherStatus(
  placeId = null,
  forceRefresh = false,
  options = {},
) {
  let endpoint = appendPlaceId("/api/weather/status", placeId);
  endpoint = appendQuery(
    endpoint,
    "force_refresh",
    forceRefresh ? "true" : "false",
  );
  return requestReadWithRetry(endpoint, { auth: true, ...options });
}

export async function getRecommendation(placeId = null, options = {}) {
  return requestReadWithRetry(appendPlaceId("/api/recommendation", placeId), {
    auth: true,
    ...options,
  });
}

export async function getSavingsSummary(period, placeId = null) {
  let endpoint = `/api/savings/summary?period=${period}`;
  endpoint = appendPlaceId(endpoint, placeId);

  return requestReadWithRetry(endpoint, {
    auth: true,
  });
}

// testMode는 manual 또는 auto입니다. 백엔드가 recommendation JSON에
// TEST_MANUAL/TEST_AUTO 출처를 저장해 실제 센서 기록과 구분합니다.
export async function createMockReading(
  placeId = null,
  testMode = "manual",
  options = {},
) {
  let endpoint = appendPlaceId("/api/dev/mock-reading", placeId);
  endpoint = appendQuery(endpoint, "test_mode", testMode);

  return request(endpoint, {
    method: "POST",
    auth: true,
    ...options,
  });
}
