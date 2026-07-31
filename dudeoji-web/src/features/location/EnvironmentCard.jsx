// src/features/location/EnvironmentCard.jsx
// 담당: 정현(나) (위치 추가 · 실외 날씨 · 실내외 환경 · 예상 절감)
//
// 실내·실외 모두 sensorData(백엔드 최신 reading)를 그대로 표시합니다.
// jh 수정함 - 실외는 예전엔 GET /api/weather를 따로 실시간 조회했는데,
// 그러면 추천 카드가 판단에 쓴 실외값(reading에 저장된 값)과 이 카드가
// 보여주는 실외값이 서로 다른 시점의 값이라 어긋날 수 있었다. 같은
// reading 하나에서 실내·실외를 함께 읽도록 통일했다(중복 요청도 제거).
// GET /api/weather 자체는 다른 용도로 쓸 수 있어 백엔드에는 그대로 둔다.
import { useCallback, useEffect, useState } from "react";

import { HOME_PLACE_ID } from "../sensors/deviceState";
import { createMockReading } from "../sensors/readingsApi";
import { useSensorRealtimeContext } from "../sensors/SensorRealtimeContext";
import { useLocationContext } from "./LocationContext";
import LocationSearchPopover from "./LocationSearchPopover";
import { createOccupancyLog, getLatestOccupancy } from "./occupancyApi";

// jh 수정함 - 재실감지 저장 즉시 WebSocket으로 브로드캐스트되므로(occupancy_router.py
// POST /occupancy/logs 참고), 이 폴링은 더 이상 주 경로가 아니라 realtime이
// 끊겼을 때만 쓰는 안전망이다. sensor_reading의 HTTP 폴백(60초, App.jsx)과
// 같은 주기로 맞췄다.
const OCCUPANCY_POLL_INTERVAL_MS = 60000;
// jh 수정함 - 이 시간보다 오래된 기록이면 "카메라가 지금 안 돌고 있다"로
// 간주한다(occupancy_service.py는 아직 상시 서비스가 아니라 수동 실행 중).
const OCCUPANCY_STALE_AFTER_MS = 3 * 60 * 1000;

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

// jh 수정함 - 테스트 모드 폼의 창문/에어컨 3-state 토글 옵션.
// "미연결"을 고르면 window_is_open/ac_is_on을 null로 보내 센서 미연결 상태를 재현한다.
const WINDOW_STATE_OPTIONS = [
  { value: "open", label: "열림" },
  { value: "closed", label: "닫힘" },
  { value: "unknown", label: "미연결" },
];

const AC_STATE_OPTIONS = [
  { value: "on", label: "켜짐" },
  { value: "off", label: "꺼짐" },
  { value: "unknown", label: "미연결" },
];

