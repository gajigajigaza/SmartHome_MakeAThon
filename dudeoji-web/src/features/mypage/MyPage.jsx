import { useEffect, useMemo, useState } from "react";

import {
  deleteMyAccount,
  updateMyNickname,
  updateMyPassword,
  updateMyRecovery,
} from "../auth/authApi";
import { fetchMyPlaces } from "../places/placesApi";

const RECOVERY_ITEMS = [
  { value: "acorn", icon: "🌰" },
  { value: "leaf", icon: "🍃" },
  { value: "ice", icon: "🧊" },
  { value: "bulb", icon: "💡" },
  { value: "shovel", icon: "🪏" },
  { value: "wind", icon: "🌀" },
];

function formatDate(value) {
  if (!value) {
    return "등록일 확인 중";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "등록일 확인 중";
  }

  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatPower(value) {
  if (!value) {
    return "전력 정보 없음";
  }

  return `${Number(value).toLocaleString("ko-KR")} W`;
}

function MyPageRow({ icon, title, description, danger = false, onClick }) {
  return (
    <button
      type="button"
      className={`mypage-row ${danger ? "danger" : ""}`}
      onClick={onClick}
    >
      <span className="mypage-row-icon">{icon}</span>
      <span className="mypage-row-text">
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
      <span className="mypage-row-arrow">›</span>
    </button>
  );
}

function SidebarButton({ icon, label, active = false, danger = false, onClick }) {
  return (
    <button
      type="button"
      className={`mypage-sidebar-link ${active ? "active" : ""} ${danger ? "danger" : ""}`}
      onClick={onClick}
    >
      <span>{icon}</span>
      <strong>{label}</strong>
    </button>
  );
}

function MyPageModal({ title, description, children, onClose }) {
  return (
    <div className="mypage-modal-backdrop" role="presentation">
      <section
        className="mypage-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mypage-modal-header">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>

          <button type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        {children}
      </section>
    </div>
  );
}

function MyPage({
  user,
  nickname = "두더지",
  renderProfileBadge,
  onBack,
  onOpenBadgePage,
  onStartTutorial,
  onLogout,
  onUserUpdated,
  onAccountDeleted,
}) {
  const [places, setPlaces] = useState([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(true);
  const [placeError, setPlaceError] = useState("");

  const [activeModal, setActiveModal] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const [nicknameDraft, setNicknameDraft] = useState(nickname);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    newPasswordConfirm: "",
  });
  const [recoveryForm, setRecoveryForm] = useState({
    currentPassword: "",
    item: RECOVERY_ITEMS[0].value,
    pin: "",
  });
  const [deleteForm, setDeleteForm] = useState({
    password: "",
    confirmText: "",
  });

  useEffect(() => {
    let ignoreResult = false;

    async function loadPlaces() {
      setIsLoadingPlaces(true);
      setPlaceError("");

      try {
        const result = await fetchMyPlaces();

        if (!ignoreResult) {
          setPlaces(result || []);
        }
      } catch (error) {
        if (!ignoreResult) {
          setPlaceError(error.message);
        }
      } finally {
        if (!ignoreResult) {
          setIsLoadingPlaces(false);
        }
      }
    }

    loadPlaces();

    return () => {
      ignoreResult = true;
    };
  }, []);

  useEffect(() => {
    setNicknameDraft(nickname);
  }, [nickname]);

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setToastMessage("");
    }, 2200);

    return () => window.clearTimeout(timerId);
  }, [toastMessage]);

  const firstPlace = places[0] || null;

  const allAircons = useMemo(
    () =>
      places.flatMap((place) =>
        (place.aircons || []).map((aircon) => ({
          ...aircon,
          placeName: place.name,
        })),
      ),
    [places],
  );

  function showToast(message) {
    setToastMessage(message);
  }

  function showComingSoon(featureName) {
    showToast(`${featureName} 기능은 다음 단계에서 연결할게요.`);
  }

  function openNicknameModal() {
    setNicknameDraft(nickname);
    setActiveModal("nickname");
  }

  function openPasswordModal() {
    setPasswordForm({
      currentPassword: "",
      newPassword: "",
      newPasswordConfirm: "",
    });
    setActiveModal("password");
  }

  function openRecoveryModal() {
    setRecoveryForm({
      currentPassword: "",
      item: RECOVERY_ITEMS[0].value,
      pin: "",
    });
    setActiveModal("recovery");
  }

  function openDeleteModal() {
    setDeleteForm({
      password: "",
      confirmText: "",
    });
    setActiveModal("delete");
  }

  function closeModal() {
    if (isSubmitting) {
      return;
    }

    setActiveModal(null);
  }

  async function handleNicknameSubmit(event) {
    event.preventDefault();

    const trimmedNickname = nicknameDraft.trim();

    if (!trimmedNickname) {
      showToast("별명을 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      const updatedUser = await updateMyNickname(trimmedNickname);
      onUserUpdated?.(updatedUser);
      setActiveModal(null);
      showToast("별명이 변경되었습니다.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();

    if (!passwordForm.currentPassword) {
      showToast("현재 비밀번호를 입력해 주세요.");
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      showToast("새 비밀번호는 8자 이상으로 입력해 주세요.");
      return;
    }

    if (passwordForm.newPassword !== passwordForm.newPasswordConfirm) {
      showToast("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setIsSubmitting(true);

    try {
      await updateMyPassword({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
      });
      setActiveModal(null);
      showToast("비밀번호가 변경되었습니다.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecoverySubmit(event) {
    event.preventDefault();

    if (!recoveryForm.currentPassword) {
      showToast("현재 비밀번호를 입력해 주세요.");
      return;
    }

    if (!/^\d{4}$/.test(recoveryForm.pin)) {
      showToast("복구 PIN은 숫자 4자리로 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      await updateMyRecovery({
        current_password: recoveryForm.currentPassword,
        recovery_item: recoveryForm.item,
        recovery_pin: recoveryForm.pin,
      });
      setActiveModal(null);
      showToast("복구 항목과 복구 PIN이 변경되었습니다.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteSubmit(event) {
    event.preventDefault();

    if (deleteForm.confirmText !== "탈퇴") {
      showToast("확인 문구에 탈퇴를 입력해 주세요.");
      return;
    }

    if (!deleteForm.password) {
      showToast("현재 비밀번호를 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      await deleteMyAccount(deleteForm.password);
      onAccountDeleted?.();
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mypage-screen">
      {toastMessage && (
        <div className="mypage-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
      <header className="mypage-mobile-topbar">
        <button
          type="button"
          className="mypage-back-button"
          onClick={onBack}
          aria-label="메인으로 돌아가기"
        >
          ‹
        </button>
        <h1>마이페이지</h1>
      </header>

      <div className="mypage-desktop-shell">
        <aside className="mypage-sidebar" aria-label="마이페이지 메뉴">
          <div className="mypage-sidebar-profile">
            <button
              type="button"
              className="mypage-sidebar-home-icon-button"
              onClick={onBack}
              aria-label="대시보드로 이동"
            >
              {renderProfileBadge?.("mypage-sidebar-badge-image")}
            </button>

            <div>
              <strong>{nickname}</strong>
              <span>●</span>
            </div>
          </div>

          <nav className="mypage-sidebar-nav">
            <SidebarButton icon="👤" label="마이페이지" active onClick={() => {}} />
            <SidebarButton
              icon="🌡️"
              label="센서 측정값"
              onClick={() => showComingSoon("센서 측정값")}
            />
            <SidebarButton
              icon="🏅"
              label="뱃지"
              onClick={onOpenBadgePage}
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

        <main className="mypage-main-panel">
          <div className="mypage-page-heading">
            <div>
              <p>🌱 마이페이지</p>
              <h1>내 계정과 집 정보를 관리해요</h1>
              <span>별명, 보안, 위치, 에어컨 정보를 한곳에서 확인할 수 있어요.</span>
            </div>

          </div>

          <section className="mypage-overview-grid">
            <article className="mypage-profile-card">
              <div className="mypage-profile-avatar">
                {renderProfileBadge?.("mypage-profile-avatar-image")}
              </div>

              <div className="mypage-profile-info">
                <div className="mypage-profile-name-row">
                  <h2>{nickname}</h2>
                  <button type="button" onClick={openNicknameModal}>
                    ✎ 별명
                  </button>
                  <button type="button" onClick={onOpenBadgePage}>
                    🏅 아이콘
                  </button>
                </div>

                <p>
                  <span>✉️</span>
                  {user?.username ? `${user.username} 계정` : "계정 정보를 불러오는 중"}
                </p>
                <small>계정 정보와 집 정보를 한곳에서 관리해요.</small>
              </div>
            </article>

            <section className="mypage-section-card mypage-security-card">
              <h3>계정 보안</h3>

              <div className="mypage-row-list">
                <MyPageRow
                  icon="🔒"
                  title="비밀번호 변경"
                  description="로그인 비밀번호를 새로 설정해요"
                  onClick={openPasswordModal}
                />
                <MyPageRow
                  icon="🛡️"
                  title="복구 정보 변경"
                  description="복구 항목과 4자리 PIN을 한 번에 바꿔요"
                  onClick={openRecoveryModal}
                />
              </div>
            </section>
          </section>

          <section className="mypage-section">
            <div className="mypage-section-title">
              <h3>위치 정보</h3>
            </div>

            <article className="mypage-info-card location-card">
              <div className="mypage-info-icon">🏠</div>

              <div className="mypage-info-main">
                {isLoadingPlaces ? (
                  <>
                    <h4>위치 정보를 불러오는 중</h4>
                    <p>잠시만 기다려 주세요.</p>
                  </>
                ) : firstPlace ? (
                  <>
                    <div className="mypage-title-with-badge">
                      <h4>{firstPlace.name}</h4>
                      <span>현재 장소</span>
                    </div>
                    <p>등록된 에어컨 {firstPlace.aircons?.length || 0}개</p>
                    <small>등록일 {formatDate(firstPlace.created_at)}</small>
                  </>
                ) : (
                  <>
                    <h4>등록된 위치가 없어요</h4>
                    <p>위치를 등록하면 공간별로 에어컨을 관리할 수 있어요.</p>
                  </>
                )}

                {placeError && <small className="mypage-error">{placeError}</small>}
              </div>

              <button
                type="button"
                className="mypage-outline-button"
                onClick={() => showComingSoon("위치 변경")}
              >
                변경
              </button>
            </article>
          </section>

          <section className="mypage-section">
            <div className="mypage-section-title">
              <h3>에어컨 정보</h3>
            </div>

            <div className="mypage-aircon-list">
              {isLoadingPlaces ? (
                <article className="mypage-info-card">
                  <div className="mypage-info-icon">❄️</div>
                  <div className="mypage-info-main">
                    <h4>에어컨 정보를 불러오는 중</h4>
                    <p>잠시만 기다려 주세요.</p>
                  </div>
                </article>
              ) : allAircons.length > 0 ? (
                allAircons.map((aircon) => (
                  <article
                    className="mypage-info-card aircon-card"
                    key={aircon.id || `${aircon.placeName}-${aircon.nickname}`}
                  >
                    <div className="mypage-info-icon">❄️</div>

                    <div className="mypage-info-main">
                      <h4>{aircon.nickname || "이름 없는 에어컨"}</h4>
                      <p>
                        {[aircon.manufacturer, aircon.product_name]
                          .filter(Boolean)
                          .join(" ") || "제품명 미입력"}
                      </p>
                      <small>
                        {aircon.model_number || "모델명 미입력"} · {formatPower(aircon.rated_cooling_power_w)}
                      </small>
                    </div>

                    <button
                      type="button"
                      className="mypage-outline-button"
                      onClick={() => showComingSoon("에어컨 정보 변경")}
                    >
                      변경
                    </button>
                  </article>
                ))
              ) : (
                <article className="mypage-info-card">
                  <div className="mypage-info-icon">❄️</div>
                  <div className="mypage-info-main">
                    <h4>등록된 에어컨이 없어요</h4>
                    <p>에어컨을 등록하면 더 정확한 추천을 받을 수 있어요.</p>
                  </div>
                </article>
              )}
            </div>
          </section>

          <section className="mypage-section-card mypage-danger-card">
            <h3>계정 관리</h3>
            <MyPageRow
              icon="🚪"
              title="로그아웃"
              description="현재 계정에서 나가요"
              onClick={onLogout}
            />
            <MyPageRow
              icon="⚠️"
              title="계정 탈퇴"
              description="계정과 등록 정보를 삭제해요"
              danger
              onClick={openDeleteModal}
            />
          </section>
        </main>
      </div>

      {activeModal === "nickname" && (
        <MyPageModal
          title="별명 변경"
          description="메인 화면과 마이페이지에 표시될 이름이에요."
          onClose={closeModal}
        >
          <form className="mypage-modal-form" onSubmit={handleNicknameSubmit}>
            <label>
              새 별명
              <input
                type="text"
                maxLength="12"
                value={nicknameDraft}
                onChange={(event) => setNicknameDraft(event.target.value)}
                placeholder="새 별명을 입력해 주세요"
                autoFocus
              />
            </label>

            <div className="mypage-modal-actions">
              <button type="button" onClick={closeModal} disabled={isSubmitting}>
                취소
              </button>
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "저장 중..." : "저장"}
              </button>
            </div>
          </form>
        </MyPageModal>
      )}

      {activeModal === "password" && (
        <MyPageModal
          title="비밀번호 변경"
          description="현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿔요."
          onClose={closeModal}
        >
          <form className="mypage-modal-form" onSubmit={handlePasswordSubmit}>
            <label>
              현재 비밀번호
              <input
                type="password"
                autoComplete="current-password"
                value={passwordForm.currentPassword}
                onChange={(event) =>
                  setPasswordForm((previous) => ({
                    ...previous,
                    currentPassword: event.target.value,
                  }))
                }
                placeholder="현재 비밀번호"
                autoFocus
              />
            </label>

            <label>
              새 비밀번호
              <input
                type="password"
                autoComplete="new-password"
                value={passwordForm.newPassword}
                onChange={(event) =>
                  setPasswordForm((previous) => ({
                    ...previous,
                    newPassword: event.target.value,
                  }))
                }
                placeholder="8자 이상"
              />
            </label>

            <label>
              새 비밀번호 확인
              <input
                type="password"
                autoComplete="new-password"
                value={passwordForm.newPasswordConfirm}
                onChange={(event) =>
                  setPasswordForm((previous) => ({
                    ...previous,
                    newPasswordConfirm: event.target.value,
                  }))
                }
                placeholder="새 비밀번호 다시 입력"
              />
            </label>

            <div className="mypage-modal-actions">
              <button type="button" onClick={closeModal} disabled={isSubmitting}>
                취소
              </button>
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "변경 중..." : "변경"}
              </button>
            </div>
          </form>
        </MyPageModal>
      )}

      {activeModal === "recovery" && (
        <MyPageModal
          title="복구 정보 변경"
          description="비밀번호 찾기에 사용할 그림과 4자리 PIN을 한 번에 바꿔요."
          onClose={closeModal}
        >
          <form className="mypage-modal-form" onSubmit={handleRecoverySubmit}>
            <label>
              현재 비밀번호
              <input
                type="password"
                autoComplete="current-password"
                value={recoveryForm.currentPassword}
                onChange={(event) =>
                  setRecoveryForm((previous) => ({
                    ...previous,
                    currentPassword: event.target.value,
                  }))
                }
                placeholder="현재 비밀번호"
                autoFocus
              />
            </label>

            <div className="mypage-recovery-field">
              <span>복구 항목</span>
              <div className="mypage-recovery-grid">
                {RECOVERY_ITEMS.map((item) => (
                  <button
                    type="button"
                    className={recoveryForm.item === item.value ? "active" : ""}
                    key={item.value}
                    onClick={() =>
                      setRecoveryForm((previous) => ({
                        ...previous,
                        item: item.value,
                      }))
                    }
                    aria-label={`${item.value} 선택`}
                  >
                    {item.icon}
                  </button>
                ))}
              </div>
            </div>

            <label>
              새 복구 PIN
              <input
                type="password"
                inputMode="numeric"
                maxLength="4"
                value={recoveryForm.pin}
                onChange={(event) =>
                  setRecoveryForm((previous) => ({
                    ...previous,
                    pin: event.target.value.replace(/\D/g, "").slice(0, 4),
                  }))
                }
                placeholder="숫자 4자리"
              />
            </label>

            <div className="mypage-modal-actions">
              <button type="button" onClick={closeModal} disabled={isSubmitting}>
                취소
              </button>
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "저장 중..." : "저장"}
              </button>
            </div>
          </form>
        </MyPageModal>
      )}

      {activeModal === "delete" && (
        <MyPageModal
          title="계정 탈퇴"
          description="계정, 위치, 에어컨, 센서 기록이 삭제돼요. 되돌릴 수 없어요."
          onClose={closeModal}
        >
          <form className="mypage-modal-form" onSubmit={handleDeleteSubmit}>
            <div className="mypage-delete-warning">
              <strong>삭제되는 정보</strong>
              <p>계정 정보, 등록 위치, 에어컨 정보, 센서 기록, 로그인 세션</p>
            </div>

            <label>
              현재 비밀번호
              <input
                type="password"
                autoComplete="current-password"
                value={deleteForm.password}
                onChange={(event) =>
                  setDeleteForm((previous) => ({
                    ...previous,
                    password: event.target.value,
                  }))
                }
                placeholder="현재 비밀번호"
                autoFocus
              />
            </label>

            <label>
              확인 문구
              <input
                type="text"
                value={deleteForm.confirmText}
                onChange={(event) =>
                  setDeleteForm((previous) => ({
                    ...previous,
                    confirmText: event.target.value,
                  }))
                }
                placeholder="탈퇴 라고 입력"
              />
            </label>

            <div className="mypage-modal-actions danger">
              <button type="button" onClick={closeModal} disabled={isSubmitting}>
                취소
              </button>
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "탈퇴 중..." : "계정 탈퇴"}
              </button>
            </div>
          </form>
        </MyPageModal>
      )}
    </div>
  );
}

export default MyPage;
