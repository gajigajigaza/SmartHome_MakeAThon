// src/features/location/LocationContext.jsx
// 담당: 정현(나)
//
// useSelectedLocation()의 상태(locations, selectedLocation, selectLocation,
// refreshLocations)를 앱 전체에서 하나의 인스턴스로 공유하기 위한 Context.
// LocationSwitcher/EnvironmentCard/LocationListPanel이 각자 useSelectedLocation()을
// 따로 호출하면 서로 다른 selectedId를 들고 있게 되어, 헤더에서 위치를 바꿔도
// EnvironmentCard가 그 변경을 못 보는 문제가 있었다. App.jsx 최상단(대시보드
// 렌더링하는 곳)을 <LocationProvider>로 한 번만 감싸고, 나머지 컴포넌트는
// useLocationContext()로 그 값을 읽는다.
import { createContext, useCallback, useContext, useState } from "react";

import { updatePlaceLocation } from "../places/placesApi";
import { useSelectedLocation } from "./useSelectedLocation";

const LocationContext = createContext(null);

export function LocationProvider({ children }) {
  const selectedLocationState = useSelectedLocation();
  const { refreshLocations } = selectedLocationState;

  // jh 수정함 - MyPage.jsx의 PlaceLocationStatus가 렌더될 때마다 GET
  // /places/reverse-geocode를 다시 부르지 않도록, place id -> 주소 문자열
  // 캐시를 여기서 관리한다. 성공/실패(주소 없음) 둘 다 캐시해서 반복 호출을
  // 막는다(실패는 값이 null인 채로 캐시됨 - PlaceLocationStatus가 구분해서 표시).
  const [addressCache, setAddressCache] = useState({});

  const setCachedAddress = useCallback((placeId, address) => {
    setAddressCache((previous) => ({ ...previous, [placeId]: address }));
  }, []);

  // jh 수정함 - EnvironmentCard의 "+" 위치 검색 팝오버가 기존 장소의 lat/lon만
  // 갱신할 때 쓴다. useSelectedLocation.js 구조는 그대로 두고, PATCH 저장 후
  // refreshLocations()로 다시 불러와서 locations 상태를 서버 값과 맞춘다
  // (locations 배열을 직접 patch하지 않고 항상 서버 값을 그대로 신뢰).
  async function setLocationCoordinates(placeId, lat, lon) {
    await updatePlaceLocation(placeId, lat, lon);

    // jh 수정함 - lat/lon이 바뀌면 그동안 캐시해둔 주소는 더 이상 정확하지
    // 않으니 그 장소의 캐시만 지운다. PlaceLocationStatus가 다음 렌더에서
    // 캐시가 없는 걸 보고 알아서 다시 조회한다.
    setAddressCache((previous) => {
      if (!(placeId in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[placeId];
      return next;
    });

    await refreshLocations();
  }

  const value = {
    ...selectedLocationState,
    setLocationCoordinates,
    addressCache,
    setCachedAddress,
  };

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocationContext() {
  const context = useContext(LocationContext);

  if (!context) {
    throw new Error(
      "useLocationContext는 LocationProvider 안에서만 사용할 수 있습니다.",
    );
  }

  return context;
}
