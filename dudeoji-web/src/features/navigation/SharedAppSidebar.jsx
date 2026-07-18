import "../../FlowApp.css";

// 마이페이지·센서 측정값·뱃지 화면이 함께 사용하는 공통 사이드바입니다.
function SidebarButton({ icon, label, active = false, danger = false, onClick }) {
  return (
    <button
      type="button"
      className={`mypage-sidebar-link ${active ? "active" : ""} ${danger ? "danger" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <span aria-hidden="true">{icon}</span>
      <strong>{label}</strong>
    </button>
  );
}

export default function SharedAppSidebar({
  nickname = "두더지",
  renderProfileBadge,
  activePage,
  onOpenDashboard,
  onOpenMyPage,
  onOpenSensorReadings,
  onOpenBadgePage,
  onStartTutorial,
  onLogout,
  className = "",
}) {
  return (
    <aside
      className={`mypage-sidebar ${className}`.trim()}
      aria-label="두더지 공통 메뉴"
    >
      <div className="mypage-sidebar-profile">
        <button
          type="button"
          className="mypage-sidebar-home-icon-button"
          onClick={onOpenDashboard}
          aria-label="대시보드로 이동"
        >
          {renderProfileBadge?.("mypage-sidebar-badge-image")}
        </button>

        <div>
          <strong>{nickname}</strong>
          <span aria-label="접속 중">●</span>
        </div>
      </div>

      <nav className="mypage-sidebar-nav">
        <SidebarButton
          icon="👤"
          label="마이페이지"
          active={activePage === "mypage"}
          onClick={activePage === "mypage" ? undefined : onOpenMyPage}
        />
        <SidebarButton
          icon="🌡️"
          label="센서 측정값"
          active={activePage === "sensors"}
          onClick={activePage === "sensors" ? undefined : onOpenSensorReadings}
        />
        <SidebarButton
          icon="🏅"
          label="뱃지"
          active={activePage === "badges"}
          onClick={activePage === "badges" ? undefined : onOpenBadgePage}
        />
        <SidebarButton
          icon="📖"
          label="튜토리얼 다시 보기"
          onClick={onStartTutorial}
        />
      </nav>

      <div className="mypage-sidebar-divider" />

      <SidebarButton
        icon="🚪"
        label="로그아웃"
        danger
        onClick={onLogout}
      />
    </aside>
  );
}
