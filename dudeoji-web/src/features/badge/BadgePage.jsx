import { useEffect, useState } from "react";

import sproutMenuIcon from "../../assets/sprout-menu.svg";
import SharedAppSidebar from "../navigation/SharedAppSidebar";

function BadgePage({
  nickname = "두더지",
  badges,
  selectedBadgeId,
  onSelectBadge,
  onBack,
  onOpenMyPage,
  onOpenSensorReadings,
  onOpenDashboard,
  onStartTutorial,
  onLogout,
  renderProfileBadge,
  renderBadgeIcon,
}) {
  const [toastMessage, setToastMessage] = useState("");

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setToastMessage("");
    }, 2200);

    return () => window.clearTimeout(timerId);
  }, [toastMessage]);

  function showToast(message) {
    setToastMessage(message);
  }

  const selectedBadge = badges.find((badge) => badge.id === selectedBadgeId) || badges[0];

  return (
    <div className="badge-page-screen">
      {toastMessage && (
        <div className="mypage-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}

      <header className="mypage-mobile-topbar badge-mobile-topbar">
        <button
          type="button"
          className="mypage-back-button"
          onClick={onBack}
          aria-label="메인으로 돌아가기"
        >
          ‹
        </button>
        <h1>뱃지</h1>
      </header>

      <div className="badge-desktop-shell">
        <SharedAppSidebar
          nickname={nickname}
          renderProfileBadge={renderProfileBadge}
          activePage="badges"
          onOpenDashboard={onOpenDashboard || onBack}
          onOpenMyPage={onOpenMyPage}
          onOpenSensorReadings={onOpenSensorReadings}
          onOpenBadgePage={() => {}}
          onStartTutorial={onStartTutorial}
          onLogout={onLogout}
          className="badge-sidebar"
        />

        <main className="badge-main-panel">
          <header className="badge-page-header">
            <button
              type="button"
              className="badge-back-button"
              onClick={onBack}
              aria-label="메인으로 돌아가기"
            >
              ‹
            </button>

            <div>
              <p>🏅 뱃지</p>
              <h1>대표 아이콘을 골라요</h1>
              <span>
                얻은 뱃지는 메인 페이지와 마이페이지의 대표 아이콘으로 설정할 수 있어요.
              </span>
            </div>
          </header>

          <section className="badge-current-card">
            <div className="badge-current-icon">
              {renderBadgeIcon(selectedBadge, "badge-current-image")}
            </div>
            <div>
              <strong>현재 대표 아이콘</strong>
              <p>
                기본값은 메인 페이지에서 쓰는 새싹이에요. 아래 뱃지를 누르면 대표 아이콘이 바뀌어요.
              </p>
            </div>
          </section>

          <section className="badge-grid" aria-label="뱃지 목록">
            {badges.map((badge) => {
              const isSelected = badge.id === selectedBadgeId;

              return (
                <button
                  type="button"
                  className={`badge-card ${isSelected ? "selected" : ""} ${!badge.unlocked ? "locked" : ""}`}
                  key={badge.id}
                  onClick={() => {
                    if (!badge.unlocked) {
                      showToast("아직 잠겨 있는 뱃지예요. 나중에 절전 기록 기능과 연결할게요.");
                      return;
                    }

                    onSelectBadge(badge.id);
                  }}
                >
                  <span className="badge-card-icon">
                    {renderBadgeIcon(badge, "badge-card-image")}
                  </span>

                  <span className="badge-card-text">
                    <strong>{badge.name}</strong>
                    <small>{badge.description}</small>
                  </span>

                  <em>
                    {isSelected ? "사용 중" : badge.unlocked ? "설정" : "잠김"}
                  </em>
                </button>
              );
            })}
          </section>

          <div className="badge-page-note">
            <img src={sproutMenuIcon} alt="" aria-hidden="true" />
            <span>
              지금은 예시 뱃지 몇 개만 넣어둔 상태예요. 나중에 절전량, 센서 기록, 게임 기록과 연결하면 자동으로 잠금 해제되게 만들 수 있어요.
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}

export default BadgePage;