// jh 수정함 - 테스트 모드에서 재실감지(사람 있음/없음)도 재현할 수 있게 추가.
// "모름"을 고르면 occupancy 기록을 아예 안 보내서(카메라 미연결 상태 재현)
// 기존 재실감지 상태를 그대로 둔다.
const PERSON_STATE_OPTIONS = [
  { value: "present", label: "있음" },
  { value: "absent", label: "없음" },
  { value: "unknown", label: "모름" },
];

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
  onMockReadingCreated,
}) {
  // jh 수정함 - useSelectedLocation()을 직접 호출하던 것을 useLocationContext()로
  // 바꿔서, LocationSwitcher(헤더 위치 버튼)가 선택한 위치를 그대로 공유한다
  // (따로 호출하면 각자 다른 위치를 가리키는 문제가 있었음 - App.jsx의 LocationProvider 참고).
  const { selectedLocation, setLocationCoordinates } = useLocationContext();
  const { latestReading: realtimeReading, latestOccupancy: realtimeOccupancy } =
    useSensorRealtimeContext();
  const realtimeMatchesSelectedPlace =
    realtimeReading &&
    String(realtimeReading.place_id) === String(selectedLocation?.id);
  // jh 수정함 - realtime 브로드캐스트(WebSocket)도 저장된 reading 전체를 그대로
  // 보내주므로, 예전엔 빠져 있던 실외값도 같이 뽑아서 HTTP 폴링 경로와 동일하게 맞췄다.
  const activeSensorData = realtimeMatchesSelectedPlace
    ? {
        indoorTemperature: realtimeReading.indoor_temperature,
        indoorHumidity: realtimeReading.indoor_humidity,
        outdoorTemperature: realtimeReading.outdoor_temperature,
        outdoorHumidity: realtimeReading.outdoor_humidity,
        weatherCondition: realtimeReading.weather_condition,
      }
    : sensorData;
  // jh 수정함 - 실내 온습도 센서가 실제로 붙어 있는 곳은 "우리집"(place_id 54)
  // 하나뿐이다. 다른 장소는 예전 테스트 기록이 남아 있을 수 있어도 화면에는
  // "측정 대기 중"으로 보여준다(TemperatureValue/HumidityValue가 null을 이미
  // 그렇게 처리한다). 실외값은 날씨 API 기반이라 그대로 둔다.
  const isKnownHomePlace = String(selectedLocation?.id) === HOME_PLACE_ID;
  const effectiveSensorData = isKnownHomePlace
    ? activeSensorData
    : {
        ...activeSensorData,
        indoorTemperature: null,
        indoorHumidity: null,
      };
  // jh 수정함 - "마지막 측정" 시각도 실제로 화면에 그리는 값과 같은 출처에서
  // 가져온다. 예전에는 온습도는 WebSocket(5초마다 갱신)에서 오는데 시각은
  // updatedAt prop(App.jsx의 60초 폴링에서만 갱신)에서 와서, 값은 최신인데
  // 옆의 시각만 최대 60초 뒤처져 보였다 — 사용자는 그 시각을 신선도의
  // 근거로 읽기 때문에, 파이프라인이 정상인데도 "안 갱신된다"고 느끼게 된다.
  const activeUpdatedAt =
    realtimeMatchesSelectedPlace && realtimeReading.measured_at
      ? new Date(realtimeReading.measured_at)
      : updatedAt;
  const hasLocation =
    selectedLocation?.lat != null && selectedLocation?.lon != null;
  // jh 수정함 - 장소는 있지만 아직 reading이 한 건도 없는 경우(막 등록한 장소
  // 등) 실외 온도/습도가 null/undefined다 — 이때 "측정 대기 중"을 보여준다.
  const hasOutdoorReading =
    activeSensorData?.outdoorTemperature != null &&
    activeSensorData?.outdoorHumidity != null;

  // jh 수정함 - 실외 카드가 비어 있을 때(is-empty) "+" 버튼으로 여는 위치 검색
  // 팝오버 열림 상태. 위치가 저장되면(hasLocation이 true가 됨) 다음 reading
  // 폴링/realtime 브로드캐스트가 그 장소의 실외값을 자연히 채워준다.
  const [isLocationPopoverOpen, setIsLocationPopoverOpen] = useState(false);

  // jh 수정함 - 재실감지(카메라 → YOLO26/occupancy_service.py) 최신 상태.
  // POST /occupancy/logs 저장 직후 /ws/readings로 바로 브로드캐스트되므로
  // (sensor_reading/device_state와 같은 소켓), 아래 realtimeOccupancy effect가
  // 대부분의 갱신을 즉시 반영한다. 이 폴링은 realtime이 끊겼을 때의 안전망.
  const [occupancyStatus, setOccupancyStatus] = useState(null);

  // jh 추가 - WebSocket으로 새 재실감지 값이 오면 폴링 결과를 기다리지 않고
  // 바로 반영한다. selectedLocation이 바뀌면 이전 장소의 realtimeOccupancy가
  // 아직 context에 남아 있을 수 있으니, effect 실행 시점의 selectedLocation과
  // 무관하게 SensorRealtimeContext가 이미 place_id로 필터링해서 넘겨준 값만
  // 여기 온다(SensorRealtimeContext.jsx의 message.place_id 비교 참고).
  useEffect(() => {
    if (realtimeOccupancy) {
      setOccupancyStatus(realtimeOccupancy);
    }
  }, [realtimeOccupancy]);

  // jh 수정함 - 테스트 모드에서 사람 있음/없음을 보낸 직후 20초 폴링을
  // 기다리지 않고 바로 반영하려고 effect 밖으로 뺐다(useCallback으로 감싸서
  // effect의 의존성 배열에 안전하게 넣는다).
  const refreshOccupancy = useCallback(async (placeId) => {
    try {
      const result = await getLatestOccupancy(placeId);
      setOccupancyStatus(result);
    } catch {
      setOccupancyStatus(null);
    }
  }, []);

  useEffect(() => {
    const placeId = selectedLocation?.id;
    if (!placeId) {
      setOccupancyStatus(null);
      return undefined;
    }

    refreshOccupancy(placeId);
    const intervalId = window.setInterval(
      () => refreshOccupancy(placeId),
      OCCUPANCY_POLL_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedLocation?.id, refreshOccupancy]);

  const occupancyDetectedAt = occupancyStatus?.detected_at
    ? new Date(occupancyStatus.detected_at)
    : null;
  const isOccupancyFresh =
    occupancyDetectedAt != null &&
    Date.now() - occupancyDetectedAt.getTime() < OCCUPANCY_STALE_AFTER_MS;
  const occupancyStatusText =
    !occupancyDetectedAt || isOccupancyFresh
      ? null
      : "재실감지: 카메라 연결 끊김 (오래된 기록)";
  // jh 수정함 - 실내 카드 아이콘을 재실감지 결과에 맞춰 바꾼다. 센서 미연결/
  // 오래된 기록 등 판단 불가한 경우는 모두 "감지됨" 아이콘으로 둔다(사용자 결정).
  const indoorPresenceEmoji =
    isOccupancyFresh && occupancyStatus.person_detected === false
      ? "🙅‍♂️"
      : "🙋‍♂️";

  // jh 수정함 - 개발/데모용 "테스트 모드" 토글. 서버에 저장하지 않는 로컬 state라
  // 새로고침하면 꺼진 상태로 돌아가도 무방하다(기본값 OFF).
  const [isTestModeOn, setIsTestModeOn] = useState(false);
  const [isMockReadingLoading, setIsMockReadingLoading] = useState(false);
  const [mockReadingError, setMockReadingError] = useState("");
  // jh 수정함 - "가짜 데이터 받기" 버튼(랜덤 생성)을 입력 폼으로 교체.
  // 창문/에어컨은 기본값을 "미연결"로 둬서, 실제 하드웨어가 붙기 전
  // 기본 상태(리드 스위치/전원 센서 없음)를 그대로 재현한다.
  const [mockIndoorTemperature, setMockIndoorTemperature] = useState("26");
  const [mockIndoorHumidity, setMockIndoorHumidity] = useState("60");
  const [mockWindowState, setMockWindowState] = useState("unknown");
  const [mockAcState, setMockAcState] = useState("unknown");
  const [mockPersonState, setMockPersonState] = useState("unknown");
  // jh 수정함 - "실외 직접 입력(시연용)". 비워두면(빈 문자열) 저장 경로가
  // 실제 날씨 API 값을 그대로 쓴다 — 기본값이 빈 문자열인 이유.
  const [mockOutdoorTemperature, setMockOutdoorTemperature] = useState("");
  const [mockOutdoorHumidity, setMockOutdoorHumidity] = useState("");
  const hasOutdoorOverride =
    mockOutdoorTemperature.trim() !== "" || mockOutdoorHumidity.trim() !== "";

  async function handleLocationSelect(lat, lon) {
    if (!selectedLocation) {
      return;
    }

    await setLocationCoordinates(selectedLocation.id, lat, lon);
    setIsLocationPopoverOpen(false);
  }

  // jh 수정함 - POST /api/dev/mock-reading으로 입력한 값을 하나 저장한 뒤,
  // App.jsx의 기존 loadLatestReading() 갱신 패턴을 그대로 재사용해서 화면을 새로고침한다.
  async function handleMockFormSubmit(event) {
    event.preventDefault();
    setIsMockReadingLoading(true);
    setMockReadingError("");

    const windowIsOpen =
      mockWindowState === "open"
        ? true
        : mockWindowState === "closed"
          ? false
          : null;
    const acIsOn =
      mockAcState === "on" ? true : mockAcState === "off" ? false : null;
    const outdoorTemperature =
      mockOutdoorTemperature.trim() === ""
        ? null
        : Number(mockOutdoorTemperature);
    const outdoorHumidity =
      mockOutdoorHumidity.trim() === "" ? null : Number(mockOutdoorHumidity);

    try {
      await createMockReading(selectedLocation?.id ?? null, "manual", {
        indoorTemperature: Number(mockIndoorTemperature),
        indoorHumidity: Number(mockIndoorHumidity),
        windowIsOpen,
        acIsOn,
        outdoorTemperature,
        outdoorHumidity,
      });

      if (mockPersonState !== "unknown" && selectedLocation?.id) {
        await createOccupancyLog(
          selectedLocation.id,
          mockPersonState === "present",
        );
        await refreshOccupancy(selectedLocation.id);
      }

      await onMockReadingCreated?.();
    } catch (error) {
      setMockReadingError(error.message);
    } finally {
      setIsMockReadingLoading(false);
    }
  }

  return (
    <article
      className={`card environment-card ${isTutorialTarget ? "tutorial-target" : ""}`}
    >
      {/* jh 수정함 - 제목 + 테스트 모드 토글/버튼을 한 줄에 배치(SavingsSummary.jsx의
          .saving-summary-header와 동일한 패턴) */}
      <div className="environment-card-header">
        <h3>실시간 실내외 환경</h3>

        <div className="environment-test-mode">
          <label className="environment-test-mode-toggle">
            <input
              type="checkbox"
              checked={isTestModeOn}
              onChange={(event) => setIsTestModeOn(event.target.checked)}
            />
            테스트 모드
          </label>
        </div>
      </div>

      {isTestModeOn && (
        <form className="environment-mock-form" onSubmit={handleMockFormSubmit}>
          <div className="environment-mock-form-row">
            <div className="environment-mock-numbers">
              <label className="environment-mock-field">
                온도(℃)
                <input
                  type="number"
                  step="0.1"
                  required
                  value={mockIndoorTemperature}
                  onChange={(event) =>
                    setMockIndoorTemperature(event.target.value)
                  }
                />
              </label>

              <label className="environment-mock-field">
                습도(%)
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  required
                  value={mockIndoorHumidity}
                  onChange={(event) =>
                    setMockIndoorHumidity(event.target.value)
                  }
                />
              </label>
            </div>

            <div className="environment-mock-tristate">
              <span>창문</span>
              <div className="environment-mock-tristate-options">
                {WINDOW_STATE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`environment-mock-tristate-button ${
                      mockWindowState === option.value ? "is-active" : ""
                    }`}
                    onClick={() => setMockWindowState(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="environment-mock-tristate">
              <span>에어컨</span>
              <div className="environment-mock-tristate-options">
                {AC_STATE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`environment-mock-tristate-button ${
                      mockAcState === option.value ? "is-active" : ""
                    }`}
                    onClick={() => setMockAcState(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="environment-mock-tristate">
              <span>사람</span>
              <div className="environment-mock-tristate-options">
                {PERSON_STATE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`environment-mock-tristate-button ${
                      mockPersonState === option.value ? "is-active" : ""
                    }`}
                    onClick={() => setMockPersonState(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="environment-mock-button"
              disabled={isMockReadingLoading}
            >
              {isMockReadingLoading ? "전송 중..." : "전송"}
            </button>
          </div>

          {/* jh 수정함 - 실외값은 기본적으로 날씨 API 실측을 쓰므로 접힘
              섹션으로 숨겨두고, 시연/검증용으로 필요할 때만 펼쳐서 override한다. */}
          <details className="environment-mock-outdoor">
            <summary>
              실외 직접 입력 (시연용)
              {hasOutdoorOverride && (
                <span className="environment-mock-outdoor-badge">
                  실외 override 적용 중
                </span>
              )}
            </summary>

            <div className="environment-mock-outdoor-fields">
              <label className="environment-mock-field">
                실외 온도(℃)
                <input
                  type="number"
                  step="0.1"
                  placeholder="실제 날씨"
                  value={mockOutdoorTemperature}
                  onChange={(event) =>
                    setMockOutdoorTemperature(event.target.value)
                  }
                />
              </label>

              <label className="environment-mock-field">
                실외 습도(%)
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  placeholder="실제 날씨"
                  value={mockOutdoorHumidity}
                  onChange={(event) =>
                    setMockOutdoorHumidity(event.target.value)
                  }
                />
              </label>
            </div>
          </details>
        </form>
      )}

      {mockReadingError && (
        <p className="environment-mock-error">{mockReadingError}</p>
      )}

      <div className="environment-grid">
        <div className="environment-item indoor">
          <div className="environment-title">
            <span>실내</span>
            <span className="environment-emoji">{indoorPresenceEmoji}</span>
          </div>

          <strong>
            <TemperatureValue value={effectiveSensorData?.indoorTemperature} />
          </strong>
          <p>
            <HumidityValue value={effectiveSensorData?.indoorHumidity} />
          </p>
          {occupancyStatusText && (
            <p
              className={`environment-occupancy-status ${
                isOccupancyFresh ? "" : "is-stale"
              }`}
              role="status"
            >
              {occupancyStatusText}
            </p>
          )}
        </div>

        <div
          className={`environment-item outdoor ${
            !hasLocation || !hasOutdoorReading ? "is-empty" : ""
          }`}
        >
          <div className="environment-title">
            <span>실외</span>
            {hasLocation ? (
              <span className="environment-emoji">
                {getWeatherEmoji(activeSensorData?.weatherCondition)}
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
          ) : !hasOutdoorReading ? (
            <p className="environment-outdoor-empty">측정 대기 중</p>
          ) : (
            <>
              <strong>
                <TemperatureValue value={activeSensorData?.outdoorTemperature} />
              </strong>
              <p>
                <HumidityValue value={activeSensorData?.outdoorHumidity} />
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

      {/* jh 수정함 - 시간만 있으면 며칠 지난 기록인지 알 수 없어서 날짜(N월 N일)도 같이 표시 */}
      {activeUpdatedAt && (
        <p className="dashboard-updated-at">
          마지막 측정{" "}
          {activeUpdatedAt.toLocaleDateString("ko-KR", {
            month: "long",
            day: "numeric",
          })}{" "}
          {activeUpdatedAt.toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
    </article>
  );
}
