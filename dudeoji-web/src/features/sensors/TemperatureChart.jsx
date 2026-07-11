// 실내외 온도 기록을 SVG 그래프로 표시하는 컴포넌트
function TemperatureChart({ history }) {
      // 백엔드에 저장된 측정 기록이 아직 없을 때
  // 빈 그래프 대신 안내 문구를 표시한다.
  if (history.length === 0) {
    return (
      <div className="chart-empty">
        <strong>아직 측정 기록이 없습니다.</strong>

        <p>
          센서 노드에서 데이터가 들어오면 그래프가 자동으로 생성됩니다.
        </p>
      </div>
    );
  }
  // 그래프 내부 좌표계의 크기
  const chartWidth = 600;
  const chartHeight = 220;

  // 그래프 선이 가장자리에 붙지 않도록 여백 설정
  const horizontalPadding = 30;
  const verticalPadding = 25;

  // 실내와 실외 온도를 하나의 배열로 합친다.
  const allTemperatures = history.flatMap(
    (record) => [
      record.indoorTemperature,
      record.outdoorTemperature,
    ]
  );

  // 그래프에 표시할 최소 온도
  const minimumTemperature =
    Math.floor(Math.min(...allTemperatures)) - 1;

  // 그래프에 표시할 최대 온도
  const maximumTemperature =
    Math.ceil(Math.max(...allTemperatures)) + 1;

  // 모든 온도가 같은 경우에도 0으로 나누지 않도록 한다.
  const temperatureRange = Math.max(
    maximumTemperature - minimumTemperature,
    1
  );

  // 실제 그래프를 그릴 수 있는 영역
  const drawableWidth =
    chartWidth - horizontalPadding * 2;

  const drawableHeight =
    chartHeight - verticalPadding * 2;

  // 기록 순서에 따라 X 좌표를 계산한다.
  function calculateX(index) {
    // 기록이 하나뿐이면 그래프 가운데에 표시한다.
    if (history.length === 1) {
      return chartWidth / 2;
    }

    return (
      horizontalPadding +
      (index * drawableWidth) /
        (history.length - 1)
    );
  }

  // 온도값을 SVG의 Y 좌표로 변환한다.
  function calculateY(temperature) {
    return (
      verticalPadding +
      ((maximumTemperature - temperature) /
        temperatureRange) *
        drawableHeight
    );
  }

  // 실내 온도 선의 좌표 문자열
  const indoorPoints = history
    .map(
      (record, index) =>
        `${calculateX(index)},${calculateY(
          record.indoorTemperature
        )}`
    )
    .join(" ");

  // 실외 온도 선의 좌표 문자열
  const outdoorPoints = history
    .map(
      (record, index) =>
        `${calculateX(index)},${calculateY(
          record.outdoorTemperature
        )}`
    )
    .join(" ");

  // 그래프 가로 기준선을 위한 온도값
  const guideTemperatures = [
    maximumTemperature,
    (maximumTemperature +
      minimumTemperature) /
      2,
    minimumTemperature,
  ];

  return (
    <>
      <div className="real-chart">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="실내외 온도 입력 기록 그래프"
        >
          {/* 그래프의 가로 기준선과 온도 숫자 */}
          {guideTemperatures.map(
            (temperature, index) => {
              const y = calculateY(temperature);

              return (
                <g key={`guide-${index}`}>
                  <line
                    className="chart-guide-line"
                    x1={horizontalPadding}
                    y1={y}
                    x2={
                      chartWidth -
                      horizontalPadding
                    }
                    y2={y}
                  />

                  <text
                    className="chart-guide-label"
                    x="4"
                    y={y + 4}
                  >
                    {temperature.toFixed(1)}℃
                  </text>
                </g>
              );
            }
          )}

          {/* 기록이 2개 이상이면 점 사이를 선으로 연결한다. */}
          {history.length >= 2 && (
            <>
              <polyline
                className="indoor-line"
                points={indoorPoints}
              />

              <polyline
                className="outdoor-line"
                points={outdoorPoints}
              />
            </>
          )}

          {/* 실내 온도 기록의 초록색 점 */}
          {history.map((record, index) => (
            <g key={`indoor-${record.id}`}>
              <circle
                className="indoor-point"
                cx={calculateX(index)}
                cy={calculateY(
                  record.indoorTemperature
                )}
                r="5"
              />

              <title>
                실내 {record.indoorTemperature}
                ℃
              </title>
            </g>
          ))}

          {/* 실외 온도 기록의 파란색 점 */}
          {history.map((record, index) => (
            <g key={`outdoor-${record.id}`}>
              <circle
                className="outdoor-point"
                cx={calculateX(index)}
                cy={calculateY(
                  record.outdoorTemperature
                )}
                r="5"
              />

              <title>
                실외 {record.outdoorTemperature}
                ℃
              </title>
            </g>
          ))}
        </svg>
      </div>

      {/* 각 기록이 입력된 시각 */}
      <div className="chart-times">
        {history.map((record) => (
          <span key={`time-${record.id}`}>
            {record.recordedAt.toLocaleTimeString(
              "ko-KR",
              {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }
            )}
          </span>
        ))}
      </div>

      <p className="chart-record-count">
        최근 {history.length}개의 측정 기록을
        표시하고 있습니다.
      </p>
    </>
  );
}

export default TemperatureChart;