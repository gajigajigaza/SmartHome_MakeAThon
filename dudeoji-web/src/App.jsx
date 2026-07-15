import { useEffect, useState } from "react";

import "./App.css";
import "./DashboardOverrides.css";
import { getLatestReading, getReadingHistory } from "./features/sensors/readingsApi";

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
// jh 수정함 - LocationSwitcher/EnvironmentCard가 각자 useSelectedLocation()을
// 따로 호출해서 서로 다른 위치를 가리키던 문제를 고치려고 Context를 추가했다.
import { LocationProvider } from "./features/location/LocationContext";
import SensorReadings from "./features/sensors/SensorReadings";
import {
  ProfileBadgeIcon,
  PROFILE_BADGES,
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
  const [sensorData, setSensorData] = useState(null);
  const [recommendation, setRecommendation] = useState(
    convertRecommendation(null),
  );
  const [readingHistory, setReadingHistory] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("checking");
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [dashboardToast, setDashboardToast] = useState("");
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [profileBadgeId, setProfileBadgeId] = useState(() =>
    getStoredProfileBadgeId(user),
  );

  const currentProfileBadge = getProfileBadgeById(profileBadgeId);

  useEffect(() => {
    setProfileBadgeId(getStoredProfileBadgeId(user));
  }, [user?.username]);

  // 대시보드에 필요한 "가장 최근 값 1건"을 불러온다.
  useEffect(() => {
    let ignoreResult = false;

    async function loadLatestReading() {
      try {
        const latestBackendReading = await getLatestReading();

        if (ignoreResult) return;

        const latestReading = convertReading(latestBackendReading);

        setSensorData({
          indoorTemperature: latestReading.indoorTemperature,
          indoorHumidity: latestReading.indoorHumidity,
          outdoorTemperature: latestReading.outdoorTemperature,
          outdoorHumidity: latestReading.outdoorHumidity,
        });
        setRecommendation(
          convertRecommendation(latestBackendReading.recommendation),
        );
        setUpdatedAt(latestReading.recordedAt);
        setConnectionStatus("connected");
      } catch (error) {
        if (ignoreResult) return;

        // 센서 기록이 없는 것은 서버 연결 실패가 아니므로 초록 점으로 표시한다.
        if (error.message.includes("저장된 센서 기록이 없습니다")) {
          setSensorData(null);
          setRecommendation(convertRecommendation(null));
          setUpdatedAt(null);
          setConnectionStatus("connected");
          return;
        }

        setConnectionStatus("error");
      }
    }

    loadLatestReading();

    return () => {
      ignoreResult = true;
    };
  }, []);

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

  function handleBadgeBack() {
    if (badgeReturnPage === "mypage") {
      setCurrentPage("mypage");
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

  // 담당: 민주 - 센서 측정값 화면. 처음 열 때만 이력을 불러온다.
  async function openSensorReadings() {
    setIsUserMenuOpen(false);
    setIsTutorialOpen(false);
    setCurrentPage("sensors");

    try {
      const history = await getReadingHistory(24);
      setReadingHistory(history.map(convertReading));
    } catch (error) {
      setDashboardToast(`센서 기록을 불러오지 못했어요: ${error.message}`);
    }
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
    return (
      <MyPage
        user={user}
        nickname={nickname}
        profileBadge={currentProfileBadge}
        renderProfileBadge={(className) => (
          <ProfileBadgeIcon badge={currentProfileBadge} className={className} />
        )}
        onBack={openDashboard}
        onOpenBadgePage={() => openBadgePage("mypage")}
        onStartTutorial={startTutorial}
        onLogout={onLogout}
        onUserUpdated={onUserUpdated}
        onAccountDeleted={onAccountDeleted}
      />
    );
  }

  if (currentPage === "badges") {
    return (
      <BadgePage
        user={user}
        nickname={nickname}
        badges={PROFILE_BADGES}
        selectedBadgeId={profileBadgeId}
        onSelectBadge={handleBadgeSelect}
        onBack={handleBadgeBack}
        onOpenMyPage={openMyPage}
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
      <SensorReadings history={readingHistory} onBack={openDashboard} />
    );
  }

  const tutorialStepKey = isTutorialOpen
    ? TUTORIAL_STEPS[tutorialStepIndex].key
    : "";
  const isIconTutorialStep =
    tutorialStepKey === "menu" || tutorialStepKey === "again";

  return (
    // jh 수정함 - 대시보드 전체를 LocationProvider로 감싸서 LocationSwitcher/
    // EnvironmentCard/LocationListPanel이 같은 selectedLocation을 공유하게 한다.
    <LocationProvider>
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
          onToggleOpen={() => setIsUserMenuOpen((previous) => !previous)}
          onClose={() => setIsUserMenuOpen(false)}
          connectionStatus={connectionStatus}
          onOpenMyPage={openMyPage}
          onOpenSensorReadings={openSensorReadings}
          onOpenBadgePage={openBadgePage}
          onStartTutorial={startTutorial}
          onLogout={handleLogoutClick}
          isLoggingOut={isLoggingOut}
          isTutorialTarget={isIconTutorialStep}
        />

        {/* 담당: 정현(나) - 위치 추가 / 실외 날씨 (좌측 상단) */}
        <LocationSwitcher />
      </header>

      <main>
        <section className="top-grid dashboard-main-grid">
          <RecommendationCard
            recommendation={recommendation}
            isTutorialTarget={isTutorialOpen && tutorialStepIndex === 1}
          />

          <EnvironmentCard
            sensorData={sensorData}
            updatedAt={updatedAt}
            isTutorialTarget={isTutorialOpen && tutorialStepIndex === 2}
          >
            <SavingsSummary />
          </EnvironmentCard>
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
          onNext={moveToNextTutorialStep}
          onPrevious={moveToPreviousTutorialStep}
          onClose={closeTutorial}
        />
      )}
    </div>
    </LocationProvider>
  );
}

export default App;
