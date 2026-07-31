import { useEffect, useState } from "react";

import { updatePlaceComfortTemperature } from "./placesApi";
import "./AutoControlSettings.css";
import "./ComfortTemperatureSettings.css";

const MIN_TEMPERATURE = 24;
const MAX_TEMPERATURE = 30;

function normalizeTemperature(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 26;
  }

  return Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, numericValue));
}

// 장소별로 "이 온도부터는 덥다"고 판단하는 기준을 사용자가 직접 설정하는
// 컴포넌트. AutoControlSettings와 달리 에어컨 한 대가 아니라 장소 전체
// 추천 로직에 적용되는 값이라 아이콘/에어컨 카드 밖(장소 요약 영역)에
// 한 번만 둔다.
export default function ComfortTemperatureSettings({ placeId, initialTemperature = 26, onSaved }) {
  const normalizedInitial = normalizeTemperature(initialTemperature);
  const [isOpen, setIsOpen] = useState(false);
  const [savedTemperature, setSavedTemperature] = useState(normalizedInitial);
  const [temperatureDraft, setTemperatureDraft] = useState(String(normalizedInitial));
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const next = normalizeTemperature(initialTemperature);
    setSavedTemperature(next);

    if (!isOpen) {
      setTemperatureDraft(String(next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemperature]);

  useEffect(() => {
    if (!feedback) {
      return undefined;
    }

    const timerId = window.setTimeout(() => setFeedback(""), 2200);
    return () => window.clearTimeout(timerId);
  }, [feedback]);

  function openSettings() {
    setTemperatureDraft(String(savedTemperature));
    setErrorMessage("");
    setIsOpen(true);
  }

  function closeSettings() {
    setTemperatureDraft(String(savedTemperature));
    setErrorMessage("");
    setIsOpen(false);
  }

  async function handleSave(event) {
    event.preventDefault();

    const numericTemperature = Number(temperatureDraft);

    if (
      !Number.isFinite(numericTemperature) ||
      numericTemperature < MIN_TEMPERATURE ||
      numericTemperature > MAX_TEMPERATURE
    ) {
      setErrorMessage(
        `기준 온도는 ${MIN_TEMPERATURE}도부터 ${MAX_TEMPERATURE}도 사이로 입력해 주세요.`,
      );
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      const result = await updatePlaceComfortTemperature(placeId, numericTemperature);
      const nextTemperature = normalizeTemperature(
        result?.target_indoor_hot_temperature ?? numericTemperature,
      );

      setSavedTemperature(nextTemperature);
      setFeedback("기준 온도가 저장되었습니다.");
      setIsOpen(false);

      onSaved?.({ target_indoor_hot_temperature: nextTemperature });
    } catch (error) {
      setErrorMessage(error.message || "기준 온도를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className={`auto-control-settings ${isOpen ? "open" : ""}`} aria-label="더위 기준 온도 설정">
      <div className="auto-control-summary">
        <div className="auto-control-summary-icon" aria-hidden="true">
          🌡️
        </div>

        <div className="auto-control-summary-copy">
          <div className="auto-control-summary-title-row">
            <strong>더위 기준 온도</strong>
          </div>
          <p>{savedTemperature}℃부터 덥다고 판단해요</p>
          {feedback && <small role="status">{feedback}</small>}
        </div>

        <button
          type="button"
          className="auto-control-open-button"
          onClick={isOpen ? closeSettings : openSettings}
          aria-expanded={isOpen}
        >
          {isOpen ? "닫기" : "설정"}
        </button>
      </div>

      {isOpen && (
        <form className="auto-control-form" onSubmit={handleSave}>
          <div className="auto-control-form-heading">
            <div>
              <strong>🌡️ 더위 기준 온도 설정</strong>
              <p>실내 온도가 이 값 이상이면 창문 대신 에어컨을 추천해요.</p>
            </div>
          </div>

          <div className="comfort-input-row">
            <div className="auto-control-fields comfort-fields">
              <label>
                <span>기준 온도</span>
                <div className="auto-control-minute-input">
                  <input
                    type="number"
                    min={MIN_TEMPERATURE}
                    max={MAX_TEMPERATURE}
                    step="0.5"
                    inputMode="decimal"
                    value={temperatureDraft}
                    onChange={(event) => setTemperatureDraft(event.target.value)}
                    disabled={isSaving}
                  />
                  <span>℃</span>
                </div>
              </label>
            </div>

            <div className="auto-control-actions comfort-actions">
              <button
                type="button"
                className="auto-control-cancel-button"
                onClick={closeSettings}
                disabled={isSaving}
              >
                취소
              </button>
              <button type="submit" className="auto-control-save-button" disabled={isSaving}>
                {isSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>

          {errorMessage && (
            <p className="auto-control-error" role="alert">
              {errorMessage}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
