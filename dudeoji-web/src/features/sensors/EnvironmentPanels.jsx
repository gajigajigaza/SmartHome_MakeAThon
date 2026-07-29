// src/features/sensors/EnvironmentPanels.jsx
// "센서 측정값" 페이지의 1) 실내 환경 2) 실외 환경 카드 + 기타 현재 상태/관측
// 정보 스트립. SensorReadings.jsx가 너무 길어져서 섹션별로 분리한 파일 중 하나.

import {
  METRICS,
  formatMetric,
  formatObservationTime,
  getAcLabel,
  getComfortStatus,
  getIndoorSourceDescription,
  getIndoorSourceLabel,
  getOccupancyLabel,
  getOccupancySourceLabel,
  getWindowLabel,
} from "./sensorReadingsUtils";

function MetricValueCard({ metric, latest, thresholds }) {
  const value = latest?.[metric.key] ?? null;
  const status = getComfortStatus(metric.key, value, latest, thresholds);
  const source =
    metric.group === "outdoor"
      ? latest?.outdoorDataValid
        ? metric.source
        : "API 출처 확인 필요"
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

export default function EnvironmentPanels({
  placeName,
  latest,
  outdoorLatest,
  logicThresholds,
}) {
  return (
    <>
      <section
        className="sensor-overview-grid"
        aria-label="현재 환경 측정값"
      >
        <article className="sensor-environment-panel">
          <div className="sensor-section-heading">
            <div>
              <span className="sensor-section-number is-indoor">1</span>
              <div>
                <h2>실내 환경</h2>
                <p>
                  {placeName} · {getIndoorSourceDescription(latest)}
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
            {METRICS.slice(0, 2).map((metric) => (
              <MetricValueCard
                metric={metric}
                latest={latest}
                thresholds={logicThresholds}
                key={metric.key}
              />
            ))}

            <article className="sensor-value-card tone-green">
              <div className="sensor-value-card__top">
                <span className="sensor-value-card__label">창문 상태</span>
                <span className="sensor-value-card__icon" aria-hidden="true">
                  🪟
                </span>
              </div>
              <strong className="sensor-value-card__value is-text">
                {getWindowLabel(latest)}
              </strong>
              <div className="sensor-value-card__bottom">
                <span
                  className={`sensor-status-chip ${
                    latest.windowDataAvailable ? "is-good" : "is-warning"
                  }`}
                >
                  {latest.windowDataAvailable ? "센서 수신" : "센서 미연결"}
                </span>
                <span>window_is_open</span>
              </div>
            </article>

            <article className="sensor-value-card tone-blue">
              <div className="sensor-value-card__top">
                <span className="sensor-value-card__label">에어컨 가동</span>
                <span className="sensor-value-card__icon" aria-hidden="true">
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

            <article className="sensor-value-card tone-purple">
              <div className="sensor-value-card__top">
                <span className="sensor-value-card__label">재실 감지</span>
                <span className="sensor-value-card__icon" aria-hidden="true">
                  👤
                </span>
              </div>
              <strong className="sensor-value-card__value is-text">
                {getOccupancyLabel(latest)}
              </strong>
              <div className="sensor-value-card__bottom">
                <span
                  className={`sensor-status-chip ${
                    latest.occupancySource === "LIVE"
                      ? "is-good"
                      : latest.occupancySource === "PATTERN"
                        ? "is-neutral"
                        : "is-warning"
                  }`}
                >
                  {getOccupancySourceLabel(latest)}
                </span>
                <span>occupancy_logs</span>
              </div>
            </article>
          </div>
        </article>

        <article className="sensor-environment-panel">
          <div className="sensor-section-heading">
            <div>
              <span className="sensor-section-number is-outdoor">2</span>
              <div>
                <h2>실외 환경</h2>
                <p>{placeName} 좌표 기준 날씨·대기질 API</p>
              </div>
            </div>
            <span
              className={`sensor-panel-source ${
                latest.outdoorDataValid ? "is-api" : "is-invalid"
              }`}
            >
              {latest.outdoorDataValid ? "날씨 API 확인" : "출처 확인 필요"}
            </span>
          </div>

          {!latest.outdoorDataValid && (
            <div className="sensor-outdoor-source-warning" role="alert">
              이 기록은 날씨 API 사용 여부를 확인할 수 없어 실외값을
              표시하지 않습니다. 새 측정부터 API가 성공해야만 저장됩니다.
            </div>
          )}

          <div className="sensor-value-grid">
            {METRICS.slice(2).map((metric) => (
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

      <section className="sensor-system-strip" aria-label="기타 현재 상태">
        <div>
          <span aria-hidden="true">☀️</span>
          <small>날씨</small>
          <strong>
            {latest.outdoorDataValid ? latest.weatherCondition : "API 확인 필요"}
          </strong>
        </div>
        <div>
          <span aria-hidden="true">⚙️</span>
          <small>제어 모드</small>
          <strong>{latest.currentMode === "AUTO" ? "자동" : "수동"}</strong>
        </div>
        <div>
          <span aria-hidden="true">❄️</span>
          <small>에어컨 상태</small>
          <strong>{getAcLabel(latest)}</strong>
        </div>
        <div>
          <span aria-hidden="true">💡</span>
          <small>현재 추천</small>
          <strong>{latest.recommendationTitle}</strong>
        </div>
        <div>
          <span aria-hidden="true">🧪</span>
          <small>기록 구분</small>
          <strong>
            {getIndoorSourceLabel(latest)} ·{" "}
            {latest.outdoorDataValid ? "실외 날씨 API" : "실외 출처 확인 필요"}
          </strong>
        </div>
        <div>
          <span aria-hidden="true">⚡</span>
          <small>실측 전력</small>
          <strong>
            {Number.isFinite(latest.powerWatt)
              ? `${latest.powerWatt.toFixed(1)} W`
              : "INA219 데이터 없음"}
          </strong>
        </div>
      </section>

      <section
        className="sensor-observation-strip"
        aria-label="날씨 API 관측 정보"
      >
        <span>
          기상청 관측{" "}
          <strong>{formatObservationTime(latest.weatherObservedAt)}</strong>
        </span>
        <span>
          대기질 관측{" "}
          <strong>{formatObservationTime(latest.airQualityObservedAt)}</strong>
        </span>
        <span>
          API 조회{" "}
          <strong>{formatObservationTime(latest.weatherFetchedAt)}</strong>
        </span>
        <span>
          {latest.weatherCacheUsed ? "API 캐시 사용" : "API 직접 조회"}
        </span>
      </section>
    </>
  );
}
