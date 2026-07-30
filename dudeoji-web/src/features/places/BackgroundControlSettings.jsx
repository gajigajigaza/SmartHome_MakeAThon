// src/features/places/BackgroundControlSettings.jsx
//
// 마이페이지 전용 - "웹 앱 없이도 서버가 알아서 기기를 조작"하는 두 가지
// 백그라운드 자동 제어 동의 토글. 기존 AutoControlSettings(에어컨 최소
// 가동시간 기준)와는 완전히 별개 기능이라 컴포넌트/저장 API도 분리했다.
//
// - background_condition_control_enabled: 그때그때 실측 상태(더움/시원함 등)에
//   따른 반응형 추천을 서버가 직접 실행
// - background_occupancy_control_enabled: 재실 패턴 예측(도착/퇴근 10분 전)에
//   따른 사전조치를 사람 확인 팝업 없이 서버가 바로 실행
//
// 둘 다 껐을 때(기본값)는 지금까지와 동일하게 웹 앱을 열어야만(카운트다운/
// 팝업) 기기가 조작된다.

import { useEffect, useState } from "react";

import { updatePlaceBackgroundControl } from "./placesApi";
import "./BackgroundControlSettings.css";

const TOGGLES = [
  {
    key: "background_condition_control_enabled",
    icon: "🌡️",
    title: "지속적인 현재 상태에 따른 자동 조작",
    description:
      "실내외 온습도 등 그때그때 조건에 맞춰, 앱을 안 열어도 서버가 알아서 켜고 끕니다.",
  },
  {
    key: "background_occupancy_control_enabled",
    icon: "🚶",
    title: "재실 예측을 통한 자동 조작",
    description:
      "평소 오시거나 나가시는 시간대 패턴을 미리 감지해, 확인 없이 서버가 알아서 준비해둡니다.",
  },
];

export default function BackgroundControlSettings({
  placeId,
  initialConditionEnabled = false,
  initialOccupancyEnabled = false,
  onSaved,
}) {
  const [savedState, setSavedState] = useState({
    background_condition_control_enabled: Boolean(initialConditionEnabled),
    background_occupancy_control_enabled: Boolean(initialOccupancyEnabled),
  });
  const [savingKey, setSavingKey] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setSavedState({
      background_condition_control_enabled: Boolean(initialConditionEnabled),
      background_occupancy_control_enabled: Boolean(initialOccupancyEnabled),
    });
  }, [initialConditionEnabled, initialOccupancyEnabled]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timerId = window.setTimeout(() => setFeedback(""), 2200);
    return () => window.clearTimeout(timerId);
  }, [feedback]);

  async function handleToggle(key) {
    if (savingKey) return;

    const nextValue = !savedState[key];
    setSavingKey(key);
    setErrorMessage("");

    try {
      const result = await updatePlaceBackgroundControl(placeId, {
        [key]: nextValue,
      });
      const nextState = {
        background_condition_control_enabled: Boolean(
          result?.background_condition_control_enabled,
        ),
        background_occupancy_control_enabled: Boolean(
          result?.background_occupancy_control_enabled,
        ),
      };
      setSavedState(nextState);
      setFeedback(nextValue ? "켜졌어요" : "꺼졌어요");
      onSaved?.(nextState);
    } catch (error) {
      setErrorMessage(
        error.message || "백그라운드 자동 제어 설정을 저장하지 못했습니다.",
      );
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section
      className="background-control-settings"
      aria-label="백그라운드 자동 제어 설정"
    >
      <div className="background-control-heading">
        <strong>백그라운드 자동 제어</strong>
        <p>웹 앱을 안 켜둬도, 동의한 항목은 서버가 알아서 판단하고 실행해요.</p>
      </div>

      {TOGGLES.map((toggle) => {
        const isEnabled = savedState[toggle.key];
        const isSaving = savingKey === toggle.key;

        return (
          <div className="background-control-row" key={toggle.key}>
            <div className="background-control-row-icon" aria-hidden="true">
              {toggle.icon}
            </div>
            <div className="background-control-row-copy">
              <strong>{toggle.title}</strong>
              <p>{toggle.description}</p>
            </div>
            <button
              type="button"
              className={`background-control-switch ${isEnabled ? "enabled" : ""}`}
              role="switch"
              aria-checked={isEnabled}
              disabled={Boolean(savingKey)}
              onClick={() => handleToggle(toggle.key)}
            >
              <span aria-hidden="true" />
              <strong>{isSaving ? "..." : isEnabled ? "켜짐" : "꺼짐"}</strong>
            </button>
          </div>
        );
      })}

      {feedback && (
        <p className="background-control-feedback" role="status">
          {feedback}
        </p>
      )}
      {errorMessage && (
        <p className="background-control-error" role="alert">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
