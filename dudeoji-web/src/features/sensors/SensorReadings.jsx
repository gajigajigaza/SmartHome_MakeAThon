import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createMockReading,
  getLogicThresholds,
  getReadingHistory,
  getWeatherStatus,
} from "./readingsApi";
import LocationSwitcher from "../location/LocationSwitcher";
import SharedAppSidebar from "../navigation/SharedAppSidebar";
import { useLocationContext } from "../location/LocationContext";
import "./SensorReadings.css";

const LIVE_REFRESH_SECONDS = 5;
const TEST_DURATION_PRESETS = [30, 60, 120, 300];
const TEST_INTERVAL_PRESETS = [5, 10, 15, 30, 60];
const TEST_DURATION_DEFAULT_SECONDS = 30;
const TEST_INTERVAL_DEFAULT_SECONDS = 5;
const TEST_DURATION_MIN_SECONDS = 5;
const TEST_DURATION_MAX_SECONDS = 3600;
const TEST_INTERVAL_MIN_SECONDS = 1;
const TEST_INTERVAL_MAX_SECONDS = 600;
const TEST_DURATION_STORAGE_KEY = "dudeoji_sensor_test_duration_seconds";
const TEST_INTERVAL_STORAGE_KEY = "dudeoji_sensor_test_interval_seconds";
const HISTORY_LIMIT = 1000;

function normalizeSeconds(value, fallback, minimum, maximum) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(numericValue)));
}

function getStoredSeconds(storageKey, fallback, minimum, maximum) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    return storedValue == null
      ? fallback
      : normalizeSeconds(storedValue, fallback, minimum, maximum);
  } catch {
    return fallback;
  }
}

function getStoredTestDurationSeconds() {
  if (typeof window !== "undefined") {
    try {
      const currentValue = window.localStorage.getItem(
        TEST_DURATION_STORAGE_KEY,
      );
      if (currentValue == null) {
        const legacyValue = window.localStorage.getItem(
          "dudeoji_sensor_test_record_seconds",
        );
        if (legacyValue != null) {
          return normalizeSeconds(
            legacyValue,
            TEST_DURATION_DEFAULT_SECONDS,
            TEST_DURATION_MIN_SECONDS,
            TEST_DURATION_MAX_SECONDS,
          );
        }
      }
    } catch {
      // 아래 기본 저장값 조회로 계속 진행합니다.
    }
  }

  return getStoredSeconds(
    TEST_DURATION_STORAGE_KEY,
    TEST_DURATION_DEFAULT_SECONDS,
    TEST_DURATION_MIN_SECONDS,
    TEST_DURATION_MAX_SECONDS,
  );
}

function getStoredTestIntervalSeconds() {
  return getStoredSeconds(
    TEST_INTERVAL_STORAGE_KEY,
    TEST_INTERVAL_DEFAULT_SECONDS,
    TEST_INTERVAL_MIN_SECONDS,
    TEST_INTERVAL_MAX_SECONDS,
  );
}

const RANGE_OPTIONS = [
  { key: "1h", label: "1시간", milliseconds: 60 * 60 * 1000 },
  { key: "6h", label: "6시간", milliseconds: 6 * 60 * 60 * 1000 },
  { key: "24h", label: "24시간", milliseconds: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7일", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "전체", milliseconds: null },
];

const FALLBACK_THRESHOLDS = {
  sensor_temperature_min: -10,
  sensor_temperature_max: 50,
  indoor_hot: 26,
  indoor_cold: 18,
  indoor_humidity_high: 70,
  thi_high: 75,
  pm25_bad: 35,
  wind_ventilation: 3,
  wind_strong: 10,
  outdoor_temperature_margin: 2,
  ac_cooldown_min_temperature: 22,
};

const ACTION_LABELS = {
  OPEN_WINDOW: "환기 권장",
  USE_AIRCON: "에어컨 권장",
  MAINTAIN: "현재 상태 유지",
  CLOSE_WINDOW: "창문 닫기",
  ENJOY: "쾌적 상태",
  ERROR: "센서 점검",
};

const READING_SOURCE_LABELS = {
  SENSOR: "실내 센서",
  TEST_MANUAL: "수동 테스트값",
  TEST_AUTO: "자동 테스트값",
  UNKNOWN: "출처 확인 필요",
};

const METRICS = [
  {
    key: "indoorTemperature",
    title: "실내 온도",
    unit: "℃",
    icon: "🌡️",
    tone: "coral",
    decimals: 1,
    group: "indoor",
    source: "실내 센서",
  },
  {
    key: "indoorHumidity",
    title: "실내 습도",
    unit: "%",
    icon: "💧",
    tone: "blue",
    decimals: 0,
    group: "indoor",
    source: "실내 센서",
  },
  {
    key: "thi",
    title: "불쾌지수 (THI)",
    unit: "",
    icon: "🙂",
    tone: "purple",
    decimals: 1,
    group: "indoor",
    source: "실내 온·습도 계산",
  },
  {
    key: "outdoorTemperature",
    title: "실외 온도",
    unit: "℃",
    icon: "☀️",
    tone: "orange",
    decimals: 1,
    group: "outdoor",
    source: "날씨 API",
  },
  {
    key: "outdoorHumidity",
    title: "실외 습도",
    unit: "%",
    icon: "☔",
    tone: "indigo",
    decimals: 0,
    group: "outdoor",
    source: "날씨 API",
  },
  {
    key: "windSpeed",
    title: "풍속",
    unit: "m/s",
    icon: "💨",
    tone: "cyan",
    decimals: 1,
    group: "outdoor",
    source: "날씨 API",
  },
  {
    key: "pm25",
    title: "미세먼지 (PM2.5)",
    unit: "㎍/㎥",
    icon: "◌",
    tone: "green",
    decimals: 0,
    group: "outdoor",
    source: "대기질 API",
  },
];

function getMetricSourceClass(metric, record) {
  if (!record) {
    return "is-unknown";
  }

  if (metric.group === "outdoor") {
    return record.outdoorDataValid ? "is-api" : "is-unknown";
  }

  if (record.isTestReading) {
    return "is-test";
  }

  if (record.readingSource === "UNKNOWN") {
    return "is-unknown";
  }

  return "is-actual";
}

function getMetricSourceLabel(metric, record) {
  const sourceClass = getMetricSourceClass(metric, record);

  if (sourceClass === "is-api") {
    return "날씨 API";
  }
  if (sourceClass === "is-test") {
    return "테스트값";
  }
  if (sourceClass === "is-actual") {
    return "실제값";
  }
  return "출처 미확인";
}

function getIndoorSourceLabel(record) {
  return READING_SOURCE_LABELS[record?.readingSource] || "출처 확인 필요";
}

function getIndoorSourceDescription(record) {
  if (record?.readingSource === "SENSOR") {
    return "센서 노드에서 직접 수신";
  }
  if (record?.readingSource === "TEST_MANUAL") {
    return "수동으로 생성한 실내 테스트값";
  }
  if (record?.readingSource === "TEST_AUTO") {
    return "자동으로 생성한 실내 테스트값";
  }
  return "기록 출처를 확인할 수 없음";
}

function getAcLabel(record) {
  if (!record?.acDataAvailable || typeof record.acIsOn !== "boolean") {
    return "미연결";
  }
  return record.acIsOn ? "가동 중" : "꺼짐";
}

function getRecommendationLabel(record) {
  if (!record) {
    return "측정 대기";
  }

  if (record.recommendationAction === "OPEN_WINDOW") {
    return record.windowDataAvailable ? "창문 열기 권장" : "창문 확인 후 환기";
  }
  if (record.recommendationAction === "CLOSE_WINDOW") {
    return record.windowDataAvailable ? "창문 닫기" : "창문 상태 확인";
  }
  if (record.recommendationAction === "USE_AIRCON") {
    return record.acDataAvailable
      ? "에어컨 가동 권장"
      : "에어컨 상태 확인 후 냉방";
  }
  if (record.recommendationAction === "ENJOY") {
    if (record.controlContext === "AIRCON") return "에어컨 가동 유지";
    if (record.controlContext === "VENTILATION") return "환기 유지";
    return "쾌적 상태";
  }
  return (
    ACTION_LABELS[record.recommendationAction] || record.recommendationAction
  );
}

function formatObservationTime(value) {
  if (!value) return "—";
  const normalizedValue =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
      ? `${value.replace(" ", "T")}:00+09:00`
      : value;
  const parsed = new Date(normalizedValue);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return String(value);
}

function formatHistoryTick(date, rangeKey) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  if (rangeKey === "1h") {
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (rangeKey === "6h") {
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (rangeKey === "24h") {
    return date.toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

function getMetricReferenceLines(metric, thresholds) {
  if (metric.key === "indoorTemperature") {
    return [
      { value: thresholds.indoor_hot, label: `냉방 ${thresholds.indoor_hot}℃` },
    ];
  }
  if (metric.key === "thi") {
    return [
      { value: thresholds.thi_high, label: `THI ${thresholds.thi_high}` },
    ];
  }
  if (metric.key === "pm25") {
    return [
      { value: thresholds.pm25_bad, label: `환기 제한 ${thresholds.pm25_bad}` },
    ];
  }
  if (metric.key === "windSpeed") {
    return [
      {
        value: thresholds.wind_ventilation,
        label: `환기 ${thresholds.wind_ventilation}`,
      },
      {
        value: thresholds.wind_strong,
        label: `강풍 ${thresholds.wind_strong}`,
      },
    ];
  }
  return [];
}

function getMetricDomain(metric, values, thresholds) {
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  const references = getMetricReferenceLines(metric, thresholds).map(
    (item) => item.value,
  );
  if (references.length) {
    minimum = Math.min(minimum, ...references);
    maximum = Math.max(maximum, ...references);
  }

  if (metric.key.includes("Humidity")) {
    const padding = Math.max((maximum - minimum) * 0.2, 5);
    return [Math.max(0, minimum - padding), Math.min(100, maximum + padding)];
  }
  if (metric.key === "pm25" || metric.key === "windSpeed") {
    const padding = Math.max(
      (maximum - minimum) * 0.2,
      metric.key === "windSpeed" ? 1 : 5,
    );
    return [0, maximum + padding];
  }

  const minimumSpan =
    metric.key === "indoorTemperature"
      ? 8
      : metric.key === "outdoorTemperature"
        ? 10
        : 12;
  const center = (minimum + maximum) / 2;
  const span = Math.max(maximum - minimum, minimumSpan);
  return [center - span / 2, center + span / 2];
}

function formatGapDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}초`;
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}분`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}

function percentile(values, ratio) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)),
  );
  return sorted[position];
}

