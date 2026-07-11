// src/features/dashboard/RecommendationCard.jsx
// 담당: 민주 (현재 추천 + 이유)
//
// 백엔드 /api/recommendation, /api/readings/latest가 내려주는 값을
// convertRecommendation()으로 변환해서 그대로 넣어주면 됩니다.
// 최근엔 백엔드가 warning(경고 문구)도 함께 내려주니, 필요하면
// recommendation.warning을 화면에 추가로 노출해도 좋습니다.
export const initialRecommendation = {
  type: "maintain",
  icon: "📡",
  title: "센서 측정값을 기다리는 중이에요",
  summary: "아직 저장된 실내외 환경 기록이 없습니다.",
  reason:
    "센서 데이터가 들어오면 두더지가 실내외 환경을 분석해 냉방 방법을 추천합니다.",
};

function convertActionToType(action) {
  if (action === "OPEN_WINDOW") return "window";
  if (action === "USE_AIRCON") return "aircon";
  if (action === "CLOSE_WINDOW") return "close-window";
  if (action === "ENJOY") return "enjoy";
  return "maintain";
}

function getRecommendationIcon(action) {
  if (action === "OPEN_WINDOW") return "🪟";
  if (action === "USE_AIRCON") return "❄️";
  if (action === "CLOSE_WINDOW") return "🚪";
  if (action === "ENJOY") return "🍃";
  return "✅";
}

export function convertRecommendation(backendRecommendation) {
  if (!backendRecommendation) {
    return initialRecommendation;
  }

  return {
    type: convertActionToType(backendRecommendation.action),
    icon: getRecommendationIcon(backendRecommendation.action),
    title: backendRecommendation.title,
    summary: backendRecommendation.summary,
    reason: backendRecommendation.reason,
    warning: backendRecommendation.warning,
  };
}

export default function RecommendationCard({ recommendation, isTutorialTarget }) {
  return (
    <article
      className={`card recommendation-card ${recommendation.type} ${
        isTutorialTarget ? "tutorial-target" : ""
      }`}
    >
      <p className="section-label">두더지의 현재 추천</p>
      <p className="dashboard-tagline recommendation-card-tagline">
        두 가지 냉방 방식 중, 더 효율적인 선택을 지능적으로
      </p>

      <div className="recommendation-main">
        <div className="recommendation-icon">{recommendation.icon}</div>

        <div>
          <h2>{recommendation.title}</h2>
          <p>{recommendation.summary}</p>
        </div>
      </div>

      {recommendation.warning && (
        <div className="reason-box warning-box">
          <span>⚠️</span>
          <div>
            <p>{recommendation.warning}</p>
          </div>
        </div>
      )}

      <div className="reason-box">
        <span>💡</span>
        <div>
          <strong>왜 이런 추천을 했나요?</strong>
          <p>{recommendation.reason}</p>
        </div>
      </div>
    </article>
  );
}
