// src/features/location/LocationSwitcher.jsx
// 담당: 정현(나)
//
// App.jsx 헤더 좌측 상단에 들어가는 위치 버튼.
// 누르면 LocationListPanel이 열려서 저장된 위치 중 하나를 고르거나
// 새로 추가할 수 있습니다. 선택된 위치는 useSelectedLocation 훅이
// 기억하고 있다가, EnvironmentCard/SavingsSummary에서 "이 위치 기준
// 실외 날씨"를 보여줄 때 참조하면 됩니다.
import { useState } from "react";

import LocationListPanel from "./LocationListPanel";
import { useSelectedLocation } from "./useSelectedLocation";

export default function LocationSwitcher() {
  const { locations, selectedLocation, addLocation, selectLocation } =
    useSelectedLocation();
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  return (
    <div className="location-switcher">
      <button
        type="button"
        className="location-switcher-button"
        onClick={() => setIsPanelOpen((previous) => !previous)}
      >
        <span>📍</span>
        <span>{selectedLocation ? selectedLocation.name : "위치 추가"}</span>
        <em>▾</em>
      </button>

      {isPanelOpen && (
        <LocationListPanel
          locations={locations}
          selectedLocationId={selectedLocation?.id}
          onSelect={selectLocation}
          onAdd={addLocation}
          onClose={() => setIsPanelOpen(false)}
        />
      )}
    </div>
  );
}
