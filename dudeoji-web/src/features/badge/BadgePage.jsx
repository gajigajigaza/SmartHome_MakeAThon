// jh 수정함 - 뱃지가 더 이상 로컬 하드코딩 배열이 아니라 GET /api/badges가
// 계산해준 잠금 여부/진행도를 그대로 쓴다(mergeBadgeStates로
// shared/profileBadges.jsx의 표시 메타데이터와 합침). 잠긴 카드에 커서를
// 올리면(또는 탭하면) 정확한 달성 조건 + 진행도를 보여주는 툴팁을 추가했다.
import { useEffect, useState } from "react";

import sproutMenuIcon from "../../assets/sprout-menu.svg";
import SharedAppSidebar from "../navigation/SharedAppSidebar";
import { getBadges } from "./badgesApi";
import { mergeBadgeStates } from "../../shared/profileBadges";

function formatProgress(badge, progress) {
  if (!progress) {
    return null;
  }

  if (badge.id.startsWith("power-hero")) {
    return `${progress.current.toFixed(2)} / ${progress.target}kWh`;
  }

  if (progress.target <= 1) {
    return null;
  }

  return `${progress.current} / ${progress.target}회`;
}

function BadgePage({
  nickname = "두더지",
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
  const [badges, setBadges] = useState(() => mergeBadgeStates([]));
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [openTooltipId, setOpenTooltipId] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setLoadError("");

    getBadges()
      .then((badgeStates) => {
        if (!isCancelled) {
          setBadges(mergeBadgeStates(badgeStates));
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setLoadError(
            String(error?.message || "뱃지 정보를 불러오지 못했어요."),
          );
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const selectedBadge = badges.find((badge) => badge.id === selectedBadgeId) || badges[0];
  const unlockedCount = badges.filter((badge) => badge.unlocked).length;
  const totalCount = badges.length;

  return (
    <div className="badge-page-screen">
      <header className="mypage-mobile-topbar badge-mobile-topbar">
        <button
          type="button"
          className="mypage-back-button"
          onClick={onBack}
          aria-label="메인으로 돌아가기"
        >
          ‹
        </button>
        <h1>프로필</h1>
        <span className="badge-mobile-topbar-count">
          {unlockedCount}/{totalCount}
        </span>
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
              <p>🏅 프로필</p>
              <h1>대표 아이콘을 골라요</h1>
              <span>
                두더지의 기능을 사용할수록 새 프로필이 열려요. 잠긴 프로필에
                커서를 올리면(또는 탭하면) 획득 방법이 보여요.
              </span>
            </div>

            <div className="badge-collection-count" role="status">
              <strong>
                {unlockedCount} / {totalCount}
              </strong>
              <span>개 프로필 수집</span>
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

          {loadError && (
            <div className="badge-load-error" role="alert">
              {loadError} · 최신 잠금 상태를 못 불러와 마지막으로 확인된 상태를 보여줘요.
            </div>
          )}

          <section
            className={`badge-grid ${isLoading ? "is-loading" : ""}`}
            aria-label="프로필 목록"
            aria-busy={isLoading}
          >
            {badges.map((badge) => {
              const isSelected = badge.id === selectedBadgeId;
              const isTooltipOpen = openTooltipId === badge.id;
              const progressText = formatProgress(badge, badge.progress);

              return (
                <button
                  type="button"
                  className={`badge-card ${isSelected ? "selected" : ""} ${!badge.unlocked ? "locked" : ""}`}
                  key={badge.id}
                  aria-describedby={!badge.unlocked ? `badge-tooltip-${badge.id}` : undefined}
                  onFocus={() => !badge.unlocked && setOpenTooltipId(badge.id)}
                  onBlur={() => setOpenTooltipId((current) => (current === badge.id ? null : current))}
                  onMouseEnter={() => !badge.unlocked && setOpenTooltipId(badge.id)}
                  onMouseLeave={() => setOpenTooltipId((current) => (current === badge.id ? null : current))}
                  onClick={() => {
                    if (!badge.unlocked) {
                      // 터치 기기는 hover가 없으니, 탭했을 때도 같은 툴팁을
                      // 토글해서 획득 조건을 볼 수 있게 한다.
                      setOpenTooltipId((current) => (current === badge.id ? null : badge.id));
                      return;
                    }

                    setOpenTooltipId(null);
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

                  {!badge.unlocked && (
                    <span
                      id={`badge-tooltip-${badge.id}`}
                      role="tooltip"
                      className={`badge-card-tooltip ${isTooltipOpen ? "is-open" : ""}`}
                    >
                      <strong>획득 방법</strong>
                      <p>{badge.requirement}</p>
                      {progressText && <em>{progressText}</em>}
                    </span>
                  )}
                </button>
              );
            })}
          </section>

          <div className="badge-page-note">
            <img src={sproutMenuIcon} alt="" aria-hidden="true" />
            <span>
              추천 수락·거절, 창문 환기, 에어컨 등록, 전력 절감처럼 두더지의 기능을 직접 써볼수록 새 프로필이 열려요.
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}

export default BadgePage;