function buildCompressedTimeline(records, left, drawableWidth) {
  if (records.length === 0) {
    return {
      xPositions: [],
      gapBreaks: [],
    };
  }

  if (records.length === 1) {
    return {
      xPositions: [left + drawableWidth / 2],
      gapBreaks: [],
    };
  }

  const times = records.map((record) => record.measuredAt.getTime());
  const deltas = times
    .slice(1)
    .map((time, index) => Math.max(1, time - times[index]));
  const positiveDeltas = deltas.filter((delta) => delta > 0);

  const typicalGap =
    positiveDeltas.length >= 3
      ? percentile(positiveDeltas, 0.25)
      : Math.min(...positiveDeltas, 60 * 1000);

  const gapThreshold = Math.max(
    5 * 60 * 1000,
    Math.max(typicalGap || 60 * 1000, 1000) * 8,
  );

  const gapIndexes = deltas
    .map((delta, index) => (delta > gapThreshold ? index : null))
    .filter((index) => index !== null);

  if (gapIndexes.length === 0) {
    const firstTime = times[0];
    const lastTime = times.at(-1);
    const timeRange = Math.max(lastTime - firstTime, 1);

    return {
      xPositions: records.map(
        (record) =>
          left +
          ((record.measuredAt.getTime() - firstTime) / timeRange) *
            drawableWidth,
      ),
      gapBreaks: [],
    };
  }

  const clusters = [];
  let clusterStart = 0;

  gapIndexes.forEach((gapIndex) => {
    clusters.push({
      start: clusterStart,
      end: gapIndex,
    });
    clusterStart = gapIndex + 1;
  });
  clusters.push({
    start: clusterStart,
    end: records.length - 1,
  });

  const breakWidth = Math.min(
    42,
    Math.max(28, drawableWidth * 0.08),
    drawableWidth / (gapIndexes.length * 2 + 2),
  );
  const totalBreakWidth = breakWidth * gapIndexes.length;
  const availableClusterWidth = Math.max(
    drawableWidth - totalBreakWidth,
    drawableWidth * 0.25,
  );
  const clusterWeights = clusters.map((cluster) =>
    Math.max(cluster.end - cluster.start, 0.75),
  );
  const totalWeight = clusterWeights.reduce((sum, weight) => sum + weight, 0);
  const xPositions = new Array(records.length);
  const gapBreaks = [];
  let cursor = left;

  clusters.forEach((cluster, clusterIndex) => {
    const isFirstCluster = clusterIndex === 0;
    const isLastCluster = clusterIndex === clusters.length - 1;
    const clusterWidth =
      availableClusterWidth *
      (clusterWeights[clusterIndex] / Math.max(totalWeight, 0.001));

    const count = cluster.end - cluster.start + 1;
    if (count === 1) {
      if (isFirstCluster && !isLastCluster) {
        xPositions[cluster.start] = cursor + clusterWidth;
      } else if (isLastCluster && !isFirstCluster) {
        xPositions[cluster.start] = cursor;
      } else {
        xPositions[cluster.start] = cursor + clusterWidth / 2;
      }
    } else {
      const firstTime = times[cluster.start];
      const lastTime = times[cluster.end];
      const duration = Math.max(lastTime - firstTime, 1);

      for (let index = cluster.start; index <= cluster.end; index += 1) {
        xPositions[index] =
          cursor + ((times[index] - firstTime) / duration) * clusterWidth;
      }
    }

    cursor += clusterWidth;

    if (!isLastCluster) {
      const previousIndex = cluster.end;
      const nextIndex = cluster.end + 1;
      gapBreaks.push({
        x: cursor + breakWidth / 2,
        previousIndex,
        nextIndex,
        duration: times[nextIndex] - times[previousIndex],
      });
      cursor += breakWidth;
    }
  });

  const maximumX = left + drawableWidth;
  return {
    xPositions: xPositions.map((x) => Math.max(left, Math.min(maximumX, x))),
    gapBreaks,
  };
}

function selectTimeLabelIndexes(records, xPositions, gapBreaks) {
  if (records.length === 0) {
    return [];
  }

  const candidates = [
    0,
    ...gapBreaks.map((gap) => gap.nextIndex),
    Math.floor((records.length - 1) / 2),
    records.length - 1,
  ];
  const uniqueCandidates = [...new Set(candidates)]
    .filter((index) => index >= 0 && index < records.length)
    .sort((left, right) => xPositions[left] - xPositions[right]);

  const selected = [];
  const minimumDistance = 92;

  uniqueCandidates.forEach((index) => {
    const isFirst = index === 0;
    const isLast = index === records.length - 1;
    const previousIndex = selected.at(-1);

    if (
      isFirst ||
      previousIndex === undefined ||
      xPositions[index] - xPositions[previousIndex] >= minimumDistance
    ) {
      selected.push(index);
      return;
    }

    if (isLast) {
      selected[selected.length - 1] = index;
    }
  });

  if (!selected.includes(records.length - 1)) {
    selected.push(records.length - 1);
  }

  return [...new Set(selected)].sort(
    (left, right) => xPositions[left] - xPositions[right],
  );
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function toFiniteNumber(value) {
  if (value === "" || value === undefined || value === null) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNullableBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "open", "opened", "열림"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "close", "closed", "닫힘"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function calculateThi(temperature, humidity) {
  if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) {
    return null;
  }

  return (
    1.8 * temperature -
    0.55 * (1 - humidity / 100) * (1.8 * temperature - 26) +
    32
  );
}

function normalizeReading(record) {
  if (!record) {
    return null;
  }

  const indoorTemperature = toFiniteNumber(
    firstDefined(record.indoor_temperature, record.indoorTemperature),
  );
  const indoorHumidity = toFiniteNumber(
    firstDefined(record.indoor_humidity, record.indoorHumidity),
  );
  const outdoorTemperature = toFiniteNumber(
    firstDefined(record.outdoor_temperature, record.outdoorTemperature),
  );
  const outdoorHumidity = toFiniteNumber(
    firstDefined(record.outdoor_humidity, record.outdoorHumidity),
  );
  const windSpeed = toFiniteNumber(
    firstDefined(record.wind_speed, record.windSpeed),
  );
  const pm25 = toFiniteNumber(record.pm25);
  const measuredAtValue = firstDefined(
    record.measured_at,
    record.recordedAt,
    record.measuredAt,
  );
  const measuredAt = measuredAtValue ? new Date(measuredAtValue) : new Date();
  const recommendation = record.recommendation || {};
  const recommendationAction = firstDefined(
    recommendation.action,
    record.recommendationAction,
    "MAINTAIN",
  );
  const rawWindow = firstDefined(record.window_is_open, record.windowIsOpen);
  const windowDataAvailable = Boolean(
    firstDefined(
      recommendation.window_data_available,
      record.windowDataAvailable,
      false,
    ),
  );
  const readingSource = firstDefined(
    recommendation.reading_source,
    record.readingSource,
    "UNKNOWN",
  );
  const outdoorDataSource = firstDefined(
    recommendation.outdoor_data_source,
    record.outdoorDataSource,
    "UNKNOWN",
  );
  const outdoorDataValid = Boolean(
    firstDefined(
      recommendation.outdoor_data_valid,
      record.outdoorDataValid,
      false,
    ),
  );
  const acDataAvailable = Boolean(
    firstDefined(
      recommendation.ac_data_available,
      record.acDataAvailable,
      false,
    ),
  );
  const rawAcState = firstDefined(
    recommendation.ac_is_on,
    record.ac_is_on,
    record.acIsOn,
  );

  return {
    id: firstDefined(record.id, `${measuredAt.getTime()}-${Math.random()}`),
    placeId: firstDefined(record.place_id, record.placeId, null),
    indoorTemperature,
    indoorHumidity,
    outdoorTemperature,
    outdoorHumidity,
    windSpeed,
    pm25,
    weatherCondition: firstDefined(
      record.weather_condition,
      record.weatherCondition,
      "정보 없음",
    ),
    windowDataAvailable,
    windowIsOpen: windowDataAvailable ? toNullableBoolean(rawWindow) : null,
    currentMode: firstDefined(
      record.current_mode,
      record.currentMode,
      "MANUAL",
    ),
    recommendationAction,
    recommendationTitle: firstDefined(
      recommendation.title,
      record.recommendationTitle,
      ACTION_LABELS[recommendationAction],
      "현재 상태 유지",
    ),
    recommendationReason: firstDefined(
      recommendation.reason,
      record.recommendationReason,
      "",
    ),
    readingSource,
    isTestReading: ["TEST_MANUAL", "TEST_AUTO"].includes(readingSource),
    outdoorDataSource,
    outdoorDataValid: outdoorDataValid && outdoorDataSource === "WEATHER_API",
    acDataAvailable,
    acIsOn: acDataAvailable ? toNullableBoolean(rawAcState) : null,
    controlContext: firstDefined(
      recommendation.control_context,
      record.controlContext,
      "UNKNOWN",
    ),
    weatherObservedAt: firstDefined(
      recommendation.weather_observed_at,
      record.weatherObservedAt,
      null,
    ),
    airQualityObservedAt: firstDefined(
      recommendation.air_quality_observed_at,
      record.airQualityObservedAt,
      null,
    ),
    weatherFetchedAt: firstDefined(
      recommendation.weather_fetched_at,
      record.weatherFetchedAt,
      null,
    ),
    weatherCacheUsed: Boolean(
      firstDefined(recommendation.weather_cache_used, false),
    ),
    kmaStatus: firstDefined(recommendation.kma_status, "UNKNOWN"),
    airQualityStatus: firstDefined(
      recommendation.air_quality_status,
      "UNKNOWN",
    ),
    measuredAt,
    thi: calculateThi(indoorTemperature, indoorHumidity),
  };
}

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map(normalizeReading)
    .filter(Boolean)
    .filter((record) => !Number.isNaN(record.measuredAt.getTime()))
    .sort((left, right) => left.measuredAt - right.measuredAt);
}

function mergeReadings(...collections) {
  const merged = new Map();

  collections
    .flatMap((collection) =>
      Array.isArray(collection) ? collection : [collection],
    )
    .filter(Boolean)
    .forEach((record) => {
      const key = record.id ?? record.measuredAt.getTime();
      merged.set(String(key), record);
    });

  return [...merged.values()]
    .sort((left, right) => left.measuredAt - right.measuredAt)
    .slice(-HISTORY_LIMIT);
}

