// jh 수정함 - 실제 하드웨어(ESP32)가 연결된 곳은 "우리집"(place_id 54)
// 하나뿐이다. 다른 장소는 예전 테스트 모드로 남은 기록 때문에 백엔드가
// 센서 데이터가 있는 것처럼 내려줄 수 있지만 실제 센서는 없으므로, 화면에는
// 무조건 "센서 미연결"로 보여준다(HeaderQuickControls, EnvironmentPanels).
export const HOME_PLACE_ID = "54";

function belongsToSelectedPlace(state, selectedPlaceId) {
  return (
    state != null &&
    selectedPlaceId != null &&
    String(state.place_id) === String(selectedPlaceId)
  );
}

export function buildRealtimeDeviceState(message) {
  if (!message?.data || typeof message.data !== "object") {
    return null;
  }

  return {
    ...message.data,
    place_id: message.place_id,
  };
}

export function getNodeConnectionStatus(state, field, selectedPlaceId) {
  if (!belongsToSelectedPlace(state, selectedPlaceId)) {
    return "unknown";
  }

  if (state.gateway_connected === false) {
    return "disconnected";
  }

  if (state[field] === true) {
    return "connected";
  }

  if (state[field] === false) {
    return "disconnected";
  }

  return "unknown";
}

export function areDeviceControlsDisabled({
  selectedPlaceId,
  pendingDevice,
  state,
}) {
  if (!selectedPlaceId || pendingDevice) {
    return true;
  }

  if (!belongsToSelectedPlace(state, selectedPlaceId)) {
    return false;
  }

  return (
    state.gateway_connected === false || state.control_connected === false
  );
}

export function isSenseNodeDisconnected(state, selectedPlaceId) {
  return (
    getNodeConnectionStatus(state, "sense_connected", selectedPlaceId) ===
    "disconnected"
  );
}
