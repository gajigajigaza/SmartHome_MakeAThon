/* eslint-disable no-unused-vars */
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

// 우리가 제작한 설정 컴포넌트 및 자동제어 팝업 컴포넌트
import CooldownSettings from "./features/places/CooldownSettings";
import RecommendationPopup from "./features/dashboard/RecommendationPopup";

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
  
  // 팝업 모달창에 그대로 넘겨줄 백엔드 오리지널 추천 상태
  const [rawRecommendation, setRawRecommendation] = useState(null);

  // 💡 사용자가 현재 자동제어 팝업을 보고 있는 중인지 판별하는 상태 (리셋 방지용)
  const [isPopupActive, setIsPopupActive] = useState(false);

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

  // 사용자 세션의 토큰을 가져오는 장치
  const currentToken = localStorage.getItem("access_token") || "";

  useEffect(() => {
    setProfileBadgeId(getStoredProfileBadgeId(user));
  }, [user?.username]);

  // 백엔드 API로부터 최신 추천 데이터를 한 번 읽어오는 핵심 함수
  async function loadLatestReading() {
    try {
      const latestBackendReading = await getLatestReading();
      const latestReading = convertReading(latestBackendReading);

      setSensorData({
        indoorTemperature: latestReading.indoorTemperature,
        indoorHumidity: latestReading.indoorHumidity,
        outdoorTemperature: latestReading.outdoorTemperature,
        outdoorHumidity: latestReading.outdoorHumidity,
      });

      if (latestBackendReading && latestBackendReading.recommendation) {
        setRawRecommendation(latestBackendReading.recommendation);
      }

      setRecommendation(
        convertRecommendation(latestBackendReading.recommendation),
      );
      setUpdatedAt(latestReading.recordedAt);
      setConnectionStatus("connected");
    } catch (error) {
      if (error.message.includes("저장된 센서 기록이 없습니다")) {
        setSensorData(null);
        setRawRecommendation(null);
        setRecommendation(convertRecommendation(null));
        setUpdatedAt(null);
        setConnectionStatus("connected");
        return;
      }
      setConnectionStatus("error");
    }
  }

  // 💡 [개선 완료] 주기적 갱신 타이머 로직
  useEffect(() => {
    // 최초 화면 로드 시 한 번 실행
    loadLatestReading();

    // 팝업이 켜져 있는 동안에는 주기적 데이터 로드를 잠시 중단합니다.
    if (isPopupActive) {
      console.log("자동 제어 판단 팝업 작동 중: 주기적 추천 데이터 갱신을 잠시 중단합니다.");
      return undefined;
    }

    // 1분(60000ms)마다 백엔드에 새로운 날씨 정보가 있는지 요청하는 타이머 작동
    const updateInterval = setInterval(() => {
      console.log("60초 도래: 백엔드로부터 최신 환경 추천 정보를 업데이트합니다.");
      loadLatestReading();
    }, 60000);

    // 컴포넌트가 꺼지거나 상태가 바뀔 때 작동 중이던 타이머를 깨끗이 청소합니다.
    return () => {
      clearInterval(updateInterval);
    };
  }, [isPopupActive]); // isPopupActive 상태가 변할 때마다 타이머를 켰다 껐다 조절합니다.

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

        <LocationSwitcher />
      </header>

      <main>
        <section className="top-grid dashboard-main-grid">
          <RecommendationCard
            recommendation={recommendation}
            isTutorialTarget={isTutorialOpen && tutorialStepIndex === 1}
          />

          <div className="flex-layout-column" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <EnvironmentCard
              sensorData={sensorData}
              updatedAt={updatedAt}
              isTutorialTarget={isTutorialOpen && tutorialStepIndex === 2}
            >
              <SavingsSummary />
            </EnvironmentCard>

            <CooldownSettings 
              placeId={1} 
              currentToken={currentToken} 
            />
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
          onNext={moveToNextTutorialStep}
          onPrevious={moveToPreviousTutorialStep}
          onClose={closeTutorial}
        />
      )}

      {/* 💡 팝업 활성화 상태 여부를 감지할 수 있도록 콜백(setIsPopupActive)을 함께 전달합니다. */}
      <RecommendationPopup 
        recommendation={rawRecommendation} 
        currentToken={currentToken}
        setIsPopupActive={setIsPopupActive}
      />
    </div>
    </LocationProvider>
  );
}

export default App;