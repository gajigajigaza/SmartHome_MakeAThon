// useState는 화면의 데이터를 저장한다.
// useEffect는 페이지가 처음 열릴 때 백엔드에 연결한다.
import { useEffect, useState } from "react";

import "./App.css";

// 온도 기록을 그래프로 표시하는 컴포넌트
import TemperatureChart from "./TemperatureChart";

// api.js에서 만든 백엔드 통신 함수를 가져온다.
import {
  createReading,
  fetchReadingHistory,
} from "./api";

// 백엔드 기록이 없을 때 표시할 기본 온습도
const initialSensorData = {
  indoorTemperature: 28.3,
  indoorHumidity: 64,
  outdoorTemperature: 24.7,
  outdoorHumidity: 52,
};

// 아직 백엔드 추천을 받지 않았을 때 표시할 내용
const initialRecommendation = {
  type: "maintain",
  icon: "📡",
  title: "온습도 값을 입력해 주세요",
  summary:
    "백엔드가 실내외 환경을 분석해 냉방 방법을 추천합니다.",
  reason:
    "가상 센서 테스트에서 온습도를 입력한 뒤 추천 결과 확인 버튼을 눌러 주세요.",
};

// 백엔드의 추천 action을 CSS 클래스 이름으로 바꾼다.
function convertActionToType(action) {
  if (action === "OPEN_WINDOW") {
    return "window";
  }

  if (action === "USE_AIRCON") {
    return "aircon";
  }

  return "maintain";
}

// 백엔드 추천 결과에 맞는 아이콘을 반환한다.
function getRecommendationIcon(action) {
  if (action === "OPEN_WINDOW") {
    return "🪟";
  }

  if (action === "USE_AIRCON") {
    return "❄️";
  }

  return "✅";
}

// FastAPI의 추천 응답을 화면에서 사용하는 형식으로 바꾼다.
function convertRecommendation(backendRecommendation) {
  return {
    type: convertActionToType(
      backendRecommendation.action
    ),

    icon: getRecommendationIcon(
      backendRecommendation.action
    ),

    title: backendRecommendation.title,
    summary: backendRecommendation.summary,
    reason: backendRecommendation.reason,
  };
}

// FastAPI의 snake_case 데이터를
// React에서 사용하는 camelCase 데이터로 바꾼다.
function convertReading(backendReading) {
  return {
    id: backendReading.id,

    indoorTemperature:
      backendReading.indoor_temperature,

    indoorHumidity:
      backendReading.indoor_humidity,

    outdoorTemperature:
      backendReading.outdoor_temperature,

    outdoorHumidity:
      backendReading.outdoor_humidity,

    recordedAt: new Date(
      backendReading.measured_at
    ),
  };
}

