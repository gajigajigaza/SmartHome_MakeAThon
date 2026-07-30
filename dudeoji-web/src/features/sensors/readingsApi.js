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

// Render 무료 플랜은 15분 미사용 시 서버가 완전히 꺼졌다가 첫 요청에서
// 콜드스타트(20~50초)한다. SavingsSummary 등에서 이 에러 종류를 구분해
// "서버를 깨우는 중" 같은 안내 문구를 보여줄 수 있도록 내보낸다.
export function isRetryableReadError(error) {
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

// attempts=5, 800ms부터 배로 늘어나는 백오프(800/1600/3200/6400ms, 총 약
// 12초)로 늘렸다 — 기존 3회/250ms 백오프(총 750ms)는 Render 콜드스타트를
// 버티기엔 너무 짧아서, 서버가 막 깨어나는 도중에 들어온 요청이 재시도를
// 다 소진하고 "Failed to fetch"로 사용자에게 그대로 노출되곤 했다.
async function requestReadWithRetry(endpoint, options = {}, attempts = 5) {
  let lastError;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await request(endpoint, options);
    } catch (error) {
      lastError = error;
      if (!isRetryableReadError(error) || index === attempts - 1) {
        throw error;
      }
      await wait(800 * 2 ** index, options.signal);
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

// "다시 추천받기" 버튼 전용. 이전 추천을 얼마나 유지했다가(shownAt 기준)
// 어떤 결과로 끝났는지(previousOutcome)를 백엔드에 남기고, 그 자리에서 바로
// 최신 추천을 다시 받아온다 — 60초 폴링과 달리 사용자가 직접 눌렀을 때만
// 호출된다.
export async function refreshRecommendation(
  placeId,
  previousAction,
  previousOutcome,
  shownAt,
  options = {},
) {
  return request("/api/recommendation/refresh", {
    method: "POST",
    auth: true,
    body: JSON.stringify({
      place_id: placeId,
      previous_action: previousAction,
      previous_outcome: previousOutcome,
      shown_at: shownAt.toISOString(),
    }),
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
// jh 수정함 - 백엔드가 더 이상 실내값을 랜덤 생성하지 않으므로, 호출부가
// reading으로 { indoorTemperature, indoorHumidity, windowIsOpen, acIsOn }을
// 넘겨야 한다. windowIsOpen/acIsOn을 안 넘기면(undefined) null로 보내서
// "센서 미연결" 상태를 그대로 재현한다.
// jh 수정함 - outdoorTemperature/outdoorHumidity("실외 직접 입력" 시연용)도
// 안 넘기면 null로 보낸다 — 백엔드가 null이면 실제 날씨 API 값을 그대로 쓴다.
export async function createMockReading(
  placeId = null,
  testMode = "manual",
  reading = {},
  options = {},
) {
  let endpoint = appendPlaceId("/api/dev/mock-reading", placeId);
  endpoint = appendQuery(endpoint, "test_mode", testMode);

  const {
    indoorTemperature,
    indoorHumidity,
    windowIsOpen = null,
    acIsOn = null,
    outdoorTemperature = null,
    outdoorHumidity = null,
  } = reading;

  return request(endpoint, {
    method: "POST",
    auth: true,
    body: JSON.stringify({
      indoor_temperature: indoorTemperature,
      indoor_humidity: indoorHumidity,
      window_is_open: windowIsOpen,
      ac_is_on: acIsOn,
      outdoor_temperature: outdoorTemperature,
      outdoor_humidity: outdoorHumidity,
    }),
    ...options,
  });
}
