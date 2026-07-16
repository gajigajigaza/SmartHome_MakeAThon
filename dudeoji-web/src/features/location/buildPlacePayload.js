// src/features/location/buildPlacePayload.js
// 담당: 정현(나)
//
// jh 수정함 - AirconPage가 관리하는 registeredAircons(슬롯) 배열을
// POST /api/places가 기대하는 payload로 바꾸는 매핑. FlowApp.jsx의
// handleAirconComplete와 같은 규칙(백엔드 PlaceCreate/UserAirconCreate 스키마 기준)이다.
// 원래 LocationListPanel.jsx 안에 있었는데, MyPage.jsx의 "장소 추가" 버튼도
// 같은 "+ 장소 추가" 모달 흐름을 재사용하면서 이 함수가 필요해져서, 컴포넌트
// 파일 밖으로 뺐다(컴포넌트 파일이 컴포넌트 아닌 값도 export하면 Vite fast
// refresh가 깨진다는 react-refresh/only-export-components 경고 때문).
export function buildPlacePayload(placeName, aircons, lat, lon) {
  return {
    place_name: placeName,
    lat: lat ?? null,
    lon: lon ?? null,
    aircons: aircons.map((aircon) => ({
      nickname: aircon.roomName,
      aircon_model_id:
        aircon.powerSource === "database" ? Number(aircon.airconId) : null,
      manufacturer: aircon.manufacturer,
      product_name: aircon.productName || null,
      model_number: aircon.modelNumber || null,
      aircon_type: aircon.airconType || null,
      rated_cooling_power_w: aircon.ratedCoolingPowerW,
      power_source: aircon.powerSource,
      verification_status: aircon.verificationStatus || null,
      estimated_min_power_w: aircon.estimatedMinPowerW || null,
      estimated_max_power_w: aircon.estimatedMaxPowerW || null,
    })),
  };
}
