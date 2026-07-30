import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getLogicThresholds,
  getReadingHistory,
  getWeatherStatus,
} from "./readingsApi";
import LocationSwitcher from "../location/LocationSwitcher";
import { useSensorRealtimeContext } from "./SensorRealtimeContext";
import SharedAppSidebar from "../navigation/SharedAppSidebar";
import { useLocationContext } from "../location/LocationContext";
import EnvironmentPanels from "./EnvironmentPanels";
import SensorHistorySection from "./SensorHistorySection";
import SensorRecordsTable from "./SensorRecordsTable";
import SensorStatusPanels from "./SensorStatusPanels";
import {
  FALLBACK_THRESHOLDS,
  HISTORY_LIMIT,
  RANGE_OPTIONS,
  buildAlerts,
  formatDateTime,
  getConnectionState,
  mergeReadings,
  normalizeHistory,
} from "./sensorReadingsUtils";
import "./SensorReadings.css";

const LIVE_REFRESH_SECONDS = 5;

export default function SensorReadings({
  history = [],
  nickname = "두더지",
  renderProfileBadge,
  onBack,
  onOpenMyPage,
  onStartTutorial,
  onLogout,
}) {
  const {
    selectedLocation,
    isLoading: isLocationLoading,
    loadError: locationLoadError,
  } = useLocationContext();
  const selectedPlaceId = selectedLocation?.id ?? null;
  const { latestReading: realtimeReading, realtimeIsLive } =
    useSensorRealtimeContext();
  const [readings, setReadings] = useState([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshSeconds = LIVE_REFRESH_SECONDS;
  const [weatherStatus, setWeatherStatus] = useState(null);
  const [weatherStatusError, setWeatherStatusError] = useState("");
  const [isWeatherStatusLoading, setIsWeatherStatusLoading] = useState(false);
  const [rangeKey, setRangeKey] = useState("1h");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [newReadingPulse, setNewReadingPulse] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [logicThresholds, setLogicThresholds] = useState(FALLBACK_THRESHOLDS);

  const mountedRef = useRef(true);
  const selectedPlaceIdRef = useRef(null);
  const requestVersionRef = useRef(0);
  const historyAbortRef = useRef(null);
  const weatherStatusAbortRef = useRef(null);
  const newestReadingKeyRef = useRef(null);
  const newestMeasuredAtRef = useRef(null);
  const refreshCycleLockRef = useRef(false);
  const consecutiveFailureRef = useRef(0);
  const pulseTimerRef = useRef(null);

  const showNewReadingPulse = useCallback(() => {
    setNewReadingPulse(true);
    window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        setNewReadingPulse(false);
      }
    }, 1400);
  }, []);

  const mergeIntoState = useCallback(
    (
      incoming,
      {
        replace = false,
        expectedPlaceId = selectedPlaceIdRef.current,
        expectedVersion = requestVersionRef.current,
      } = {},
    ) => {
      if (
        String(selectedPlaceIdRef.current) !== String(expectedPlaceId) ||
        requestVersionRef.current !== expectedVersion
      ) {
        return;
      }

      const normalizedIncoming = normalizeHistory(incoming || []).filter(
        (record) =>
          record.placeId != null &&
          String(record.placeId) === String(expectedPlaceId),
      );

      setReadings((previous) => {
        const next = replace
          ? normalizedIncoming.slice(-HISTORY_LIMIT)
          : mergeReadings(previous, normalizedIncoming);
        const newest = next.at(-1) || null;
        const newestKey = newest
          ? String(newest.id ?? newest.measuredAt.getTime())
          : null;

        if (
          newestReadingKeyRef.current &&
          newestKey &&
          newestReadingKeyRef.current !== newestKey
        ) {
          showNewReadingPulse();
        }

        newestReadingKeyRef.current = newestKey;
        newestMeasuredAtRef.current =
          newest?.measuredAt?.toISOString?.() || null;
        return next;
      });
    },
    [showNewReadingPulse],
  );

  const loadData = useCallback(
    async ({
      silent = false,
      incremental = false,
      placeId = selectedPlaceIdRef.current,
      version = requestVersionRef.current,
    } = {}) => {
      if (!placeId) {
        setReadings([]);
        setErrorMessage("");
        setSyncStatus("idle");
        setIsInitialLoading(false);
        setIsRefreshing(false);
        newestMeasuredAtRef.current = null;
        return;
      }

      historyAbortRef.current?.abort();
      const controller = new AbortController();
      historyAbortRef.current = controller;

      if (!silent) {
        setIsRefreshing(true);
      }

      try {
        const after = incremental ? newestMeasuredAtRef.current : null;
        const historyResult = await getReadingHistory(
          HISTORY_LIMIT,
          placeId,
          after,
          { signal: controller.signal },
        );

        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          String(selectedPlaceIdRef.current) !== String(placeId) ||
          requestVersionRef.current !== version
        ) {
          return;
        }

        mergeIntoState(historyResult || [], {
          replace: !incremental,
          expectedPlaceId: placeId,
          expectedVersion: version,
        });
        consecutiveFailureRef.current = 0;
        setErrorMessage("");
        setSyncStatus("connected");
        setLastSyncedAt(new Date());
      } catch (error) {
        if (
          !mountedRef.current ||
          error?.name === "AbortError" ||
          String(selectedPlaceIdRef.current) !== String(placeId) ||
          requestVersionRef.current !== version
        ) {
          return;
        }

        const message = error?.message || "센서 데이터를 불러오지 못했습니다.";
        if (message.includes("저장된 센서 기록이 없습니다")) {
          if (!incremental) {
            setReadings([]);
          }
          consecutiveFailureRef.current = 0;
          setErrorMessage("");
          setSyncStatus("connected");
        } else {
          consecutiveFailureRef.current += 1;
          if (consecutiveFailureRef.current < 3) {
            setSyncStatus("retrying");
            setErrorMessage("");
          } else {
            setSyncStatus("error");
            setErrorMessage(message);
          }
        }
      } finally {
        if (
          mountedRef.current &&
          String(selectedPlaceIdRef.current) === String(placeId) &&
          requestVersionRef.current === version
        ) {
          setIsInitialLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [mergeIntoState],
  );

  const loadWeatherApiStatus = useCallback(
    async ({
      placeId = selectedPlaceIdRef.current,
      version = requestVersionRef.current,
      forceRefresh = false,
    } = {}) => {
      if (!placeId) {
        setWeatherStatus(null);
        setWeatherStatusError("");
        return;
      }

      weatherStatusAbortRef.current?.abort();
      const controller = new AbortController();
      weatherStatusAbortRef.current = controller;
      setIsWeatherStatusLoading(true);

      try {
        const result = await getWeatherStatus(placeId, forceRefresh, {
          signal: controller.signal,
        });
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          String(selectedPlaceIdRef.current) !== String(placeId) ||
          requestVersionRef.current !== version
        ) {
          return;
        }
        setWeatherStatus(result || null);
        setWeatherStatusError("");
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (
          mountedRef.current &&
          String(selectedPlaceIdRef.current) === String(placeId) &&
          requestVersionRef.current === version
        ) {
          setWeatherStatusError(
            error?.message || "날씨 API 상태를 확인하지 못했습니다.",
          );
        }
      } finally {
        if (mountedRef.current) setIsWeatherStatusLoading(false);
      }
    },
    [],
  );

  const performRefreshCycle = useCallback(async () => {
    const placeId = selectedPlaceIdRef.current;
    const version = requestVersionRef.current;

    if (!placeId || refreshCycleLockRef.current) {
      return;
    }

    refreshCycleLockRef.current = true;
    try {
      await loadData({
        silent: true,
        incremental: true,
        placeId,
        version,
      });
    } catch (error) {
      if (
        mountedRef.current &&
        String(selectedPlaceIdRef.current) === String(placeId) &&
        requestVersionRef.current === version
      ) {
        consecutiveFailureRef.current += 1;
        if (consecutiveFailureRef.current < 3) {
          setSyncStatus("retrying");
          setErrorMessage("");
        } else {
          setSyncStatus("error");
          setErrorMessage(error.message || "센서 데이터를 갱신하지 못했습니다.");
        }
      }
    } finally {
      refreshCycleLockRef.current = false;
    }
  }, [loadData]);

  useEffect(() => {
    mountedRef.current = true;

    const controller = new AbortController();
    getLogicThresholds({ signal: controller.signal })
      .then((result) => {
        if (mountedRef.current && result) {
          setLogicThresholds({ ...FALLBACK_THRESHOLDS, ...result });
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          console.warn("추천 기준을 불러오지 못해 기본값을 사용합니다.", error);
        }
      });

    return () => {
      mountedRef.current = false;
      controller.abort();
      historyAbortRef.current?.abort();
      weatherStatusAbortRef.current?.abort();
      window.clearTimeout(pulseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const nextPlaceId =
      selectedPlaceId == null ? null : String(selectedPlaceId);

    requestVersionRef.current += 1;
    const version = requestVersionRef.current;
    selectedPlaceIdRef.current = nextPlaceId;
    historyAbortRef.current?.abort();
    weatherStatusAbortRef.current?.abort();
    refreshCycleLockRef.current = false;
    newestReadingKeyRef.current = null;
    newestMeasuredAtRef.current = null;
    consecutiveFailureRef.current = 0;
    setReadings([]);
    setWeatherStatus(null);
    setWeatherStatusError("");
    setErrorMessage("");
    setSyncStatus("idle");
    setLastSyncedAt(null);
    setIsInitialLoading(Boolean(nextPlaceId));

    const initialForPlace = normalizeHistory(history).filter(
      (record) =>
        nextPlaceId != null &&
        record.placeId != null &&
        String(record.placeId) === nextPlaceId,
    );
    if (initialForPlace.length) {
      mergeIntoState(initialForPlace, {
        replace: true,
        expectedPlaceId: nextPlaceId,
        expectedVersion: version,
      });
    }

    if (nextPlaceId) {
      loadData({
        incremental: false,
        placeId: nextPlaceId,
        version,
      });
      loadWeatherApiStatus({
        placeId: nextPlaceId,
        version,
      });
    } else {
      setIsInitialLoading(false);
    }
  }, [
    history,
    loadData,
    loadWeatherApiStatus,
    mergeIntoState,
    selectedPlaceId,
  ]);

  useEffect(() => {
    if (
      !autoRefresh ||
      !realtimeReading ||
      !selectedPlaceId ||
      String(realtimeReading.place_id) !== String(selectedPlaceId)
    ) {
      return;
    }

    mergeIntoState([realtimeReading], {
      expectedPlaceId: String(selectedPlaceId),
      expectedVersion: requestVersionRef.current,
    });
    consecutiveFailureRef.current = 0;
    setErrorMessage("");
    setSyncStatus("connected");
    setLastSyncedAt(new Date());
  }, [autoRefresh, mergeIntoState, realtimeReading, selectedPlaceId]);

  useEffect(() => {
    if (!autoRefresh || !selectedPlaceId || realtimeIsLive) {
      return undefined;
    }

    // jh 수정함 - 판정 기준을 "소켓 연결 여부"에서 "값이 실제로 들어오는지"로
    // 바꿨다. 소켓만 열려 있고 값이 안 오는 상태에서도 폴백이 꺼져 화면이
    // 낡아 보이던 문제(SensorRealtimeContext의 READING_STALE_AFTER_MS 참고).
    const timerId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        performRefreshCycle();
      }
    }, refreshSeconds * 1000);

    return () => window.clearInterval(timerId);
  }, [
    autoRefresh,
    performRefreshCycle,
    realtimeIsLive,
    refreshSeconds,
    selectedPlaceId,
  ]);

  useEffect(() => {
    if (!selectedPlaceId) return undefined;
    const timerId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadWeatherApiStatus();
      }
    }, 60 * 1000);
    return () => window.clearInterval(timerId);
  }, [loadWeatherApiStatus, selectedPlaceId]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (
        document.visibilityState === "visible" &&
        autoRefresh &&
        !realtimeIsLive
      ) {
        performRefreshCycle();
      }
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [autoRefresh, performRefreshCycle, realtimeIsLive]);

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }

    const timerId = window.setTimeout(() => setToastMessage(""), 3000);
    return () => window.clearTimeout(timerId);
  }, [toastMessage]);

  const latest = readings.at(-1) || null;
  const outdoorLatest = latest?.outdoorDataValid ? latest : null;
  const activeRange = RANGE_OPTIONS.find((option) => option.key === rangeKey);
  const displayedReadings = useMemo(() => {
    if (!activeRange?.milliseconds) {
      return readings;
    }

    const cutoff = Date.now() - activeRange.milliseconds;
    return readings.filter((record) => record.measuredAt.getTime() >= cutoff);
  }, [activeRange, readings, lastSyncedAt]);
  const connectionState = getConnectionState({
    latest,
    refreshSeconds,
    syncStatus,
  });
  const alerts = buildAlerts(latest, connectionState, logicThresholds);

  return (
    <div className="mypage-screen sensor-page-shell">
      <header className="mypage-mobile-topbar sensor-mobile-topbar">
        <button
          type="button"
          className="mypage-back-button"
          onClick={onBack}
          aria-label="메인으로 돌아가기"
        >
          ‹
        </button>
        <h1>센서 측정값</h1>
      </header>

      <div className="mypage-desktop-shell sensor-desktop-shell">
        <SharedAppSidebar
          nickname={nickname}
          renderProfileBadge={renderProfileBadge}
          activePage="sensors"
          onOpenDashboard={onBack}
          onOpenMyPage={onOpenMyPage}
          onOpenSensorReadings={() => {}}
          onStartTutorial={onStartTutorial}
          onLogout={onLogout}
        />

        <div className="sensor-page-workspace">
          <header className="sensor-page-header">
            <div className="sensor-page-header__title-group">
              <div>
                <div className="sensor-page-title-row">
                  <h1>실시간 센서 측정값</h1>
                  <span
                    className={`sensor-live-badge is-${connectionState.key} ${
                      newReadingPulse ? "is-pulsing" : ""
                    }`}
                  >
                    <i />
                    {connectionState.label}
                  </span>
                </div>
                <p>
                  센서와 날씨 데이터를 실시간으로 확인하고 변화 이력을 분석해
                  보세요.
                </p>
              </div>
            </div>

            {/* jh 수정함 - 데모용으로 상단 컨트롤(장소 선택/마지막 측정/
                실시간 확인/새로고침)을 화면에서만 숨긴다. 기능 자체는
                그대로 둬서 나중에 다시 보이게 하기 쉽게 한다. */}
            <div className="sensor-page-controls" style={{ display: "none" }}>
              <div className="sensor-location-control">
                <span>측정 장소</span>
                <LocationSwitcher />
              </div>

              <div className="sensor-last-update">
                <span>마지막 측정</span>
                <strong>
                  {latest ? formatDateTime(latest.measuredAt) : "측정 대기"}
                </strong>
              </div>

              <label className="sensor-auto-toggle">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(event) => setAutoRefresh(event.target.checked)}
                />
                <span className="sensor-auto-toggle__track" aria-hidden="true">
                  <i />
                </span>
                실시간 확인
              </label>

              <button
                type="button"
                className="sensor-refresh-button"
                onClick={() => {
                  loadData({
                    placeId: selectedPlaceIdRef.current,
                    version: requestVersionRef.current,
                  });
                  loadWeatherApiStatus({ forceRefresh: true });
                }}
                disabled={isRefreshing}
              >
                <span className={isRefreshing ? "is-spinning" : ""}>↻</span>
                {isRefreshing ? "불러오는 중" : "지금 새로고침"}
              </button>
            </div>
          </header>

          <main className="sensor-page-main" id="sensor-overview">
            {errorMessage && (
              <section className="sensor-error-banner" role="alert">
                <div>
                  <strong>센서 또는 날씨 API를 확인해 주세요.</strong>
                  <p>{errorMessage}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    loadData({
                      placeId: selectedPlaceIdRef.current,
                      version: requestVersionRef.current,
                    })
                  }
                >
                  다시 시도
                </button>
              </section>
            )}

            {locationLoadError ? (
              <section className="sensor-error-banner" role="alert">
                <div>
                  <strong>장소 정보를 불러오지 못했습니다.</strong>
                  <p>{locationLoadError}</p>
                </div>
              </section>
            ) : isLocationLoading ? (
              <section className="sensor-loading-state">
                <span className="sensor-loading-spinner" />
                <strong>등록된 장소를 확인하고 있어요.</strong>
                <p>측정값을 표시할 장소를 준비하는 중입니다.</p>
              </section>
            ) : !selectedLocation ? (
              <section className="sensor-empty-state sensor-location-empty">
                <span aria-hidden="true">🏠</span>
                <h2>측정할 장소가 없습니다.</h2>
                <p>먼저 마이페이지에서 장소와 에어컨을 등록해 주세요.</p>
                <LocationSwitcher />
              </section>
            ) : isInitialLoading && readings.length === 0 ? (
              <section className="sensor-loading-state">
                <span className="sensor-loading-spinner" />
                <strong>센서 기록을 불러오고 있어요.</strong>
                <p>선택한 장소의 최신 측정값을 확인하는 중입니다.</p>
              </section>
            ) : readings.length === 0 ? (
              <section className="sensor-empty-state">
                <span aria-hidden="true">📡</span>
                <h2>{selectedLocation.name}의 측정 기록이 없습니다.</h2>
                <p>
                  실내 센서값과 이 장소 좌표의 날씨 API 조회가 모두 성공하면
                  기록이 저장됩니다.
                </p>
              </section>
            ) : (
              <>
                <EnvironmentPanels
                  placeName={selectedLocation.name}
                  latest={latest}
                  outdoorLatest={outdoorLatest}
                  logicThresholds={logicThresholds}
                  selectedPlaceId={selectedPlaceId}
                />

                <SensorHistorySection
                  rangeKey={rangeKey}
                  onRangeKeyChange={setRangeKey}
                  displayedReadings={displayedReadings}
                  activeRange={activeRange}
                  logicThresholds={logicThresholds}
                  placeName={selectedLocation.name}
                />

                <section className="sensor-bottom-grid" id="sensor-records">
                  <SensorRecordsTable
                    displayedReadings={displayedReadings}
                    totalCount={readings.length}
                    rangeKey={rangeKey}
                  />

                  <SensorStatusPanels
                    latest={latest}
                    weatherStatus={weatherStatus}
                    weatherStatusError={weatherStatusError}
                    isWeatherStatusLoading={isWeatherStatusLoading}
                    alerts={alerts}
                  />
                </section>

                <section className="sensor-info-note">
                  <span>TIP</span>
                  <p>
                    현재 선택한 <strong>{selectedLocation.name}</strong>의 최근
                    최대 {HISTORY_LIMIT.toLocaleString("ko-KR")}건만
                    불러옵니다. 기간 버튼은 그중 실제 현재 시각 범위에
                    들어오는 기록만 표시하며, 기록이 없으면 다른 기간의
                    데이터를 대신 보여주지 않습니다. 실외값은 날씨 API 성공
                    결과만 저장하며 API 결과는 10분간 재사용합니다.
                  </p>
                </section>
              </>
            )}
          </main>
        </div>
      </div>

      {toastMessage && (
        <div className="sensor-toast" role="status">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