function App() {
  // 사용자가 입력창에서 수정하는 값
  const [formData, setFormData] =
    useState(initialSensorData);

  // 환경 카드에 실제로 표시되는 값
  const [sensorData, setSensorData] =
    useState(initialSensorData);

  // 백엔드가 반환한 추천 결과
  const [recommendation, setRecommendation] =
    useState(initialRecommendation);

  // 백엔드에 저장된 최근 온도 기록
  const [history, setHistory] = useState([]);

  // 마지막으로 데이터를 측정한 시각
  const [updatedAt, setUpdatedAt] =
    useState(null);

  // 백엔드 요청이 진행 중인지 저장한다.
  const [isLoading, setIsLoading] =
    useState(false);

  // 백엔드 연결 상태
  const [connectionStatus, setConnectionStatus] =
    useState("checking");

  // 오류가 발생했을 때 화면에 표시할 문구
  const [errorMessage, setErrorMessage] =
    useState("");

  // 페이지가 처음 열릴 때 한 번 실행된다.
  useEffect(() => {
    let ignoreResult = false;

    async function loadInitialHistory() {
      try {
        // FastAPI에서 최근 기록 8개를 가져온다.
        const backendHistory =
          await fetchReadingHistory(8);

        if (ignoreResult) {
          return;
        }

        // 요청이 성공했으므로 연결 상태를 변경한다.
        setConnectionStatus("connected");
        setErrorMessage("");

        // 저장된 기록이 없으면 기본 화면을 유지한다.
        if (backendHistory.length === 0) {
          return;
        }

        // 백엔드 기록을 그래프용 형식으로 변경한다.
        const convertedHistory =
          backendHistory.map(convertReading);

        setHistory(convertedHistory);

        // 배열의 마지막 기록을 최신 기록으로 사용한다.
        const latestBackendReading =
          backendHistory[
            backendHistory.length - 1
          ];

        const latestReading =
          convertReading(latestBackendReading);

        // 최신 온습도를 환경 카드에 표시한다.
        setSensorData({
          indoorTemperature:
            latestReading.indoorTemperature,

          indoorHumidity:
            latestReading.indoorHumidity,

          outdoorTemperature:
            latestReading.outdoorTemperature,

          outdoorHumidity:
            latestReading.outdoorHumidity,
        });

        // 최신 추천 결과를 화면에 표시한다.
        setRecommendation(
          convertRecommendation(
            latestBackendReading.recommendation
          )
        );

        setUpdatedAt(latestReading.recordedAt);
      } catch (error) {
        if (ignoreResult) {
          return;
        }

        setConnectionStatus("error");

        setErrorMessage(
          `백엔드 연결 실패: ${error.message}`
        );
      }
    }

    loadInitialHistory();

    return () => {
      ignoreResult = true;
    };
  }, []);

  // 입력창의 숫자가 변경될 때 실행된다.
  function handleInputChange(event) {
    const { name, value } = event.target;

    setFormData((previousData) => ({
      ...previousData,

      // 입력창이 비어 있으면 빈 문자열을 유지한다.
      // 값이 있으면 숫자로 변환한다.
      [name]:
        value === "" ? "" : Number(value),
    }));
  }

  // 추천 결과 확인 버튼을 눌렀을 때 실행된다.
  async function handleRecommendation() {
    // 비어 있거나 숫자가 아닌 값이 있는지 확인한다.
    const hasInvalidValue = Object.values(
      formData
    ).some(
      (value) =>
        value === "" || !Number.isFinite(value)
    );

    if (hasInvalidValue) {
      alert(
        "모든 온도와 습도 값을 숫자로 입력해 주세요."
      );

      return;
    }

    // 습도가 0~100 범위인지 확인한다.
    if (
      formData.indoorHumidity < 0 ||
      formData.indoorHumidity > 100 ||
      formData.outdoorHumidity < 0 ||
      formData.outdoorHumidity > 100
    ) {
      alert(
        "습도는 0%부터 100% 사이로 입력해 주세요."
      );

      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    try {
      // React 입력값을 FastAPI 형식으로 바꿔 전송한다.
      const createdReading = await createReading({
        indoor_temperature:
          formData.indoorTemperature,

        indoor_humidity:
          formData.indoorHumidity,

        outdoor_temperature:
          formData.outdoorTemperature,

        outdoor_humidity:
          formData.outdoorHumidity,
      });

      // 백엔드 응답을 React 형식으로 변환한다.
      const convertedReading =
        convertReading(createdReading);

      // 백엔드에 저장된 값을 환경 카드에 표시한다.
      setSensorData({
        indoorTemperature:
          convertedReading.indoorTemperature,

        indoorHumidity:
          convertedReading.indoorHumidity,

        outdoorTemperature:
          convertedReading.outdoorTemperature,

        outdoorHumidity:
          convertedReading.outdoorHumidity,
      });

      // 백엔드가 계산한 추천 결과를 표시한다.
      setRecommendation(
        convertRecommendation(
          createdReading.recommendation
        )
      );

      setUpdatedAt(
        convertedReading.recordedAt
      );

      // 새 기록을 그래프에 추가하고 최근 8개만 남긴다.
      setHistory((previousHistory) =>
        [
          ...previousHistory,
          convertedReading,
        ].slice(-8)
      );

      setConnectionStatus("connected");
    } catch (error) {
      setConnectionStatus("error");

      setErrorMessage(
        `데이터 전송 실패: ${error.message}`
      );
    } finally {
      setIsLoading(false);
    }
  }

  // 백엔드 연결 상태에 따라 표시할 문구
  const connectionText = {
    checking: "백엔드 확인 중",
    connected: "백엔드 연결됨",
    error: "백엔드 연결 오류",
  }[connectionStatus];

  return (
    <div className="app">
      {/* 서비스 이름과 백엔드 연결 상태 */}
      <header className="header">
        <div className="brand">
          <div className="logo">🌱</div>

          <div>
            <h1>두더지</h1>

            <p>
              두 가지 냉방 방식 중, 더 효율적인
              선택을 지능적으로
            </p>
          </div>
        </div>

        <div className="sensor-status">
          <span
            className={`status-dot ${connectionStatus}`}
          />

          <span>{connectionText}</span>

          {updatedAt && (
            <span>
              {updatedAt.toLocaleTimeString(
                "ko-KR",
                {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }
              )}
            </span>
          )}
        </div>
      </header>

      <main>
        <section className="top-grid">
          {/* 백엔드에서 받은 추천 결과 */}
          <article
            className={`card recommendation-card ${recommendation.type}`}
          >
            <p className="section-label">
              두더지의 현재 추천
            </p>

            <div className="recommendation-main">
              <div className="recommendation-icon">
                {recommendation.icon}
              </div>

              <div>
                <h2>{recommendation.title}</h2>
                <p>{recommendation.summary}</p>
              </div>
            </div>

            <div className="reason-box">
              <span>💡</span>

              <div>
                <strong>
                  왜 이런 추천을 했나요?
                </strong>

                <p>{recommendation.reason}</p>
              </div>
            </div>
          </article>

          {/* 가장 최근의 실내외 온습도 */}
          <article className="card environment-card">
            <h3>실시간 실내외 환경</h3>

            <div className="environment-grid">
              <div className="environment-item indoor">
                <div className="environment-title">
                  <span>실내</span>
                  <span>🏠</span>
                </div>

                <strong>
                  {Number(
                    sensorData.indoorTemperature
                  ).toFixed(1)}
                  ℃
                </strong>

                <p>
                  습도 {sensorData.indoorHumidity}%
                </p>
              </div>

              <div className="environment-item outdoor">
                <div className="environment-title">
                  <span>실외</span>
                  <span>🌤️</span>
                </div>

                <strong>
                  {Number(
                    sensorData.outdoorTemperature
                  ).toFixed(1)}
                  ℃
                </strong>

                <p>
                  습도 {sensorData.outdoorHumidity}%
                </p>
              </div>
            </div>

            <div className="saving-box">
              <div>
                <span>오늘의 예상 절감</span>
                <strong>계산 준비 중</strong>

                <small>
                  추후 실제 측정 기록으로 계산
                </small>
              </div>

              <span className="saving-icon">
                ⚡
              </span>
            </div>
          </article>
        </section>

        <section className="bottom-grid">
          {/* 백엔드 기록을 그래프로 표시한다. */}
          <article className="card chart-card">
            <h3>최근 온도 변화</h3>

            <div className="chart-legend">
              <span className="indoor-legend">
                실내 온도
              </span>

              <span className="outdoor-legend">
                실외 온도
              </span>
            </div>

            <TemperatureChart history={history} />
          </article>

          {/* 백엔드 전송을 시험하는 입력 영역 */}
          <article className="card test-card">
            <h3>가상 센서 테스트</h3>

            <div className="input-grid">
              <label>
                실내 온도 (℃)

                <input
                  type="number"
                  step="0.1"
                  name="indoorTemperature"
                  value={
                    formData.indoorTemperature
                  }
                  onChange={handleInputChange}
                />
              </label>

              <label>
                실내 습도 (%)

                <input
                  type="number"
                  min="0"
                  max="100"
                  name="indoorHumidity"
                  value={formData.indoorHumidity}
                  onChange={handleInputChange}
                />
              </label>

              <label>
                실외 온도 (℃)

                <input
                  type="number"
                  step="0.1"
                  name="outdoorTemperature"
                  value={
                    formData.outdoorTemperature
                  }
                  onChange={handleInputChange}
                />
              </label>

              <label>
                실외 습도 (%)

                <input
                  type="number"
                  min="0"
                  max="100"
                  name="outdoorHumidity"
                  value={formData.outdoorHumidity}
                  onChange={handleInputChange}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={handleRecommendation}
              disabled={isLoading}
            >
              {isLoading
                ? "백엔드 분석 중..."
                : "추천 결과 확인"}
            </button>

            {errorMessage && (
              <p className="connection-error">
                {errorMessage}
              </p>
            )}

            <p className="rule-description">
              입력값은 FastAPI 백엔드로
              전송됩니다. 백엔드가 추천을 계산하고
              저장한 결과를 다시 화면에 표시합니다.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}

export default App;