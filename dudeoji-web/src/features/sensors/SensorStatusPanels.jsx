// src/features/sensors/SensorStatusPanels.jsx
// "센서 측정값" 페이지의 "데이터 상태"(수신 여부/출처) + "환경 알림" 카드.
// SensorReadings.jsx가 너무 길어져서 섹션별로 분리한 파일 중 하나.

import {
  formatObservationTime,
  formatTime,
  getIndoorSourceDescription,
  getIndoorSourceLabel,
  getOccupancySourceLabel,
} from "./sensorReadingsUtils";

function SourceStatusCard({ icon, title, source, status, latest, timeLabel = null }) {
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

export default function SensorStatusPanels({
  latest,
  weatherStatus,
  weatherStatusError,
  isWeatherStatusLoading,
  alerts,
}) {
  return (
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
          icon="👤"
          title="재실 감지"
          source={`occupancy_logs · ${getOccupancySourceLabel(latest)}`}
          status={
            latest.occupancySource === "LIVE"
              ? { label: "카메라 정상", tone: "good" }
              : latest.occupancySource === "PATTERN"
                ? { label: "패턴 추정", tone: "neutral" }
                : { label: "신호 없음", tone: "warning" }
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
            (isWeatherStatusLoading ? "확인 중" : weatherStatusError || "상태 미확인")
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
            weatherStatus?.kma?.observed_at || latest.weatherObservedAt,
          )}
        />
        <SourceStatusCard
          icon="🌫️"
          title="OpenWeather 대기질"
          source={
            weatherStatus?.air_quality?.message ||
            (isWeatherStatusLoading ? "확인 중" : weatherStatusError || "상태 미확인")
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
            weatherStatus?.air_quality?.observed_at || latest.airQualityObservedAt,
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
            latest.outdoorDataValid ? "실외 날씨 API" : "실외 출처 확인 필요"
          }`}
          status={
            latest.isTestReading
              ? { label: "실내 테스트 · 실외 API", tone: "warning" }
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
  );
}
