import { useEffect, useMemo, useState } from "react";

import { updatePlaceCooldown } from "./placesApi";
import "./AutoControlSettings.css";

const ROOM_PRESETS = [
  { value: "small", label: "원룸/소형", minutes: 20 },
  { value: "medium", label: "거실/투룸", minutes: 30 },
  { value: "large", label: "대형 평수", minutes: 45 },
];

function normalizeMinutes(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 30;
  }

  return Math.min(120, Math.max(1, Math.round(numericValue)));
}

function findPresetValue(minutes) {
  return (
    ROOM_PRESETS.find((preset) => preset.minutes === Number(minutes))?.value ||
    "custom"
  );
}

function getRoomLabel(minutes) {
  return (
    ROOM_PRESETS.find((preset) => preset.minutes === Number(minutes))?.label ||
    "직접 설정"
  );
}

export default function AutoControlSettings({
  placeId,
  airconName = "에어컨",
  initialMinutes = 30,
  initialEnabled = false,
  onSaved,
}) {
  const normalizedInitialMinutes = normalizeMinutes(initialMinutes);
  const [isOpen, setIsOpen] = useState(false);
  const [savedEnabled, setSavedEnabled] = useState(Boolean(initialEnabled));
  const [savedMinutes, setSavedMinutes] = useState(normalizedInitialMinutes);
  const [enabledDraft, setEnabledDraft] = useState(Boolean(initialEnabled));
  const [minutesDraft, setMinutesDraft] = useState(
    String(normalizedInitialMinutes),
  );
  const [roomSizeDraft, setRoomSizeDraft] = useState(
    findPresetValue(normalizedInitialMinutes),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const nextMinutes = normalizeMinutes(initialMinutes);
    const nextEnabled = Boolean(initialEnabled);

    setSavedEnabled(nextEnabled);
    setSavedMinutes(nextMinutes);

    if (!isOpen) {
      setEnabledDraft(nextEnabled);
      setMinutesDraft(String(nextMinutes));
      setRoomSizeDraft(findPresetValue(nextMinutes));
    }
  }, [initialEnabled, initialMinutes, isOpen]);

  useEffect(() => {
    if (!feedback) {
      return undefined;
    }

    const timerId = window.setTimeout(() => setFeedback(""), 2200);
    return () => window.clearTimeout(timerId);
  }, [feedback]);

  const savedSummary = useMemo(() => {
    if (!savedEnabled) {
      return "자동 제어를 사용하지 않아요";
    }

    return `${getRoomLabel(savedMinutes)} · ${savedMinutes}분`;
  }, [savedEnabled, savedMinutes]);

  function openSettings() {
    setEnabledDraft(savedEnabled);
    setMinutesDraft(String(savedMinutes));
    setRoomSizeDraft(findPresetValue(savedMinutes));
    setErrorMessage("");
    setIsOpen(true);
  }

  function closeSettings() {
    setEnabledDraft(savedEnabled);
    setMinutesDraft(String(savedMinutes));
    setRoomSizeDraft(findPresetValue(savedMinutes));
    setErrorMessage("");
    setIsOpen(false);
  }

  function handleRoomSizeChange(event) {
    const nextValue = event.target.value;
    const preset = ROOM_PRESETS.find((item) => item.value === nextValue);

    setRoomSizeDraft(nextValue);

    if (preset) {
      setMinutesDraft(String(preset.minutes));
    }
  }

  function handleMinutesChange(event) {
    const nextValue = event.target.value;
    setMinutesDraft(nextValue);

    if (nextValue === "") {
      setRoomSizeDraft("custom");
      return;
    }

    setRoomSizeDraft(findPresetValue(Number(nextValue)));
  }

  async function handleSave(event) {
    event.preventDefault();

    const numericMinutes = Number(minutesDraft);

    if (
      !Number.isInteger(numericMinutes) ||
      numericMinutes < 1 ||
      numericMinutes > 120
    ) {
      setErrorMessage("가동 시간은 1분부터 120분 사이의 정수로 입력해 주세요.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      const result = await updatePlaceCooldown(placeId, {
        target_cooldown_minutes: numericMinutes,
        auto_control_enabled: enabledDraft,
      });

      const nextEnabled =
        result?.auto_control_enabled ?? Boolean(enabledDraft);
      const nextMinutes =
        result?.target_cooldown_minutes ?? numericMinutes;

      setSavedEnabled(Boolean(nextEnabled));
      setSavedMinutes(normalizeMinutes(nextMinutes));
      setFeedback("자동 제어 설정이 저장되었습니다.");
      setIsOpen(false);

      onSaved?.({
        auto_control_enabled: Boolean(nextEnabled),
        target_cooldown_minutes: normalizeMinutes(nextMinutes),
      });
    } catch (error) {
      setErrorMessage(error.message || "자동 제어 설정을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      className={`auto-control-settings ${isOpen ? "open" : ""}`}
      aria-label={`${airconName} 자동 제어 설정`}
    >
      <div className="auto-control-summary">
        <div className="auto-control-summary-icon" aria-hidden="true">
          ⏱️
        </div>

        <div className="auto-control-summary-copy">
          <div className="auto-control-summary-title-row">
            <strong>자동 제어 설정</strong>
            <span
              className={`auto-control-status ${
                savedEnabled ? "enabled" : "disabled"
              }`}
            >
              {savedEnabled ? "사용 중" : "사용 안 함"}
            </span>
          </div>
          <p>{savedSummary}</p>
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
              <strong>⏱ 에어컨 자동 제어 설정</strong>
              <p>{airconName}에 적용할 가동 시간을 설정해요.</p>
            </div>

            <button
              type="button"
              className={`auto-control-switch ${
                enabledDraft ? "enabled" : ""
              }`}
              role="switch"
              aria-checked={enabledDraft}
              onClick={() => setEnabledDraft((previous) => !previous)}
            >
              <span aria-hidden="true" />
              <strong>{enabledDraft ? "켜짐" : "꺼짐"}</strong>
            </button>
          </div>

          <div
            className={`auto-control-fields ${
              enabledDraft ? "" : "disabled"
            }`}
          >
            <label>
              <span>방 크기</span>
              <select
                value={roomSizeDraft}
                onChange={handleRoomSizeChange}
                disabled={!enabledDraft || isSaving}
              >
                {ROOM_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label} ({preset.minutes}분)
                  </option>
                ))}
                <option value="custom">직접 설정</option>
              </select>
            </label>

            <label>
              <span>예상 가동 시간</span>
              <div className="auto-control-minute-input">
                <input
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  inputMode="numeric"
                  value={minutesDraft}
                  onChange={handleMinutesChange}
                  disabled={!enabledDraft || isSaving}
                />
                <span>분</span>
              </div>
            </label>
          </div>

          {!enabledDraft && (
            <p className="auto-control-disabled-guide">
              저장하면 이 에어컨의 자동 제어가 꺼집니다.
            </p>
          )}

          {errorMessage && (
            <p className="auto-control-error" role="alert">
              {errorMessage}
            </p>
          )}

          <div className="auto-control-actions">
            <button
              type="button"
              className="auto-control-cancel-button"
              onClick={closeSettings}
              disabled={isSaving}
            >
              취소
            </button>
            <button
              type="submit"
              className="auto-control-save-button"
              disabled={isSaving}
            >
              {isSaving ? "저장 중..." : "저장"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
