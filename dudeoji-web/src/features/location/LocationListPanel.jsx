// src/features/location/LocationListPanel.jsx
// 담당: 정현(나)
//
// LocationSwitcher를 눌렀을 때 열리는 패널입니다.
// 저장된 위치(집/회사 등) 목록을 보여주고, 선택하면 그 위치로 바뀝니다.
//
// jh 수정함 - "+ 장소 추가"(AirconPage variant="modal" 흐름)를 이 패널에서
// 없앴다. 마이페이지의 "장소 정보" 섹션에 같은 기능(같은 모달 재사용)이
// 생겨서 여기 중복으로 둘 필요가 없어졌다 - 장소 추가는 이제 마이페이지에서만.
import { useLocationContext } from "./LocationContext";

export default function LocationListPanel({ onClose }) {
  // jh 수정함 - locations/selectedLocation/selectLocation을 LocationSwitcher가
  // props로 내려주던 것을 useLocationContext()로 직접 가져오도록 바꿨다
  // (다른 위치를 가리키는 문제 방지, App.jsx의 LocationProvider 참고).
  const { locations, selectedLocation, selectLocation } = useLocationContext();

  return (
    <div className="location-panel">
      {/* jh 수정함 - "내 장소" 헤더(라벨+닫기 버튼)를 통째로 없앴다. 닫기는
          LocationSwitcher.jsx의 토글 버튼을 다시 누르거나, 아래 목록에서
          장소를 선택하면(onSelect 뒤 onClose 호출) 이미 처리된다. */}
      <ul className="location-panel-list">
        {locations.length === 0 && (
          <li className="location-panel-empty">저장된 장소가 없어요.</li>
        )}

        {locations.map((location) => {
          const isSelected =
            String(location.id) === String(selectedLocation?.id);

          return (
            <li key={location.id}>
              <button
                type="button"
                className={isSelected ? "active" : ""}
                onClick={() => {
                  selectLocation(location.id);
                  onClose();
                }}
              >
                {/* jh 수정함 - 배경 사각 배지를 없애고 점만 남김. 선택된 장소만
                    초록, 나머지는 회색(muted) - LocationSwitcher.jsx와 같은 로직. */}
                <span
                  className={`location-pin-dot ${isSelected ? "active" : ""}`}
                  aria-hidden="true"
                />
                {location.name}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
