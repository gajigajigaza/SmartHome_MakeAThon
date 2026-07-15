// src/features/location/LocationListPanel.jsx
// 담당: 정현(나)
//
// LocationSwitcher를 눌렀을 때 열리는 패널입니다.
// 저장된 위치(집/회사 등) 목록을 보여주고, 선택하면 그 위치로 바뀝니다.
//
// jh 수정함 - 이름만 받던 자유 텍스트 추가 폼을 없애고, features/places/AirconPage.jsx
// (장소 이름 + 위치 검색 + 에어컨 등록 폼)를 그대로 재사용하는 방식으로 바꿨다(류은 승인 완료).
// "새 위치 추가"를 누르면 화면 전체를 덮는 모달로 AirconPage를 variant="modal"로 렌더링하고,
// 완료되면 placesApi.js의 createPlaceWithAircons로 백엔드에 저장한 뒤 onPlacesChanged
// (useSelectedLocation의 refreshLocations)를 호출해 목록을 새로고침한다.
// onBack은 FlowApp.jsx의 handleAirconBack과 달리 로그아웃하지 않고 그냥 모달만 닫는다
// (이미 로그인한 사용자가 대시보드에서 위치를 추가하는 상황이기 때문).
import { useState } from "react";

import AirconPage, { createInitialAirconSlots } from "../places/AirconPage";
import { createPlaceWithAircons } from "../places/placesApi";
import { useLocationContext } from "./LocationContext";

// jh 수정함 - AirconPage가 관리하는 registeredAircons(슬롯) 배열을
// POST /api/places가 기대하는 payload로 바꾸는 매핑. FlowApp.jsx의
// handleAirconComplete와 같은 규칙(백엔드 PlaceCreate/UserAirconCreate 스키마 기준)이다.
function buildPlacePayload(placeName, aircons, lat, lon) {
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

export default function LocationListPanel({ onClose }) {
  // jh 수정함 - locations/selectedLocation/selectLocation/refreshLocations를
  // LocationSwitcher가 props로 내려주던 것을 useLocationContext()로 직접
  // 가져오도록 바꿨다(다른 위치를 가리키는 문제 방지, App.jsx의 LocationProvider 참고).
  const { locations, selectedLocation, selectLocation, refreshLocations } =
    useLocationContext();
  const [isAdding, setIsAdding] = useState(false);
  const [registeredAircons, setRegisteredAircons] = useState(
    createInitialAirconSlots,
  );

  function openAddForm() {
    setRegisteredAircons(createInitialAirconSlots());
    setIsAdding(true);
  }

  function closeAddForm() {
    setIsAdding(false);
  }

  async function handleAirconComplete(placeName, aircons, lat, lon) {
    await createPlaceWithAircons(
      buildPlacePayload(placeName, aircons, lat, lon),
    );
    // jh 수정함 - 성공했을 때만 여기까지 온다(실패하면 createPlaceWithAircons가
    // 던진 에러가 AirconPage.jsx의 handleComplete try/catch에서 그대로 alert로
    // 처리되고, 아래 줄들은 실행되지 않아 모달도 안 닫힌다 - 기존 에러 처리 그대로).
    // alert()는 FlowApp.jsx가 전역 오버라이드한 showInlineMessage 토스트를 그대로 탄다.
    alert("장소가 추가되었습니다.");
    setIsAdding(false);
    await refreshLocations();
  }

  if (isAdding) {
    return (
      <div
        className="location-add-modal-backdrop"
        role="presentation"
        onMouseDown={closeAddForm}
      >
        {/* jh 수정함 - 닫기(×) 버튼은 AirconPage(variant="modal")의 헤더 안에서
            .aircon-modal-close와 같은 방식(position 없는 평범한 flex 자식)으로
            렌더링된다 — 스크롤 콘텐츠 맨 위에 있어서 카드를 스크롤하면 같이
            스크롤되다 사라진다(onBack=closeAddForm이 그대로 닫기 역할을 함). */}
        <div
          className="location-add-modal"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="location-add-modal-scroll">
            <AirconPage
              variant="modal"
              registeredAircons={registeredAircons}
              setRegisteredAircons={setRegisteredAircons}
              onBack={closeAddForm}
              onComplete={handleAirconComplete}
            />
          </div>
        </div>
      </div>
    );
  }

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

      <div className="location-panel-add">
        {/* jh 수정함 - CSS 도형 아이콘은 텍스트와 색이 미묘하게 달라 보여서
            다시 일반 텍스트 "+"로 되돌림(별도 색 지정 없이 버튼 색을 그대로
            물려받아 "장소 추가"와 완전히 같은 색). 버튼은 목록 항목처럼
            width:100%로 되돌려서, hover 표시 영역도 목록 항목만큼 넓어진다. */}
        <button type="button" onClick={openAddForm}>
          + 장소 추가
        </button>
      </div>
    </div>
  );
}
