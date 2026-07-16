import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { request } from "../../api";
import {
  deleteMyAccount,
  updateMyNickname,
  updateMyPassword,
  updateMyRecovery,
} from "../auth/authApi";
import { createPlaceWithAircons, fetchMyPlaces } from "../places/placesApi";
// jh 수정함 - "위치 정보" 섹션이 LocationSwitcher/EnvironmentCard와 같은
// 위치 목록(useLocationContext)을 공유해서 쓰도록 연결
import { useLocationContext } from "../location/LocationContext";
import LocationSearchPopover from "../location/LocationSearchPopover";
// jh 수정함 - "장소 추가" 버튼이 대시보드 LocationSwitcher의 "+ 장소 추가"와
// 똑같은 모달(AirconPage variant="modal")을 재사용하도록, LocationListPanel.jsx가
// 이미 쓰고 있는 조립 로직(buildPlacePayload)을 그대로 가져다 쓴다.
import AirconPage, { createInitialAirconSlots } from "../places/AirconPage";
import { buildPlacePayload } from "../location/buildPlacePayload";

// jh 수정함 - "위치 정보" 목록 접기/더보기 기준 개수
const LOCATION_PREVIEW_COUNT = 3;

const RECOVERY_ITEMS = [
  { value: "acorn", icon: "🌰" },
  { value: "leaf", icon: "🍃" },
  { value: "ice", icon: "🧊" },
  { value: "bulb", icon: "💡" },
  { value: "shovel", icon: "🪏" },
  { value: "wind", icon: "🌀" },
];

