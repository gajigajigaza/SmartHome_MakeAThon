// src/features/dashboard/OccupancyPredictionPopup.jsx
//
// 재실 패턴 예측(A안) 전용 팝업입니다. 평소엔 아무것도 렌더링하지 않고,
// occupancy_router.py의 GET /api/occupancy/prediction이 "곧 도착/퇴근 예상"
// (PENDING_CONFIRM)을 내려줄 때만 떠서 예/아니오를 묻습니다.
//
// "예"를 누르면 이 컴포넌트가 직접 기기를 제어하지 않고, 기존
// devicesApi.controlDevice()를 그대로 호출합니다(RecommendationCard가 자동
// 실행할 때와 동일한 경로) — 그 뒤로는 실측 센서값이 자연스럽게 그 상태를
// 반영하므로, 메인 카드 쪽은 아무 것도 바꿀 필요가 없습니다.

import { useEffect, useRef, useState } from "react";

import { controlDevice } from "./devicesApi";
import {
  getOccupancyPrediction,
  respondOccupancyPrediction,
} from "../location/occupancyApi";

const POLL_INTERVAL_MS = 60000;

const ACTION_ICON = {
  USE_AIRCON: "❄️",
  OPEN_WINDOW: "🪟",
  TURN_OFF_AIRCON: "🔌",
};

// recommendation_engine의 action 이름을 /api/devices/control이 받는 실제
// 기기 명령으로 매핑한다. RecommendationCard.jsx의 ACTION_TO_DEVICE_COMMAND와
// 값이 같지만, 그 파일을 건드리지 않기 위해 여기 별도로 둔다.
const ACTION_TO_DEVICE_COMMAND = {
  USE_AIRCON: "TURN_ON_AIRCON",
  OPEN_WINDOW: "OPEN_WINDOW",
  TURN_OFF_AIRCON: "TURN_OFF_AIRCON",
};

export default function OccupancyPredictionPopup({
  placeId,
  isPaused = false,
  setIsPopupActive,
}) {
  const [prediction, setPrediction] = useState(null);
  const [isResponding, setIsResponding] = useState(false);
  const [feedback, setFeedback] = useState("");
  const pollTimerRef = useRef(null);

  useEffect(() => {
    if (setIsPopupActive) {
      setIsPopupActive(Boolean(prediction));
    }
  }, [prediction, setIsPopupActive]);

  useEffect(() => {
    setPrediction(null);
  }, [placeId]);

  useEffect(() => {
    if (!placeId || isPaused) {
      return undefined;
    }

    let isCancelled = false;

    async function poll() {
      try {
        const response = await getOccupancyPrediction(placeId);
        if (isCancelled) return;

        if (response?.prediction?.status === "PENDING_CONFIRM") {
          setPrediction(response.prediction);
        } else {
          setPrediction(null);
        }
      } catch (error) {
        console.error("재실 패턴 예측 조회 실패:", error);
      }
    }

    poll();
    pollTimerRef.current = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(pollTimerRef.current);
    };
  }, [placeId, isPaused]);

  async function handleRespond(accept) {
    if (!prediction || isResponding) return;
    setIsResponding(true);
    setFeedback("");

    try {
      const result = await respondOccupancyPrediction(
        placeId,
        prediction.transition_key,
        accept,
      );

      if (accept) {
        const deviceCommand = ACTION_TO_DEVICE_COMMAND[result.action];
        if (deviceCommand) {
          await controlDevice(placeId, deviceCommand);
        }
      }

      setPrediction(null);
    } catch (error) {
      setFeedback(
        String(error?.message || "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요."),
      );
    } finally {
      setIsResponding(false);
    }
  }

  if (!prediction) return null;

  return (
    <div className="occupancy-prediction-backdrop" role="presentation">
      <section
        className="occupancy-prediction-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="occupancy-prediction-title"
      >
        <div className="occupancy-prediction-icon" aria-hidden="true">
          {ACTION_ICON[prediction.action] || "⏰"}
        </div>

        <h2 id="occupancy-prediction-title">{prediction.title}</h2>
        <p className="occupancy-prediction-summary">{prediction.summary}</p>

        <div className="occupancy-prediction-reason">
          <strong>추천 이유</strong>
          <p>{prediction.reason}</p>
        </div>

        {feedback && (
          <p className="occupancy-prediction-feedback" role="status">
            {feedback}
          </p>
        )}

        <div className="occupancy-prediction-actions">
          <button
            type="button"
            className="occupancy-prediction-cancel"
            onClick={() => handleRespond(false)}
            disabled={isResponding}
          >
            아니오
          </button>
          <button
            type="button"
            className="occupancy-prediction-confirm"
            onClick={() => handleRespond(true)}
            disabled={isResponding}
          >
            {isResponding ? "처리 중..." : "예"}
          </button>
        </div>
      </section>
    </div>
  );
}
