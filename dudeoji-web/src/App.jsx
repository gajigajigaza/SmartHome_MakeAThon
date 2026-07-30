/* eslint-disable no-unused-vars */
import { useEffect, useState } from "react";

import "./App.css";
import "./DashboardOverrides.css";
import {
  getLatestReading,
  getReadingHistory,
  refreshRecommendation,
} from "./features/sensors/readingsApi";
import { getStoredToken } from "./api";

import MyPage from "./features/mypage/MyPage";
import BadgePage from "./features/badge/BadgePage";
import CrawlingMole from "./features/background/CrawlingMole";
import UserMenu from "./features/menu/UserMenu";
import { TUTORIAL_STEPS, TutorialOverlay } from "./features/menu/Tutorial";
import RecommendationCard, {
  convertRecommendation,
} from "./features/dashboard/RecommendationCard";
import EnvironmentCard from "./features/location/EnvironmentCard";
import SavingsSummary from "./features/location/SavingsSummary";
import LocationSwitcher from "./features/location/LocationSwitcher";
// jh 수정함(2026-07-30) - "추천 시작" 전에도 하드웨어(ESP32 → 라즈베리파이 →
// 서버) 파이프라인을 바로 테스트할 수 있어야 해서, 헤더에도 다시 상시
// 노출한다. RecommendationCard 우측 상단(거절 후 수동 조작 영역)의
// HeaderQuickControls는 그대로 유지 — 같은 컴포넌트를 두 곳에서 각자
// 독립적으로 마운트하는 것뿐이라 상태 충돌은 없다.
import HeaderQuickControls from "./features/dashboard/HeaderQuickControls";
import OccupancyPredictionPopup from "./features/dashboard/OccupancyPredictionPopup";
// jh 수정함 - LocationSwitcher/EnvironmentCard가 각자 useSelectedLocation()을
// 따로 호출해서 서로 다른 위치를 가리키던 문제를 고치려고 Context를 추가했다.
import {
  LocationProvider,
  useLocationContext,
} from "./features/location/LocationContext";
import SensorReadings from "./features/sensors/SensorReadings";

// 우리가 제작한 설정 컴포넌트 및 자동제어 팝업 컴포넌트
// jh 수정함 - 자동제어 UI, 하드웨어 제어 연동 후 활성화 예정(팀 결정,
// 2026-07-26). 팝업이 스타일/포지셔닝 없이 페이지 하단에 생 텍스트로
// 렌더링되는 문제도 있어서, 재활성화 시 포지셔닝(모달/포탈)부터 손봐야 함.
// 파일 자체는 지우지 않음 — TEAM_STRUCTURE.md 참고.
// import RecommendationPopup from "./features/dashboard/RecommendationPopup";

import {
  ProfileBadgeIcon,
  getProfileBadgeById,
  getProfileBadgeStorageKey,
  getStoredProfileBadgeId,
} from "./shared/profileBadges";

function convertReading(backendReading) {
  return {
    id: backendReading.id,
    indoorTemperature: backendReading.indoor_temperature,
    indoorHumidity: backendReading.indoor_humidity,
    outdoorTemperature: backendReading.outdoor_temperature,
    outdoorHumidity: backendReading.outdoor_humidity,
    // jh 수정함 - EnvironmentCard의 실외 카드가 GET /api/weather 실시간 조회
    // 대신 이 reading의 실외값을 그대로 쓰도록 바꿨다(추천 판단에 쓴 값과
    // 표시값을 일치시키기 위함). 날씨 이모지에 필요한 weather_condition도 같이 넘긴다.
    weatherCondition: backendReading.weather_condition,
    recordedAt: new Date(backendReading.measured_at),
  };
}