// jh 수정함 - 장소 목록 각 행에 lat/lon 대신 사람이 읽을 주소를 보여주기 위해
// 카카오 좌표->주소 변환(GET /places/reverse-geocode)을 호출한다. 로그인 없이도
// 되는 엔드포인트라 LocationSearchPopover.jsx와 같은 패턴으로 placesApi.js를
// 거치지 않고 request()를 직접 쓴다.
//
// jh 수정함 - 마이페이지를 열 때마다 같은 장소를 매번 다시 조회하지 않도록,
// 결과를 LocationContext의 addressCache(placeId -> 주소)에 캐시해서 재사용한다.
// 캐시에 이미 있으면(성공/실패 둘 다 캐시됨) API를 다시 부르지 않고,
// lat/lon이 바뀌면 LocationContext.setLocationCoordinates가 그 장소의
// 캐시만 지워서 여기서 자연히 다시 조회하게 된다.
function PlaceLocationStatus({ placeId, lat, lon }) {
  const { addressCache, setCachedAddress } = useLocationContext();
  const cachedAddress = addressCache[placeId];

  useEffect(() => {
    if (lat == null || lon == null) {
      return undefined;
    }

    if (Object.prototype.hasOwnProperty.call(addressCache, placeId)) {
      return undefined;
    }

    let ignoreResult = false;

    request(`/api/places/reverse-geocode?lat=${lat}&lon=${lon}`)
      .then((result) => {
        if (!ignoreResult) {
          setCachedAddress(placeId, result.address ?? null);
        }
      })
      .catch(() => {
        if (!ignoreResult) {
          setCachedAddress(placeId, null);
        }
      });

    return () => {
      ignoreResult = true;
    };
    // addressCache/setCachedAddress는 일부러 뺐다. 다른 장소의 캐시가 갱신될
    // 때마다 이 effect가 다시 도는 걸 막고, placeId/lat/lon이 바뀔 때(= 이
    // 장소를 새로 그리거나 위치가 바뀌었을 때)만 다시 조회하면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId, lat, lon]);

  if (lat == null || lon == null) {
    return <p>위치 미설정</p>;
  }

  if (cachedAddress === undefined) {
    return <p>주소 확인 중...</p>;
  }

  return <p>{cachedAddress || "주소를 확인하지 못했어요"}</p>;
}

function formatPower(value) {
  if (!value) {
    return "전력 정보 없음";
  }

  return `${Number(value).toLocaleString("ko-KR")} W`;
}

// jh 수정함 - 장소 카드의 별표(기본 설정)/연필(이름 수정) 아이콘 버튼 스타일
// 헬퍼. 네모 테두리/배경 없이 아이콘만 떠 있는 형태로 통일했다. 새 전역 CSS
// 클래스를 추가하는 대신 인라인 스타일로 처리해서 다른 마이페이지 섹션
// 스타일에 영향이 없게 했다.
function locationIconButtonStyle({ active = false, tone = "neutral" } = {}) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    padding: 0,
    border: "none",
    background: "transparent",
    color:
      tone === "star" ? (active ? "#f5b301" : "#b7c4bd") : "#5f7269",
    fontSize: tone === "star" ? "19px" : "15px",
    lineHeight: 1,
    cursor: "pointer",
  };
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

  // jh 수정함 - "위치 정보" 섹션은 이제 이 places state 대신 useLocationContext()의
  // locations를 쓴다(LocationSwitcher/EnvironmentCard와 같은 목록을 공유).
  // "에어컨 정보" 섹션은 그대로 places를 쓰므로 위 state는 남겨둔다.
  const {
    locations,
    isLoading: isLoadingLocations,
    loadError: locationLoadError,
    setDefaultLocation,
    savePlaceDetails,
    removeLocation,
    refreshLocations,
  } = useLocationContext();

  // jh 수정함 - 목록 표시 순서만 기본 장소가 맨 위로 오도록 정렬한다(id/순회
  // 순서 등 다른 로직에는 영향 없게, 렌더링에 쓸 파생 배열만 따로 만든다).
  // locations가 바뀔 때마다(= setDefaultLocation의 낙관적 갱신 포함) 다시
  // 계산되므로, 기본 장소를 바꾼 그 순간 바로 맨 위로 옮겨간다.
  const sortedLocations = useMemo(
    () => [
      ...locations.filter((location) => location.isDefault),
      ...locations.filter((location) => !location.isDefault),
    ],
    [locations],
  );

  const [openLocationPopoverId, setOpenLocationPopoverId] = useState(null);
  // jh 수정함 - "변경" 모달이 "장소 추가"와 같은 디자인(장소 이름 + 위치 검색 ->
  // 저장하기 버튼)을 쓰도록 바꾸면서, 이름/위치 둘 다 고르는 즉시 저장하지
  // 않고 여기 담아뒀다가 "저장하기"를 눌러야 실제로 저장한다(바뀐 필드만
  // savePlaceDetails로 한 번에 보냄). nameDraft는 모달을 열 때 현재 이름으로
  // 초기화된다.
  const [nameDraft, setNameDraft] = useState("");
  const [pendingLocationSelection, setPendingLocationSelection] =
    useState(null);
  const [isSavingLocationSelection, setIsSavingLocationSelection] =
    useState(false);
  const [isUpdatingDefaultId, setIsUpdatingDefaultId] = useState(null);
  // jh 수정함 - 장소가 많을 때 목록이 너무 길어지지 않도록 처음엔 3개만 보여준다.
  const [isLocationListExpanded, setIsLocationListExpanded] = useState(false);
  // jh 수정함 - "장소 추가" 버튼. LocationListPanel.jsx의 "+ 장소 추가"와 완전히
  // 같은 모달(AirconPage variant="modal")을 그대로 재사용한다.
  const [isAddingPlace, setIsAddingPlace] = useState(false);
  const [registeredAircons, setRegisteredAircons] = useState(
    createInitialAirconSlots,
  );

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

  // jh 수정함 - "장소 추가" 모달 열기/닫기 + 완료 처리. LocationListPanel.jsx의
  // openAddForm/closeAddForm/handleAirconComplete와 동일한 흐름이다.
  function openAddPlaceForm() {
    setRegisteredAircons(createInitialAirconSlots());
    setIsAddingPlace(true);
  }

  function closeAddPlaceForm() {
    setIsAddingPlace(false);
  }

  async function handleAirconComplete(placeName, aircons, lat, lon) {
    await createPlaceWithAircons(
      buildPlacePayload(placeName, aircons, lat, lon),
    );
    alert("장소가 추가되었습니다.");
    setIsAddingPlace(false);
    await refreshLocations();
  }

  // jh 수정함 - "위치 정보" 섹션의 변경/기본 설정/삭제 버튼 핸들러
  function closeLocationPopover() {
    setOpenLocationPopoverId(null);
    setPendingLocationSelection(null);
    setNameDraft("");
  }

  // jh 수정함 - "변경" 버튼을 누르면 이름 입력창을 현재 이름으로 초기화해서 연다
  // (이름 인라인 편집 대신, 이름도 이 모달에서 같이 편집한다).
  function openLocationPopoverFor(location) {
    setPendingLocationSelection(null);
    setNameDraft(location.name);
    setOpenLocationPopoverId(location.id);
  }

  // jh 수정함 - "저장하기" 버튼. 이름/위치 중 실제로 바뀐 것만 모아서
  // savePlaceDetails 한 번으로 저장한다(AirconPage의 "추가하기"처럼 입력/
  // 검색과 저장을 분리). 아무것도 안 바뀌었으면 저장 자체를 스킵한다.
  async function handleSaveLocationDetails() {
    if (openLocationPopoverId === null) {
      return;
    }

    const currentLocation = locations.find(
      (location) => String(location.id) === String(openLocationPopoverId),
    );
    if (!currentLocation) {
      return;
    }

    const trimmedName = nameDraft.trim();
    const updates = {};

    if (trimmedName && trimmedName !== currentLocation.name) {
      updates.name = trimmedName;
    }
    if (pendingLocationSelection) {
      updates.lat = pendingLocationSelection.lat;
      updates.lon = pendingLocationSelection.lon;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    setIsSavingLocationSelection(true);

    try {
      await savePlaceDetails(openLocationPopoverId, updates);
      closeLocationPopover();
      showToast("저장되었습니다.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsSavingLocationSelection(false);
    }
  }

  async function handleSetDefaultLocation(placeId) {
    setIsUpdatingDefaultId(placeId);

    try {
      await setDefaultLocation(placeId);
      showToast("기본 장소로 설정되었습니다.");
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsUpdatingDefaultId(null);
    }
  }

  async function handleDeleteLocation(placeId) {
    if (locations.length <= 1) {
      return;
    }

    const confirmed = window.confirm("이 장소를 삭제하시겠습니까?");
    if (!confirmed) {
      return;
    }

    if (openLocationPopoverId === placeId) {
      closeLocationPopover();
    }

    try {
      await removeLocation(placeId);
      showToast("장소가 삭제되었습니다.");
    } catch (error) {
      showToast(error.message);
    }
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

  // jh 수정함 - "장소 정보 변경하기" 모달의 저장 버튼 활성화 여부. 이름을
  // 실제로 바꿨거나(원래 이름과 다르고 비어있지 않음) 위치를 새로 골랐을
  // 때만 저장 가능하다.
  const editingLocation = locations.find(
    (location) => String(location.id) === String(openLocationPopoverId),
  );
  const trimmedNameDraft = nameDraft.trim();
  const hasNameChange = Boolean(
    editingLocation &&
      trimmedNameDraft &&
      trimmedNameDraft !== editingLocation.name,
  );
  const canSaveLocationDetails = hasNameChange || Boolean(pendingLocationSelection);

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
              <h3>장소 정보</h3>
            </div>

            {isLoadingLocations ? (
              <article className="mypage-info-card location-card">
                <div className="mypage-info-icon">🏠</div>
                <div className="mypage-info-main">
                  <h4>장소 정보를 불러오는 중</h4>
                  <p>잠시만 기다려 주세요.</p>
                </div>
              </article>
            ) : locations.length === 0 ? (
              <article className="mypage-info-card location-card">
                <div className="mypage-info-icon">🏠</div>
                <div className="mypage-info-main">
                  <h4>등록된 장소가 없어요</h4>
                  <p>장소를 등록하면 공간별로 에어컨을 관리할 수 있어요.</p>
                </div>
              </article>
            ) : (
              (isLocationListExpanded
                ? sortedLocations
                : sortedLocations.slice(0, LOCATION_PREVIEW_COUNT)
              ).map((location) => {
                const isOnlyLocation = locations.length <= 1;

                return (
                  <article
                    className="mypage-info-card location-card"
                    key={location.id}
                  >
                    <div className="mypage-info-icon">🏠</div>

                    <div className="mypage-info-main">
                      <div
                        className="mypage-title-with-badge"
                        style={{ rowGap: "6px" }}
                      >
                        <h4>{location.name}</h4>

                        {location.isDefault && <span>기본 장소</span>}
                      </div>

                      <PlaceLocationStatus
                        placeId={location.id}
                        lat={location.lat}
                        lon={location.lon}
                      />
                    </div>

                    <div
                      className="mypage-location-actions"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: "8px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleSetDefaultLocation(location.id)}
                        disabled={isUpdatingDefaultId === location.id}
                        aria-pressed={location.isDefault}
                        aria-label={
                          location.isDefault
                            ? "기본 장소로 설정됨"
                            : "기본 장소로 설정"
                        }
                        style={locationIconButtonStyle({
                          active: location.isDefault,
                          tone: "star",
                        })}
                      >
                        {location.isDefault ? "★" : "☆"}
                      </button>

                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          className="mypage-outline-button"
                          onClick={() => openLocationPopoverFor(location)}
                        >
                          변경
                        </button>

                        <button
                          type="button"
                          className="mypage-outline-button"
                          onClick={() => handleDeleteLocation(location.id)}
                          disabled={isOnlyLocation}
                          title={
                            isOnlyLocation
                              ? "최소 1개의 장소는 남아있어야 해요"
                              : undefined
                          }
                          style={
                            isOnlyLocation
                              ? { opacity: 0.45, cursor: "not-allowed" }
                              : undefined
                          }
                        >
                          삭제
                        </button>
                      </div>
                    </div>

                  </article>
                );
              })
            )}

            {/* jh 수정함 - 3개 초과일 때만 더보기/접기 버튼을 보여주고,
                "+ 장소 추가"는 항상 보여준다. 더보기가 있을 땐 나란히 둔다. */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              <button
                type="button"
                className="mypage-outline-button"
                onClick={openAddPlaceForm}
              >
                + 장소 추가
              </button>

              {locations.length > LOCATION_PREVIEW_COUNT && (
                <button
                  type="button"
                  className="mypage-outline-button"
                  onClick={() =>
                    setIsLocationListExpanded((previous) => !previous)
                  }
                >
                  {isLocationListExpanded ? "접기" : "더보기"}
                </button>
              )}
            </div>

            {/* jh 수정함 - 이 섹션 안 깊숙이 그대로 렌더링하면(마이페이지 레이아웃
                조상 어딘가에 의해) position:fixed가 뷰포트가 아니라 스크롤되는
                조상 기준으로 잡혀서, 스크롤 위치/버튼 위치에 따라 모달이 화면
                아래쪽에 뜨는 문제가 있었다. createPortal로 document.body에 직접
                붙여서 별명 변경 모달처럼 항상 뷰포트 정중앙에 뜨게 한다 - 디자인/
                클래스/로직은 전혀 안 바꾸고 "어디에 마운트되는지"만 바꾼 것이다. */}
            {isAddingPlace &&
              createPortal(
                <div
                  className="location-add-modal-backdrop"
                  role="presentation"
                  onMouseDown={closeAddPlaceForm}
                >
                  <div
                    className="location-add-modal"
                    role="dialog"
                    aria-modal="true"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <div className="location-add-modal-scroll">
                      <AirconPage
                        variant="modal"
                        registeredAircons={registeredAircons}
                        setRegisteredAircons={setRegisteredAircons}
                        onBack={closeAddPlaceForm}
                        onComplete={handleAirconComplete}
                      />
                    </div>
                  </div>
                </div>,
                document.body,
              )}

            {locationLoadError && (
              <small className="mypage-error">{locationLoadError}</small>
            )}
          </section>

          <section className="mypage-section">
            <div className="mypage-section-title">
              <h3>에어컨 정보</h3>
            </div>

            {/* jh 수정함 - "위치 정보" 섹션이 locations(useLocationContext)로
                옮겨가면서, 같은 fetchMyPlaces() 실패 메시지(placeError)를 보여줄
                자리가 없어져서 에어컨 정보 쪽으로 옮겼다(에어컨 목록도 이 places
                상태를 그대로 쓰고 있어서 실패하면 여기도 영향을 받는다). */}
            {placeError && <small className="mypage-error">{placeError}</small>}

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

      {/* jh 수정함 - "변경" 버튼을 누르면 "장소 추가"와 완전히 같은 모달 디자인
          (location-add-modal-* 클래스, flow-card 헤더+저장 버튼 행)으로 뜨도록
          바꿨다. 제목만 "장소 정보 변경하기"로 다르고, "장소 이름" 필드까지
          같이 넣어서 이름/위치를 이 모달 하나에서 같이 편집한다(이름 인라인
          편집은 없앰 - 마이페이지의 다른 편집들(별명 등)도 전부 모달 방식이라
          이게 더 일관적이다). 이름/위치 모두 고르는 즉시 저장하지 않고
          담아뒀다가 "저장하기"를 눌러야 실제로 저장되고, 바뀐 필드만
          savePlaceDetails로 한 번에 보낸다. "장소 추가" 모달과 같은 이유로
          createPortal로 document.body에 직접 마운트해서 스크롤 위치에 따라
          위치가 밀리는 문제를 피한다. */}
      {openLocationPopoverId !== null &&
        createPortal(
          <div
            className="location-add-modal-backdrop"
            role="presentation"
            onMouseDown={closeLocationPopover}
          >
            <div
              className="location-add-modal"
              role="dialog"
              aria-modal="true"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="location-add-modal-scroll">
                <section className="flow-card wide-card location-add-modal-card">
                  <div className="location-add-modal-heading">
                    <div>
                      {/* jh 수정함 - 설명 문구를 없애서, h2 하나만 남은 이 헤더에서는
                          h2 자체의 margin-bottom(다음 문단과의 간격용)이 필요 없어
                          margin:0으로 지웠다(location-add-modal-heading h2 공용
                          규칙은 "장소 추가" 모달이 아직 설명 문구를 쓰므로 그대로 둠). */}
                      <h2 style={{ margin: 0 }}>장소 정보 변경</h2>
                    </div>

                    <button
                      type="button"
                      className="location-add-modal-close"
                      onClick={closeLocationPopover}
                      aria-label="장소 정보 변경하기 닫기"
                    >
                      ×
                    </button>
                  </div>

                  <label className="place-field">
                    장소 이름
                    <input
                      type="text"
                      value={nameDraft}
                      maxLength={50}
                      onChange={(event) => setNameDraft(event.target.value)}
                      placeholder="예: 우리 집, 자취방, 사무실"
                    />
                  </label>

                  <LocationSearchPopover
                    embedded
                    onSelect={(lat, lon) =>
                      setPendingLocationSelection({ lat, lon })
                    }
                    onClose={closeLocationPopover}
                  />

                  <div className="flow-button-row aircon-action-row">
                    <button
                      className="flow-secondary-button"
                      type="button"
                      onClick={closeLocationPopover}
                    >
                      취소
                    </button>

                    <button
                      className="flow-primary-button"
                      type="button"
                      onClick={handleSaveLocationDetails}
                      disabled={
                        !canSaveLocationDetails || isSavingLocationSelection
                      }
                    >
                      {isSavingLocationSelection ? "저장 중..." : "저장하기"}
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )}

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
