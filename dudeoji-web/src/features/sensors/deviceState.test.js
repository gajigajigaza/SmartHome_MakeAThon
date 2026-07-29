import assert from "node:assert/strict";
import test from "node:test";

import {
  areDeviceControlsDisabled,
  buildRealtimeDeviceState,
  getNodeConnectionStatus,
  isSenseNodeDisconnected,
} from "./deviceState.js";

test("새 device_state 여섯 필드를 웹 상태에 그대로 보존한다", () => {
  const state = buildRealtimeDeviceState({
    type: "device_state",
    place_id: 54,
    data: {
      window_is_open: false,
      ac_is_on: true,
      bme_available: true,
      sense_connected: true,
      control_connected: false,
      ina_available: true,
    },
  });

  assert.deepEqual(state, {
    place_id: 54,
    window_is_open: false,
    ac_is_on: true,
    bme_available: true,
    sense_connected: true,
    control_connected: false,
    ina_available: true,
  });
});

test("구버전 device_state는 노드 상태를 모르는 것으로 보고 제어를 유지한다", () => {
  const legacyState = {
    place_id: 54,
    gateway_connected: true,
    window_is_open: false,
    ac_is_on: false,
    bme_available: true,
  };

  assert.equal(
    getNodeConnectionStatus(legacyState, "control_connected", 54),
    "unknown",
  );
  assert.equal(
    areDeviceControlsDisabled({
      selectedPlaceId: 54,
      pendingDevice: "",
      state: legacyState,
    }),
    false,
  );
});

test("control_connected=false이면 선택 장소의 제어 UI를 비활성화한다", () => {
  assert.equal(
    areDeviceControlsDisabled({
      selectedPlaceId: 54,
      pendingDevice: "",
      state: {
        place_id: 54,
        gateway_connected: true,
        control_connected: false,
      },
    }),
    true,
  );
});

test("다른 장소의 이전 상태는 현재 장소 제어를 막지 않는다", () => {
  assert.equal(
    areDeviceControlsDisabled({
      selectedPlaceId: 55,
      pendingDevice: "",
      state: {
        place_id: 54,
        gateway_connected: true,
        control_connected: false,
      },
    }),
    false,
  );
});

test("sense 연결 해제와 게이트웨이 연결 해제를 마지막 값 상태로 판정한다", () => {
  assert.equal(
    isSenseNodeDisconnected(
      {
        place_id: 54,
        gateway_connected: true,
        sense_connected: false,
      },
      54,
    ),
    true,
  );
  assert.equal(
    isSenseNodeDisconnected(
      {
        place_id: 54,
        gateway_connected: false,
      },
      54,
    ),
    true,
  );
});
