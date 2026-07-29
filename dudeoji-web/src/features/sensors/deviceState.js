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
