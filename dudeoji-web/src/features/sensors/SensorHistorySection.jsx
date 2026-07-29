// src/features/sensors/SensorHistorySection.jsx
// "센서 측정값" 페이지의 3) 측정값 히스토리(꺾은선 그래프) + 이력(상태 타임라인)
// 섹션. SensorReadings.jsx가 너무 길어져서 섹션별로 분리한 파일 중 하나.

import {
  HISTORY_LIMIT,
  METRICS,
  RANGE_OPTIONS,
  average,
  buildCompressedTimeline,
  downloadCsv,
  estimateActionMinutes,
  formatDateTime,
  formatGapDuration,
  formatHistoryTick,
  formatMetric,
  getActionTone,
  getMetricDomain,
  getMetricReferenceLines,
  getMetricSourceClass,
  getMetricSourceLabel,
  selectTimeLabelIndexes,
} from "./sensorReadingsUtils";

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

          {timeline.gapBreaks.map((gap) => (
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

export default function SensorHistorySection({
  rangeKey,
  onRangeKeyChange,
  displayedReadings,
  activeRange,
  logicThresholds,
  placeName,
}) {
  const summary = {
    averageIndoorTemperature: average(displayedReadings, "indoorTemperature"),
    averageIndoorHumidity: average(displayedReadings, "indoorHumidity"),
    ventilationMinutes: estimateActionMinutes(
      displayedReadings,
      (record) => record.recommendationAction === "OPEN_WINDOW",
    ),
  };

  return (
    <section className="sensor-history-section" id="sensor-history">
      <div className="sensor-history-toolbar">
        <div>
          <div className="sensor-history-title-row">
            <span className="sensor-section-number is-history">3</span>
            <div>
              <h2>측정값 히스토리</h2>
              <p>
                최근 최대 {HISTORY_LIMIT.toLocaleString("ko-KR")}건 중 선택한
                기간에 들어오는 기록만 표시합니다.
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
                className={rangeKey === option.key ? "is-active" : ""}
                onClick={() => onRangeKeyChange(option.key)}
                key={option.key}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="sensor-export-button"
            onClick={() => downloadCsv(displayedReadings, placeName)}
            disabled={displayedReadings.length === 0}
          >
            ↓ CSV 내보내기
          </button>
        </div>
      </div>

      <div className="sensor-record-legend" aria-label="기록 구분 범례">
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
          긴 측정 공백은 ~ ~ 표시로 축약하고, 각 구간 안에서는 시간 비율을
          유지합니다.
        </small>
      </div>

      {displayedReadings.length === 0 ? (
        <div className="sensor-range-empty-state">
          <strong>{activeRange?.label || "선택한 기간"}에 측정 기록이 없습니다.</strong>
          <p>다른 기간을 선택하거나 새 센서값이 들어올 때까지 기다려 주세요.</p>
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
              <strong>{formatMetric(summary.averageIndoorHumidity, 0)}%</strong>
            </div>
            <div>
              <span>환기 권장 시간</span>
              <strong>{Math.round(summary.ventilationMinutes)}분</strong>
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
              title="재실 감지 이력"
              icon="👤"
              records={displayedReadings}
              getState={(record) => {
                if (record.occupancyPresent === true) {
                  return { label: "감지됨", tone: "aircon" };
                }
                if (record.occupancyPresent === false) {
                  return { label: "감지 안 됨", tone: "closed" };
                }
                return { label: "데이터 없음", tone: "unknown" };
              }}
            />
            <StateTimeline
              title="추천 동작 이력"
              icon="💡"
              records={displayedReadings}
              getState={(record) => ({
                label: record.recommendationTitle,
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
                const condition = record.weatherCondition || "정보 없음";
                const isBadWeather =
                  condition.includes("비") ||
                  condition.includes("눈") ||
                  condition.includes("Rain");
                return {
                  label: condition,
                  tone: isBadWeather ? "weather-bad" : "weather-good",
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
  );
}
