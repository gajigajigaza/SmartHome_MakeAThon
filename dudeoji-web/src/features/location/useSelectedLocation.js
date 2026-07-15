// src/features/location/useSelectedLocation.js
// 담당: 정현(나)
//
// "집/회사 등 여러 위치를 저장하고, 그중 하나를 선택해서 그 위치 기준으로
// 실외 날씨를 가져온다"는 흐름을 위한 상태 관리 훅입니다.
//
// jh 수정함 - localStorage에 이름만 저장하던 임시 버전에서 류은의 장소(place)
// 등록 기능(GET /api/places)을 그대로 재사용하는 방식으로 전환했다. 새 위치
// 추가 자체는 이 훅이 하지 않고 features/places/AirconPage.jsx +
// placesApi.js의 createPlaceWithAircons가 담당하며(LocationListPanel.jsx 참고),
// 이 훅은 목록을 불러오고(refreshLocations) 그중 하나를 선택된 상태로
// 기억하는 역할만 한다. "선택된 위치"는 서버에 저장할 개념이 아니라서
// 그 id만 여전히 localStorage에 남겨둔다.
import { useCallback, useEffect, useState } from "react";

import { fetchMyPlaces } from "../places/placesApi";

const SELECTED_ID_KEY = "dudeoji-selected-location-id";

function mapPlaceToLocation(place) {
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    aircons: place.aircons || [],
  };
}

export function useSelectedLocation() {
  const [locations, setLocations] = useState([]);
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem(SELECTED_ID_KEY) || null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const refreshLocations = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const places = await fetchMyPlaces();
      const nextLocations = places.map(mapPlaceToLocation);

      setLocations(nextLocations);
      setSelectedId((previousId) => {
        const stillExists = nextLocations.some(
          (location) => String(location.id) === String(previousId),
        );

        return stillExists ? previousId : (nextLocations[0]?.id ?? null);
      });
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshLocations();
  }, [refreshLocations]);

  useEffect(() => {
    if (selectedId) {
      localStorage.setItem(SELECTED_ID_KEY, selectedId);
    }
  }, [selectedId]);

  const selectLocation = useCallback((id) => {
    setSelectedId(id);
  }, []);

  const selectedLocation =
    locations.find(
      (location) => String(location.id) === String(selectedId),
    ) || null;

  return {
    locations,
    selectedLocation,
    selectLocation,
    refreshLocations,
    isLoading,
    loadError,
  };
}