function App({
  user = null,
  nickname = "두더지",
  onLogout,
  onUserUpdated,
  onAccountDeleted,
  showTutorialOnFirstVisit = false,
  onTutorialShown,
}) {
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [badgeReturnPage, setBadgeReturnPage] = useState("dashboard");
  const [readingHistory] = useState([]);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [dashboardToast, setDashboardToast] = useState("");
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [profileBadgeId, setProfileBadgeId] = useState(() =>
    getStoredProfileBadgeId(user),
  );

  const currentProfileBadge = getProfileBadgeById(profileBadgeId);

  // 사용자 세션의 토큰을 가져오는 장치
  // jh 수정함 - "access_token"이 아니라 api.js의 saveAuthToken()이 실제로
  // 쓰는 "dudeoji_auth_token" 키였다. 예전엔 항상 빈 문자열이라 자동제어
  // 팝업의 기기 제어 요청(RecommendationPopup.jsx)이 인증 없이 나가고 있었다.
  const currentToken = getStoredToken() || "";

  useEffect(() => {
    setProfileBadgeId(getStoredProfileBadgeId(user));
  }, [user?.username]);

  useEffect(() => {
    if (!showTutorialOnFirstVisit) {
      return;
    }

    setTutorialStepIndex(0);
    setIsTutorialOpen(true);
    localStorage.setItem("dudeoji-dashboard-tutorial-seen", "yes");
    onTutorialShown?.();
  }, [showTutorialOnFirstVisit, onTutorialShown]);

  useEffect(() => {
    function closeMenuWithEscape(event) {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
        setIsTutorialOpen(false);
      }
    }

    window.addEventListener("keydown", closeMenuWithEscape);

    return () => {
      window.removeEventListener("keydown", closeMenuWithEscape);
    };
  }, []);

  useEffect(() => {
    if (!dashboardToast) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setDashboardToast("");
    }, 2200);

    return () => window.clearTimeout(timerId);
  }, [dashboardToast]);

  async function handleLogoutClick() {
    if (!onLogout || isLoggingOut) return;

    setIsLoggingOut(true);

    try {
      await onLogout();
    } finally {
      setIsLoggingOut(false);
      setIsUserMenuOpen(false);
    }
  }

  function openMyPage() {
    setIsUserMenuOpen(false);
    setIsTutorialOpen(false);
    setCurrentPage("mypage");
  }

  function openDashboard() {
    setCurrentPage("dashboard");
    setBadgeReturnPage("dashboard");
  }

  function openBadgePage(returnPage = "dashboard") {
    setIsUserMenuOpen(false);
    setIsTutorialOpen(false);
    setBadgeReturnPage(returnPage);
    setCurrentPage("badges");
  }

  // 중략된 핸들러 로직들 유지
  function handleBadgeBack() {
    if (badgeReturnPage === "mypage") {
      setCurrentPage("mypage");
      return;
    }
    if (badgeReturnPage === "sensors") {
      setCurrentPage("sensors");
      return;
    }
    openDashboard();
  }

  function handleBadgeSelect(badgeId) {
    setProfileBadgeId(badgeId);
    localStorage.setItem(getProfileBadgeStorageKey(user), badgeId);

    if (badgeReturnPage === "mypage") {
      setCurrentPage("mypage");
    }
  }

  async function openSensorReadings() {
    setIsUserMenuOpen(false);
    setIsTutorialOpen(false);
    setCurrentPage("sensors");
  }

  function startTutorial() {
    setCurrentPage("dashboard");
    setIsUserMenuOpen(false);
    setTutorialStepIndex(0);
    setIsTutorialOpen(true);
  }

  function closeTutorial() {
    setIsTutorialOpen(false);
  }

  function moveToNextTutorialStep() {
    setTutorialStepIndex((previousIndex) =>
      Math.min(previousIndex + 1, TUTORIAL_STEPS.length - 1),
    );
  }

  function moveToPreviousTutorialStep() {
    setTutorialStepIndex((previousIndex) => Math.max(previousIndex - 1, 0));
  }

  if (currentPage === "mypage") {
    // jh 수정함 - MyPage의 "위치 정보" 섹션이 useLocationContext()를 쓰므로,
    // 대시보드 return과 마찬가지로 LocationProvider로 감싼다.
    return (
      <LocationProvider>
        <MyPage
          user={user}
          nickname={nickname}
          profileBadge={currentProfileBadge}
          renderProfileBadge={(className) => (
            <ProfileBadgeIcon badge={currentProfileBadge} className={className} />
          )}
          onBack={openDashboard}
          onOpenBadgePage={() => openBadgePage("mypage")}
          onOpenSensorReadings={openSensorReadings}
          onStartTutorial={startTutorial}
          onLogout={onLogout}
          onUserUpdated={onUserUpdated}
          onAccountDeleted={onAccountDeleted}
        />
      </LocationProvider>
    );
  }

  if (currentPage === "badges") {
    return (
      <BadgePage
        user={user}
        nickname={nickname}
        selectedBadgeId={profileBadgeId}
        onSelectBadge={handleBadgeSelect}
        onBack={handleBadgeBack}
        onOpenMyPage={openMyPage}
        onOpenSensorReadings={openSensorReadings}
        onOpenDashboard={openDashboard}
        onStartTutorial={startTutorial}
        onLogout={onLogout}
        renderProfileBadge={(className) => (
          <ProfileBadgeIcon badge={currentProfileBadge} className={className} />
        )}
        renderBadgeIcon={(badge, className) => (
          <ProfileBadgeIcon badge={badge} className={className} />
        )}
      />
    );
  }

  if (currentPage === "sensors") {
    return (
      <LocationProvider>
        <SensorReadings
          history={readingHistory}
          nickname={nickname}
          renderProfileBadge={(className) => (
            <ProfileBadgeIcon badge={currentProfileBadge} className={className} />
          )}
          onBack={openDashboard}
          onOpenMyPage={openMyPage}
          onOpenBadgePage={() => openBadgePage("sensors")}
          onStartTutorial={startTutorial}
          onLogout={handleLogoutClick}
        />
      </LocationProvider>
    );
  }

  return (
    // jh 수정함 - 대시보드 전체를 LocationProvider로 감싸서 LocationSwitcher/
    // EnvironmentCard/LocationListPanel이 같은 selectedLocation을 공유하게 한다.
    // DashboardHome이 그 Provider 안쪽 자식이라 useLocationContext()로 선택된
    // 장소를 읽어서 place_id를 API에 실어 보낼 수 있다(App 자신은 Provider를
    // 선언하는 쪽이라 같은 컨텍스트를 못 읽는다).
    <LocationProvider>
      <DashboardHome
        nickname={nickname}
        currentProfileBadge={currentProfileBadge}
        isUserMenuOpen={isUserMenuOpen}
        onToggleUserMenu={() => setIsUserMenuOpen((previous) => !previous)}
        onCloseUserMenu={() => setIsUserMenuOpen(false)}
        onOpenMyPage={openMyPage}
        onOpenSensorReadings={openSensorReadings}
        onOpenBadgePage={openBadgePage}
        onStartTutorial={startTutorial}
        onLogout={handleLogoutClick}
        isLoggingOut={isLoggingOut}
        isTutorialOpen={isTutorialOpen}
        tutorialStepIndex={tutorialStepIndex}
        onTutorialNext={moveToNextTutorialStep}
        onTutorialPrevious={moveToPreviousTutorialStep}
        onTutorialClose={closeTutorial}
        dashboardToast={dashboardToast}
        currentToken={currentToken}
      />
    </LocationProvider>
  );
}

