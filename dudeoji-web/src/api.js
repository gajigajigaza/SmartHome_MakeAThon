// src/api.js
//
// 담당: 공용 (백엔드 호출의 공통 기반만 여기 둠)
//
// 실제 API 함수들은 여기 없습니다. 백엔드가 routers/로 나뉜 것과 똑같이,
// 프론트도 기능별 Api.js로 나눴습니다:
//   - features/auth/authApi.js      → 회원가입/로그인/마이페이지 (auth_router.py 대응)
//   - features/places/placesApi.js  → 장소/에어컨 등록 (places_router.py 대응)
//   - features/sensors/readingsApi.js → 센서 기록/추천 (readings_router.py 대응)
//   - features/location/locationApi.js → 위치 (locations_router.py 완성되면 추가 예정)
//
// 새 API 함수를 추가할 땐 여기 말고, 위 파일 중 자기 기능에 맞는 곳에
// 추가하세요. 이 파일(api.js)은 request()/토큰 관리처럼 "다 같이 쓰는
// 기반"만 남겨두는 곳입니다 — 여기 계속 함수를 늘리면 예전처럼 다시
// 한 파일에 다 모여서 merge 충돌이 잦아집니다.

// 로컬 개발에서는 VITE_API_BASE_URL을 사용할 수 있다.
// 환경변수가 없으면 현재 Render 백엔드 주소를 사용한다.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://dudeoji-makerthon.onrender.com";

const AUTH_TOKEN_KEY = "dudeoji_auth_token";

export function getStoredToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function clearAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function saveAuthToken(token) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export async function request(endpoint, options = {}) {
  const {
    auth = false,
    headers: optionHeaders,
    ...fetchOptions
  } = options;

  const headers = {
    "Content-Type": "application/json",
    ...optionHeaders,
  };

  if (auth) {
    const token = getStoredToken();

    if (!token) {
      throw new Error("로그인이 필요합니다.");
    }

    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `API 요청 실패: ${response.status}`;

    try {
      const errorData = await response.json();

      if (errorData.detail) {
        errorMessage = errorData.detail;
      }
    } catch {
      // JSON 오류 응답이 아니면 기본 메시지를 사용한다.
    }

    // 현재 비밀번호 오입력처럼 401을 쓰는 일반 오류가 있어도
    // 토큰을 바로 지우면 이후 모든 마이페이지 요청이
    // "로그인이 필요합니다."로 바뀌어 버린다.
    // 세션 자체가 만료/무효인 경우에만 토큰을 정리한다.
    const shouldClearToken =
      response.status === 401 &&
      (errorMessage.includes("로그인 정보가 유효하지") ||
        errorMessage.includes("로그인이 만료") ||
        errorMessage.includes("사용자 정보를 찾을 수"));

    if (shouldClearToken) {
      clearAuthToken();
    }

    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

