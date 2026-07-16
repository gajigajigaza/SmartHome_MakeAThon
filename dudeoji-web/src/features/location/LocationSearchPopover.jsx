// src/features/location/LocationSearchPopover.jsx
// 담당: 정현(나)
//
// EnvironmentCard의 "+" 버튼을 누르면 뜨는 가벼운 위치 검색 팝오버.
// features/places/AirconPage.jsx의 위치 검색 탭("주소로 찾기"/"현재 위치로 찾기",
// GET /places/geocode·GET /places/reverse-geocode를 request()로 직접 호출하는
// 패턴) 로직을 그대로 따르되, 에어컨 등록 없이 "위치를 고르면 onSelect(lat, lon)
// 호출"만 하는 축소판이다. 스타일은 FlowApp.css의 place-address-* 클래스를 그대로 재사용한다.
import { useEffect, useRef, useState } from "react";

import { request } from "../../api";

// jh 수정함 - embedded=true면 자체 팝오버 껍데기(위치 고정 박스 + 자체 닫기
// 버튼)를 생략하고 안쪽 검색 UI만 반환한다. MyPage.jsx가 이걸 MyPageModal
// 안에 넣어서 "별명 변경" 같은 가운데 정렬 모달로 쓴다 - 검색/선택 로직은
// EnvironmentCard.jsx가 쓰는 기본(팝오버) 모드와 완전히 동일하다.
export default function LocationSearchPopover({ onSelect, onClose, embedded = false }) {
  const [locationMode, setLocationMode] = useState("address");
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResults, setAddressResults] = useState([]);
  const [isAddressSearching, setIsAddressSearching] = useState(false);
  const [addressSearchError, setAddressSearchError] = useState("");
  const [currentLocationLabel, setCurrentLocationLabel] = useState("");
  const [isLocatingCurrentPosition, setIsLocatingCurrentPosition] =
    useState(false);
  const [currentLocationError, setCurrentLocationError] = useState("");

  // 검색 결과를 선택해서 addressQuery를 채운 직후, 디바운스 검색 effect가
  // 곧바로 다시 실행되는 걸 막기 위한 플래그(AirconPage.jsx와 같은 패턴).
  const skipNextAddressSearchRef = useRef(false);
  // 탭을 전환한 뒤 이전 현재위치 요청이 뒤늦게 응답해서 상태를 덮어쓰는 걸
  // 막기 위한 요청 토큰(AirconPage.jsx와 같은 패턴).
  const currentLocationRequestIdRef = useRef(0);

  useEffect(() => {
    if (skipNextAddressSearchRef.current) {
      skipNextAddressSearchRef.current = false;
      setAddressResults([]);
      setAddressSearchError("");
      return undefined;
    }

    const trimmedQuery = addressQuery.trim();

    if (!trimmedQuery) {
      setAddressResults([]);
      setAddressSearchError("");
      return undefined;
    }

    let ignoreResult = false;
    setIsAddressSearching(true);
    setAddressSearchError("");

    const timerId = window.setTimeout(async () => {
      try {
        const results = await request(
          `/api/places/geocode?query=${encodeURIComponent(trimmedQuery)}`,
        );

        if (!ignoreResult) {
          setAddressResults(results);
        }
      } catch (error) {
        if (!ignoreResult) {
          setAddressResults([]);
          setAddressSearchError(error.message);
        }
      } finally {
        if (!ignoreResult) {
          setIsAddressSearching(false);
        }
      }
    }, 300);

    return () => {
      ignoreResult = true;
      window.clearTimeout(timerId);
    };
  }, [addressQuery]);

  function selectAddressResult(result) {
    skipNextAddressSearchRef.current = true;
    setAddressQuery(result.address);
    setAddressResults([]);
    onSelect(result.lat, result.lon);
  }

  function switchLocationMode(nextMode) {
    if (nextMode === locationMode) {
      return;
    }

    currentLocationRequestIdRef.current += 1;
    setAddressQuery("");
    setAddressResults([]);
    setAddressSearchError("");
    setCurrentLocationLabel("");
    setCurrentLocationError("");
    setIsLocatingCurrentPosition(false);
    setLocationMode(nextMode);
  }

  function handleAddressInputKeyDown(event) {
    if (event.key === "Escape") {
      setAddressQuery("");
      setAddressResults([]);
    }
  }

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setCurrentLocationError(
        "이 브라우저는 위치 정보 조회를 지원하지 않습니다. 주소로 찾기를 이용해 주세요.",
      );
      return;
    }

    const requestId = ++currentLocationRequestIdRef.current;
    setIsLocatingCurrentPosition(true);
    setCurrentLocationError("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (currentLocationRequestIdRef.current !== requestId) {
          return;
        }

        const { latitude, longitude } = position.coords;
        let resolvedLabel = "현재 위치로 설정됨";

        try {
          const result = await request(
            `/api/places/reverse-geocode?lat=${latitude}&lon=${longitude}`,
          );

          if (result.address) {
            resolvedLabel = `현재 위치: ${result.address}`;
          }
        } catch {
          // 주소 변환이 실패해도 좌표는 이미 받았으니 선택 자체는 유지한다.
        }

        if (currentLocationRequestIdRef.current !== requestId) {
          return;
        }

        setCurrentLocationLabel(resolvedLabel);
        setIsLocatingCurrentPosition(false);
        onSelect(latitude, longitude);
      },
      () => {
        if (currentLocationRequestIdRef.current !== requestId) {
          return;
        }

        setCurrentLocationError(
          "위치 권한이 거부되었거나 위치를 가져오지 못했습니다. 주소로 찾기를 이용해 주세요.",
        );
        setIsLocatingCurrentPosition(false);
      },
    );
  }

  // jh 수정함 - embedded/기본(팝오버) 모드가 공유하는 안쪽 검색 UI. 탭/입력/결과
  // 목록 로직은 완전히 동일하고, 바깥 껍데기(위치 고정 박스 vs 모달)만 다르다.
  const searchContent = (
    <div className="place-field place-address-field">
      <span className="place-address-field-label">위치 검색</span>

        <div className="place-location-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={locationMode === "address"}
            className={locationMode === "address" ? "active" : ""}
            onClick={() => switchLocationMode("address")}
          >
            주소로 찾기
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={locationMode === "current"}
            className={locationMode === "current" ? "active" : ""}
            onClick={() => switchLocationMode("current")}
          >
            현재 위치로 찾기
          </button>
        </div>

        {locationMode === "address" ? (
          <div className="place-location-panel">
            <input
              type="text"
              className="place-address-input"
              value={addressQuery}
              onChange={(event) => setAddressQuery(event.target.value)}
              onKeyDown={handleAddressInputKeyDown}
              placeholder="예: 서울 강남구 테헤란로, 강남역 스타벅스"
              autoFocus
            />

            {isAddressSearching && (
              <small className="place-address-status">검색 중...</small>
            )}

            {!isAddressSearching && addressSearchError && (
              <small className="place-address-status error">
                {addressSearchError}
              </small>
            )}

            {addressResults.length > 0 && (
              <ul className="place-address-results">
                {addressResults.map((result, index) => (
                  <li key={`${result.address}-${index}`}>
                    <button
                      type="button"
                      className="place-address-result-card"
                      onClick={() => selectAddressResult(result)}
                    >
                      <span className="place-address-result-icon">📍</span>
                      <span>{result.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="place-location-panel">
            {currentLocationLabel ? (
              <input
                type="text"
                className="place-address-input selected"
                value={currentLocationLabel}
                readOnly
              />
            ) : (
              <button
                type="button"
                className="place-current-location-button"
                onClick={handleUseCurrentLocation}
                disabled={isLocatingCurrentPosition}
              >
                {isLocatingCurrentPosition
                  ? "위치 확인 중..."
                  : "📍 현재 위치 가져오기"}
              </button>
            )}

            {currentLocationError && (
              <div className="place-address-status error place-current-location-error">
                <p>{currentLocationError}</p>
                <button
                  type="button"
                  onClick={() => switchLocationMode("address")}
                >
                  주소로 찾기로 전환
                </button>
              </div>
            )}
          </div>
        )}
    </div>
  );

  if (embedded) {
    return searchContent;
  }

  return (
    <div
      className="location-coord-popover"
      role="dialog"
      aria-label="위치 검색"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="location-coord-popover-close"
        onClick={onClose}
        aria-label="닫기"
      >
        ✕
      </button>

      {searchContent}
    </div>
  );
}
