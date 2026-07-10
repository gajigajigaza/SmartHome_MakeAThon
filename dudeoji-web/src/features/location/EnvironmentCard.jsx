// src/features/location/EnvironmentCard.jsx
// 담당: 나 (위치 추가 · 실외 날씨 · 실내외 환경 · 예상 절감)
//
// 지금은 sensorData(백엔드 최신 기록)만 표시합니다.
// 위치/날씨 입력 UI는 LocationBar.jsx, 절감 요약은 SavingsSummary.jsx에서
// 각각 개발한 뒤 이 카드 위/아래에 끼워 넣으면 됩니다.
export function TemperatureValue({ value }) {
  if (value === null || value === undefined) {
    return <>-- ℃</>;
  }

  return <>{Number(value).toFixed(1)}℃</>;
}

export function HumidityValue({ value }) {
  if (value === null || value === undefined) {
    return <>아직 측정 전</>;
  }

  return <>습도 {value}%</>;
}

export default function EnvironmentCard({
  sensorData,
  updatedAt,
  isTutorialTarget,
  children,
}) {
  return (
    <article
      className={`card environment-card ${isTutorialTarget ? "tutorial-target" : ""}`}
    >
      <h3>실시간 실내외 환경</h3>

      <div className="environment-grid">
        <div className="environment-item indoor">
          <div className="environment-title">
            <span>실내</span>
            <span>🏠</span>
          </div>

          <strong>
            <TemperatureValue value={sensorData?.indoorTemperature} />
          </strong>
          <p>
            <HumidityValue value={sensorData?.indoorHumidity} />
          </p>
        </div>

        <div className="environment-item outdoor">
          <div className="environment-title">
            <span>실외</span>
            <span>🌤️</span>
          </div>

          <strong>
            <TemperatureValue value={sensorData?.outdoorTemperature} />
          </strong>
          <p>
            <HumidityValue value={sensorData?.outdoorHumidity} />
          </p>
        </div>
      </div>

      {/* 예상 절감(SavingsSummary)이나 위치 표시줄을 붙일 자리 */}
      {children}

      {updatedAt && (
        <p className="dashboard-updated-at">
          마지막 측정{" "}
          {updatedAt.toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </article>
  );
}
