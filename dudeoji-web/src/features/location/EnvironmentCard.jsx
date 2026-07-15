// src/features/location/EnvironmentCard.jsx
// 담당: 정현(나) (위치 추가 · 실외 날씨 · 실내외 환경 · 예상 절감)
//
// 실내는 sensorData(백엔드 최신 기록)를 그대로 표시하고, 실외는 선택된
// 위치(useSelectedLocation)의 위경도로 GET /api/weather를 호출해 표시합니다.
import { useEffect, useState } from "react";

import { request } from "../../api";
import { useLocationContext } from "./LocationContext";
import LocationSearchPopover from "./LocationSearchPopover";

const WEATHER_EMOJI = {
  맑음: "☀️",
  흐림: "☁️",
  비: "🌧️",
  소나기: "🌦️",
  눈: "❄️",
  태풍: "🌀",
};

function getWeatherEmoji(condition) {
  return WEATHER_EMOJI[condition] || "🌤️";
}

export function TemperatureValue({ value }) {
  if (value === null || value === undefined) {
    return <>-- ℃</>;
  }

  return <>{Number(value).toFixed(1)}℃</>;
}

export function HumidityValue({ value }) {
  if (value === null || value === undefined) {
    return <>아직 측정 전</>;
  }

  return <>습도 {value}%</>;
}

export default function EnvironmentCard({
  sensorData,
  updatedAt,
  isTutorialTarget,
  children,
}) {
  // jh 수정함 - useSelectedLocation()을 직접 호출하던 것을 useLocationContext()로
  // 바꿔서, LocationSwitcher(헤더 위치 버튼)가 선택한 위치를 그대로 공유한다
  // (따로 호출하면 각자 다른 위치를 가리키는 문제가 있었음 - App.jsx의 LocationProvider 참고).
  const { selectedLocation, setLocationCoordinates } = useLocationContext();
  const hasLocation =
    selectedLocation?.lat != null && selectedLocation?.lon != null;

  const [outdoorWeather, setOutdoorWeather] = useState(null);
  const [isWeatherLoading, setIsWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  // jh 수정함 - 실외 카드가 비어 있을 때(is-empty) "+" 버튼으로 여는 위치 검색
  // 팝오버 열림 상태. 위치가 저장되면(hasLocation이 true가 됨) 위 useEffect가
  // 알아서 날씨를 다시 불러오므로 별도 재조회 로직은 필요 없다.
  const [isLocationPopoverOpen, setIsLocationPopoverOpen] = useState(false);

  async function handleLocationSelect(lat, lon) {
    if (!selectedLocation) {
      return;
    }

    await setLocationCoordinates(selectedLocation.id, lat, lon);
    setIsLocationPopoverOpen(false);
  }

  useEffect(() => {
    if (!hasLocation) {
      return;
    }

    let isCancelled = false;
    setIsWeatherLoading(true);
    setWeatherError("");

    request(
      `/api/weather?lat=${selectedLocation.lat}&lon=${selectedLocation.lon}`,
      { auth: true },
    )
      .then((data) => {
        if (!isCancelled) {
          setOutdoorWeather(data);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setWeatherError(error.message);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsWeatherLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [hasLocation, selectedLocation?.lat, selectedLocation?.lon]);

  return (
    <article
      className={`card environment-card ${isTutorialTarget ? "tutorial-target" : ""}`}
    >
      <h3>실시간 실내외 환경</h3>

      <div className="environment-grid">
        <div className="environment-item indoor">
          <div className="environment-title">
            <span>실내</span>
            <span className="environment-emoji">🏠</span>
          </div>

          <strong>
            <TemperatureValue value={sensorData?.indoorTemperature} />
          </strong>
          <p>
            <HumidityValue value={sensorData?.indoorHumidity} />
          </p>
        </div>

        <div
          className={`environment-item outdoor ${!hasLocation ? "is-empty" : ""}`}
        >
          <div className="environment-title">
            <span>실외</span>
            {hasLocation ? (
              <span className="environment-emoji">
                {getWeatherEmoji(outdoorWeather?.weather_condition)}
              </span>
            ) : (
              // jh 수정함 - 위치 미설정 상태에선 날씨 이모지 자리에 "+" 버튼을 놓고,
              // 누르면 LocationSearchPopover(주소/현재 위치 검색)를 띄운다.
              <button
                type="button"
                className="environment-emoji environment-add-location-button"
                onClick={() => setIsLocationPopoverOpen(true)}
                aria-label="위치 추가"
              >
                +
              </button>
            )}
          </div>

          {!hasLocation ? (
            <p className="environment-outdoor-empty">위치를 설정해 주세요</p>
          ) : isWeatherLoading ? (
            <p>불러오는 중...</p>
          ) : weatherError ? (
            <p>{weatherError}</p>
          ) : (
            <>
              <strong>
                <TemperatureValue value={outdoorWeather?.outdoor_temperature} />
              </strong>
              <p>
                <HumidityValue value={outdoorWeather?.outdoor_humidity} />
              </p>
            </>
          )}

          {isLocationPopoverOpen && (
            <>
              <div
                className="location-coord-popover-backdrop"
                onMouseDown={() => setIsLocationPopoverOpen(false)}
              />
              <LocationSearchPopover
                onSelect={handleLocationSelect}
                onClose={() => setIsLocationPopoverOpen(false)}
              />
            </>
          )}
        </div>
      </div>

      {/* 예상 절감(SavingsSummary)이나 위치 표시줄을 붙일 자리 */}
      {children}

      {updatedAt && (
        <p className="dashboard-updated-at">
          마지막 측정{" "}
          {updatedAt.toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </article>
  );
}
