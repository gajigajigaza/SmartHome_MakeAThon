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
// jh 수정함(2026-07-29, 팀 결정) - "추천 시작" 이후 흐름을 자동 실행형으로
// 바꿨다: 실행 가능한 추천(창문/에어컨 상태 변경이 필요한 action)이 뜨면
// 5초 카운트다운 후 자동으로 기기에 명령을 보낸다. 그 안에 "거절"을 누르면
// 카드가 반으로 나뉘어 HeaderQuickControls(창문/에어컨 버튼)가 나타나고,
// 그때부터는 사람이 직접 눌러서 조작한다. MAINTAIN/ENJOY/ERROR처럼 상태
// 변경이 필요 없는 추천은 카운트다운도 버튼도 없이 멘트만 보여준다(기존과
// 동일). HeaderQuickControls는 더 이상 카드 상단에 항상 뜨지 않고, 거절
// 이후(수동 모드)에만 렌더링된다.

import { useEffect, useRef, useState } from "react";

import { controlDevice } from "./devicesApi";
import HeaderQuickControls from "./HeaderQuickControls";
import SensorNodeStatusBadges from "./SensorNodeStatusBadges";

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

// jh 수정함 - 자동 실행 카운트다운 길이(초). 거절 없이 이 시간이 지나면
// 추천대로 기기에 명령을 보낸다.
const COUNTDOWN_SECONDS = 5;

// jh 수정함 - recommendation.action(추천 엔진의 비즈니스 용어)을
// /api/devices/control이 받는 실제 기기 명령으로 매핑한다. 여기 없는
// action(MAINTAIN/ENJOY/ERROR)은 "지금 실행할 게 없다"는 뜻으로, 카운트다운도
// 수동 버튼도 뜨지 않는다.
const ACTION_TO_DEVICE_COMMAND = {
  USE_AIRCON: "TURN_ON_AIRCON",
  TURN_OFF_AIRCON: "TURN_OFF_AIRCON",
  OPEN_WINDOW: "OPEN_WINDOW",
  CLOSE_WINDOW: "CLOSE_WINDOW",
};

function getDeviceCommandForAction(action) {
  return ACTION_TO_DEVICE_COMMAND[action] || null;
}

