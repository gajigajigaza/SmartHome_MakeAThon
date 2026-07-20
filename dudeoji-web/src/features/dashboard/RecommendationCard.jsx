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
// 방식이다(합의된 옵션 a). 상단 상태 배지(에어컨/환기)는 시안에서도 대기
// 화면에 이미 보이는 위치라 hasStarted와 무관하게 항상 둘 다 보여주고,
// 실제로 켜져/열려 있을 때만 강조 스타일로 구분한다(아래
// getAcStatusBadge/getWindowStatusBadge 참고).

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
  return "maintain";
}

function getRecommendationIcon(action) {
  if (action === "OPEN_WINDOW") return "🪟";
  if (action === "USE_AIRCON" || action === "TURN_ON_AC") return "❄️";
  if (action === "CLOSE_WINDOW") return "🚪";
  if (action === "ENJOY") return "🍃";
  if (action === "ERROR") return "🚨";
  return "✅";
}

// jh 수정함 - 상단 "현재 동작 상태" 배지. 처음엔 action === "ENJOY"일 때만
// (즉 뭔가 실제로 진행 중일 때만) 배지를 보여줬는데, 그러면 그 상태가 아닐
// 때는 배지 자체가 사라져서 "지금 에어컨/환기가 꺼져 있다"는 것도 확인할
// 방법이 없었다. 이제 hasStarted면 항상 에어컨/환기 배지 둘 다 보여주되,
// 실제로 켜져/열려 있는 상태(ENJOY + 해당 control_context)만 강조 스타일
// (active: true)로 표시하고, 그 외엔 "꺼짐/닫힘"을 muted 스타일로 보여준다.
function getAcStatusBadge(action, controlContext) {
  const isRunning = action === "ENJOY" && controlContext === "AIRCON";
  return {
    icon: isRunning ? "❄️" : "🌡️",
    label: isRunning ? "에어컨 가동 중" : "에어컨 꺼짐",
    active: isRunning,
  };
}

function getWindowStatusBadge(action, controlContext) {
  const isOpen = action === "ENJOY" && controlContext === "VENTILATION";
  return {
    icon: isOpen ? "🍃" : "🚪",
    label: isOpen ? "환기 중" : "창문 닫힘",
    active: isOpen,
  };
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
  // jh 수정함 - 추천카드.png를 다시 보니 상태 배지는 "추천 시작" 버튼이 떠
  // 있는 대기 화면에도 이미 보이는 위치였다(hasStarted로 가릴 게 아니었음).
  // 대기 상태에서도 실제로 로드된 recommendation이 있으면(예: 이전에 저장된
  // 최신 값) 그 기준으로 지금 에어컨/창문이 어떤지 항상 보여준다.
  const acStatusBadge = getAcStatusBadge(
    safeRecommendation.action,
    safeRecommendation.controlContext,
  );
  const windowStatusBadge = getWindowStatusBadge(
    safeRecommendation.action,
    safeRecommendation.controlContext,
  );

  return (
    <article className={`card recommendation-card ${displayRecommendation.type} ${isTutorialTarget ? "tutorial-target" : ""}`}>
      <p className="section-label">두더지의 현재 추천</p>
      <p className="dashboard-tagline recommendation-card-tagline">
        두 가지 냉방 방식 중, 더 효율적인 선택을 지능적으로
      </p>

      <div className="recommendation-status-badges">
        <span
          className={`recommendation-status-badge ${acStatusBadge.active ? "is-active" : "is-muted"}`}
        >
          <span aria-hidden="true">{acStatusBadge.icon}</span> {acStatusBadge.label}
        </span>
        <span
          className={`recommendation-status-badge ${windowStatusBadge.active ? "is-active" : "is-muted"}`}
        >
          <span aria-hidden="true">{windowStatusBadge.icon}</span> {windowStatusBadge.label}
        </span>
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