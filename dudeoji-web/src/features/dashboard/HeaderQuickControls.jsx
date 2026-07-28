// src/features/dashboard/HeaderQuickControls.jsx
// 상태창 2개 + 조작 버튼 2개(창문/에어컨)입니다.
// 상태는 버튼 클릭값이 아니라 백엔드의 최신 실제 센서 기록을 기준으로 표시합니다.
// jh 수정함 - 헤더에서 RecommendationCard 안(우측 상단)으로 이식됨(2026-07-26,
// 팀 결정). 이름은 그대로 유지(파일 위치/컴포넌트명 변경 없음), 컴포넌트
// 자체 로직·마크업·스타일은 이식 전과 동일 — 추천 강조(recommendedAction)만 추가.

import { useCallback, useEffect, useRef, useState } from "react";

import { request } from "../../api";
import { useLocationContext } from "../location/LocationContext";
import { getLatestReading } from "../sensors/readingsApi";
import { useSensorRealtimeContext } from "../sensors/SensorRealtimeContext";

import "./HeaderQuickControls.css";

const STATUS_REFRESH_INTERVAL_MS = 2000;

function WindowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="3.75" width="16" height="16.5" rx="2.2" />
      <path d="M12 4.2v15.6M4.6 12h14.8" />
    </svg>
  );
}

function AirconIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="8.5" rx="2.2" />
      <path d="M7 9.2h10M7 13.5v1.3M10.5 13.5v2.2M14 13.5v1.3M17.5 13.5v2.2" />
      <path d="M8 19c.7-.65.7-1.35 0-2M12 19c.7-.65.7-1.35 0-2M16 19c.7-.65.7-1.35 0-2" />
    </svg>
  );
}

function extractDeviceState(reading) {
  const recommendation = reading?.recommendation ?? {};
  const windowAvailable = recommendation.window_data_available === true;
  const airconAvailable = recommendation.ac_data_available === true;
  // jh 수정함 - reading?.ac_is_on(top-level)은 백엔드가 절대 채우지 않는
  // 죽은 fallback이었음(ac_is_on은 recommendation jsonb 안에만 저장됨).
  // recommendation.ac_is_on만 신뢰하도록 정리.
  const rawAirconState = recommendation.ac_is_on;

  return {
    windowAvailable,
    windowIsOpen: windowAvailable ? reading?.window_is_open === true : null,
    airconAvailable,
    airconIsOn: airconAvailable ? rawAirconState === true : null,
  };
}

function extractRealtimeDeviceState(state) {
  const gatewayConnected = state?.gateway_connected !== false;
  const windowAvailable =
    gatewayConnected && typeof state?.window_is_open === "boolean";
  const airconAvailable =
    gatewayConnected && typeof state?.ac_is_on === "boolean";

  return {
    windowAvailable,
    windowIsOpen: windowAvailable ? state.window_is_open : null,
    airconAvailable,
    airconIsOn: airconAvailable ? state.ac_is_on : null,
  };
}

function getStatusText({
  isLoading,
  hasError,
  isAvailable,
  isOn,
  onText,
  offText,
}) {
  if (isLoading) return "확인 중";
  if (hasError) return "확인 실패";
  if (!isAvailable) return "센서 미연결";
  return isOn ? onText : offText;
}

