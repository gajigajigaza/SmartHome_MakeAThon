// src/features/menu/Tutorial.jsx
// 담당: 류은 (메뉴/온보딩)
export const TUTORIAL_STEPS = [
  {
    key: "menu",
    badge: "MENU",
    title: "새싹 아이콘이 메뉴 버튼이에요",
    description:
      "왼쪽 위 새싹 아이콘을 누르면 마이페이지, 센서 측정값, 뱃지, 로그아웃 메뉴를 열 수 있어요.",
    hint: "메뉴가 어디 있는지 먼저 기억해 주세요.",
  },
  {
    key: "recommendation",
    badge: "추천",
    title: "두더지가 지금의 냉방 방법을 추천해요",
    description:
      "실내외 환경을 보고 창문을 열지, 에어컨을 쓸지 한눈에 알려주는 영역이에요.",
    hint: "가장 먼저 보면 되는 핵심 카드예요.",
  },
  {
    key: "environment",
    badge: "환경",
    title: "실내외 온도와 습도를 확인해요",
    description:
      "현재 실내와 실외 상태를 비교해서 추천 이유를 이해할 수 있어요.",
    hint: "센서값이 들어오면 이 카드가 최신 상태로 바뀌어요.",
  },
  {
    key: "again",
    badge: "다시 보기",
    title: "튜토리얼은 언제든 다시 볼 수 있어요",
    description:
      "새싹 메뉴를 열고 '튜토리얼 다시 보기'를 누르면 이 안내를 다시 확인할 수 있어요.",
    hint: "이제 두더지를 시작해 볼까요?",
  },
];

export function TutorialOverlay({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onPrevious,
  onClose,
}) {
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1;

  return (
    <div className={`dashboard-tutorial-overlay step-${step.key}`}>
      <div className="dashboard-tutorial-dim" />

      <section
        className={`dashboard-tutorial-card tutorial-${step.key}`}
        role="dialog"
        aria-modal="true"
        aria-label="두더지 사용 안내"
      >
        <div className="dashboard-tutorial-badge">{step.badge}</div>

        <button
          className="dashboard-tutorial-close"
          type="button"
          onClick={onClose}
          aria-label="튜토리얼 닫기"
        >
          ×
        </button>

        <h2>{step.title}</h2>
        <p>{step.description}</p>
        <small>{step.hint}</small>

        <div className="dashboard-tutorial-progress">
          {Array.from({ length: totalSteps }).map((_, index) => (
            <span
              className={index === stepIndex ? "active" : ""}
              key={index}
            />
          ))}
        </div>

        <div className="dashboard-tutorial-actions">
          <button
            type="button"
            className="dashboard-tutorial-secondary"
            onClick={isFirstStep ? onClose : onPrevious}
          >
            {isFirstStep ? "건너뛰기" : "이전"}
          </button>

          <button
            type="button"
            className="dashboard-tutorial-primary"
            onClick={isLastStep ? onClose : onNext}
          >
            {isLastStep ? "시작하기" : "다음"}
          </button>
        </div>
      </section>
    </div>
  );
}
