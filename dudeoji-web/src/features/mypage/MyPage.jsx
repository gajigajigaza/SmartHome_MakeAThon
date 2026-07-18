import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { request } from "../../api";
import {
  deleteMyAccount,
  updateMyNickname,
  updateMyPassword,
  updateMyRecovery,
} from "../auth/authApi";
import { useLocationContext } from "../location/LocationContext";
import SharedAppSidebar from "../navigation/SharedAppSidebar";
import LocationSearchPopover from "../location/LocationSearchPopover";
import { buildPlacePayload } from "../location/buildPlacePayload";
import AirconPage, { createInitialAirconSlots } from "../places/AirconPage";
import AirconSelectorModal from "../places/AirconSelectorModal";
import AutoControlSettings from "../places/AutoControlSettings";
// 류은 수정 0718 - 에어컨 이름 변경과 제품 변경 API를 분리해서 사용합니다.
import {
  createPlaceWithAircons,
  fetchMyPlaces,
  updateUserAirconNickname,
  updateUserAirconProduct,
} from "../places/placesApi";
import "./MyPageNestedAircon.css";

const LOCATION_PREVIEW_COUNT = 3;

const RECOVERY_ITEMS = [
  { value: "acorn", icon: "🌰" },
  { value: "leaf", icon: "🍃" },
  { value: "ice", icon: "🧊" },
  { value: "bulb", icon: "💡" },
  { value: "shovel", icon: "🪏" },
  { value: "wind", icon: "🌀" },
];

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
    // 다른 장소의 주소 캐시가 갱신될 때마다 다시 호출하지 않도록
    // 장소 ID와 좌표가 바뀔 때만 주소를 다시 조회한다.
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

// jh 수정함 - 장소 삭제 확인 문구에 장소 이름을 그대로 꽂으면 "정현을 삭제"/
// "회사를 삭제"처럼 받침 유무에 따라 을/를이 갈려서, 완성형 한글 마지막 글자의
// 받침 유무(유니코드 오프셋 % 28)로 올바른 조사를 골라준다.
function getEulReulParticle(word) {
  const lastChar = word?.trim().slice(-1);

  if (!lastChar) {
    return "를";
  }

  const code = lastChar.charCodeAt(0);

  if (code < 0xac00 || code > 0xd7a3) {
    return "를";
  }

  const hasBatchim = (code - 0xac00) % 28 !== 0;
  return hasBatchim ? "을" : "를";
}