// jh 수정함 - 예전엔 이 JSX가 App() 안에 그대로 있어서 selectedLocation을 몰랐다
// (App이 LocationProvider를 선언하는 쪽이라 자신의 Provider를 못 읽음). 대시보드
// 전용 데이터 패칭(sensorData/recommendation/updatedAt/connectionStatus)을 이
// 컴포넌트로 옮기고 useLocationContext()로 선택된 장소의 place_id를
// getLatestReading에 실어 보내서, 헤더에서 장소를 바꾸면 실내/추천 카드도 그
// 장소 것으로 즉시 갱신되게 했다(기존엔 실외 날씨만 위치를 따라갔음).
function DashboardHome({
  nickname,
  currentProfileBadge,
  isUserMenuOpen,
  onToggleUserMenu,
  onCloseUserMenu,
  onOpenMyPage,
  onOpenSensorReadings,
  onOpenBadgePage,
  onStartTutorial,
  onLogout,
  isLoggingOut,
  isTutorialOpen,
  tutorialStepIndex,
  onTutorialNext,
  onTutorialPrevious,
  onTutorialClose,
  dashboardToast,
  currentToken,
}) {
  const { selectedLocation } = useLocationContext();
  const selectedPlaceId = selectedLocation?.id ?? null;

  const [sensorData, setSensorData] = useState(null);
  const [recommendation, setRecommendation] = useState(
    convertRecommendation(null),
  );
  // 팝업 모달창에 그대로 넘겨줄 백엔드 오리지널 추천 상태
  const [rawRecommendation, setRawRecommendation] = useState(null);
  // 💡 사용자가 현재 자동제어 팝업을 보고 있는 중인지 판별하는 상태 (리셋 방지용)
  const [isPopupActive, setIsPopupActive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("checking");
  // jh 수정함 - "추천 시작" 버튼(추천카드.png)을 눌렀는지 여부. 새로 fetch를
  // 트리거하지 않고, 이미 불러와져 있는 recommendation을 그제서야 화면에
  // 노출하는 순수 UI 상태다. 장소를 바꾸면 그 장소의 추천을 다시 확인하도록
  // 리셋한다(아래 useEffect).
  const [hasStartedRecommendation, setHasStartedRecommendation] =
    useState(false);
  // jh 추가 - 지금 화면에 "고정"돼 있는 추천이 언제부터 유지됐는지. "다시
  // 추천받기"를 누를 때 이 시점부터 지금까지의 시간을 held_seconds로 백엔드에
  // 남긴다(recommendationRefreshApi 참고).
  const [recommendationShownAt, setRecommendationShownAt] = useState(null);
  // jh 추가 - RecommendationCard에 넘기는 readingKey. 예전엔 60초 폴링이
  // 새 reading을 받아올 때마다 바뀌어서 카운트다운이 제멋대로 재시작됐는데,
  // 지금은 최초 로드/장소 전환/"다시 추천받기" 클릭 시에만 바뀐다 — 그 사이엔
  // 센서값(sensorData)이 폴링으로 계속 갱신돼도 추천 카드는 그대로 유지된다.
  const [pinnedReadingKey, setPinnedReadingKey] = useState(0);
  // jh 추가 - 지금 고정된 추천의 근거가 된 실측 시각(reading.measured_at).
  // updatedAt은 60초 폴링마다 계속 갱신되지만(센서값 표시용), 이건 recommendation이
  // 실제로 새로 고정된 순간에만 바뀐다 — RecommendationCard가 "이 추천, 언제 기준"을
  // 보여줄 때 updatedAt을 쓰면 폴링 때문에 실제보다 신선해 보이는 착시가 생긴다.
  const [recommendationMeasuredAt, setRecommendationMeasuredAt] = useState(null);

  // 백엔드 API로부터 선택된 장소의 최신 추천 데이터를 한 번 읽어오는 핵심 함수.
  // pinRecommendation=true일 때만 RecommendationCard가 보는 추천/카운트다운
  // 트리거(recommendation/rawRecommendation/pinnedReadingKey)를 갱신한다.
  // 60초 폴링은 pinRecommendation=false로 호출해 sensorData(온습도 표시)만
  // 조용히 새로고침한다.
  async function loadLatestReading(pinRecommendation = true) {
    try {
      const latestBackendReading = await getLatestReading(selectedPlaceId);
      const latestReading = convertReading(latestBackendReading);

      setSensorData({
        indoorTemperature: latestReading.indoorTemperature,
        indoorHumidity: latestReading.indoorHumidity,
        outdoorTemperature: latestReading.outdoorTemperature,
        outdoorHumidity: latestReading.outdoorHumidity,
        weatherCondition: latestReading.weatherCondition,
      });
      setUpdatedAt(latestReading.recordedAt);
      setConnectionStatus("connected");

      if (!pinRecommendation) {
        return;
      }

      if (latestBackendReading && latestBackendReading.recommendation) {
        setRawRecommendation(latestBackendReading.recommendation);
      }
      setRecommendation(
        convertRecommendation(latestBackendReading.recommendation),
      );
      setRecommendationShownAt(new Date());
      setRecommendationMeasuredAt(latestReading.recordedAt);
      setPinnedReadingKey((previous) => previous + 1);
    } catch (error) {
      if (error.message.includes("저장된 센서 기록이 없습니다")) {
        setSensorData(null);
        setUpdatedAt(null);
        setConnectionStatus("connected");
        if (pinRecommendation) {
          setRawRecommendation(null);
          setRecommendation(convertRecommendation(null));
          setRecommendationShownAt(new Date());
          setRecommendationMeasuredAt(null);
          setPinnedReadingKey((previous) => previous + 1);
        }
        return;
      }
      setConnectionStatus("error");
    }
  }

  // jh 추가 - "다시 추천받기" 버튼 클릭 시 App.jsx가 하는 일: 이전 추천을
  // 얼마나 유지했는지/어떤 결과로 끝났는지 백엔드에 기록하고, 그 자리에서 바로
  // 최신 추천을 받아와 화면에 고정한다.
  async function handleRequestNewRecommendation({ previousAction, outcome }) {
    const response = await refreshRecommendation(
      selectedPlaceId,
      previousAction,
      outcome,
      recommendationShownAt || new Date(),
    );

    const latestReading = convertReading(response);
    setSensorData({
      indoorTemperature: latestReading.indoorTemperature,
      indoorHumidity: latestReading.indoorHumidity,
      outdoorTemperature: latestReading.outdoorTemperature,
      outdoorHumidity: latestReading.outdoorHumidity,
      weatherCondition: latestReading.weatherCondition,
    });
    setUpdatedAt(latestReading.recordedAt);
    setConnectionStatus("connected");
    setRawRecommendation(response.recommendation);
    setRecommendation(convertRecommendation(response.recommendation));
    setRecommendationShownAt(new Date());
    setRecommendationMeasuredAt(latestReading.recordedAt);
    setPinnedReadingKey((previous) => previous + 1);
  }

  // 💡 [개선 완료] 주기적 갱신 타이머 로직
  useEffect(() => {
    // 최초 화면 로드 시, 그리고 선택된 장소가 바뀔 때마다 한 번 실행 —
    // 이때는 추천 카드도 그 장소의 최신 추천으로 고정한다.
    loadLatestReading(true);

    // 팝업이 켜져 있는 동안에는 주기적 데이터 로드를 잠시 중단합니다.
    if (isPopupActive) {
      console.log("자동 제어 판단 팝업 작동 중: 주기적 추천 데이터 갱신을 잠시 중단합니다.");
      return undefined;
    }

    // 1분(60000ms)마다 백엔드에 새로운 날씨 정보가 있는지 요청하는 타이머 작동.
    // 여기서는 sensorData(온습도 표시)만 갱신하고, 추천 카드는 사용자가
    // "다시 추천받기"를 누르기 전까지 그대로 유지한다.
    const updateInterval = setInterval(() => {
      console.log("60초 도래: 백엔드로부터 최신 센서값을 조용히 업데이트합니다.");
      loadLatestReading(false);
    }, 60000);

    // 컴포넌트가 꺼지거나 상태가 바뀔 때 작동 중이던 타이머를 깨끗이 청소합니다.
    return () => {
      clearInterval(updateInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlaceId, isPopupActive]); // 선택된 장소나 isPopupActive가 바뀔 때마다 다시 불러옵니다.

  // jh 수정함 - 장소를 바꾸면 이전 장소 기준으로 이미 "추천 시작"을 눌렀던
  // 상태가 남아있지 않도록, 선택된 장소가 바뀔 때마다 대기 화면으로 되돌린다.
  useEffect(() => {
    setHasStartedRecommendation(false);
  }, [selectedPlaceId]);

  const tutorialStepKey = isTutorialOpen
    ? TUTORIAL_STEPS[tutorialStepIndex].key
    : "";
  const isIconTutorialStep =
    tutorialStepKey === "menu" || tutorialStepKey === "again";

  return (
    <div
      className={`app ${
        isTutorialOpen ? `tutorial-open tutorial-step-${tutorialStepKey}` : ""
      }`}
    >
      <CrawlingMole />

      <header
        className={`header dashboard-header ${
          isIconTutorialStep ? "tutorial-header" : ""
        }`}
      >
        <UserMenu
          nickname={nickname}
          currentProfileBadge={currentProfileBadge}
          isOpen={isUserMenuOpen}
          onToggleOpen={onToggleUserMenu}
          onClose={onCloseUserMenu}
          connectionStatus={connectionStatus}
          onOpenMyPage={onOpenMyPage}
          onOpenSensorReadings={onOpenSensorReadings}
          onOpenBadgePage={onOpenBadgePage}
          onStartTutorial={onStartTutorial}
          onLogout={onLogout}
          isLoggingOut={isLoggingOut}
          isTutorialTarget={isIconTutorialStep}
        />

        <HeaderQuickControls />

        <LocationSwitcher />
      </header>

      <main>
        <section className="top-grid dashboard-main-grid">
          <RecommendationCard
            recommendation={recommendation}
            isTutorialTarget={isTutorialOpen && tutorialStepIndex === 1}
            hasStarted={hasStartedRecommendation}
            onStart={() => setHasStartedRecommendation(true)}
            placeId={selectedPlaceId}
            readingKey={pinnedReadingKey}
            onRequestNewRecommendation={handleRequestNewRecommendation}
            measuredAt={recommendationMeasuredAt}
          />

          <div className="flex-layout-column" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <EnvironmentCard
              sensorData={sensorData}
              updatedAt={updatedAt}
              isTutorialTarget={isTutorialOpen && tutorialStepIndex === 2}
              // jh 수정함 - 테스트 모드 "가짜 데이터 받기" 버튼이 저장 후 화면을
              // 갱신할 때 기존 loadLatestReading()을 그대로 재사용하도록 전달
              onMockReadingCreated={loadLatestReading}
            >
              <SavingsSummary placeId={selectedPlaceId} />
            </EnvironmentCard>

          </div>
        </section>
      </main>

      {dashboardToast && (
        <div className="dashboard-toast" role="status" aria-live="polite">
          {dashboardToast}
        </div>
      )}

      {isTutorialOpen && (
        <TutorialOverlay
          step={TUTORIAL_STEPS[tutorialStepIndex]}
          stepIndex={tutorialStepIndex}
          totalSteps={TUTORIAL_STEPS.length}
          onNext={onTutorialNext}
          onPrevious={onTutorialPrevious}
          onClose={onTutorialClose}
        />
      )}

      {/* jh 수정함 - 자동제어 UI, 하드웨어 제어 연동 후 활성화 예정(팀 결정,
          2026-07-26). RecommendationPopup.jsx 파일은 보존, 마운트만 제거.
      <RecommendationPopup
        recommendation={rawRecommendation}
        currentToken={currentToken}
        setIsPopupActive={setIsPopupActive}
        placeId={selectedPlaceId}
      />
      */}

      <OccupancyPredictionPopup
        placeId={selectedPlaceId}
        isPaused={isTutorialOpen}
        setIsPopupActive={setIsPopupActive}
      />
    </div>
  );
}

export default App;