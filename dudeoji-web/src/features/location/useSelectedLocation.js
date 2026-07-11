// src/features/location/useSelectedLocation.js
// 담당: 정현(나)
//
// "집/회사 등 여러 위치를 저장하고, 그중 하나를 선택해서 그 위치 기준으로
// 실외 날씨를 가져온다"는 흐름을 위한 상태 관리 훅입니다.
//
// 지금은 localStorage에 위치 목록을 저장하는 임시 버전입니다.
// TODO(정현): 류은이 만든 '장소(place)' 등록 기능과 개념이 겹칩니다
// (api.js의 fetchMyPlaces/createPlaceWithAircons 참고). 실제로는
// 새 위치 API를 따로 만들기보다, places 테이블에 위/경도나 날씨 조회용
// 지역 코드를 컬럼으로 추가해서 재사용하는 방향을 류은과 먼저 상의하세요.
// 그렇게 되면 아래 loadLocations/saveLocations 부분만 API 호출로
// 바꾸면 되고, 이 훅을 쓰는 컴포넌트(LocationSwitcher 등)는 그대로 씁니다.
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "dudeoji-locations";
const SELECTED_ID_KEY = "dudeoji-selected-location-id";

function loadLocations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocations(locations) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(locations));
}

export function useSelectedLocation() {
  const [locations, setLocations] = useState(loadLocations);
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem(SELECTED_ID_KEY) || null,
  );

  useEffect(() => {
    if (selectedId) {
      localStorage.setItem(SELECTED_ID_KEY, selectedId);
    }
  }, [selectedId]);

  const addLocation = useCallback((name) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const newLocation = { id: crypto.randomUUID(), name: trimmed };

    setLocations((previous) => {
      const next = [...previous, newLocation];
      saveLocations(next);
      return next;
    });
    setSelectedId(newLocation.id);
  }, []);

  const selectLocation = useCallback((id) => {
    setSelectedId(id);
  }, []);

  const selectedLocation =
    locations.find((location) => location.id === selectedId) || null;

  return { locations, selectedLocation, addLocation, selectLocation };
}