function formatPower(value) {
  if (!value) {
    return "전력 정보 없음";
  }

  return `${Number(value).toLocaleString("ko-KR")} W`;
}

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
  onOpenSensorReadings,
  onStartTutorial,
  onLogout,
  onUserUpdated,
  onAccountDeleted,
}) {
  const [places, setPlaces] = useState([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(true);
  const [placeError, setPlaceError] = useState("");

  const {
    locations,
    isLoading: isLoadingLocations,
    loadError: locationLoadError,
    setDefaultLocation,
    savePlaceDetails,
    removeLocation,
    refreshLocations,
  } = useLocationContext();

  const sortedLocations = useMemo(
    () => [
      ...locations.filter((location) => location.isDefault),
      ...locations.filter((location) => !location.isDefault),
    ],
    [locations],
  );

  const [openLocationPopoverId, setOpenLocationPopoverId] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [pendingLocationSelection, setPendingLocationSelection] =
    useState(null);
  const [isSavingLocationSelection, setIsSavingLocationSelection] =
    useState(false);
  const [isUpdatingDefaultId, setIsUpdatingDefaultId] = useState(null);
  const [isLocationListExpanded, setIsLocationListExpanded] = useState(false);
  const [isAddingPlace, setIsAddingPlace] = useState(false);
  const [registeredAircons, setRegisteredAircons] = useState(
    createInitialAirconSlots,
  );
  // jh 수정함 - window.confirm() 대신 커스텀 모달로 삭제 여부를 물어보기 위한 state.
  // null이면 모달이 닫혀 있고, 값이 있으면 그 place id의 삭제 확인 모달이 열려 있음.
  const [deleteTargetPlaceId, setDeleteTargetPlaceId] = useState(null);

  // 류은 수정 0718 - 장소마다 에어컨·자동 제어 영역을 독립적으로 접고 펼칩니다.
  // 객체가 비어 있는 최초 상태에서는 모든 장소의 에어컨 정보가 접혀 있습니다.
  const [expandedAirconPlaces, setExpandedAirconPlaces] = useState({});

  // 류은 수정 0718 - 카드에서 이름을 바로 수정하기 위한 상태입니다.
  const [editingAirconName, setEditingAirconName] = useState(null);
  const [airconNameDraft, setAirconNameDraft] = useState("");
  const [isSavingAirconName, setIsSavingAirconName] = useState(false);

  // 변경 버튼으로 선택할 제품과 제품 저장 상태입니다.
  const [airconProductTarget, setAirconProductTarget] = useState(null);
  const [isSavingAirconProduct, setIsSavingAirconProduct] = useState(false);

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

  function showToast(message) {
    setToastMessage(message);
  }

  // 선택한 장소의 에어컨 정보와 자동 제어 설정을 함께 열거나 닫습니다.
  function toggleAirconSection(placeId) {
    const placeKey = String(placeId);

    setExpandedAirconPlaces((previous) => ({
      ...previous,
      [placeKey]: !previous[placeKey],
    }));
  }

  async function refreshPlaceAircons() {
    setPlaceError("");

    try {
      const result = await fetchMyPlaces();
      setPlaces(result || []);
    } catch (error) {
      setPlaceError(error.message);
    } finally {
      setIsLoadingPlaces(false);
    }
  }

  // 류은 수정 0718 - 밑줄 친 이름을 클릭하면 입력창으로 전환합니다.
  function startEditingAirconName(placeId, aircon) {
    setEditingAirconName({
      placeId,
      airconId: aircon.id,
      originalNickname: aircon.nickname || "에어컨",
    });
    setAirconNameDraft(aircon.nickname || "에어컨");
  }

  function cancelEditingAirconName() {
    if (isSavingAirconName) {
      return;
    }

    setEditingAirconName(null);
    setAirconNameDraft("");
  }

  async function saveAirconName() {
    if (!editingAirconName || isSavingAirconName) {
      return;
    }

    const nextNickname = airconNameDraft.trim();

    if (!nextNickname) {
      showToast("에어컨 이름을 입력해 주세요.");
      cancelEditingAirconName();
      return;
    }

    if (nextNickname === editingAirconName.originalNickname) {
      cancelEditingAirconName();
      return;
    }

    const target = editingAirconName;
    setIsSavingAirconName(true);

    try {
      await updateUserAirconNickname(
        target.placeId,
        target.airconId,
        nextNickname,
      );
      await refreshPlaceAircons();
      setEditingAirconName(null);
      setAirconNameDraft("");
      showToast("에어컨 이름이 변경되었습니다.");
    } catch (error) {
      showToast(error.message || "에어컨 이름을 변경하지 못했습니다.");
    } finally {
      setIsSavingAirconName(false);
    }
  }

  function handleAirconNameKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingAirconName();
    }
  }

  function openAirconProductSelector(placeId, aircon) {
    setAirconProductTarget({
      placeId,
      aircon,
    });
  }

  function closeAirconProductSelector() {
    if (isSavingAirconProduct) {
      return;
    }

    setAirconProductTarget(null);
  }

  async function handleAirconProductChange(payload) {
    if (!airconProductTarget || isSavingAirconProduct) {
      return;
    }

    setIsSavingAirconProduct(true);

    try {
      await updateUserAirconProduct(
        airconProductTarget.placeId,
        airconProductTarget.aircon.id,
        payload,
      );
      await refreshPlaceAircons();
      setAirconProductTarget(null);
      showToast("에어컨 제품이 변경되었습니다.");
    } catch (error) {
      showToast(error.message || "에어컨 제품을 변경하지 못했습니다.");
      throw error;
    } finally {
      setIsSavingAirconProduct(false);
    }
  }

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

    setIsAddingPlace(false);
    await Promise.all([refreshLocations(), refreshPlaceAircons()]);
    showToast("장소가 추가되었습니다.");
  }

  function closeLocationPopover() {
    setOpenLocationPopoverId(null);
    setPendingLocationSelection(null);
    setNameDraft("");
  }

  function openLocationPopoverFor(location) {
    setPendingLocationSelection(null);
    setNameDraft(location.name);
    setOpenLocationPopoverId(location.id);
  }

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

  // jh 수정함 - window.confirm() 호출을 없애고, 대신 deleteTargetPlaceId를 세팅해
  // 아래 커스텀 확인 모달을 열도록 바꿈. 실제 삭제는 confirmDeleteLocation에서 처리.
  function handleDeleteLocation(placeId) {
    if (locations.length <= 1) {
      return;
    }

    setDeleteTargetPlaceId(placeId);
  }

  // jh 수정함 - 삭제 확인 모달의 "취소" 버튼과 배경 클릭에서 공용으로 씀.
  function closeDeleteConfirm() {
    setDeleteTargetPlaceId(null);
  }

  // jh 수정함 - 삭제 확인 모달의 "삭제" 버튼을 눌렀을 때만 실행되는 실제 삭제 로직.
  // window.confirm(true 분기)에 있던 로직을 그대로 옮김.
  async function confirmDeleteLocation() {
    const placeId = deleteTargetPlaceId;

    if (placeId === null) {
      return;
    }

    setDeleteTargetPlaceId(null);

    if (openLocationPopoverId === placeId) {
      closeLocationPopover();
    }

    try {
      await removeLocation(placeId);
      setPlaces((previous) =>
        previous.filter((place) => String(place.id) !== String(placeId)),
      );
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

  const editingLocation = locations.find(
    (location) => String(location.id) === String(openLocationPopoverId),
  );
  // jh 수정함 - 삭제 확인 모달 제목에 실제 장소 이름을 넣기 위한 조회
  const deleteTargetLocation = locations.find(
    (location) => String(location.id) === String(deleteTargetPlaceId),
  );
  const trimmedNameDraft = nameDraft.trim();
  const hasNameChange = Boolean(
    editingLocation &&
      trimmedNameDraft &&
      trimmedNameDraft !== editingLocation.name,
  );
  const canSaveLocationDetails =
    hasNameChange || Boolean(pendingLocationSelection);

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
        <SharedAppSidebar
          nickname={nickname}
          renderProfileBadge={renderProfileBadge}
          activePage="mypage"
          onOpenDashboard={onBack}
          onOpenMyPage={() => {}}
          onOpenSensorReadings={onOpenSensorReadings}
          onOpenBadgePage={onOpenBadgePage}
          onStartTutorial={onStartTutorial}
          onLogout={onLogout}
        />

        <main className="mypage-main-panel">
          <div className="mypage-page-heading">
            <div>
              <p>🌱 마이페이지</p>
              <h1>내 계정과 집 정보를 관리해요</h1>
              <span>별명, 보안, 장소와 에어컨 정보를 한곳에서 확인할 수 있어요.</span>
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
                  {user?.username
                    ? `${user.username} 계정`
                    : "계정 정보를 불러오는 중"}
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

            {placeError && <small className="mypage-error">{placeError}</small>}

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
                const matchedPlace = places.find(
                  (place) => String(place.id) === String(location.id),
                );
                const locationAircons = matchedPlace?.aircons || [];
                const airconSectionKey = String(location.id);
                const isAirconExpanded = Boolean(
                  expandedAirconPlaces[airconSectionKey],
                );
                const airconSectionId = `mypage-aircon-section-${location.id}`;

                return (
                  <article
                    className="mypage-info-card location-card mypage-location-with-aircons"
                    key={location.id}
                  >
                    <div className="mypage-location-summary">
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

                      <div className="mypage-location-actions">
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

                        <div className="mypage-location-action-buttons">
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
                    </div>

                    <div
                      className="mypage-location-aircons"
                      aria-label={`${location.name} 에어컨 정보`}
                    >
                      <div className="mypage-location-aircons-heading">
                        <strong>에어컨 정보</strong>

                        <button
                          type="button"
                          className={`mypage-aircon-toggle-button ${
                            isAirconExpanded ? "expanded" : ""
                          }`}
                          onClick={() => toggleAirconSection(location.id)}
                          aria-expanded={isAirconExpanded}
                          aria-controls={airconSectionId}
                          aria-label={
                            isAirconExpanded
                              ? "에어컨 정보와 자동 제어 설정 접기"
                              : "에어컨 정보와 자동 제어 설정 펼치기"
                          }
                        >
                          <svg
                            className="mypage-aircon-toggle-icon"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path d="m7 10 5 5 5-5" />
                          </svg>
                        </button>
                      </div>

                      <div
                        id={airconSectionId}
                        className="mypage-aircon-collapsible-content"
                        hidden={!isAirconExpanded}
                      >
                        {isLoadingPlaces ? (
                        <div className="mypage-nested-aircon-state">
                          <span className="mypage-nested-aircon-state-icon">❄️</span>
                          <div>
                            <strong>에어컨 정보를 불러오는 중</strong>
                            <p>잠시만 기다려 주세요.</p>
                          </div>
                        </div>
                      ) : placeError ? (
                        <div className="mypage-nested-aircon-state">
                          <span className="mypage-nested-aircon-state-icon">⚠️</span>
                          <div>
                            <strong>에어컨 정보를 불러오지 못했어요</strong>
                            <p>잠시 후 마이페이지를 다시 열어 주세요.</p>
                          </div>
                        </div>
                      ) : locationAircons.length > 0 ? (
                        <div className="mypage-nested-aircon-list">
                          {locationAircons.map((aircon) => (
                            <article
                              className="mypage-nested-aircon-shell"
                              key={
                                aircon.id ||
                                `${location.id}-${aircon.nickname}-${aircon.model_number}`
                              }
                            >
                              <div className="mypage-nested-aircon-card">
                                <div className="mypage-nested-aircon-icon">❄️</div>

                                <div className="mypage-nested-aircon-info">
                                  {editingAirconName?.placeId === location.id &&
                                  editingAirconName?.airconId === aircon.id ? (
                                    <input
                                      className="mypage-aircon-name-input"
                                      type="text"
                                      maxLength={30}
                                      value={airconNameDraft}
                                      onChange={(event) =>
                                        setAirconNameDraft(event.target.value)
                                      }
                                      onKeyDown={handleAirconNameKeyDown}
                                      onBlur={saveAirconName}
                                      disabled={isSavingAirconName}
                                      autoFocus
                                      aria-label="에어컨 이름 수정"
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      className="mypage-aircon-name-button"
                                      onClick={() =>
                                        startEditingAirconName(location.id, aircon)
                                      }
                                      title="에어컨 이름 수정"
                                    >
                                      {aircon.nickname || "이름 없는 에어컨"}
                                    </button>
                                  )}
                                  <p>
                                    {[aircon.manufacturer, aircon.product_name]
                                      .filter(Boolean)
                                      .join(" ") || "제품명 미입력"}
                                  </p>
                                  <small>
                                    {aircon.model_number || "모델명 미입력"} ·{" "}
                                    {formatPower(aircon.rated_cooling_power_w)}
                                  </small>
                                </div>

                                <button
                                  type="button"
                                  className="mypage-outline-button mypage-nested-aircon-button"
                                  onClick={() =>
                                    openAirconProductSelector(location.id, aircon)
                                  }
                                >
                                  변경
                                </button>
                              </div>

                              <AutoControlSettings
                                placeId={location.id}
                                airconName={aircon.nickname || "에어컨"}
                                initialMinutes={
                                  matchedPlace?.target_cooldown_minutes ?? 30
                                }
                                initialEnabled={
                                  matchedPlace?.auto_control_enabled ?? false
                                }
                                onSaved={(savedSettings) => {
                                  setPlaces((previousPlaces) =>
                                    previousPlaces.map((place) =>
                                      String(place.id) === String(location.id)
                                        ? { ...place, ...savedSettings }
                                        : place,
                                    ),
                                  );
                                }}
                              />
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="mypage-nested-aircon-state empty">
                          <span className="mypage-nested-aircon-state-icon">❄️</span>
                          <div>
                            <strong>등록된 에어컨이 없어요</strong>
                            <p>에어컨을 등록하면 더 정확한 추천을 받을 수 있어요.</p>
                          </div>
                        </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}

            <div className="mypage-location-list-actions">
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

      {/* jh 수정함 - 장소 삭제 확인용 커스텀 모달. window.confirm() 대체.
          오버레이는 다른 위치 모달과 동일한 .location-add-modal-backdrop을
          재사용하고(배경 클릭 시 onMouseDown으로 닫힘), 카드만 확인 문구에
          맞게 좁은 전용 클래스(.location-delete-confirm-card)로 새로 만듦. */}
      {deleteTargetPlaceId !== null &&
        createPortal(
          <div
            className="location-add-modal-backdrop"
            role="presentation"
            onMouseDown={closeDeleteConfirm}
          >
            <div
              className="location-delete-confirm-card"
              role="dialog"
              aria-modal="true"
              aria-label="장소 삭제 확인"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="location-delete-confirm-icon" aria-hidden="true">
                ⚠️
              </div>

              <p className="location-delete-confirm-text">
                &lsquo;{deleteTargetLocation?.name ?? "이 장소"}&rsquo;
                {getEulReulParticle(deleteTargetLocation?.name)} 삭제하시겠습니까?
              </p>

              <div className="location-delete-confirm-actions">
                <button
                  type="button"
                  className="flow-secondary-button"
                  onClick={closeDeleteConfirm}
                >
                  취소
                </button>

                <button
                  type="button"
                  className="location-delete-confirm-button"
                  onClick={confirmDeleteLocation}
                >
                  삭제
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {airconProductTarget && (
        <AirconSelectorModal
          currentAircon={airconProductTarget.aircon}
          isSaving={isSavingAirconProduct}
          onClose={closeAirconProductSelector}
          onSelect={handleAirconProductChange}
        />
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
