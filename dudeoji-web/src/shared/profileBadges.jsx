// src/shared/profileBadges.js
//
// 헤더의 아바타 아이콘(메뉴 담당: 류은)과 뱃지 페이지(담당: 민주, 추후)가
// 함께 쓰는 데이터입니다. 새 뱃지를 추가할 땐 여기 배열에 표시용 메타데이터를
// 추가하고, 백엔드 badges.py의 get_badge_states()에도 같은 id로 잠금 조건을
// 추가하세요 — 두 화면에 자동으로 반영됩니다.
//
// jh 수정함 - unlocked: true/false를 여기 하드코딩하던 걸 걷어냈다. 이제
// 잠금 여부/진행도는 GET /api/badges(badgesApi.js)가 계산해서 내려주고,
// 이 파일은 이름/설명/아이콘/달성 조건 문구 같은 "고정된 표시 정보"만
// 갖는다. mergeBadgeStates()가 이 메타데이터와 API 응답을 id로 합친다.
import sproutMenuIcon from "../assets/sprout-menu.svg";

export const DEFAULT_PROFILE_BADGE_ID = "sprout";

export const PROFILE_BADGES = [
  {
    id: "sprout",
    name: "새싹",
    description: "처음부터 사용할 수 있는 기본 아이콘이에요.",
    type: "image",
    value: "sprout",
  },
  {
    id: "energy-saver",
    name: "절전 새내기",
    description: "두더지와 함께 첫 발을 뗀 사용자에게 어울려요.",
    requirement: "센서 기록이 1건 이상 쌓이면 잠금 해제돼요.",
    type: "emoji",
    value: "🌿",
  },
  {
    id: "cool-window",
    name: "창문 환기러",
    description: "창문 환기를 잘 활용하는 사용자에게 어울려요.",
    requirement: "창문 열기 추천을 5회 활용하면 잠금 해제돼요.",
    type: "emoji",
    value: "🪟",
  },
  {
    id: "ice-master",
    name: "시원한 관리자",
    description: "에어컨 정보를 등록한 사용자에게 어울리는 뱃지예요.",
    requirement: "마이페이지에서 에어컨 정보를 등록하면 잠금 해제돼요.",
    type: "emoji",
    value: "❄️",
  },
  {
    id: "power-hero-1",
    name: "전력 지킴이 Ⅰ",
    description: "누적 절감을 시작한 사용자에게 어울려요.",
    requirement: "누적 절감량이 1kWh를 넘으면 잠금 해제돼요.",
    type: "emoji",
    value: "⚡",
  },
  {
    id: "power-hero-2",
    name: "전력 지킴이 Ⅱ",
    description: "꾸준히 절감을 쌓아가는 사용자에게 어울려요.",
    requirement: "누적 절감량이 5kWh를 넘으면 잠금 해제돼요.",
    type: "emoji",
    value: "⚡⚡",
  },
  {
    id: "power-hero-3",
    name: "전력 지킴이 Ⅲ",
    description: "절감을 습관으로 만든 사용자에게 어울려요.",
    requirement: "누적 절감량이 20kWh를 넘으면 잠금 해제돼요.",
    type: "emoji",
    value: "⚡⚡⚡",
  },
  {
    id: "accept-10",
    name: "믿음직한 파트너",
    description: "두더지의 추천을 믿고 따르는 사용자에게 어울려요.",
    requirement: "추천을 10번 수락(자동 실행 유지)하면 잠금 해제돼요.",
    type: "emoji",
    value: "🤝",
  },
  {
    id: "reject-10",
    name: "나만의 방식",
    description: "직접 판단해서 조작하는 걸 선호하는 사용자에게 어울려요.",
    requirement: "추천을 10번 거절하고 직접 조작하면 잠금 해제돼요.",
    type: "emoji",
    value: "🧭",
  },
  {
    id: "manual-first",
    name: "첫 조작",
    description: "처음으로 직접 기기를 움직여본 사용자에게 어울려요.",
    requirement: "창문이나 에어컨을 직접(수동으로) 1회 조작하면 잠금 해제돼요.",
    type: "emoji",
    value: "🖐️",
  },
];

const PROFILE_BADGE_BY_ID = Object.fromEntries(
  PROFILE_BADGES.map((badge) => [badge.id, badge]),
);

// jh 추가 - GET /api/badges 응답(id별 unlocked/progress)과 위 메타데이터를
// id 기준으로 합친다. 응답에 없는 id(구버전 백엔드 등)는 잠긴 것으로
// 취급한다 — 새로 추가된 뱃지가 배포 타이밍 차이로 무조건 해금돼 보이는
// 것보단 안전한 쪽.
export function mergeBadgeStates(badgeStates) {
  const stateById = Object.fromEntries(
    (badgeStates || []).map((state) => [state.id, state]),
  );

  return PROFILE_BADGES.map((badge) => {
    const state = stateById[badge.id];
    return {
      ...badge,
      // jh 추가 - API 응답이 아직 없을 때(최초 로딩 중)도 기본 뱃지(sprout)는
      // 항상 해금 상태여야 한다. 그냥 false로 두면 로딩 중 "대표 아이콘"으로
      // 쓰이고 있는 새싹이 잠깐 "잠김"으로 보이는 모순이 생긴다.
      unlocked: state?.unlocked ?? badge.id === DEFAULT_PROFILE_BADGE_ID,
      progress: state?.progress ?? null,
    };
  });
}

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
  return PROFILE_BADGE_BY_ID[badgeId] || PROFILE_BADGES[0];
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