// jh 수정함(2026-07-29) - 자동 실행이 성공한 직후 카드에 보여줄 멘트.
// 백엔드가 다음 실제 센서 측정치를 받아 recommendation을 새로 계산해줄
// 때까지(수십 초 걸릴 수 있음) 기다리지 않고, recommendation_engine.py의
// _TITLES 8종 중 방금 만든 상태에 해당하는 멘트를 그대로 가져와 즉시
// 보여준다. 새 reading이 도착하면(readingKey 변경) 이 오버레이는 지우고
// 백엔드가 내려준 진짜 recommendation을 다시 신뢰한다.
const POST_EXECUTION_DISPLAY = {
  TURN_ON_AIRCON: {
    type: "aircon",
    icon: "❄️",
    title: "에어컨이 켜져 있어요! 시원한 바람 즐기는 중",
    summary: "두더지가 추천대로 에어컨을 자동으로 켰어요.",
  },
  OPEN_WINDOW: {
    type: "enjoy",
    icon: "🍃",
    title: "창문이 열려 있어요! 자연 바람 즐기는 중",
    summary: "두더지가 추천대로 창문을 자동으로 열었어요.",
  },
  CLOSE_WINDOW: {
    type: "maintain",
    icon: "✅",
    title: "딱 좋은 상태 유지 중",
    summary: "두더지가 추천대로 창문을 자동으로 닫았어요.",
  },
  TURN_OFF_AIRCON: {
    type: "maintain",
    icon: "✅",
    title: "딱 좋은 상태 유지 중",
    summary: "두더지가 추천대로 에어컨을 자동으로 껐어요.",
  },
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
  // jh 수정함 - 자동 실행 명령을 보낼 장소. App.jsx의 selectedPlaceId를 그대로 받는다.
  placeId = null,
  // jh 수정함 - "새 추천이 도착했다"를 판별하는 값. 예전엔 60초 폴링이 새
  // reading을 받아올 때마다 바뀌었지만, 지금은 App.jsx가 "다시 추천받기"
  // 버튼을 눌렀을 때(+최초 로드/장소 전환)만 이 값을 바꾼다 — 그래야 폴링이
  // 조용히 새 온습도를 받아와도 카운트다운/추천이 화면에서 제멋대로 바뀌지
  // 않고, 사용자가 누를 때까지 그대로 유지된다.
  readingKey = null,
  // jh 추가 - "다시 추천받기" 클릭 시 App.jsx로 이전 추천의 결과(outcome)를
  // 넘겨준다. App.jsx가 이걸로 백엔드에 유지 시간을 기록하고 새 추천을 받아와
  // readingKey를 갱신해준다.
  onRequestNewRecommendation = null,
}) {
  const safeRecommendation = recommendation || initialRecommendation;
  // jh 수정함 - 추천 시작 전(대기 화면)이거나 추천이 없을 때는 강조 없음.
  const recommendedAction = hasStarted ? safeRecommendation.action : null;

  // "confirming"(카운트다운 중) | "auto-executing"(명령 전송 중) |
  // "manual"(거절/실패 후 직접 조작) | "idle"(실행할 것 없음 또는 완료)
  const [phase, setPhase] = useState("idle");
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [executionNote, setExecutionNote] = useState("");
  // jh 수정함 - 자동 실행 성공 직후 POST_EXECUTION_DISPLAY로 덮어쓸 멘트.
  // 새 reading이 도착하면(readingKey 변경) null로 되돌아간다.
  const [postExecutionOverride, setPostExecutionOverride] = useState(null);
  // jh 수정함(2026-07-29) - 수동 모드에서 HeaderQuickControls가 보고하는
  // 명령 전송 결과/오류 문구. 예전엔 버튼 박스 안에 떠서 지저분했는데,
  // "직접 창문/에어컨을 조작해 주세요" 라벨 옆에 작게 옮겨서 보여준다.
  const [manualDeviceFeedback, setManualDeviceFeedback] = useState("");
  // jh 추가 - "다시 추천받기" 요청이 진행 중인지(중복 클릭 방지 + 버튼 로딩 표시).
  const [isRefreshing, setIsRefreshing] = useState(false);
  // jh 추가 - 아래 useEffect가 이 readingKey를 실제로 처리(phase 확정)하고
  // 나면 그 key를 기록한다. ref가 아니라 state인 이유: "다시 추천받기"
  // 노출 여부를 이 값으로 판단하는데, ref를 직접 읽으면 phase가 우연히
  // 이전과 같은 값("idle" -> "idle")이라 React가 리렌더를 스킵하는 경우
  // 버튼이 갱신된 ref를 반영하지 못하고 영영 안 보이게 된다. state는 매번
  // 진짜 새 readingKey로 바뀌므로 항상 리렌더가 보장된다.
  const [settledReadingKey, setSettledReadingKey] = useState(null);
  // jh 추가 - phase가 "manual"이 된 두 가지 서로 다른 이유를 구분해서 기록한다:
  // 사용자가 "거절"을 직접 눌렀는지(REJECTED_MANUAL), 아니면 자동실행이 기기
  // 통신 실패로 넘어간 것인지(AUTO_EXECUTION_FAILED). 이걸 구분 안 하면
  // "다시 추천받기" 클릭 시 실패도 전부 "거절"로 로그돼 분석 데이터가 왜곡된다.
  const [manualEntryReason, setManualEntryReason] = useState(null);

  const displayRecommendation = !hasStarted
    ? { ...initialRecommendation, ...START_PROMPT }
    : postExecutionOverride
      ? { ...safeRecommendation, ...postExecutionOverride }
      : safeRecommendation;

  const handledReadingKeyRef = useRef(null);
  const intervalIdRef = useRef(null);
  const fireTimeoutIdRef = useRef(null);
  // jh 수정함 - StrictMode(개발 모드)는 setState 업데이터 함수를 순수성 검증을
  // 위해 두 번 호출한다. 예전엔 이 실행 트리거가 setSecondsLeft의 업데이터
  // 함수 안에 있어서, 실제 기기 명령(controlDevice)이 두 번 나가는 버그가
  // 있었다(브라우저로 직접 검증하다가 발견). 카운트다운 숫자는 setState
  // 업데이터로 순수하게 감소만 시키고, "0에 도달했다" 판정과 명령 실행은
  // 이 ref로 감시해 정확히 한 번만 실행되게 분리했다.
  const firedForReadingKeyRef = useRef(null);

  function clearCountdownInterval() {
    if (intervalIdRef.current) {
      window.clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    if (fireTimeoutIdRef.current) {
      window.clearTimeout(fireTimeoutIdRef.current);
      fireTimeoutIdRef.current = null;
    }
  }

  async function executeAutoCommand(deviceCommand, key) {
    if (firedForReadingKeyRef.current === key) {
      return;
    }
    firedForReadingKeyRef.current = key;

    setPhase("auto-executing");

    try {
      await controlDevice(placeId, deviceCommand);
      setPhase("idle");
      setPostExecutionOverride(POST_EXECUTION_DISPLAY[deviceCommand] || null);
    } catch (error) {
      setPhase("manual");
      setManualEntryReason("AUTO_EXECUTION_FAILED");
      setManualDeviceFeedback("");
      setExecutionNote(
        String(error?.message || "자동 실행에 실패했어요. 직접 조작해 주세요."),
      );
    }
  }

  function startCountdown(deviceCommand, key) {
    clearCountdownInterval();
    setExecutionNote("");
    setSecondsLeft(COUNTDOWN_SECONDS);
    setPhase("confirming");

    intervalIdRef.current = window.setInterval(() => {
      setSecondsLeft((previous) => Math.max(0, previous - 1));
    }, 1000);

    fireTimeoutIdRef.current = window.setTimeout(() => {
      clearCountdownInterval();
      executeAutoCommand(deviceCommand, key);
    }, COUNTDOWN_SECONDS * 1000);
  }

  // jh 수정함 - 추천이 시작되지 않았거나(hasStarted=false) 장소가 없으면
  // 아무것도 하지 않는다. 실행 가능한 추천이 뜨면, 같은 reading에 대해 이미
  // 카운트다운을 시작/처리한 적이 없을 때만(handledReadingKeyRef) 새로
  // 카운트다운을 시작한다 — 그래야 60초 폴링이 같은 reading을 다시 받아와도
  // 카운트다운이 매번 재시작되지 않는다. readingKey가 바뀌면(진짜 새 reading)
  // manual 모드 중이었더라도 다시 confirming으로 리셋한다.
  useEffect(() => {
    if (!hasStarted || !placeId) {
      clearCountdownInterval();
      setPhase("idle");
      setPostExecutionOverride(null);
      setManualEntryReason(null);
      return;
    }

    const deviceCommand = getDeviceCommandForAction(safeRecommendation.action);

    if (!deviceCommand) {
      clearCountdownInterval();
      setPhase("idle");
      handledReadingKeyRef.current = readingKey;
      setSettledReadingKey(readingKey);
      setPostExecutionOverride(null);
      setManualEntryReason(null);
      return;
    }

    if (handledReadingKeyRef.current === readingKey) {
      return;
    }

    handledReadingKeyRef.current = readingKey;
    setSettledReadingKey(readingKey);
    setPostExecutionOverride(null);
    setManualEntryReason(null);
    startCountdown(deviceCommand, readingKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStarted, placeId, readingKey]);

  useEffect(() => clearCountdownInterval, []);

  useEffect(() => {
    if (!executionNote) return undefined;
    const timerId = window.setTimeout(() => setExecutionNote(""), 4200);
    return () => window.clearTimeout(timerId);
  }, [executionNote]);

  function handleReject() {
    clearCountdownInterval();
    setPhase("manual");
    setManualEntryReason("REJECTED_MANUAL");
    setExecutionNote("");
    setManualDeviceFeedback("");
  }

  // jh 추가 - 카운트다운 결과(자동실행/거절/애초에 실행할 것 없음)를 3가지
  // outcome 중 하나로 요약해 App.jsx에 넘긴다. App.jsx가 이 값을 그대로
  // /api/recommendation/refresh 로그에 저장한다.
  async function handleRequestNewRecommendation() {
    if (!onRequestNewRecommendation || isRefreshing) return;

    const outcome =
      phase === "manual"
        ? manualEntryReason || "REJECTED_MANUAL"
        : postExecutionOverride
          ? "AUTO_EXECUTED"
          : "NO_ACTION_NEEDED";

    setIsRefreshing(true);
    setExecutionNote("");
    try {
      await onRequestNewRecommendation({
        previousAction: safeRecommendation.action,
        outcome,
      });
    } catch (error) {
      setExecutionNote(
        String(error?.message || "새 추천을 받아오지 못했어요. 잠시 후 다시 시도해 주세요."),
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  // jh 추가 - 이 readingKey를 위 useEffect가 아직 처리하기 전(그 사이 렌더)엔
  // phase가 이전 recommendation 시절의 "idle"을 그대로 들고 있을 수 있다.
  // settledReadingKey 체크 없이 노출하면, 실행 가능한 새 추천의 카운트다운이
  // 시작되기 직전 한 프레임 동안 "다시 추천받기"가 잘못 반짝였다 사라진다.
  const canRequestNewRecommendation =
    hasStarted &&
    (phase === "idle" || phase === "manual") &&
    settledReadingKey === readingKey;

  return (
    <article className={`card recommendation-card ${displayRecommendation.type} ${isTutorialTarget ? "tutorial-target" : ""}`}>
      <div className="recommendation-card-topbar">
        <div className="recommendation-card-heading">
          <p className="section-label">두더지의 현재 추천</p>
          <p className="dashboard-tagline recommendation-card-tagline">
            두 가지 냉방 방식 중, 더 효율적인 선택을 지능적으로
          </p>
        </div>
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

      {hasStarted && phase === "confirming" && (
        <div className="recommendation-countdown-box">
          <div className="recommendation-countdown-copy">
            <strong>{secondsLeft}초 후 자동으로 실행할게요</strong>
            <p>원하지 않으면 지금 거절해 주세요.</p>
          </div>
          <div className="recommendation-countdown-bar" aria-hidden="true">
            <div
              className="recommendation-countdown-bar-fill"
              style={{ width: `${(secondsLeft / COUNTDOWN_SECONDS) * 100}%` }}
            />
          </div>
          <button
            type="button"
            className="recommendation-reject-button"
            onClick={handleReject}
          >
            거절
          </button>
        </div>
      )}

      {hasStarted && phase === "auto-executing" && (
        <div className="recommendation-countdown-box">
          <strong>지금 실행하는 중이에요…</strong>
        </div>
      )}

      {hasStarted && phase === "manual" && (
        <div className="recommendation-manual-controls">
          <div className="recommendation-manual-controls-heading">
            <p className="recommendation-manual-controls-label">
              직접 창문/에어컨을 조작해 주세요
            </p>
            <SensorNodeStatusBadges />
          </div>
          <p
            className="recommendation-manual-feedback"
            role="status"
            title={manualDeviceFeedback || undefined}
          >
            {manualDeviceFeedback}
          </p>
          <HeaderQuickControls
            recommendedAction={recommendedAction}
            onFeedbackChange={setManualDeviceFeedback}
          />
        </div>
      )}

      {canRequestNewRecommendation && (
        <button
          type="button"
          className="recommendation-refresh-button"
          onClick={handleRequestNewRecommendation}
          disabled={isRefreshing}
        >
          <span aria-hidden="true">🔄</span>{" "}
          {isRefreshing ? "다시 받아오는 중..." : "다시 추천받기"}
        </button>
      )}

      {hasStarted && executionNote && (
        <div className="recommendation-execution-note" role="status">
          {executionNote}
        </div>
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