function formatMetric(value, decimals = 1, fallback = "—") {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatTime(date, withSeconds = true) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

function formatDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getWindowLabel(record) {
  if (
    !record?.windowDataAvailable ||
    typeof record.windowIsOpen !== "boolean"
  ) {
    return "미연결";
  }
  return record.windowIsOpen ? "열림" : "닫힘";
}

function getComfortStatus(metricKey, value, latest, thresholds) {
  if (!Number.isFinite(value)) {
    return { label: "데이터 없음", tone: "muted" };
  }

  if (metricKey === "indoorTemperature") {
    if (value >= thresholds.indoor_hot) {
      return { label: "냉방 판단 기준", tone: "warning" };
    }
    if (value < thresholds.indoor_cold) {
      return { label: "낮음", tone: "warning" };
    }
    return { label: "기준 범위", tone: "good" };
  }

  if (metricKey === "indoorHumidity") {
    if (value >= thresholds.indoor_humidity_high) {
      return { label: "높음", tone: "danger" };
    }
    return { label: "기준 범위", tone: "good" };
  }

  if (metricKey === "thi") {
    if (value >= thresholds.thi_high) {
      return { label: "주의", tone: "warning" };
    }
    return { label: "기준 범위", tone: "good" };
  }

  if (metricKey === "pm25") {
    if (value > thresholds.pm25_bad) {
      return { label: "환기 제한", tone: "danger" };
    }
    return { label: "환기 기준 이내", tone: "good" };
  }

  if (metricKey === "windSpeed") {
    if (value >= thresholds.wind_strong) {
      return { label: "강풍", tone: "danger" };
    }
    if (value >= thresholds.wind_ventilation) {
      return { label: "바람 충분", tone: "good" };
    }
    return { label: "약한 바람", tone: "neutral" };
  }

  if (metricKey === "outdoorTemperature") {
    if (!Number.isFinite(latest?.indoorTemperature)) {
      return { label: "날씨 API", tone: "neutral" };
    }

    if (value < latest.indoorTemperature) {
      return { label: "실내보다 낮음", tone: "good" };
    }

    const windCanHelp =
      Number.isFinite(latest.windSpeed) &&
      latest.windSpeed >= thresholds.wind_ventilation &&
      value <= latest.indoorTemperature + thresholds.outdoor_temperature_margin;

    if (windCanHelp) {
      return { label: "바람 활용 범위", tone: "neutral" };
    }

    return { label: "실내 이상", tone: "warning" };
  }

  if (metricKey === "outdoorHumidity") {
    return { label: "참고값", tone: "neutral" };
  }

  return { label: "기록됨", tone: "neutral" };
}

function getActionTone(action) {
  if (action === "OPEN_WINDOW") return "ventilation";
  if (action === "USE_AIRCON") return "aircon";
  if (action === "CLOSE_WINDOW" || action === "ERROR") return "danger";
  if (action === "ENJOY") return "enjoy";
  return "maintain";
}

function getConnectionState({
  latest,
  refreshSeconds,
  testIntervalSeconds,
  syncStatus,
  isTestAutoRecording,
}) {
  if (syncStatus === "error") {
    return {
      key: "error",
      label: "연결 확인 필요",
      description: "연속된 요청 실패로 백엔드 연결을 확인하고 있습니다.",
    };
  }

  if (syncStatus === "retrying") {
    return {
      key: "retrying",
      label: "연결 재시도 중",
      description: "기존 측정값을 유지하고 다시 시도합니다.",
    };
  }

  if (!latest) {
    return {
      key: syncStatus === "connected" ? "waiting" : "empty",
      label: syncStatus === "connected" ? "새 측정 대기" : "측정 대기",
      description: "서버 연결은 정상이지만 아직 저장된 측정 기록이 없습니다.",
    };
  }

  const ageSeconds = Math.max(
    0,
    (Date.now() - latest.measuredAt.getTime()) / 1000,
  );
  const refreshThreshold = Math.max(30, refreshSeconds * 3);
  const testRecordingGraceSeconds = Math.max(
    15,
    Math.min(30, testIntervalSeconds * 0.75),
  );
  const expectedThreshold = isTestAutoRecording
    ? Math.max(
        refreshThreshold,
        testIntervalSeconds + testRecordingGraceSeconds,
      )
    : refreshThreshold;

  if (ageSeconds <= expectedThreshold) {
    const isTest = latest.isTestReading;
    return {
      key: "live",
      label: isTest
        ? isTestAutoRecording
          ? "테스트 자동 기록 중"
          : "테스트값 수신"
        : "실시간 센서 수신",
      description: `${Math.round(ageSeconds)}초 전 · ${getIndoorSourceLabel(latest)}`,
    };
  }

  if (!isTestAutoRecording) {
    return {
      key: "connected",
      label: "서버 연결됨",
      description: `마지막 측정 ${formatDateTime(latest.measuredAt)}`,
    };
  }

  return {
    key: "delay",
    label: "테스트 기록 지연",
    description: `마지막 측정 ${formatDateTime(latest.measuredAt)}`,
  };
}

function buildAlerts(latest, connectionState, thresholds) {
  const alerts = [];

  if (!latest) {
    return [
      {
        tone: "neutral",
        title: "센서 측정 대기 중",
        message: "센서나 테스트 측정값이 들어오면 화면이 자동으로 채워집니다.",
      },
    ];
  }

  if (connectionState.key === "error") {
    alerts.push({
      tone: "danger",
      title: "센서 데이터 연결을 확인해 주세요",
      message: "백엔드 요청에 실패했습니다. 서버와 네트워크를 확인해 주세요.",
    });
  } else if (connectionState.key === "retrying") {
    alerts.push({
      tone: "neutral",
      title: "측정값 연결을 다시 시도하고 있어요",
      message: "기존 기록은 유지되며 다음 자동 확인 때 다시 연결합니다.",
    });
  } else if (connectionState.key === "delay") {
    alerts.push({
      tone: "warning",
      title: "테스트 자동 기록이 지연되고 있어요",
      message: `마지막 측정 시각은 ${formatDateTime(latest.measuredAt)}입니다.`,
    });
  }

  if (!latest.outdoorDataValid) {
    alerts.push({
      tone: "danger",
      title: "실외 데이터 출처를 확인할 수 없어요",
      message:
        "이전 기록은 날씨 API 사용 여부를 증명할 수 없습니다. 새 측정부터 날씨 API가 성공한 경우에만 저장됩니다.",
    });
  }

  if (!latest.windowDataAvailable) {
    alerts.push({
      tone: "neutral",
      title: "창문 센서가 연결되지 않았어요",
      message: "창문 상태를 닫힘으로 추정하지 않고 미연결로 표시합니다.",
    });
  }

  if (
    Number.isFinite(latest.indoorTemperature) &&
    latest.indoorTemperature >= thresholds.indoor_hot
  ) {
    alerts.push({
      tone: "warning",
      title: "실내 온도가 냉방 판단 기준 이상이에요",
      message: `현재 ${formatMetric(latest.indoorTemperature, 1)}℃이며 추천 로직 기준은 ${thresholds.indoor_hot}℃입니다.`,
    });
  }

  if (
    Number.isFinite(latest.indoorHumidity) &&
    latest.indoorHumidity >= thresholds.indoor_humidity_high
  ) {
    alerts.push({
      tone: "warning",
      title: "실내 습도가 높아요",
      message: `현재 ${formatMetric(latest.indoorHumidity, 0)}%이며 로직 기준은 ${thresholds.indoor_humidity_high}%입니다.`,
    });
  }

  if (Number.isFinite(latest.thi) && latest.thi >= thresholds.thi_high) {
    alerts.push({
      tone: "warning",
      title: "불쾌지수가 높아요",
      message: `현재 THI ${formatMetric(latest.thi, 1)}이며 로직 기준은 ${thresholds.thi_high}입니다.`,
    });
  }

  if (
    latest.outdoorDataValid &&
    Number.isFinite(latest.pm25) &&
    latest.pm25 > thresholds.pm25_bad
  ) {
    alerts.push({
      tone: "danger",
      title: "미세먼지로 환기가 제한돼요",
      message: `PM2.5가 ${formatMetric(latest.pm25, 0)}㎍/㎥로 로직 기준 ${thresholds.pm25_bad}를 초과했습니다.`,
    });
  }

  if (
    latest.outdoorDataValid &&
    Number.isFinite(latest.windSpeed) &&
    latest.windSpeed >= thresholds.wind_strong
  ) {
    alerts.push({
      tone: "danger",
      title: "강풍 기준에 해당해요",
      message: `풍속 ${formatMetric(latest.windSpeed, 1)}m/s로 로직 기준 ${thresholds.wind_strong}m/s 이상입니다.`,
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      tone: "good",
      title: "추천 로직 기준 주의 항목이 없어요",
      message:
        "현재 기록은 냉방·습도·THI·미세먼지·강풍 기준을 벗어나지 않았습니다.",
    });
  }

  return alerts.slice(0, 5);
}

function average(records, key) {
  const values = records
    .map((record) => record[key])
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(records, key) {
  const values = records
    .map((record) => record[key])
    .filter((value) => Number.isFinite(value));

  return values.length ? Math.max(...values) : null;
}

function estimateActionMinutes(records, predicate) {
  if (records.length < 2) {
    return 0;
  }

  return records.slice(0, -1).reduce((total, record, index) => {
    if (!predicate(record)) {
      return total;
    }

    const next = records[index + 1];
    const intervalMinutes = Math.max(
      0,
      (next.measuredAt - record.measuredAt) / 60000,
    );

    return total + Math.min(intervalMinutes, 30);
  }, 0);
}

function downloadCsv(records, placeName) {
  if (records.length === 0) {
    return;
  }

  const headers = [
    "측정 시각",
    "실내 데이터 출처",
    "실외 데이터 출처",
    "실내 온도(℃)",
    "실내 습도(%)",
    "불쾌지수(THI)",
    "실외 API 검증",
    "실외 온도(℃)",
    "실외 습도(%)",
    "풍속(m/s)",
    "PM2.5(㎍/㎥)",
    "날씨",
    "창문 상태",
    "에어컨 상태",
    "제어 모드",
    "기상청 관측 시각",
    "대기질 관측 시각",
    "API 조회 시각",
    "날씨 캐시 사용",
    "추천 동작",
    "추천 제목",
  ];

  const escapeCell = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };

  const rows = records.map((record) => [
    record.measuredAt.toISOString(),
    getIndoorSourceLabel(record),
    record.outdoorDataValid ? "날씨 API" : "출처 확인 필요",
    record.indoorTemperature,
    record.indoorHumidity,
    record.thi,
    record.outdoorDataValid ? "날씨 API 확인" : "출처 확인 필요",
    record.outdoorDataValid ? record.outdoorTemperature : "",
    record.outdoorDataValid ? record.outdoorHumidity : "",
    record.outdoorDataValid ? record.windSpeed : "",
    record.outdoorDataValid ? record.pm25 : "",
    record.outdoorDataValid ? record.weatherCondition : "",
    getWindowLabel(record),
    getAcLabel(record),
    record.currentMode,
    record.weatherObservedAt || "",
    record.airQualityObservedAt || "",
    record.weatherFetchedAt || "",
    record.weatherCacheUsed ? "예" : "아니오",
    ACTION_LABELS[record.recommendationAction] || record.recommendationAction,
    record.recommendationTitle,
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
  const blob = new Blob(["\ufeff", csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safePlaceName = String(placeName || "place").replace(
    /[\\/:*?"<>|]/g,
    "_",
  );
  anchor.href = url;
  anchor.download = `dudeoji_${safePlaceName}_sensor_history_${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function MetricValueCard({ metric, latest, thresholds }) {
  const value = latest?.[metric.key] ?? null;
  const status = getComfortStatus(metric.key, value, latest, thresholds);
  const source =
    metric.group === "outdoor"
      ? latest?.outdoorDataValid
        ? metric.source
        : "API 출처 확인 필요"
      : metric.key === "thi"
        ? latest?.isTestReading
          ? "테스트 온·습도 계산"
          : latest?.readingSource === "SENSOR"
            ? "실내 센서 계산"
            : "출처 확인 필요"
        : getIndoorSourceLabel(latest);

  return (
    <article className={`sensor-value-card tone-${metric.tone}`}>
      <div className="sensor-value-card__top">
        <span className="sensor-value-card__label">{metric.title}</span>
        <span className="sensor-value-card__icon" aria-hidden="true">
          {metric.icon}
        </span>
      </div>

      <strong className="sensor-value-card__value">
        {formatMetric(value, metric.decimals)}
        <small>{metric.unit}</small>
      </strong>

      <div className="sensor-value-card__bottom">
        <span className={`sensor-status-chip is-${status.tone}`}>
          {status.label}
        </span>
        <span>{source}</span>
      </div>
    </article>
  );
}

function MetricChart({ metric, records, thresholds, rangeKey }) {
  const validRecords = records.filter(
    (record) =>
      Number.isFinite(record[metric.key]) &&
      (metric.group !== "outdoor" || record.outdoorDataValid),
  );
  const latestRecord = validRecords.at(-1) || null;
  const latestValue = latestRecord?.[metric.key] ?? null;
  const latestSourceClass = getMetricSourceClass(metric, latestRecord);
  const latestSourceLabel = getMetricSourceLabel(metric, latestRecord);

  if (validRecords.length === 0) {
    return (
      <article className="sensor-chart-card">
        <div className="sensor-chart-card__header">
          <div>
            <span className="sensor-chart-card__eyebrow">{metric.source}</span>
            <h3>
              <span aria-hidden="true">{metric.icon}</span> {metric.title}
            </h3>
          </div>
          <strong>—</strong>
        </div>
        <div className="sensor-chart-empty">
          {metric.group === "outdoor"
            ? "선택 기간에 날씨 API로 확인된 기록이 없습니다."
            : "선택 기간에 표시할 기록이 없습니다."}
        </div>
      </article>
    );
  }

  const width = 560;
  const height = 190;
  const padding = { top: 18, right: 18, bottom: 34, left: 42 };
  const values = validRecords.map((record) => record[metric.key]);
  let [minimum, maximum] = getMetricDomain(metric, values, thresholds);
  if (minimum === maximum) {
    minimum -= 1;
    maximum += 1;
  }
  const referenceLines = getMetricReferenceLines(metric, thresholds).filter(
    (line) => line.value >= minimum && line.value <= maximum,
  );

  const drawableWidth = width - padding.left - padding.right;
  const drawableHeight = height - padding.top - padding.bottom;
  const timeline = buildCompressedTimeline(
    validRecords,
    padding.left,
    drawableWidth,
  );
  const calculateX = (_record, index) => timeline.xPositions[index];
  const calculateY = (value) =>
    padding.top + ((maximum - value) / (maximum - minimum)) * drawableHeight;
  const guideValues = [maximum, (maximum + minimum) / 2, minimum];
  const labelIndexes = selectTimeLabelIndexes(
    validRecords,
    timeline.xPositions,
    timeline.gapBreaks,
  );

  return (
    <article className="sensor-chart-card">
      <div className="sensor-chart-card__header">
        <div>
          <span className="sensor-chart-card__eyebrow">{metric.source}</span>
          <h3>
            <span aria-hidden="true">{metric.icon}</span> {metric.title}
          </h3>
        </div>
        <strong>
          {formatMetric(latestValue, metric.decimals)}
          <small>{metric.unit}</small>
          {(latestSourceClass === "is-test" ||
            latestSourceClass === "is-api") && (
            <em
              className={`sensor-latest-source-badge ${
                latestSourceClass === "is-api" ? "is-api" : ""
              }`}
            >
              {latestSourceLabel}
            </em>
          )}
        </strong>
      </div>

      <div className="sensor-chart-wrap">
        <svg
          className={`sensor-metric-chart tone-${metric.tone}`}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${metric.title} 시간 공백 축약 변화 그래프`}
        >
          {guideValues.map((guideValue, index) => {
            const y = calculateY(guideValue);
            return (
              <g key={`${metric.key}-guide-${index}`}>
                <line
                  className="sensor-chart-guide"
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                />
                <text className="sensor-chart-y-label" x="4" y={y + 4}>
                  {formatMetric(guideValue, metric.decimals)}
                </text>
              </g>
            );
          })}

          {referenceLines.map((reference) => {
            const y = calculateY(reference.value);
            return (
              <g key={`${metric.key}-reference-${reference.value}`}>
                <line
                  className="sensor-chart-reference-line"
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                />
                <text
                  className="sensor-chart-reference-label"
                  x={width - padding.right - 2}
                  y={y - 4}
                  textAnchor="end"
                >
                  {reference.label}
                </text>
              </g>
            );
          })}

          {validRecords.slice(1).map((record, index) => {
            const previous = validRecords[index];
            const previousSourceClass = getMetricSourceClass(metric, previous);
            const currentSourceClass = getMetricSourceClass(metric, record);
            const segmentSourceClass =
              previousSourceClass === "is-unknown" ||
              currentSourceClass === "is-unknown"
                ? "is-unknown"
                : previousSourceClass === "is-test" ||
                    currentSourceClass === "is-test"
                  ? "is-test"
                  : metric.group === "outdoor"
                    ? "is-api"
                    : "is-actual";
            const gapBreak = timeline.gapBreaks.find(
              (gap) =>
                gap.previousIndex === index && gap.nextIndex === index + 1,
            );
            const x1 = calculateX(previous, index);
            const x2 = calculateX(record, index + 1);
            const y1 = calculateY(previous[metric.key]);
            const y2 = calculateY(record[metric.key]);

            if (gapBreak) {
              const markerHalfWidth = 11;
              const gapX = gapBreak.x;
              const firstRatio = Math.max(
                0,
                Math.min(
                  1,
                  (gapX - markerHalfWidth - x1) / Math.max(x2 - x1, 1),
                ),
              );
              const secondRatio = Math.max(
                0,
                Math.min(
                  1,
                  (gapX + markerHalfWidth - x1) / Math.max(x2 - x1, 1),
                ),
              );
              const firstEndY = y1 + (y2 - y1) * firstRatio;
              const secondStartY = y1 + (y2 - y1) * secondRatio;

              return (
                <g key={`${metric.key}-gap-line-${previous.id}-${record.id}`}>
                  <line
                    className={`sensor-chart-series-line ${segmentSourceClass}`}
                    x1={x1}
                    x2={gapX - markerHalfWidth}
                    y1={y1}
                    y2={firstEndY}
                  />
                  <line
                    className={`sensor-chart-series-line ${segmentSourceClass}`}
                    x1={gapX + markerHalfWidth}
                    x2={x2}
                    y1={secondStartY}
                    y2={y2}
                  />
                </g>
              );
            }

            return (
              <line
                className={`sensor-chart-series-line ${segmentSourceClass}`}
                key={`${metric.key}-line-${previous.id}-${record.id}`}
                x1={x1}
                x2={x2}
                y1={y1}
                y2={y2}
              />
            );
          })}

          {timeline.gapBreaks.map((gap, index) => (
            <g
              className="sensor-chart-gap-break"
              key={`${metric.key}-gap-${gap.previousIndex}-${gap.nextIndex}`}
            >
              <rect
                className="sensor-chart-gap-marker-bg"
                x={gap.x - 15}
                y={height / 2 - 13}
                width="30"
                height="22"
                rx="8"
              />
              <text
                className="sensor-chart-gap-marker"
                textAnchor="middle"
                x={gap.x}
                y={height / 2 + 3}
              >
                ~ ~
              </text>
              <title>
                {formatGapDuration(gap.duration)} 동안 측정 기록이 없어 간격을
                축약했습니다.
              </title>
            </g>
          ))}

          {validRecords.map((record, index) => {
            const sourceClass = getMetricSourceClass(metric, record);
            return (
              <circle
                className={`sensor-chart-point ${sourceClass}`}
                cx={calculateX(record, index)}
                cy={calculateY(record[metric.key])}
                key={`${metric.key}-${record.id}`}
                r={index === validRecords.length - 1 ? 4 : 2.7}
              >
                <title>
                  {formatDateTime(record.measuredAt)} · {metric.title}{" "}
                  {formatMetric(record[metric.key], metric.decimals)}
                  {metric.unit}
                  {" · "}
                  {getMetricSourceLabel(metric, record)}
                </title>
              </circle>
            );
          })}

          {labelIndexes.map((recordIndex, labelIndex) => {
            const record = validRecords[recordIndex];
            return (
              <text
                className="sensor-chart-x-label"
                key={`${metric.key}-time-${record.id}`}
                textAnchor={
                  labelIndex === 0
                    ? "start"
                    : labelIndex === labelIndexes.length - 1
                      ? "end"
                      : "middle"
                }
                x={calculateX(record, recordIndex)}
                y={height - 8}
              >
                {formatHistoryTick(record.measuredAt, rangeKey)}
              </text>
            );
          })}
        </svg>
      </div>
    </article>
  );
}

function StateTimeline({ title, icon, records, getState }) {
  const visibleRecords = records.slice(-24);

  return (
    <article className="sensor-state-timeline-card">
      <div className="sensor-state-timeline-card__header">
        <h3>
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
        <span>최근 {visibleRecords.length}건</span>
      </div>

      {visibleRecords.length === 0 ? (
        <div className="sensor-chart-empty">선택 기간에 기록이 없습니다.</div>
      ) : (
        <div className="sensor-state-timeline" role="list">
          {visibleRecords.map((record) => {
            const state = getState(record);
            return (
              <span
                className={`sensor-state-segment is-${state.tone}`}
                key={`${title}-${record.id}`}
                role="listitem"
                title={`${formatDateTime(record.measuredAt)} · ${state.label}`}
              >
                <span className="sr-only">{state.label}</span>
              </span>
            );
          })}
        </div>
      )}

      <div className="sensor-state-timeline-card__legend">
        {[
          ...new Map(
            visibleRecords.map((record) => {
              const state = getState(record);
              return [state.label, state];
            }),
          ).values(),
        ].map((state) => (
          <span key={state.label}>
            <i className={`is-${state.tone}`} />
            {state.label}
          </span>
        ))}
      </div>
    </article>
  );
}

function SourceStatusCard({
  icon,
  title,
  source,
  status,
  latest,
  timeLabel = null,
}) {
  return (
    <div className="sensor-source-row">
      <span className="sensor-source-row__icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <strong>{title}</strong>
        <span>{source}</span>
      </div>
      <span className={`sensor-status-chip is-${status.tone}`}>
        {status.label}
      </span>
      <time>{timeLabel || (latest ? formatTime(latest.measuredAt) : "—")}</time>
    </div>
  );
}

export default function SensorReadings({
  history = [],
  nickname = "두더지",
  renderProfileBadge,
  onBack,
  onOpenMyPage,
  onOpenBadgePage,
  onStartTutorial,
  onLogout,
}) {
  const {
    selectedLocation,
    isLoading: isLocationLoading,
    loadError: locationLoadError,
  } = useLocationContext();
  const selectedPlaceId = selectedLocation?.id ?? null;
  const [readings, setReadings] = useState([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingMock, setIsCreatingMock] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isTestAutoRecording, setIsTestAutoRecording] = useState(false);
  const refreshSeconds = LIVE_REFRESH_SECONDS;
  const [testDurationSeconds, setTestDurationSeconds] = useState(
    getStoredTestDurationSeconds,
  );
  const [testDurationDraft, setTestDurationDraft] = useState(() =>
    String(getStoredTestDurationSeconds()),
  );
  const [testIntervalSeconds, setTestIntervalSeconds] = useState(
    getStoredTestIntervalSeconds,
  );
  const [testIntervalDraft, setTestIntervalDraft] = useState(() =>
    String(getStoredTestIntervalSeconds()),
  );
  const [testRemainingSeconds, setTestRemainingSeconds] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState(null);
  const [weatherStatusError, setWeatherStatusError] = useState("");
  const [isWeatherStatusLoading, setIsWeatherStatusLoading] = useState(false);
  const [rangeKey, setRangeKey] = useState("1h");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [newReadingPulse, setNewReadingPulse] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [logicThresholds, setLogicThresholds] = useState(FALLBACK_THRESHOLDS);

  const mountedRef = useRef(true);
  const selectedPlaceIdRef = useRef(null);
  const previousPlaceIdRef = useRef(null);
  const requestVersionRef = useRef(0);
  const historyAbortRef = useRef(null);
  const weatherStatusAbortRef = useRef(null);
  const newestReadingKeyRef = useRef(null);
  const newestMeasuredAtRef = useRef(null);
  const refreshCycleLockRef = useRef(false);
  const isTestAutoRecordingRef = useRef(false);
  const testSessionStartedAtRef = useRef(null);
  const testSessionPlaceIdRef = useRef(null);
  const consecutiveFailureRef = useRef(0);
  const testFailureRef = useRef(0);
  const pulseTimerRef = useRef(null);

  const showNewReadingPulse = useCallback(() => {
    setNewReadingPulse(true);
    window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        setNewReadingPulse(false);
      }
    }, 1400);
  }, []);

  const mergeIntoState = useCallback(
    (
      incoming,
      {
        replace = false,
        expectedPlaceId = selectedPlaceIdRef.current,
        expectedVersion = requestVersionRef.current,
      } = {},
    ) => {
      if (
        String(selectedPlaceIdRef.current) !== String(expectedPlaceId) ||
        requestVersionRef.current !== expectedVersion
      ) {
        return;
      }

      const normalizedIncoming = normalizeHistory(incoming || []).filter(
        (record) =>
          record.placeId != null &&
          String(record.placeId) === String(expectedPlaceId),
      );

      setReadings((previous) => {
        const next = replace
          ? normalizedIncoming.slice(-HISTORY_LIMIT)
          : mergeReadings(previous, normalizedIncoming);
        const newest = next.at(-1) || null;
        const newestKey = newest
          ? String(newest.id ?? newest.measuredAt.getTime())
          : null;

        if (
          newestReadingKeyRef.current &&
          newestKey &&
          newestReadingKeyRef.current !== newestKey
        ) {
          showNewReadingPulse();
        }

        newestReadingKeyRef.current = newestKey;
        newestMeasuredAtRef.current =
          newest?.measuredAt?.toISOString?.() || null;
        return next;
      });
    },
    [showNewReadingPulse],
  );

  const loadData = useCallback(
    async ({
      silent = false,
      incremental = false,
      placeId = selectedPlaceIdRef.current,
      version = requestVersionRef.current,
    } = {}) => {
      if (!placeId) {
        setReadings([]);
        setErrorMessage("");
        setSyncStatus("idle");
        setIsInitialLoading(false);
        setIsRefreshing(false);
        newestMeasuredAtRef.current = null;
        return;
      }

      historyAbortRef.current?.abort();
      const controller = new AbortController();
      historyAbortRef.current = controller;

      if (!silent) {
        setIsRefreshing(true);
      }

      try {
        const after = incremental ? newestMeasuredAtRef.current : null;
        const historyResult = await getReadingHistory(
          HISTORY_LIMIT,
          placeId,
          after,
          { signal: controller.signal },
        );

        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          String(selectedPlaceIdRef.current) !== String(placeId) ||
          requestVersionRef.current !== version
        ) {
          return;
        }

        mergeIntoState(historyResult || [], {
          replace: !incremental,
          expectedPlaceId: placeId,
          expectedVersion: version,
        });
        consecutiveFailureRef.current = 0;
        setErrorMessage("");
        setSyncStatus("connected");
        setLastSyncedAt(new Date());
      } catch (error) {
        if (
          !mountedRef.current ||
          error?.name === "AbortError" ||
          String(selectedPlaceIdRef.current) !== String(placeId) ||
          requestVersionRef.current !== version
        ) {
          return;
        }

        const message = error?.message || "센서 데이터를 불러오지 못했습니다.";
        if (message.includes("저장된 센서 기록이 없습니다")) {
          if (!incremental) {
            setReadings([]);
          }
          consecutiveFailureRef.current = 0;
          setErrorMessage("");
          setSyncStatus("connected");
        } else {
          consecutiveFailureRef.current += 1;
          if (consecutiveFailureRef.current < 3) {
            setSyncStatus("retrying");
            setErrorMessage("");
          } else {
            setSyncStatus("error");
            setErrorMessage(message);
          }
        }
      } finally {
        if (
          mountedRef.current &&
          String(selectedPlaceIdRef.current) === String(placeId) &&
          requestVersionRef.current === version
        ) {
          setIsInitialLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [mergeIntoState],
  );

  const loadWeatherApiStatus = useCallback(
    async ({
      placeId = selectedPlaceIdRef.current,
      version = requestVersionRef.current,
      forceRefresh = false,
    } = {}) => {
      if (!placeId) {
        setWeatherStatus(null);
        setWeatherStatusError("");
        return;
      }

      weatherStatusAbortRef.current?.abort();
      const controller = new AbortController();
      weatherStatusAbortRef.current = controller;
      setIsWeatherStatusLoading(true);

      try {
        const result = await getWeatherStatus(placeId, forceRefresh, {
          signal: controller.signal,
        });
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          String(selectedPlaceIdRef.current) !== String(placeId) ||
          requestVersionRef.current !== version
        ) {
          return;
        }
        setWeatherStatus(result || null);
        setWeatherStatusError("");
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (
          mountedRef.current &&
          String(selectedPlaceIdRef.current) === String(placeId) &&
          requestVersionRef.current === version
        ) {
          setWeatherStatusError(
            error?.message || "날씨 API 상태를 확인하지 못했습니다.",
          );
        }
      } finally {
        if (mountedRef.current) setIsWeatherStatusLoading(false);
      }
    },
    [],
  );

  const performRefreshCycle = useCallback(
    async ({ createTestRecord = false, testMode = "auto" } = {}) => {
      const placeId = selectedPlaceIdRef.current;
      const version = requestVersionRef.current;

      if (!placeId || refreshCycleLockRef.current) {
        return;
      }

      refreshCycleLockRef.current = true;
      try {
        if (createTestRecord) {
          const created = await createMockReading(placeId, testMode);

          if (
            !mountedRef.current ||
            String(selectedPlaceIdRef.current) !== String(placeId) ||
            requestVersionRef.current !== version
          ) {
            return;
          }

          mergeIntoState([created], {
            expectedPlaceId: placeId,
            expectedVersion: version,
          });
          loadWeatherApiStatus({ placeId, version });
          consecutiveFailureRef.current = 0;
          testFailureRef.current = 0;
          setErrorMessage("");
          setSyncStatus("connected");
          setLastSyncedAt(new Date());
        } else {
          await loadData({
            silent: true,
            incremental: true,
            placeId,
            version,
          });
        }
      } catch (error) {
        if (
          mountedRef.current &&
          String(selectedPlaceIdRef.current) === String(placeId) &&
          requestVersionRef.current === version
        ) {
          if (createTestRecord) {
            testFailureRef.current += 1;
            if (testFailureRef.current >= 3) {
              isTestAutoRecordingRef.current = false;
              testSessionStartedAtRef.current = null;
              testSessionPlaceIdRef.current = null;
              setIsTestAutoRecording(false);
              setTestRemainingSeconds(null);
              setSyncStatus("error");
              setErrorMessage(
                `테스트 자동 기록을 중지했습니다. ${
                  error.message || "날씨 API 연결 상태를 확인해 주세요."
                }`,
              );
              setToastMessage(
                "날씨 API가 3회 연속 실패해 테스트 자동 기록을 중지했습니다.",
              );
            } else {
              setSyncStatus("retrying");
              setToastMessage(
                `테스트 기록 실패 ${testFailureRef.current}/3 · 다음 기록 때 다시 확인합니다.`,
              );
            }
          } else {
            consecutiveFailureRef.current += 1;
            if (consecutiveFailureRef.current < 3) {
              setSyncStatus("retrying");
              setErrorMessage("");
            } else {
              setSyncStatus("error");
              setErrorMessage(
                error.message || "센서 데이터를 갱신하지 못했습니다.",
              );
            }
          }
        }
      } finally {
        refreshCycleLockRef.current = false;
      }
    },
    [loadData, loadWeatherApiStatus, mergeIntoState],
  );

  useEffect(() => {
    mountedRef.current = true;

    const controller = new AbortController();
    getLogicThresholds({ signal: controller.signal })
      .then((result) => {
        if (mountedRef.current && result) {
          setLogicThresholds({ ...FALLBACK_THRESHOLDS, ...result });
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          console.warn("추천 기준을 불러오지 못해 기본값을 사용합니다.", error);
        }
      });

    return () => {
      mountedRef.current = false;
      controller.abort();
      historyAbortRef.current?.abort();
      weatherStatusAbortRef.current?.abort();
      window.clearTimeout(pulseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    isTestAutoRecordingRef.current = isTestAutoRecording;
  }, [isTestAutoRecording]);

  useEffect(() => {
    const nextPlaceId =
      selectedPlaceId == null ? null : String(selectedPlaceId);
    const previousPlaceId = previousPlaceIdRef.current;
    const placeChanged =
      previousPlaceId != null && previousPlaceId !== nextPlaceId;

    requestVersionRef.current += 1;
    const version = requestVersionRef.current;
    selectedPlaceIdRef.current = nextPlaceId;
    previousPlaceIdRef.current = nextPlaceId;
    historyAbortRef.current?.abort();
    weatherStatusAbortRef.current?.abort();
    refreshCycleLockRef.current = false;
    newestReadingKeyRef.current = null;
    newestMeasuredAtRef.current = null;
    consecutiveFailureRef.current = 0;
    testFailureRef.current = 0;
    setReadings([]);
    setWeatherStatus(null);
    setWeatherStatusError("");
    setErrorMessage("");
    setSyncStatus("idle");
    setLastSyncedAt(null);
    setIsInitialLoading(Boolean(nextPlaceId));

    if (placeChanged && isTestAutoRecordingRef.current) {
      isTestAutoRecordingRef.current = false;
      testSessionStartedAtRef.current = null;
      testSessionPlaceIdRef.current = null;
      setIsTestAutoRecording(false);
      setTestRemainingSeconds(null);
      setToastMessage(
        "장소가 변경되어 진행 중이던 테스트를 안전하게 중지했습니다.",
      );
    }

    const initialForPlace = normalizeHistory(history).filter(
      (record) =>
        nextPlaceId != null &&
        record.placeId != null &&
        String(record.placeId) === nextPlaceId,
    );
    if (initialForPlace.length) {
      mergeIntoState(initialForPlace, {
        replace: true,
        expectedPlaceId: nextPlaceId,
        expectedVersion: version,
      });
    }

    if (nextPlaceId) {
      loadData({
        incremental: false,
        placeId: nextPlaceId,
        version,
      });
      loadWeatherApiStatus({
        placeId: nextPlaceId,
        version,
      });
    } else {
      setIsInitialLoading(false);
    }
  }, [
    history,
    loadData,
    loadWeatherApiStatus,
    mergeIntoState,
    selectedPlaceId,
  ]);

  useEffect(() => {
    if (!autoRefresh || !selectedPlaceId || isTestAutoRecording) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        performRefreshCycle({ createTestRecord: false });
      }
    }, refreshSeconds * 1000);

    return () => window.clearInterval(timerId);
  }, [
    autoRefresh,
    isTestAutoRecording,
    performRefreshCycle,
    refreshSeconds,
    selectedPlaceId,
  ]);

  useEffect(() => {
    if (!isTestAutoRecording || !selectedPlaceId) {
      return undefined;
    }

    const sessionPlaceId = String(selectedPlaceId);
    const startedAt = testSessionStartedAtRef.current || Date.now();
    testSessionStartedAtRef.current = startedAt;
    testSessionPlaceIdRef.current = sessionPlaceId;

    const finishSession = () => {
      if (
        !isTestAutoRecordingRef.current ||
        String(selectedPlaceIdRef.current) !== sessionPlaceId
      ) {
        return;
      }

      isTestAutoRecordingRef.current = false;
      testSessionStartedAtRef.current = null;
      testSessionPlaceIdRef.current = null;
      setIsTestAutoRecording(false);
      setTestRemainingSeconds(null);
      setToastMessage(
        `총 ${testDurationSeconds}초 테스트가 완료되어 자동 기록을 종료했습니다.`,
      );
    };

    const updateRemainingTime = () => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const remainingSeconds = Math.max(
        0,
        Math.ceil(testDurationSeconds - elapsedSeconds),
      );
      setTestRemainingSeconds(remainingSeconds);
    };

    updateRemainingTime();

    const recordTimerId = window.setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      if (elapsedSeconds >= testDurationSeconds) {
        return;
      }

      if (document.visibilityState === "visible") {
        performRefreshCycle({ createTestRecord: true, testMode: "auto" });
      }
    }, testIntervalSeconds * 1000);

    const countdownTimerId = window.setInterval(updateRemainingTime, 250);
    const stopTimerId = window.setTimeout(
      finishSession,
      testDurationSeconds * 1000,
    );

    return () => {
      window.clearInterval(recordTimerId);
      window.clearInterval(countdownTimerId);
      window.clearTimeout(stopTimerId);
    };
  }, [
    isTestAutoRecording,
    performRefreshCycle,
    selectedPlaceId,
    testDurationSeconds,
    testIntervalSeconds,
  ]);

  useEffect(() => {
    if (!selectedPlaceId) return undefined;
    const timerId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadWeatherApiStatus();
      }
    }, 60 * 1000);
    return () => window.clearInterval(timerId);
  }, [loadWeatherApiStatus, selectedPlaceId]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (
        document.visibilityState === "visible" &&
        autoRefresh &&
        !isTestAutoRecording
      ) {
        performRefreshCycle({ createTestRecord: false });
      }
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [autoRefresh, isTestAutoRecording, performRefreshCycle]);

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }

    const timerId = window.setTimeout(() => setToastMessage(""), 3000);
    return () => window.clearTimeout(timerId);
  }, [toastMessage]);

  const latest = readings.at(-1) || null;
  const outdoorLatest = latest?.outdoorDataValid ? latest : null;
  const activeRange = RANGE_OPTIONS.find((option) => option.key === rangeKey);
  const displayedReadings = useMemo(() => {
    if (!activeRange?.milliseconds) {
      return readings;
    }

    const cutoff = Date.now() - activeRange.milliseconds;
    return readings.filter((record) => record.measuredAt.getTime() >= cutoff);
  }, [activeRange, readings, lastSyncedAt]);
  const connectionState = getConnectionState({
    latest,
    refreshSeconds,
    testIntervalSeconds,
    syncStatus,
    isTestAutoRecording,
  });
  const alerts = buildAlerts(latest, connectionState, logicThresholds);
  const recentRows = [...displayedReadings].reverse().slice(0, 12);
  const summary = {
    averageIndoorTemperature: average(displayedReadings, "indoorTemperature"),
    averageIndoorHumidity: average(displayedReadings, "indoorHumidity"),
    maximumThi: maximum(displayedReadings, "thi"),
    ventilationMinutes: estimateActionMinutes(
      displayedReadings,
      (record) => record.recommendationAction === "OPEN_WINDOW",
    ),
  };

  async function handleCreateMockReading() {
    const placeId = selectedPlaceIdRef.current;
    const version = requestVersionRef.current;
    if (!placeId) {
      setToastMessage("먼저 측정할 장소를 선택해 주세요.");
      return;
    }

    setIsCreatingMock(true);
    try {
      const created = await createMockReading(placeId, "manual");
      if (
        String(selectedPlaceIdRef.current) !== String(placeId) ||
        requestVersionRef.current !== version
      ) {
        return;
      }
      mergeIntoState([created], {
        expectedPlaceId: placeId,
        expectedVersion: version,
      });
      consecutiveFailureRef.current = 0;
      setSyncStatus("connected");
      setErrorMessage("");
      setLastSyncedAt(new Date());
      loadWeatherApiStatus({ placeId, version });
      setToastMessage("테스트 측정값 1건을 생성했습니다.");
    } catch (error) {
      loadWeatherApiStatus({ placeId, version });
      setToastMessage(error.message || "테스트 측정값 생성에 실패했습니다.");
    } finally {
      setIsCreatingMock(false);
    }
  }

  function parseTestSessionSettings() {
    if (testDurationDraft.trim() === "" || testIntervalDraft.trim() === "") {
      throw new Error("총 테스트 시간과 기록 간격을 모두 입력해 주세요.");
    }

    const parsedDuration = Number(testDurationDraft);
    const parsedInterval = Number(testIntervalDraft);

    if (!Number.isFinite(parsedDuration) || !Number.isFinite(parsedInterval)) {
      throw new Error("테스트 시간과 기록 간격을 숫자로 입력해 주세요.");
    }

    const nextDuration = normalizeSeconds(
      parsedDuration,
      TEST_DURATION_DEFAULT_SECONDS,
      TEST_DURATION_MIN_SECONDS,
      TEST_DURATION_MAX_SECONDS,
    );
    const nextInterval = normalizeSeconds(
      parsedInterval,
      TEST_INTERVAL_DEFAULT_SECONDS,
      TEST_INTERVAL_MIN_SECONDS,
      TEST_INTERVAL_MAX_SECONDS,
    );

    if (nextInterval > nextDuration) {
      throw new Error("기록 간격은 총 테스트 시간보다 길 수 없습니다.");
    }

    return { nextDuration, nextInterval };
  }

  function saveTestSessionSettings({ showToast = true } = {}) {
    let settings;
    try {
      settings = parseTestSessionSettings();
    } catch (error) {
      setToastMessage(error.message);
      return null;
    }

    const { nextDuration, nextInterval } = settings;
    setTestDurationSeconds(nextDuration);
    setTestDurationDraft(String(nextDuration));
    setTestIntervalSeconds(nextInterval);
    setTestIntervalDraft(String(nextInterval));

    try {
      window.localStorage.setItem(
        TEST_DURATION_STORAGE_KEY,
        String(nextDuration),
      );
      window.localStorage.setItem(
        TEST_INTERVAL_STORAGE_KEY,
        String(nextInterval),
      );
    } catch {
      // 브라우저 저장소를 사용할 수 없어도 현재 화면 설정은 유지합니다.
    }

    if (showToast) {
      setToastMessage(
        `총 ${nextDuration}초 동안 ${nextInterval}초 간격으로 기록하도록 저장했습니다.`,
      );
    }

    return settings;
  }

  function handleTestSettingKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      saveTestSessionSettings();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      setTestDurationDraft(String(testDurationSeconds));
      setTestIntervalDraft(String(testIntervalSeconds));
      event.currentTarget.blur();
    }
  }

  async function handleTestAutoRecordingChange(event) {
    const nextEnabled = event.target.checked;
    if (!nextEnabled) {
      isTestAutoRecordingRef.current = false;
      testSessionStartedAtRef.current = null;
      testSessionPlaceIdRef.current = null;
      setIsTestAutoRecording(false);
      setTestRemainingSeconds(null);
      setToastMessage("진행 중인 테스트를 중지했습니다.");
      return;
    }

    if (!selectedPlaceIdRef.current) {
      setToastMessage("먼저 측정할 장소를 선택해 주세요.");
      return;
    }

    const settings = saveTestSessionSettings({ showToast: false });
    if (!settings) {
      return;
    }

    const { nextDuration, nextInterval } = settings;
    testFailureRef.current = 0;
    testSessionStartedAtRef.current = Date.now();
    testSessionPlaceIdRef.current = String(selectedPlaceIdRef.current);
    isTestAutoRecordingRef.current = true;
    setTestRemainingSeconds(nextDuration);
    setIsTestAutoRecording(true);
    setAutoRefresh(true);
    setToastMessage(
      `총 ${nextDuration}초 동안 ${nextInterval}초 간격으로 테스트값을 기록합니다.`,
    );
    await performRefreshCycle({ createTestRecord: true, testMode: "auto" });
  }

  return (
    <div className="mypage-screen sensor-page-shell">
      <header className="mypage-mobile-topbar sensor-mobile-topbar">
        <button
          type="button"
          className="mypage-back-button"
          onClick={onBack}
          aria-label="메인으로 돌아가기"
        >
          ‹
        </button>
        <h1>센서 측정값</h1>
      </header>

      <div className="mypage-desktop-shell sensor-desktop-shell">
        <SharedAppSidebar
          nickname={nickname}
          renderProfileBadge={renderProfileBadge}
          activePage="sensors"
          onOpenDashboard={onBack}
          onOpenMyPage={onOpenMyPage}
          onOpenSensorReadings={() => {}}
          onOpenBadgePage={onOpenBadgePage}
          onStartTutorial={onStartTutorial}
          onLogout={onLogout}
        />

        <div className="sensor-page-workspace">
          <header className="sensor-page-header">
            <div className="sensor-page-header__title-group">
              <div>
                <div className="sensor-page-title-row">
                  <h1>실시간 센서 측정값</h1>
                  <span
                    className={`sensor-live-badge is-${connectionState.key} ${
                      newReadingPulse ? "is-pulsing" : ""
                    }`}
                  >
                    <i />
                    {connectionState.label}
                  </span>
                </div>
                <p>
                  센서와 날씨 데이터를 실시간으로 확인하고 변화 이력을 분석해
                  보세요.
                </p>
              </div>
            </div>

            <div className="sensor-page-controls">
              <div className="sensor-location-control">
                <span>측정 장소</span>
                <LocationSwitcher />
              </div>

              <div className="sensor-last-update">
                <span>마지막 측정</span>
                <strong>
                  {latest ? formatDateTime(latest.measuredAt) : "측정 대기"}
                </strong>
              </div>

              <label className="sensor-auto-toggle">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(event) => setAutoRefresh(event.target.checked)}
                />
                <span className="sensor-auto-toggle__track" aria-hidden="true">
                  <i />
                </span>
                실시간 확인
              </label>

              <label
                className={`sensor-auto-toggle sensor-test-record-toggle ${
                  isTestAutoRecording ? "is-active" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isTestAutoRecording}
                  onChange={handleTestAutoRecordingChange}
                />
                <span className="sensor-auto-toggle__track" aria-hidden="true">
                  <i />
                </span>
                {isTestAutoRecording
                  ? `테스트 중 · ${testRemainingSeconds ?? testDurationSeconds}초 남음`
                  : `테스트 ${testDurationSeconds}초`}
              </label>

              <div
                className={`sensor-test-session-control ${
                  isTestAutoRecording ? "is-running" : ""
                }`}
              >
                <label className="sensor-test-setting-input">
                  <span>총 테스트 시간</span>
                  <span className="sensor-test-setting-field">
                    <input
                      type="number"
                      min={TEST_DURATION_MIN_SECONDS}
                      max={TEST_DURATION_MAX_SECONDS}
                      step="1"
                      inputMode="numeric"
                      list="sensor-test-duration-presets"
                      value={testDurationDraft}
                      onChange={(event) =>
                        setTestDurationDraft(event.target.value)
                      }
                      onKeyDown={handleTestSettingKeyDown}
                      onBlur={() => {
                        if (testDurationDraft.trim() === "") {
                          setTestDurationDraft(String(testDurationSeconds));
                        }
                      }}
                      disabled={isTestAutoRecording}
                      aria-label="총 테스트 시간(초)"
                    />
                    <em>초</em>
                  </span>
                </label>

                <label className="sensor-test-setting-input">
                  <span>기록 간격</span>
                  <span className="sensor-test-setting-field">
                    <input
                      type="number"
                      min={TEST_INTERVAL_MIN_SECONDS}
                      max={TEST_INTERVAL_MAX_SECONDS}
                      step="1"
                      inputMode="numeric"
                      list="sensor-test-interval-presets"
                      value={testIntervalDraft}
                      onChange={(event) =>
                        setTestIntervalDraft(event.target.value)
                      }
                      onKeyDown={handleTestSettingKeyDown}
                      onBlur={() => {
                        if (testIntervalDraft.trim() === "") {
                          setTestIntervalDraft(String(testIntervalSeconds));
                        }
                      }}
                      disabled={isTestAutoRecording}
                      aria-label="테스트값 기록 간격(초)"
                    />
                    <em>초</em>
                  </span>
                </label>

                <datalist id="sensor-test-duration-presets">
                  {TEST_DURATION_PRESETS.map((seconds) => (
                    <option value={seconds} key={seconds} />
                  ))}
                </datalist>
                <datalist id="sensor-test-interval-presets">
                  {TEST_INTERVAL_PRESETS.map((seconds) => (
                    <option value={seconds} key={seconds} />
                  ))}
                </datalist>

                <button
                  type="button"
                  className="sensor-test-setting-apply"
                  onClick={() => saveTestSessionSettings()}
                  disabled={isTestAutoRecording}
                  title={
                    isTestAutoRecording
                      ? "테스트를 중지한 뒤 시간을 변경할 수 있습니다."
                      : "테스트 설정 저장"
                  }
                >
                  {isTestAutoRecording ? "실행 중" : "설정 적용"}
                </button>

                <span
                  className="sensor-test-session-summary"
                  aria-live="polite"
                >
                  {isTestAutoRecording
                    ? `남은 ${testRemainingSeconds ?? testDurationSeconds}초 · ${testIntervalSeconds}초마다 기록`
                    : `${testDurationSeconds}초 동안 · ${testIntervalSeconds}초마다 기록`}
                </span>
              </div>

              <button
                type="button"
                className="sensor-refresh-button"
                onClick={() => {
                  loadData({
                    placeId: selectedPlaceIdRef.current,
                    version: requestVersionRef.current,
                  });
                  loadWeatherApiStatus({ forceRefresh: true });
                }}
                disabled={isRefreshing}
              >
                <span className={isRefreshing ? "is-spinning" : ""}>↻</span>
                {isRefreshing ? "불러오는 중" : "지금 새로고침"}
              </button>
            </div>
          </header>

          <main className="sensor-page-main" id="sensor-overview">
            {errorMessage && (
              <section className="sensor-error-banner" role="alert">
                <div>
                  <strong>센서 또는 날씨 API를 확인해 주세요.</strong>
                  <p>{errorMessage}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    loadData({
                      placeId: selectedPlaceIdRef.current,
                      version: requestVersionRef.current,
                    })
                  }
                >
                  다시 시도
                </button>
              </section>
            )}

            {locationLoadError ? (
              <section className="sensor-error-banner" role="alert">
                <div>
                  <strong>장소 정보를 불러오지 못했습니다.</strong>
                  <p>{locationLoadError}</p>
                </div>
              </section>
            ) : isLocationLoading ? (
              <section className="sensor-loading-state">
                <span className="sensor-loading-spinner" />
                <strong>등록된 장소를 확인하고 있어요.</strong>
                <p>측정값을 표시할 장소를 준비하는 중입니다.</p>
              </section>
            ) : !selectedLocation ? (
              <section className="sensor-empty-state sensor-location-empty">
                <span aria-hidden="true">🏠</span>
                <h2>측정할 장소가 없습니다.</h2>
                <p>먼저 마이페이지에서 장소와 에어컨을 등록해 주세요.</p>
                <LocationSwitcher />
              </section>
            ) : isInitialLoading && readings.length === 0 ? (
              <section className="sensor-loading-state">
                <span className="sensor-loading-spinner" />
                <strong>센서 기록을 불러오고 있어요.</strong>
                <p>선택한 장소의 최신 측정값을 확인하는 중입니다.</p>
              </section>
            ) : readings.length === 0 ? (
              <section className="sensor-empty-state">
                <span aria-hidden="true">📡</span>
                <h2>{selectedLocation.name}의 측정 기록이 없습니다.</h2>
                <p>
                  실내 센서값과 이 장소 좌표의 날씨 API 조회가 모두 성공하면
                  기록이 저장됩니다.
                </p>
                <button
                  type="button"
                  onClick={handleCreateMockReading}
                  disabled={isCreatingMock}
                >
                  {isCreatingMock ? "생성 중…" : "테스트 측정값 1건 생성"}
                </button>
              </section>
            ) : (
              <>
                <section
                  className="sensor-overview-grid"
                  aria-label="현재 환경 측정값"
                >
                  <article className="sensor-environment-panel">
                    <div className="sensor-section-heading">
                      <div>
                        <span className="sensor-section-number is-indoor">
                          1
                        </span>
                        <div>
                          <h2>실내 환경</h2>
                          <p>
                            {selectedLocation.name} ·{" "}
                            {getIndoorSourceDescription(latest)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`sensor-panel-source ${
                          latest.isTestReading ? "is-test" : "is-sensor"
                        }`}
                      >
                        {getIndoorSourceLabel(latest)}
                      </span>
                    </div>

                    <div className="sensor-value-grid">
                      {METRICS.slice(0, 3).map((metric) => (
                        <MetricValueCard
                          metric={metric}
                          latest={latest}
                          thresholds={logicThresholds}
                          key={metric.key}
                        />
                      ))}

                      <article className="sensor-value-card tone-green">
                        <div className="sensor-value-card__top">
                          <span className="sensor-value-card__label">
                            창문 상태
                          </span>
                          <span
                            className="sensor-value-card__icon"
                            aria-hidden="true"
                          >
                            🪟
                          </span>
                        </div>
                        <strong className="sensor-value-card__value is-text">
                          {getWindowLabel(latest)}
                        </strong>
                        <div className="sensor-value-card__bottom">
                          <span
                            className={`sensor-status-chip ${
                              latest.windowDataAvailable
                                ? "is-good"
                                : "is-warning"
                            }`}
                          >
                            {latest.windowDataAvailable
                              ? "센서 수신"
                              : "센서 미연결"}
                          </span>
                          <span>window_is_open</span>
                        </div>
                      </article>

                      <article className="sensor-value-card tone-blue">
                        <div className="sensor-value-card__top">
                          <span className="sensor-value-card__label">
                            에어컨 가동
                          </span>
                          <span
                            className="sensor-value-card__icon"
                            aria-hidden="true"
                          >
                            ❄️
                          </span>
                        </div>
                        <strong className="sensor-value-card__value is-text">
                          {getAcLabel(latest)}
                        </strong>
                        <div className="sensor-value-card__bottom">
                          <span
                            className={`sensor-status-chip ${
                              latest.acDataAvailable
                                ? latest.acIsOn
                                  ? "is-warning"
                                  : "is-good"
                                : "is-warning"
                            }`}
                          >
                            {latest.acDataAvailable
                              ? latest.acIsOn
                                ? "가동 감지"
                                : "꺼짐 감지"
                              : "센서 미연결"}
                          </span>
                          <span>ac_is_on</span>
                        </div>
                      </article>
                    </div>
                  </article>

                  <article className="sensor-environment-panel">
                    <div className="sensor-section-heading">
                      <div>
                        <span className="sensor-section-number is-outdoor">
                          2
                        </span>
                        <div>
                          <h2>실외 환경</h2>
                          <p>
                            {selectedLocation.name} 좌표 기준 날씨·대기질 API
                          </p>
                        </div>
                      </div>
                      <span
                        className={`sensor-panel-source ${
                          latest.outdoorDataValid ? "is-api" : "is-invalid"
                        }`}
                      >
                        {latest.outdoorDataValid
                          ? "날씨 API 확인"
                          : "출처 확인 필요"}
                      </span>
                    </div>

                    {!latest.outdoorDataValid && (
                      <div
                        className="sensor-outdoor-source-warning"
                        role="alert"
                      >
                        이 기록은 날씨 API 사용 여부를 확인할 수 없어 실외값을
                        표시하지 않습니다. 새 측정부터 API가 성공해야만
                        저장됩니다.
                      </div>
                    )}

                    <div className="sensor-value-grid">
                      {METRICS.slice(3).map((metric) => (
                        <MetricValueCard
                          metric={metric}
                          latest={outdoorLatest}
                          thresholds={logicThresholds}
                          key={metric.key}
                        />
                      ))}
                    </div>
                  </article>
                </section>

                <section
                  className="sensor-system-strip"
                  aria-label="기타 현재 상태"
                >
                  <div>
                    <span aria-hidden="true">☀️</span>
                    <small>날씨</small>
                    <strong>
                      {latest.outdoorDataValid
                        ? latest.weatherCondition
                        : "API 확인 필요"}
                    </strong>
                  </div>
                  <div>
                    <span aria-hidden="true">⚙️</span>
                    <small>제어 모드</small>
                    <strong>
                      {latest.currentMode === "AUTO" ? "자동" : "수동"}
                    </strong>
                  </div>
                  <div>
                    <span aria-hidden="true">❄️</span>
                    <small>에어컨 상태</small>
                    <strong>{getAcLabel(latest)}</strong>
                  </div>
                  <div>
                    <span aria-hidden="true">💡</span>
                    <small>현재 추천</small>
                    <strong>{getRecommendationLabel(latest)}</strong>
                  </div>
                  <div>
                    <span aria-hidden="true">🧪</span>
                    <small>기록 구분</small>
                    <strong>
                      {getIndoorSourceLabel(latest)} ·{" "}
                      {latest.outdoorDataValid
                        ? "실외 날씨 API"
                        : "실외 출처 확인 필요"}
                    </strong>
                  </div>
                </section>

                <section
                  className="sensor-observation-strip"
                  aria-label="날씨 API 관측 정보"
                >
                  <span>
                    기상청 관측{" "}
                    <strong>
                      {formatObservationTime(latest.weatherObservedAt)}
                    </strong>
                  </span>
                  <span>
                    대기질 관측{" "}
                    <strong>
                      {formatObservationTime(latest.airQualityObservedAt)}
                    </strong>
                  </span>
                  <span>
                    API 조회{" "}
                    <strong>
                      {formatObservationTime(latest.weatherFetchedAt)}
                    </strong>
                  </span>
                  <span>
                    {latest.weatherCacheUsed
                      ? "API 캐시 사용"
                      : "API 직접 조회"}
                  </span>
                </section>

                <section className="sensor-history-section" id="sensor-history">
                  <div className="sensor-history-toolbar">
                    <div>
                      <div className="sensor-history-title-row">
                        <span className="sensor-section-number is-history">
                          3
                        </span>
                        <div>
                          <h2>측정값 히스토리</h2>
                          <p>
                            최근 최대 {HISTORY_LIMIT.toLocaleString("ko-KR")}건
                            중 선택한 기간에 들어오는 기록만 표시합니다.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="sensor-history-actions">
                      <div
                        className="sensor-range-tabs"
                        role="group"
                        aria-label="히스토리 기간"
                      >
                        {RANGE_OPTIONS.map((option) => (
                          <button
                            type="button"
                            className={
                              rangeKey === option.key ? "is-active" : ""
                            }
                            onClick={() => setRangeKey(option.key)}
                            key={option.key}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        className="sensor-export-button"
                        onClick={() =>
                          downloadCsv(displayedReadings, selectedLocation.name)
                        }
                        disabled={displayedReadings.length === 0}
                      >
                        ↓ CSV 내보내기
                      </button>
                    </div>
                  </div>

                  <div
                    className="sensor-record-legend"
                    aria-label="기록 구분 범례"
                  >
                    <span>
                      <i className="is-actual" /> 실내 실제값
                    </span>
                    <span>
                      <i className="is-test" /> 실내 테스트값
                    </span>
                    <span>
                      <i className="is-api" /> 실외 날씨 API
                    </span>
                    <span>
                      <i className="is-unknown" /> 출처 미확인
                    </span>
                    <small>
                      긴 측정 공백은 ~ ~ 표시로 축약하고, 각 구간 안에서는 시간
                      비율을 유지합니다.
                    </small>
                  </div>

                  {displayedReadings.length === 0 ? (
                    <div className="sensor-range-empty-state">
                      <strong>
                        {activeRange?.label || "선택한 기간"}에 측정 기록이
                        없습니다.
                      </strong>
                      <p>
                        다른 기간을 선택하거나 새 센서값이 들어올 때까지 기다려
                        주세요.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="sensor-summary-grid">
                        <div>
                          <span>표시 기록</span>
                          <strong>{displayedReadings.length}건</strong>
                        </div>
                        <div>
                          <span>평균 실내 온도</span>
                          <strong>
                            {formatMetric(summary.averageIndoorTemperature, 1)}℃
                          </strong>
                        </div>
                        <div>
                          <span>평균 실내 습도</span>
                          <strong>
                            {formatMetric(summary.averageIndoorHumidity, 0)}%
                          </strong>
                        </div>
                        <div>
                          <span>최고 불쾌지수</span>
                          <strong>{formatMetric(summary.maximumThi, 1)}</strong>
                        </div>
                        <div>
                          <span>환기 권장 시간</span>
                          <strong>
                            {Math.round(summary.ventilationMinutes)}분
                          </strong>
                          <small>OPEN_WINDOW 추천 구간</small>
                        </div>
                      </div>

                      <div className="sensor-chart-grid">
                        {METRICS.map((metric) => (
                          <MetricChart
                            metric={metric}
                            records={displayedReadings}
                            thresholds={logicThresholds}
                            rangeKey={rangeKey}
                            key={metric.key}
                          />
                        ))}
                      </div>

                      <div className="sensor-state-grid">
                        <StateTimeline
                          title="창문 상태 이력"
                          icon="🪟"
                          records={displayedReadings}
                          getState={(record) => {
                            if (!record.windowDataAvailable) {
                              return { label: "미연결", tone: "unknown" };
                            }
                            return record.windowIsOpen
                              ? { label: "열림", tone: "open" }
                              : { label: "닫힘", tone: "closed" };
                          }}
                        />
                        <StateTimeline
                          title="에어컨 가동 이력"
                          icon="❄️"
                          records={displayedReadings}
                          getState={(record) => {
                            if (!record.acDataAvailable) {
                              return { label: "미연결", tone: "unknown" };
                            }
                            return record.acIsOn
                              ? { label: "가동 중", tone: "aircon" }
                              : { label: "꺼짐", tone: "closed" };
                          }}
                        />
                        <StateTimeline
                          title="추천 동작 이력"
                          icon="💡"
                          records={displayedReadings}
                          getState={(record) => ({
                            label: getRecommendationLabel(record),
                            tone: getActionTone(record.recommendationAction),
                          })}
                        />
                        <StateTimeline
                          title="날씨 상태 이력"
                          icon="☀️"
                          records={displayedReadings.filter(
                            (record) => record.outdoorDataValid,
                          )}
                          getState={(record) => {
                            const condition =
                              record.weatherCondition || "정보 없음";
                            const isBadWeather =
                              condition.includes("비") ||
                              condition.includes("눈") ||
                              condition.includes("Rain");
                            return {
                              label: condition,
                              tone: isBadWeather
                                ? "weather-bad"
                                : "weather-good",
                            };
                          }}
                        />
                        <StateTimeline
                          title="제어 모드 이력"
                          icon="⚙️"
                          records={displayedReadings}
                          getState={(record) =>
                            record.currentMode === "AUTO"
                              ? { label: "자동", tone: "auto" }
                              : { label: "수동", tone: "manual" }
                          }
                        />
                      </div>
                    </>
                  )}
                </section>

                <section className="sensor-bottom-grid" id="sensor-records">
                  <article className="sensor-table-card">
                    <div className="sensor-card-heading">
                      <div>
                        <h2>최근 측정 기록</h2>
                        <p>
                          현재 장소의 최신 데이터부터 최대 12건을 표시합니다.
                        </p>
                      </div>
                      <span>
                        최근 {readings.length.toLocaleString("ko-KR")}건 불러옴
                      </span>
                    </div>

                    <div className="sensor-table-scroll">
                      <table className="sensor-history-table">
                        <thead>
                          <tr className="sensor-table-group-row">
                            <th rowSpan="2" className="sensor-table-time">
                              시간
                            </th>
                            <th rowSpan="2" className="sensor-table-source">
                              구분
                            </th>
                            <th
                              colSpan="3"
                              className="sensor-table-group is-indoor"
                            >
                              🏠 실내 데이터
                            </th>
                            <th
                              colSpan="5"
                              className="sensor-table-group is-outdoor"
                            >
                              ☁️ 실외 날씨 API
                            </th>
                            <th
                              colSpan="4"
                              className="sensor-table-group is-state"
                            >
                              ⚙️ 상태·추천
                            </th>
                          </tr>
                          <tr className="sensor-table-detail-row">
                            <th className="is-indoor">온도</th>
                            <th className="is-indoor">습도</th>
                            <th className="is-indoor">THI</th>
                            <th className="is-outdoor">온도</th>
                            <th className="is-outdoor">습도</th>
                            <th className="is-outdoor">풍속</th>
                            <th className="is-outdoor">PM2.5</th>
                            <th className="is-outdoor">날씨</th>
                            <th className="is-state">창문</th>
                            <th className="is-state">에어컨</th>
                            <th className="is-state">모드</th>
                            <th className="is-state">추천</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentRows.map((record) => (
                            <tr key={`table-${record.id}`}>
                              <td className="sensor-table-time">
                                {formatHistoryTick(record.measuredAt, rangeKey)}
                              </td>
                              <td className="sensor-table-source">
                                <span
                                  className={`sensor-reading-source-chip ${
                                    record.isTestReading
                                      ? "is-test"
                                      : record.readingSource === "UNKNOWN"
                                        ? "is-unknown"
                                        : "is-actual"
                                  }`}
                                >
                                  {getIndoorSourceLabel(record)}
                                </span>
                                <small>
                                  {record.outdoorDataValid
                                    ? "실외 날씨 API"
                                    : "실외 출처 확인 필요"}
                                </small>
                              </td>
                              <td
                                className={`sensor-table-cell is-indoor ${record.isTestReading ? "is-test-cell" : ""}`}
                              >
                                {formatMetric(record.indoorTemperature, 1)}℃
                              </td>
                              <td
                                className={`sensor-table-cell is-indoor ${record.isTestReading ? "is-test-cell" : ""}`}
                              >
                                {formatMetric(record.indoorHumidity, 0)}%
                              </td>
                              <td
                                className={`sensor-table-cell is-indoor ${record.isTestReading ? "is-test-cell" : ""}`}
                              >
                                {formatMetric(record.thi, 1)}
                              </td>
                              <td className="sensor-table-cell is-outdoor">
                                {record.outdoorDataValid
                                  ? `${formatMetric(
                                      record.outdoorTemperature,
                                      1,
                                    )}℃`
                                  : "API 확인 필요"}
                              </td>
                              <td className="sensor-table-cell is-outdoor">
                                {record.outdoorDataValid
                                  ? `${formatMetric(
                                      record.outdoorHumidity,
                                      0,
                                    )}%`
                                  : "—"}
                              </td>
                              <td className="sensor-table-cell is-outdoor">
                                {record.outdoorDataValid
                                  ? `${formatMetric(record.windSpeed, 1)}m/s`
                                  : "—"}
                              </td>
                              <td className="sensor-table-cell is-outdoor">
                                {record.outdoorDataValid
                                  ? formatMetric(record.pm25, 0)
                                  : "—"}
                              </td>
                              <td className="sensor-table-cell is-outdoor">
                                {record.outdoorDataValid
                                  ? record.weatherCondition
                                  : "—"}
                              </td>
                              <td className="sensor-table-cell is-state">
                                {getWindowLabel(record)}
                              </td>
                              <td className="sensor-table-cell is-state">
                                {getAcLabel(record)}
                              </td>
                              <td className="sensor-table-cell is-state">
                                {record.currentMode === "AUTO"
                                  ? "자동"
                                  : "수동"}
                              </td>
                              <td className="sensor-table-cell is-state">
                                <span
                                  className={`sensor-action-chip is-${getActionTone(
                                    record.recommendationAction,
                                  )}`}
                                  title={record.recommendationTitle}
                                >
                                  {getRecommendationLabel(record)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>

                  <aside className="sensor-side-column">
                    <article className="sensor-status-card" id="sensor-status">
                      <div className="sensor-card-heading">
                        <div>
                          <h2>데이터 상태</h2>
                          <p>수신 여부와 데이터 출처를 확인합니다.</p>
                        </div>
                      </div>

                      <SourceStatusCard
                        icon="🏠"
                        title="실내 온도·습도"
                        source={getIndoorSourceDescription(latest)}
                        status={
                          Number.isFinite(latest.indoorTemperature) &&
                          Number.isFinite(latest.indoorHumidity)
                            ? { label: "정상", tone: "good" }
                            : { label: "데이터 없음", tone: "muted" }
                        }
                        latest={latest}
                      />
                      <SourceStatusCard
                        icon="🪟"
                        title="창문 상태"
                        source="window_is_open 센서"
                        status={
                          latest.windowDataAvailable
                            ? { label: "정상", tone: "good" }
                            : { label: "미연결", tone: "warning" }
                        }
                        latest={latest}
                      />
                      <SourceStatusCard
                        icon="❄️"
                        title="에어컨 가동"
                        source="ac_is_on 전원 센서"
                        status={
                          latest.acDataAvailable
                            ? {
                                label: latest.acIsOn ? "가동 중" : "꺼짐",
                                tone: latest.acIsOn ? "warning" : "good",
                              }
                            : { label: "미연결", tone: "warning" }
                        }
                        latest={latest}
                      />
                      <SourceStatusCard
                        icon="📍"
                        title="장소 좌표"
                        source="날씨 API 조회 기준"
                        status={
                          isWeatherStatusLoading && !weatherStatus
                            ? { label: "확인 중", tone: "neutral" }
                            : weatherStatus?.coordinates_available
                              ? { label: "설정됨", tone: "good" }
                              : { label: "미설정", tone: "danger" }
                        }
                        latest={null}
                      />
                      <SourceStatusCard
                        icon="☀️"
                        title="기상청 실황 API"
                        source={
                          weatherStatus?.kma?.message ||
                          (isWeatherStatusLoading
                            ? "확인 중"
                            : weatherStatusError || "상태 미확인")
                        }
                        status={
                          isWeatherStatusLoading && !weatherStatus
                            ? { label: "확인 중", tone: "neutral" }
                            : weatherStatus?.kma?.status === "OK"
                              ? { label: "정상", tone: "good" }
                              : { label: "오류", tone: "danger" }
                        }
                        latest={null}
                        timeLabel={formatObservationTime(
                          weatherStatus?.kma?.observed_at ||
                            latest.weatherObservedAt,
                        )}
                      />
                      <SourceStatusCard
                        icon="🌫️"
                        title="OpenWeather 대기질"
                        source={
                          weatherStatus?.air_quality?.message ||
                          (isWeatherStatusLoading
                            ? "확인 중"
                            : weatherStatusError || "상태 미확인")
                        }
                        status={
                          isWeatherStatusLoading && !weatherStatus
                            ? { label: "확인 중", tone: "neutral" }
                            : weatherStatus?.air_quality?.status === "OK"
                              ? { label: "정상", tone: "good" }
                              : { label: "오류", tone: "danger" }
                        }
                        latest={null}
                        timeLabel={formatObservationTime(
                          weatherStatus?.air_quality?.observed_at ||
                            latest.airQualityObservedAt,
                        )}
                      />
                      <SourceStatusCard
                        icon="☁️"
                        title="실외 날씨"
                        source="기상·대기질 API 전용"
                        status={
                          latest.outdoorDataValid
                            ? { label: "API 확인", tone: "good" }
                            : { label: "출처 오류", tone: "danger" }
                        }
                        latest={latest}
                      />
                      <SourceStatusCard
                        icon="🧪"
                        title="기록 구분"
                        source={`${getIndoorSourceLabel(latest)} · ${
                          latest.outdoorDataValid
                            ? "실외 날씨 API"
                            : "실외 출처 확인 필요"
                        }`}
                        status={
                          latest.isTestReading
                            ? {
                                label: "실내 테스트 · 실외 API",
                                tone: "warning",
                              }
                            : latest.readingSource === "SENSOR"
                              ? { label: "실제값", tone: "good" }
                              : { label: "이전 기록", tone: "neutral" }
                        }
                        latest={latest}
                      />
                    </article>

                    <article className="sensor-alert-card">
                      <div className="sensor-card-heading">
                        <div>
                          <h2>환경 알림</h2>
                          <p>백엔드 추천 로직 기준</p>
                        </div>
                      </div>

                      <div className="sensor-alert-list">
                        {alerts.map((alert, index) => (
                          <div
                            className={`sensor-alert-item is-${alert.tone}`}
                            key={`${alert.title}-${index}`}
                          >
                            <i />
                            <div>
                              <strong>{alert.title}</strong>
                              <p>{alert.message}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  </aside>
                </section>

                <section className="sensor-info-note">
                  <span>TIP</span>
                  <p>
                    현재 선택한 <strong>{selectedLocation.name}</strong>의 최근
                    최대 {HISTORY_LIMIT.toLocaleString("ko-KR")}건만 불러옵니다.
                    기간 버튼은 그중 실제 현재 시각 범위에 들어오는 기록만
                    표시하며, 기록이 없으면 다른 기간의 데이터를 대신 보여주지
                    않습니다. 실외값은 날씨 API 성공 결과만 저장하며 API 결과는
                    10분간 재사용합니다. 테스트 자동 기록은 기본 30초이고 API가
                    3회 연속 실패하면 자동으로 중지됩니다.
                  </p>
                  <button
                    type="button"
                    onClick={handleCreateMockReading}
                    disabled={isCreatingMock}
                  >
                    {isCreatingMock ? "생성 중…" : "테스트 측정 추가"}
                  </button>
                </section>
              </>
            )}
          </main>
        </div>
      </div>

      {toastMessage && (
        <div className="sensor-toast" role="status">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
