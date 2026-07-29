// src/features/dashboard/SensorNodeStatusBadges.jsx
// 거절 후 수동 조작 모드에서 "직접 창문/에어컨을 조작해 주세요" 라벨 옆에
// 작게 보여주는 센서 보드 연결 상태(Sense/Control/INA219) 배지. 예전에는
// HeaderQuickControls 안에 있었는데, 라벨 옆으로 옮기면서 분리했다.
// 칩 스타일(.header-device-node*)은 HeaderQuickControls.css가 이미
// 전역으로 로드해두므로 그대로 재사용한다.

import { useLocationContext } from "../location/LocationContext";
import { getNodeConnectionStatus } from "../sensors/deviceState";
import { useSensorRealtimeContext } from "../sensors/SensorRealtimeContext";

const NODE_ITEMS = [
  { key: "sense_connected", label: "Sense", disconnectedLabel: "끊김" },
  { key: "control_connected", label: "Control", disconnectedLabel: "끊김" },
  { key: "ina_available", label: "INA219", disconnectedLabel: "미연결" },
];

export default function SensorNodeStatusBadges() {
  const { selectedLocation } = useLocationContext();
  const selectedPlaceId = selectedLocation?.id ?? null;
  const { latestDeviceState: realtimeDeviceState } =
    useSensorRealtimeContext();

  const nodeStatuses = NODE_ITEMS.map((item) => ({
    ...item,
    status: getNodeConnectionStatus(
      realtimeDeviceState,
      item.key,
      selectedPlaceId,
    ),
  }));

  return (
    <span className="sensor-node-badges-inline" aria-label="센서 보드 연결 상태">
      {nodeStatuses.map((item) => (
        <span
          className={`header-device-node is-${item.status}`}
          key={item.key}
          title={
            item.status === "unknown"
              ? "구버전 게이트웨이이거나 아직 상태를 받지 못했습니다."
              : undefined
          }
        >
          <i aria-hidden="true" />
          <b>{item.label}</b>
          {item.status === "connected"
            ? "연결"
            : item.status === "disconnected"
              ? item.disconnectedLabel
              : "미지원"}
        </span>
      ))}
    </span>
  );
}
