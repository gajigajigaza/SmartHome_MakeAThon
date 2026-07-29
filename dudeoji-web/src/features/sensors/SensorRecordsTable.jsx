// src/features/sensors/SensorRecordsTable.jsx
// "센서 측정값" 페이지의 "최근 측정 기록" 표. SensorReadings.jsx가 너무
// 길어져서 섹션별로 분리한 파일 중 하나.

import {
  formatHistoryTick,
  formatMetric,
  getAcLabel,
  getActionTone,
  getIndoorSourceLabel,
  getOccupancyLabel,
  getWindowLabel,
} from "./sensorReadingsUtils";

export default function SensorRecordsTable({
  displayedReadings,
  totalCount,
  rangeKey,
}) {
  const recentRows = [...displayedReadings].reverse().slice(0, 12);

  return (
    <article className="sensor-table-card">
      <div className="sensor-card-heading">
        <div>
          <h2>최근 측정 기록</h2>
          <p>현재 장소의 최신 데이터부터 최대 12건을 표시합니다.</p>
        </div>
        <span>최근 {totalCount.toLocaleString("ko-KR")}건 불러옴</span>
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
              <th colSpan="2" className="sensor-table-group is-indoor">
                🏠 실내 데이터
              </th>
              <th colSpan="5" className="sensor-table-group is-outdoor">
                ☁️ 실외 날씨 API
              </th>
              <th colSpan="5" className="sensor-table-group is-state">
                ⚙️ 상태·추천
              </th>
            </tr>
            <tr className="sensor-table-detail-row">
              <th className="is-indoor">온도</th>
              <th className="is-indoor">습도</th>
              <th className="is-outdoor">온도</th>
              <th className="is-outdoor">습도</th>
              <th className="is-outdoor">풍속</th>
              <th className="is-outdoor">PM2.5</th>
              <th className="is-outdoor">날씨</th>
              <th className="is-state">창문</th>
              <th className="is-state">에어컨</th>
              <th className="is-state">재실</th>
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
                <td className="sensor-table-cell is-outdoor">
                  {record.outdoorDataValid
                    ? `${formatMetric(record.outdoorTemperature, 1)}℃`
                    : "API 확인 필요"}
                </td>
                <td className="sensor-table-cell is-outdoor">
                  {record.outdoorDataValid
                    ? `${formatMetric(record.outdoorHumidity, 0)}%`
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
                  {record.outdoorDataValid ? record.weatherCondition : "—"}
                </td>
                <td className="sensor-table-cell is-state">
                  {getWindowLabel(record)}
                </td>
                <td className="sensor-table-cell is-state">
                  {getAcLabel(record)}
                </td>
                <td className="sensor-table-cell is-state">
                  {getOccupancyLabel(record)}
                </td>
                <td className="sensor-table-cell is-state">
                  {record.currentMode === "AUTO" ? "자동" : "수동"}
                </td>
                <td className="sensor-table-cell is-state">
                  <span
                    className={`sensor-action-chip is-${getActionTone(
                      record.recommendationAction,
                    )}`}
                    title={record.recommendationTitle}
                  >
                    {record.recommendationTitle}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
