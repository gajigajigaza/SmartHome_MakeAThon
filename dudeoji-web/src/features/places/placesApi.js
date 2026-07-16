// src/features/places/placesApi.js
// 담당: 류은
//
// 백엔드 routers/places_router.py(/api/places, /api/aircon-models)에
// 1:1로 대응합니다. 지금은 회원가입 흐름(features/auth/FlowApp.jsx)과
// 마이페이지(features/mypage/MyPage.jsx) 둘 다 여기서 fetchMyPlaces를
// 가져다 씁니다 — 장소 관련 화면이 따로 생기면 여기에 추가하세요.
import { request } from "../../api";

export async function fetchAirconModels(search = "") {
  const query = new URLSearchParams();
  const normalizedSearch = search.trim();

  if (normalizedSearch) {
    query.set("search", normalizedSearch);
  }

  query.set("limit", "50");

  const rows = await request(`/api/aircon-models?${query.toString()}`);

  return rows.map((row) => ({
    id: row.id,
    manufacturer: row.manufacturer,
    productName: row.product_name || "제품명 미입력",
    modelNumber: row.model_number,
    type: row.aircon_type || "유형 미입력",
    ratedCoolingPowerW: row.rated_cooling_power_w,
    verificationStatus: row.verification_status || "DB 등록",
  }));
}

export async function createPlaceWithAircons(payload) {
  return request("/api/places", {
    method: "POST",
    auth: true,
    body: JSON.stringify(payload),
  });
}

export async function fetchMyPlaces() {
  return request("/api/places", { auth: true });
}

// 마이페이지의 에어컨 카드에서 자동 제어 사용 여부와 목표 가동 시간을 저장한다.
export async function updatePlaceCooldown(placeId, payload) {
  return request(`/api/places/${placeId}/cooldown`, {
    method: "PATCH",
    auth: true,
    body: JSON.stringify(payload),
  });
}

// jh 수정함 - EnvironmentCard의 "+" 위치 검색 팝오버가 기존 장소의 lat/lon만
// 갱신할 때 쓴다. PATCH /places/{place_id}(places_router.py, 위치만 갱신).
export async function updatePlaceLocation(placeId, lat, lon) {
  return request(`/api/places/${placeId}`, {
    method: "PATCH",
    auth: true,
    body: JSON.stringify({ lat, lon }),
  });
}

// jh 수정함 - MyPage.jsx의 "변경" 모달(이름+위치를 한 폼에서 같이 편집)이 바뀐
// 필드만(이름만/위치만/둘 다) 한 번에 저장할 때 쓴다. updatePlaceLocation과
// 같은 PATCH /places/{place_id}를 쓰지만, payload에 넣은 필드만 보낸다
// (places_router.py가 name/lat/lon을 각각 선택 필드로 받는다).
export async function updatePlaceDetails(placeId, payload) {
  return request(`/api/places/${placeId}`, {
    method: "PATCH",
    auth: true,
    body: JSON.stringify(payload),
  });
}

// jh 수정함 - MyPage.jsx의 장소 삭제 버튼에 쓴다. DELETE /places/{place_id}
// (places_router.py, user_aircons는 DB cascade로 자동 정리됨).
export async function deletePlaceItem(placeId) {
  return request(`/api/places/${placeId}`, {
    method: "DELETE",
    auth: true,
  });
}
