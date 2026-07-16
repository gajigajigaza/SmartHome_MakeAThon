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

import { request } from "../../api";
import {
  deletePlaceItem,
  fetchMyPlaces,
  updatePlaceDetails,
} from "../places/placesApi";

const SELECTED_ID_KEY = "dudeoji-selected-location-id";

function mapPlaceToLocation(place) {
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    isDefault: place.is_default || false,
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

        if (stillExists) {
          return previousId;
        }

        // jh 수정함 - localStorage에 남은 선택이 없으면(주로 앱 첫 로드),
        // is_default 장소가 있으면 그걸 우선 선택하고, 없으면 기존처럼 첫 번째 장소로 폴백한다.
        const defaultLocation = nextLocations.find(
          (location) => location.isDefault,
        );

        return defaultLocation?.id ?? nextLocations[0]?.id ?? null;
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

  // jh 수정함 - MyPage.jsx의 "기본으로 설정" 버튼용. PATCH /places/{id}/default
  // 호출 후 서버를 다시 조회하지 않고, locations 상태에서 해당 place만
  // isDefault: true로, 나머지는 false로 바로 갱신한다(places_router.py도
  // 대상 place를 켜기 전에 같은 사용자의 다른 place를 전부 false로 초기화하므로
  // 이 낙관적 갱신이 서버 상태와 일치한다). 성공하면 selectLocation도 같이 불러서
  // 기본으로 설정하는 즉시 selectedLocation도 그 장소로 바뀌고(localStorage 저장은
  // selectLocation의 기존 동작 그대로 따라간다), 대시보드로 돌아가면 바로 보인다.
  const setDefaultLocation = useCallback(async (placeId) => {
    await request(`/api/places/${placeId}/default`, {
      method: "PATCH",
      auth: true,
    });

    setLocations((previousLocations) =>
      previousLocations.map((location) => ({
        ...location,
        isDefault: String(location.id) === String(placeId),
      })),
    );

    selectLocation(placeId);
  }, [selectLocation]);

  // jh 수정함 - MyPage.jsx의 "변경" 모달용. updates에는 바뀐 필드만 담겨
  // 온다(name만 / lat+lon만 / 둘 다) - PATCH 성공 후 서버를 다시 조회하지
  // 않고 locations 상태에서 해당 항목에 바뀐 필드만 바로 반영한다.
  const savePlaceDetails = useCallback(async (placeId, updates) => {
    await updatePlaceDetails(placeId, updates);

    setLocations((previousLocations) =>
      previousLocations.map((location) =>
        String(location.id) === String(placeId)
          ? { ...location, ...updates }
          : location,
      ),
    );
  }, []);

  // jh 수정함 - MyPage.jsx의 장소 삭제 버튼용. 삭제된 장소가 선택된 장소가
  // 아니었으면 locations에서 로컬로 제거하는 것만으로 충분하다. 선택된
  // 장소였다면 로컬 필터링 대신 refreshLocations()로 서버 목록을 다시
  // 불러온다 - 백엔드가 삭제된 장소가 기본 장소였을 때 다른 장소를 새
  // 기본 장소로 재할당해두므로, refreshLocations()의 기존 폴백 로직
  // (저장된 selectedId가 더 이상 없으면 is_default 장소를 선택)이 그
  // 재할당된 기본 장소를 자동으로 selectedLocation으로 만들어준다.
  const removeLocation = useCallback(
    async (placeId) => {
      await deletePlaceItem(placeId);

      const wasSelected = String(selectedId) === String(placeId);

      if (wasSelected) {
        await refreshLocations();
      } else {
        setLocations((previousLocations) =>
          previousLocations.filter(
            (location) => String(location.id) !== String(placeId),
          ),
        );
      }
    },
    [selectedId, refreshLocations],
  );

  const selectedLocation =
    locations.find(
      (location) => String(location.id) === String(selectedId),
    ) || null;

  return {
    locations,
    selectedLocation,
    selectLocation,
    refreshLocations,
    setDefaultLocation,
    savePlaceDetails,
    removeLocation,
    isLoading,
    loadError,
  };
}
