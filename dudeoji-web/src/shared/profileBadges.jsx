// src/shared/profileBadges.js
//
// 헤더의 아바타 아이콘(메뉴 담당: 류은)과 뱃지 페이지(담당: 민주, 추후)가
// 함께 쓰는 데이터입니다. 새 뱃지를 추가할 땐 여기 배열에만 추가하면
// 두 화면에 자동으로 반영됩니다. 이 파일을 고치는 작업은 두 사람 모두에게
// 영향을 주니, 수정 전 서로 확인해 주세요.
import sproutMenuIcon from "../assets/sprout-menu.svg";

export const DEFAULT_PROFILE_BADGE_ID = "sprout";

export const PROFILE_BADGES = [
  {
    id: "sprout",
    name: "새싹",
    description: "처음부터 사용할 수 있는 기본 아이콘이에요.",
    type: "image",
    value: "sprout",
    unlocked: true,
  },
  {
    id: "energy-saver",
    name: "절전 새내기",
    description: "절전 추천을 처음 확인하면 얻는 뱃지예요.",
    type: "emoji",
    value: "🌿",
    unlocked: true,
  },
  {
    id: "cool-window",
    name: "창문 환기러",
    description: "창문 열기 추천을 잘 활용하는 사용자에게 어울려요.",
    type: "emoji",
    value: "🪟",
    unlocked: true,
  },
  {
    id: "ice-master",
    name: "시원한 관리자",
    description: "에어컨 정보를 등록한 사용자에게 어울리는 뱃지예요.",
    type: "emoji",
    value: "❄️",
    unlocked: true,
  },
  {
    id: "power-hero",
    name: "전력 지킴이",
    description: "전력 절감 기록 기능에서 사용할 예정인 뱃지예요.",
    type: "emoji",
    value: "⚡",
    unlocked: false,
  },
];

export function getProfileBadgeStorageKey(user) {
  const username = user?.username?.trim?.();

  if (username) {
    return `dudeoji-profile-badge-${username}`;
  }

  return "dudeoji-profile-badge-default";
}

export function getStoredProfileBadgeId(user) {
  return (
    localStorage.getItem(getProfileBadgeStorageKey(user)) ||
    DEFAULT_PROFILE_BADGE_ID
  );
}

export function getProfileBadgeById(badgeId) {
  return (
    PROFILE_BADGES.find((badge) => badge.id === badgeId) || PROFILE_BADGES[0]
  );
}

export function ProfileBadgeIcon({ badge, className = "" }) {
  const currentBadge = badge || PROFILE_BADGES[0];

  if (currentBadge.type === "image") {
    return (
      <img
        src={sproutMenuIcon}
        alt=""
        className={className}
        aria-hidden="true"
      />
    );
  }

  return (
    <span className={`${className} profile-badge-emoji`} aria-hidden="true">
      {currentBadge.value}
    </span>
  );
}
