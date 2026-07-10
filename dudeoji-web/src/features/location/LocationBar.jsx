// src/features/location/LocationBar.jsx
// 담당: 나 (위치 추가 버튼 · 실외 날씨 입력)
//
// 지금은 로컬 저장(localStorage)에 지역 이름만 저장하는 뼈대입니다.
// 한 번 입력하면 고정되고, "변경" 버튼으로만 바뀝니다.
// 다음 단계: 실외 날씨는 사용자가 고른 지역 기준으로 기상청/OpenWeather API를
// 호출해서 SensorReadingCreate.weather_condition / pm25 / wind_speed에
// 실어 보내면 백엔드 추천 정확도가 올라갑니다(processor.py 참고).
import { useState } from "react";

const STORAGE_KEY = "dudeoji-location-name";

function getStoredLocation() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

export default function LocationBar() {
  const [location, setLocation] = useState(getStoredLocation);
  const [isEditing, setIsEditing] = useState(() => !getStoredLocation());
  const [draft, setDraft] = useState(location);

  function handleSave() {
    const trimmed = draft.trim();

    if (!trimmed) {
      return;
    }

    localStorage.setItem(STORAGE_KEY, trimmed);
    setLocation(trimmed);
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <div className="location-bar location-bar-editing">
        <input
          type="text"
          placeholder="예: 부산 해운대구"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="위치 입력"
        />
        <button type="button" onClick={handleSave}>
          위치 저장
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="location-bar location-bar-set"
      onClick={() => {
        setDraft(location);
        setIsEditing(true);
      }}
    >
      <span>📍</span>
      <span>{location}</span>
      <em>변경</em>
    </button>
  );
}
