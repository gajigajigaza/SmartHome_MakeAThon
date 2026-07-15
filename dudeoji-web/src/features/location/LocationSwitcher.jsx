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
import { useLocationContext } from "./LocationContext";

export default function LocationSwitcher() {
  // jh 수정함 - addLocation(이름만 저장하던 로컬 추가)이 없어지고, 새 위치는
  // LocationListPanel이 AirconPage로 등록한 뒤 refreshLocations로 다시 불러온다.
  // jh 수정함 - useSelectedLocation()을 직접 호출하던 것을 useLocationContext()로
  // 바꿔서, EnvironmentCard 등 다른 컴포넌트와 selectedLocation을 공유한다
  // (따로 호출하면 각자 다른 위치를 가리키는 문제가 있었음).
  const { selectedLocation } = useLocationContext();
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  return (
    <div className="location-switcher">
      {/* jh 수정함 - isPanelOpen을 open 클래스로 노출해서(UserMenu.jsx의
          dashboard-avatar-menu-button과 같은 패턴) 패널이 열려 있을 때
          버튼 강조 + 화살표 회전을 CSS로 처리한다. */}
      <button
        type="button"
        className={`location-switcher-button ${isPanelOpen ? "open" : ""}`}
        onClick={() => setIsPanelOpen((previous) => !previous)}
      >
        {/* jh 수정함 - UserMenu.jsx 옆 온라인 상태 점과 헷갈려서 이 버튼에서는
            점 아이콘을 완전히 뺐다. 텍스트/화살표만 남김(드롭다운 목록 항목의
            점은 그대로 유지 - LocationListPanel.jsx). */}
        <span>{selectedLocation ? selectedLocation.name : "장소 추가"}</span>
        {/* jh 수정함 - 폰트 문자(▾)는 크기 조절이 어색해서, CSS로 그린
            삼각형(테두리 트릭)으로 교체. open일 때 180도 회전은 그대로 유지. */}
        <span className="location-switcher-arrow" aria-hidden="true" />
      </button>

      {isPanelOpen && (
        <LocationListPanel onClose={() => setIsPanelOpen(false)} />
      )}
    </div>
  );
}