// jh 수정함 - 헤더에서 추천 카드 안으로 이식하며 추가. recommendedAction은
// 현재 추천의 action(예: "OPEN_WINDOW")을 그대로 받는다. 스타일 강조만
// 하고 버튼 활성/비활성에는 관여하지 않는다(추천은 강제가 아니라는
// 서비스 철학 — 아래 disabled 로직은 그대로 controlsDisabled만 따름).
export default function HeaderQuickControls({ recommendedAction = null }) {
  const { selectedLocation } = useLocationContext();
  const selectedPlaceId = selectedLocation?.id ?? null;
  const {
    latestReading: realtimeReading,
    latestDeviceState: realtimeDeviceState,
    connectionStatus: realtimeConnectionStatus,
  } = useSensorRealtimeContext();

  const [deviceState, setDeviceState] = useState({
    windowAvailable: false,
    windowIsOpen: null,
    airconAvailable: false,
    airconIsOn: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [pendingDevice, setPendingDevice] = useState("");
  const [feedback, setFeedback] = useState("");
  const realtimeDeviceStateRef = useRef(null);

  const refreshDeviceState = useCallback(async () => {
    if (!selectedPlaceId) {
      setDeviceState({
        windowAvailable: false,
        windowIsOpen: null,
        airconAvailable: false,
        airconIsOn: null,
      });
      setStatusError("");
      setIsLoading(false);
      return;
    }

    try {
      const latestReading = await getLatestReading(selectedPlaceId);
      // HTTP 요청 중 실제 BLE 상태가 도착했다면 오래된 DB 기록으로
      // 다시 덮어쓰지 않습니다.
      if (!realtimeDeviceStateRef.current) {
        setDeviceState(extractDeviceState(latestReading));
        setStatusError("");
      }
    } catch (error) {
      if (realtimeDeviceStateRef.current) {
        setStatusError("");
        return;
      }

      const message = String(error?.message || "");

      if (message.includes("저장된 센서 기록이 없습니다")) {
        setDeviceState({
          windowAvailable: false,
          windowIsOpen: null,
          airconAvailable: false,
          airconIsOn: null,
        });
        setStatusError("");
      } else {
        setStatusError(message || "센서 상태를 확인하지 못했습니다.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedPlaceId]);

  useEffect(() => {
    if (
      !realtimeReading ||
      String(realtimeReading.place_id) !== String(selectedPlaceId)
    ) {
      return;
    }

    setDeviceState(extractDeviceState(realtimeReading));
    setStatusError("");
    setIsLoading(false);
  }, [realtimeReading, selectedPlaceId]);

  useEffect(() => {
    const belongsToSelectedPlace =
      realtimeDeviceState &&
      String(realtimeDeviceState.place_id) === String(selectedPlaceId);

    realtimeDeviceStateRef.current = belongsToSelectedPlace
      ? realtimeDeviceState
      : null;

    if (!belongsToSelectedPlace) return;

    setDeviceState(extractRealtimeDeviceState(realtimeDeviceState));
    setStatusError("");
    setIsLoading(false);
  }, [realtimeDeviceState, selectedPlaceId]);

  useEffect(() => {
    setIsLoading(true);
    refreshDeviceState();

    // WebSocket 연결 중에는 2초 HTTP 반복 조회를 중지합니다.
    // 연결이 끊겼을 때만 기존 HTTP 조회가 예비 수단으로 작동합니다.
    if (realtimeConnectionStatus === "connected") {
      return undefined;
    }

    const intervalId = window.setInterval(
      refreshDeviceState,
      STATUS_REFRESH_INTERVAL_MS,
    );

    return () => window.clearInterval(intervalId);
  }, [realtimeConnectionStatus, refreshDeviceState]);

  useEffect(() => {
    setFeedback("");
    setPendingDevice("");
  }, [selectedPlaceId]);

  async function sendControlCommand(device, action) {
    if (!selectedPlaceId || pendingDevice) return;

    setPendingDevice(device);
    setFeedback("");

    try {
      const response = await request("/api/devices/control", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          place_id: selectedPlaceId,
          action,
        }),
      });

      if (response?.result_received === true) {
        setFeedback(
          response.success === true
            ? "기기 응답 확인"
            : `기기 처리 실패: ${response.detail || "원인 미확인"}`,
        );
      } else if (response?.result_received === false) {
        if (response.detail === "device_disconnected_before_result") {
          setFeedback("명령 전송 후 게이트웨이 연결 끊김");
        } else if (response.detail === "device_connection_replaced") {
          setFeedback("게이트웨이 연결이 다른 장치로 교체됨");
        } else {
          setFeedback("명령 전송됨 · 기기 응답 시간 초과");
        }
      } else {
        // 아직 결과 대기 기능이 배포되지 않은 구버전 서버와 호환합니다.
        setFeedback("명령 전송됨");
      }

      // WebSocket이 연결돼 있으면 XIAO의 device_state만 실제 상태로
      // 반영합니다. 연결이 없을 때만 기존 HTTP 최신 기록을 예비로 사용합니다.
      if (realtimeConnectionStatus !== "connected") {
        await refreshDeviceState();
      }
    } catch (error) {
      setFeedback(
        String(error?.message || "기기 제어 명령을 전송하지 못했습니다."),
      );
    } finally {
      setPendingDevice("");
      window.setTimeout(() => setFeedback(""), 3600);
    }
  }

  const windowStatusText = getStatusText({
    isLoading,
    hasError: Boolean(statusError),
    isAvailable: deviceState.windowAvailable,
    isOn: deviceState.windowIsOpen,
    onText: "열려 있음",
    offText: "닫혀 있음",
  });

  const airconStatusText = getStatusText({
    isLoading,
    hasError: Boolean(statusError),
    isAvailable: deviceState.airconAvailable,
    isOn: deviceState.airconIsOn,
    onText: "작동 중",
    offText: "정지됨",
  });

  const windowAction =
    deviceState.windowIsOpen === true ? "CLOSE_WINDOW" : "OPEN_WINDOW";

  const airconAction =
    deviceState.airconIsOn === true
      ? "TURN_OFF_AIRCON"
      : "TURN_ON_AIRCON";

  const windowButtonText =
    pendingDevice === "window"
      ? "전송 중…"
      : deviceState.windowIsOpen === true
        ? "창문 닫기"
        : "창문 열기";

  const airconButtonText =
    pendingDevice === "aircon"
      ? "전송 중…"
      : deviceState.airconIsOn === true
        ? "에어컨 끄기"
        : "에어컨 틀기";

  const gatewayKnownDisconnected =
    String(realtimeDeviceState?.place_id) === String(selectedPlaceId) &&
    realtimeDeviceState?.gateway_connected === false;
  const controlsDisabled =
    !selectedPlaceId ||
    Boolean(pendingDevice) ||
    gatewayKnownDisconnected;

  // jh 수정함 - 버튼이 지금 제안하는 동작(windowAction/airconAction)이
  // 추천의 action과 같을 때만 강조한다. 창문은 OPEN_WINDOW/CLOSE_WINDOW를
  // 그대로 비교하면 되고(windowAction 값과 표현이 동일), 에어컨은 추천
  // 쪽 action 이름이 "USE_AIRCON"이라 버튼이 "틀기"를 제안 중일 때만
  // 매칭시킨다. MAINTAIN/ENJOY/ERROR/추천 없음(null)은 둘 다 false.
  const windowRecommended = recommendedAction === windowAction;
  const airconRecommended =
    recommendedAction === "USE_AIRCON" && airconAction === "TURN_ON_AIRCON";

  return (
    <section
      className="header-device-controls"
      aria-label="센서 상태와 기기 조작"
    >
      <div className="header-device-status">
        <span className="header-device-status__icon" aria-hidden="true">
          <WindowIcon />
        </span>
        <span className="header-device-status__copy">
          <small>창문 상태</small>
          <strong>{windowStatusText}</strong>
        </span>
      </div>

      <button
        type="button"
        className={`header-device-action${
          windowRecommended ? " header-device-action--recommended" : ""
        }`}
        disabled={controlsDisabled}
        onClick={() => sendControlCommand("window", windowAction)}
      >
        {windowButtonText}
      </button>

      <div className="header-device-status">
        <span className="header-device-status__icon" aria-hidden="true">
          <AirconIcon />
        </span>
        <span className="header-device-status__copy">
          <small>에어컨 상태</small>
          <strong>{airconStatusText}</strong>
        </span>
      </div>

      <button
        type="button"
        className={`header-device-action${
          airconRecommended ? " header-device-action--recommended" : ""
        }`}
        disabled={controlsDisabled}
        onClick={() => sendControlCommand("aircon", airconAction)}
      >
        {airconButtonText}
      </button>

      <span
        className="header-device-controls__feedback"
        role="status"
        aria-live="polite"
        title={feedback || statusError}
      >
        {feedback || statusError}
      </span>
    </section>
  );
}
