// src/features/dashboard/RecommendationCard.jsx
// 담당: 민주 (현재 추천 + 이유) — jh가 정현 합의로 "추천 시작" 버튼 추가
//
// 백엔드 /api/recommendation, /api/readings/latest가 내려주는 값을
// convertRecommendation()으로 변환해서 그대로 넣어주면 됩니다.
// 최근엔 백엔드가 warning(경고 문구)도 함께 내려주니, 필요하면
//
// jh 수정함 - 추천카드.png 시안대로 "추천 시작" 버튼을 추가했다. hasStarted가
// false면(대기 상태) title/summary/reason/warning 등 "추천 내용"만 숨기고
// 대기 문구 + 버튼으로 대체한다. 새로 fetch를 트리거하지 않고, App.jsx가 이미
// 들고 있는 최신 recommendation을 버튼 클릭 시점에 그대로 노출하는
// 방식이다(합의된 옵션 a).
//
// jh 수정함(2026-07-26, 팀 결정) - 헤더에 있던 HeaderQuickControls(창문/
// 에어컨 상태+제어 4칸)를 이 카드 우측 상단으로 이식. 예전에 여기 있던
// "에어컨 꺼짐"/"창문 닫힘" 상태 배지(getAcStatusBadge/getWindowStatusBadge)는
// 이식해온 4칸의 상태 표시와 중복이라 제거하고, 대신 이식된 버튼 중 현재
// 추천 action과 일치하는 쪽에 스타일 강조를 준다(HeaderQuickControls의
// recommendedAction prop).

import HeaderQuickControls from "./HeaderQuickControls";

export const initialRecommendation = {
  type: "maintain",
  icon: "📡",
  title: "센서 측정값을 기다리는 중이에요",
  summary: "아직 저장된 실내외 환경 기록이 없습니다.",
  reason: "센서 데이터가 들어오면 두더지가 실내외 환경을 분석해 냉방 방법을 추천합니다.",
};

// jh 수정함 - "추천 시작" 버튼을 누르기 전 대기 화면 전용 문구. initialRecommendation
// 자체는 "정말 저장된 기록이 없는" 경우의 폴백이라 그대로 두고, 대기 화면만
// 이 문구로 덮어써서 시작 후에도(데이터가 없으면) initialRecommendation의
// 원래 문구가 정상적으로 보이게 한다.
const START_PROMPT = {
  title: "두더지의 추천을 받아보세요",
  summary: "추천 시작 버튼을 누르면 추천 결과를 확인할 수 있습니다.",
};

function convertActionToType(action) {
  if (action === "OPEN_WINDOW") return "window";
  if (action === "USE_AIRCON" || action === "TURN_ON_AC") return "aircon";
  if (action === "CLOSE_WINDOW") return "close-window";
  if (action === "ENJOY") return "enjoy";
  if (action === "ERROR") return "error";
  if (action === "TURN_OFF_AIRCON") return "aircon-off";
  return "maintain";
}

function getRecommendationIcon(action) {
  if (action === "OPEN_WINDOW") return "🪟";
  if (action === "USE_AIRCON" || action === "TURN_ON_AC") return "❄️";
  if (action === "CLOSE_WINDOW") return "🚪";
  if (action === "ENJOY") return "🍃";
  if (action === "ERROR") return "🚨";
  if (action === "TURN_OFF_AIRCON") return "🔌";
  return "✅";
}

export function convertRecommendation(backendRecommendation) {
  if (!backendRecommendation) {
    return initialRecommendation;
  }
  return {
    action: backendRecommendation.action,
    type: convertActionToType(backendRecommendation.action),
    icon: getRecommendationIcon(backendRecommendation.action),
    title: backendRecommendation.title,
    summary: backendRecommendation.summary,
    reason: backendRecommendation.reason,
    warning: backendRecommendation.warning,
    controlContext: backendRecommendation.control_context,
  };
}

export default function RecommendationCard({
  recommendation,
  isTutorialTarget,
  hasStarted = false,
  onStart,
}) {
  const safeRecommendation = recommendation || initialRecommendation;
  const displayRecommendation = hasStarted
    ? safeRecommendation
    : { ...initialRecommendation, ...START_PROMPT };
  // jh 수정함 - 추천 시작 전(대기 화면)이거나 추천이 없을 때는 강조 없음.
  const recommendedAction = hasStarted ? safeRecommendation.action : null;

  return (
    <article className={`card recommendation-card ${displayRecommendation.type} ${isTutorialTarget ? "tutorial-target" : ""}`}>
      <div className="recommendation-card-topbar">
        <div className="recommendation-card-heading">
          <p className="section-label">두더지의 현재 추천</p>
          <p className="dashboard-tagline recommendation-card-tagline">
            두 가지 냉방 방식 중, 더 효율적인 선택을 지능적으로
          </p>
        </div>
        <HeaderQuickControls recommendedAction={recommendedAction} />
      </div>

      <div className="recommendation-main">
        <div className="recommendation-icon">{displayRecommendation.icon}</div>
        <div>
          <h2>{displayRecommendation.title}</h2>
          <p>{displayRecommendation.summary}</p>
        </div>
      </div>

      {!hasStarted && (
        <button
          type="button"
          className="recommendation-start-button"
          onClick={onStart}
        >
          <span aria-hidden="true">✨</span> 추천 시작
        </button>
      )}

      {hasStarted && displayRecommendation.warning && (
        <div className="reason-box warning-box">
          <span>⚠️</span>
          <div>
            <p>{displayRecommendation.warning}</p>
          </div>
        </div>
      )}

      <div className="reason-box">
        <span>💡</span>
        <div>
          <strong>왜 이런 추천을 했나요?</strong>
          <p>{displayRecommendation.reason}</p>
        </div>
      </div>
    </article>
  );
}