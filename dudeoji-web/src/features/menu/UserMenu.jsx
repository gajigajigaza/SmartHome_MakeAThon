// src/features/menu/UserMenu.jsx
// 담당: 류은 (메뉴바 · 회원가입/로그인과 한 세트)
//
// 새싹 아이콘을 누르면 열리는 드롭다운입니다.
// "마이페이지"/"뱃지"/"로그아웃"은 이미 연결되어 있고,
// "센서 측정값"은 민주가 features/sensors 화면을 만들면
// onOpenSensorReadings prop만 연결하면 됩니다.
import { ProfileBadgeIcon } from "../../shared/profileBadges";

export default function UserMenu({
  nickname,
  currentProfileBadge,
  isOpen,
  onToggleOpen,
  onClose,
  connectionStatus,
  onOpenMyPage,
  onOpenSensorReadings,
  onOpenBadgePage,
  onStartTutorial,
  onLogout,
  isLoggingOut,
  isTutorialTarget,
}) {
  const connectionLabel =
    connectionStatus === "connected"
      ? "연결됨"
      : connectionStatus === "error"
        ? "연결 안 됨"
        : "확인 중";

  return (
    <div className="dashboard-profile-area">
      <button
        className={`dashboard-profile-button dashboard-avatar-menu-button ${
          isOpen ? "open" : ""
        } ${isTutorialTarget ? "tutorial-target" : ""}`}
        type="button"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="사용자 메뉴 열기"
      >
        <span className="dashboard-avatar-frame">
          <ProfileBadgeIcon
            badge={currentProfileBadge}
            className="dashboard-avatar-image"
          />
        </span>
      </button>

      <span className="dashboard-profile-name">{nickname}</span>

      <span
        className={`status-dot dashboard-status-dot ${connectionStatus}`}
        aria-label={connectionLabel}
        title={connectionLabel}
      />

      {isOpen && (
        <>
          <button
            className="dashboard-menu-backdrop"
            type="button"
            aria-label="메뉴 닫기"
            onClick={onClose}
          />

          <section
            className="dashboard-user-menu"
            role="menu"
            aria-label="사용자 메뉴"
          >
            <div className="dashboard-menu-profile">
              <strong>{nickname}님의 공간</strong>
              <p>오늘도 절전 중이에요!</p>
            </div>

            <div className="dashboard-menu-items">
              <button type="button" role="menuitem" onClick={onOpenMyPage}>
                <span>👤</span>
                <strong>마이페이지</strong>
                <em>›</em>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={onOpenSensorReadings}
              >
                <span>🌡️</span>
                <strong>센서 측정값</strong>
                <em>›</em>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => onOpenBadgePage("dashboard")}
              >
                <span>🏅</span>
                <strong>뱃지</strong>
                <em>›</em>
              </button>

              <button
                className="dashboard-menu-tutorial"
                type="button"
                role="menuitem"
                onClick={onStartTutorial}
              >
                <span>🌱</span>
                <strong>튜토리얼 다시 보기</strong>
                <em>›</em>
              </button>
            </div>

            <button
              className="dashboard-menu-logout"
              type="button"
              role="menuitem"
              onClick={onLogout}
              disabled={isLoggingOut}
            >
              <span>🚪</span>
              <strong>{isLoggingOut ? "로그아웃 중..." : "로그아웃"}</strong>
            </button>
          </section>
        </>
      )}
    </div>
  );
}
