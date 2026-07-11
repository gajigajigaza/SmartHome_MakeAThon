// src/features/location/LocationListPanel.jsx
// 담당: 정현(나)
//
// LocationSwitcher를 눌렀을 때 열리는 패널입니다.
// 저장된 위치(집/회사 등) 목록을 보여주고, 선택하면 그 위치로 바뀌고,
// 새로 추가할 수도 있습니다. 지금은 이름만 저장하지만, 위치를 선택했을 때
// 실외 날씨 API를 호출하는 로직은 여기(onSelect 콜백 이후)에 추가하면 됩니다.
import { useState } from "react";

export default function LocationListPanel({
  locations,
  selectedLocationId,
  onSelect,
  onAdd,
  onClose,
}) {
  const [draft, setDraft] = useState("");

  function handleAdd() {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft("");
  }

  return (
    <div className="location-panel">
      <div className="location-panel-header">
        <strong>내 위치</strong>
        <button type="button" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>

      <ul className="location-panel-list">
        {locations.length === 0 && (
          <li className="location-panel-empty">저장된 위치가 없어요.</li>
        )}

        {locations.map((location) => (
          <li key={location.id}>
            <button
              type="button"
              className={location.id === selectedLocationId ? "active" : ""}
              onClick={() => {
                onSelect(location.id);
                onClose();
              }}
            >
              📍 {location.name}
            </button>
          </li>
        ))}
      </ul>

      <div className="location-panel-add">
        <input
          type="text"
          placeholder="예: 집, 회사, 부산 해운대구"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="새 위치 이름"
        />
        <button type="button" onClick={handleAdd}>
          위치 추가
        </button>
      </div>
    </div>
  );
}
