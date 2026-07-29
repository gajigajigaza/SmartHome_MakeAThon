// src/features/sensors/sensorReadingsUtils.js
// SensorReadings.jsx에서 쓰는 순수 함수/상수 전부. React 컴포넌트나 상태는
// 없고, 데이터 정규화·포맷팅·판정 로직만 모아둔다(파일이 너무 길어져서 분리).

export const HISTORY_LIMIT = 1000;

export const RANGE_OPTIONS = [
  { key: "1h", label: "1시간", milliseconds: 60 * 60 * 1000 },
  { key: "6h", label: "6시간", milliseconds: 6 * 60 * 60 * 1000 },
  { key: "24h", label: "24시간", milliseconds: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7일", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "전체", milliseconds: null },
];

export const FALLBACK_THRESHOLDS = {
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
  TURN_OFF_AIRCON: "에어컨 끄기 제안",
};

const READING_SOURCE_LABELS = {
  SENSOR: "실내 센서",
  TEST_MANUAL: "수동 테스트값",
  TEST_AUTO: "자동 테스트값",
  UNKNOWN: "출처 확인 필요",
};

export const METRICS = [
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

export function getMetricSourceClass(metric, record) {
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

export function getMetricSourceLabel(metric, record) {
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

export function getIndoorSourceLabel(record) {
  return READING_SOURCE_LABELS[record?.readingSource] || "출처 확인 필요";
}

export function getIndoorSourceDescription(record) {
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

export function getAcLabel(record) {
  if (!record?.acDataAvailable || typeof record.acIsOn !== "boolean") {
    return "미연결";
  }
  return record.acIsOn ? "가동 중" : "꺼짐";
}

export function formatObservationTime(value) {
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

export function formatHistoryTick(date, rangeKey) {
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

export function getMetricReferenceLines(metric, thresholds) {
  if (metric.key === "indoorTemperature") {
    return [
      { value: thresholds.indoor_hot, label: `냉방 ${thresholds.indoor_hot}℃` },
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

export function getMetricDomain(metric, values, thresholds) {
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

export function formatGapDuration(milliseconds) {
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

export function buildCompressedTimeline(records, left, drawableWidth) {
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

export function selectTimeLabelIndexes(records, xPositions, gapBreaks) {
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

export function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

export function toFiniteNumber(value) {
  if (value === "" || value === undefined || value === null) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toNullableBoolean(value) {
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

export function normalizeReading(record) {
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
  const powerWatt = toFiniteNumber(
    firstDefined(record.power_watt, record.powerWatt),
  );
  const personDetected = toNullableBoolean(
    firstDefined(record.person_detected, record.personDetected),
  );
  const measuredAtValue = firstDefined(
    record.measured_at,
    record.recordedAt,
    record.measuredAt,
  );
  const measuredAt = measuredAtValue ? new Date(measuredAtValue) : new Date();
  const recommendation = record.recommendation || {};
  // jh 수정함 - 카메라(occupancy_logs) 판정은 readings.person_detected(PIR 전용
  // 예약 컬럼)이 아니라 recommendation.occupancy_present/occupancy_source로
  // 내려온다(occupancy_engine.resolve_occupancy_signal 결과). LIVE는 카메라
  // 실시간 판정, PATTERN은 학습된 패턴 추정, UNKNOWN은 신호 없음(콜드스타트).
  const occupancyPresent = toNullableBoolean(recommendation.occupancy_present);
  const occupancySource = firstDefined(
    recommendation.occupancy_source,
    "UNKNOWN",
  );
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
    powerWatt,
    personDetected,
    occupancyPresent,
    occupancySource,
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
  };
}

export function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map(normalizeReading)
    .filter(Boolean)
    .filter((record) => !Number.isNaN(record.measuredAt.getTime()))
    .sort((left, right) => left.measuredAt - right.measuredAt);
}

export function mergeReadings(...collections) {
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

export function formatMetric(value, decimals = 1, fallback = "—") {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatTime(date, withSeconds = true) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

export function formatDateTime(date) {
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

export function getWindowLabel(record) {
  if (
    !record?.windowDataAvailable ||
    typeof record.windowIsOpen !== "boolean"
  ) {
    return "미연결";
  }
  return record.windowIsOpen ? "열림" : "닫힘";
}

// jh 수정함 - 카메라 재실감지(occupancy_present/occupancy_source) 표시용 헬퍼.
// LIVE는 카메라가 최근 5분 안에 직접 판정한 값, PATTERN은 학습된 시간대별
// 패턴으로 "확실히 비어있음"만 추정한 값(occupancy_engine.py 참고), UNKNOWN은
// 둘 다 없는 콜드스타트 상태.
export function getOccupancyLabel(record) {
  if (record?.occupancyPresent === true) return "감지됨";
  if (record?.occupancyPresent === false) return "감지 안 됨";
  return "데이터 없음";
}

export function getOccupancySourceLabel(record) {
  if (record?.occupancySource === "LIVE") return "카메라 실시간";
  if (record?.occupancySource === "PATTERN") return "학습된 패턴 추정";
  return "신호 없음";
}

export function getComfortStatus(metricKey, value, latest, thresholds) {
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

export function getActionTone(action) {
  if (action === "OPEN_WINDOW") return "ventilation";
  if (action === "USE_AIRCON" || action === "TURN_OFF_AIRCON") return "aircon";
  if (action === "CLOSE_WINDOW" || action === "ERROR") return "danger";
  if (action === "ENJOY") return "enjoy";
  return "maintain";
}

export function getConnectionState({ latest, refreshSeconds, syncStatus }) {
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

  if (ageSeconds <= refreshThreshold) {
    return {
      key: "live",
      label: latest.isTestReading ? "테스트값 수신" : "실시간 센서 수신",
      description: `${Math.round(ageSeconds)}초 전 · ${getIndoorSourceLabel(latest)}`,
    };
  }

  return {
    key: "connected",
    label: "서버 연결됨",
    description: `마지막 측정 ${formatDateTime(latest.measuredAt)}`,
  };
}

export function buildAlerts(latest, connectionState, thresholds) {
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

  // jh 수정함 - 백엔드 추천엔진(recommendation_engine.py)의 TURN_OFF_AIRCON(빈 방
  // 감지) 트리거와 같은 기준. LIVE/PATTERN 출처도 같이 보여줘서 실시간 감지인지
  // 학습된 패턴 추정인지 구분할 수 있게 한다.
  if (latest.acIsOn === true && latest.occupancyPresent === false) {
    alerts.push({
      tone: "warning",
      title: "빈 방인데 에어컨이 켜져 있어요",
      message: `재실 감지(${getOccupancySourceLabel(latest)}) 결과 사람이 없습니다. 에어컨을 꺼서 전력 낭비를 줄여보세요.`,
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
        "현재 기록은 냉방·습도·미세먼지·강풍 기준을 벗어나지 않았습니다.",
    });
  }

  return alerts.slice(0, 5);
}

export function average(records, key) {
  const values = records
    .map((record) => record[key])
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function estimateActionMinutes(records, predicate) {
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

export function downloadCsv(records, placeName) {
  if (records.length === 0) {
    return;
  }

  const headers = [
    "측정 시각",
    "실내 데이터 출처",
    "실외 데이터 출처",
    "실내 온도(℃)",
    "실내 습도(%)",
    "실외 API 검증",
    "실외 온도(℃)",
    "실외 습도(%)",
    "풍속(m/s)",
    "PM2.5(㎍/㎥)",
    "날씨",
    "창문 상태",
    "에어컨 상태",
    "재실 감지",
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
    record.outdoorDataValid ? "날씨 API 확인" : "출처 확인 필요",
    record.outdoorDataValid ? record.outdoorTemperature : "",
    record.outdoorDataValid ? record.outdoorHumidity : "",
    record.outdoorDataValid ? record.windSpeed : "",
    record.outdoorDataValid ? record.pm25 : "",
    record.outdoorDataValid ? record.weatherCondition : "",
    getWindowLabel(record),
    getAcLabel(record),
    getOccupancyLabel(record),
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
  const blob = new Blob(["﻿", csv], {
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
