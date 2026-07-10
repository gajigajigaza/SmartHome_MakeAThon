// 로컬 개발에서는 VITE_API_BASE_URL을 사용할 수 있다.
// 환경변수가 없으면 현재 Render 백엔드 주소를 사용한다.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://dudeoji-makerthon.onrender.com";

const AUTH_TOKEN_KEY = "dudeoji_auth_token";

export function getStoredToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function clearAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

function saveAuthToken(token) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

async function request(endpoint, options = {}) {
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


export async function checkUsernameAvailability(username) {
  const query = new URLSearchParams({
    username: username.trim(),
  });

  return request(
    `/api/auth/check-username?${query.toString()}`,
  );
}

export async function createAccount(accountData) {
  const result = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(accountData),
  });

  saveAuthToken(result.token);
  return result;
}

// 계정·장소·에어컨을 한 번에 저장해 회원가입을 최종 완료한다.
export async function completeSignup(signupData) {
  const result = await request("/api/auth/signup-complete", {
    method: "POST",
    body: JSON.stringify(signupData),
  });

  saveAuthToken(result.token);
  return result;
}

export async function loginAccount(credentials) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });

  saveAuthToken(result.token);
  return result;
}

export async function getCurrentUser() {
  return request("/api/auth/me", { auth: true });
}

export async function logoutAccount() {
  try {
    await request("/api/auth/logout", {
      method: "POST",
      auth: true,
    });
  } finally {
    clearAuthToken();
  }
}

export async function verifyRecoveryIdentity(payload) {
  return request("/api/auth/recovery/verify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function resetPasswordWithToken(payload) {
  return request("/api/auth/recovery/reset", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchAirconModels(search = "") {
  const query = new URLSearchParams();
  const normalizedSearch = search.trim();

  if (normalizedSearch) {
    query.set("search", normalizedSearch);
  }

  query.set("limit", "50");

  const rows = await request(
    `/api/aircon-models?${query.toString()}`,
  );

  return rows.map((row) => ({
    id: row.id,
    manufacturer: row.manufacturer,
    productName: row.product_name || "제품명 미입력",
    modelNumber: row.model_number,
    type: row.aircon_type || "유형 미입력",
    ratedCoolingPowerW: row.rated_cooling_power_w,
    verificationStatus:
      row.verification_status || "DB 등록",
  }));
}

export async function createPlaceWithAircons(payload) {
  return request("/api/places", {
    method: "POST",
    auth: true,
    body: JSON.stringify(payload),
  });
}

export async function fetchMyPlaces() {
  return request("/api/places", { auth: true });
}

export async function getLatestReading() {
  return request("/api/readings/latest", { auth: true });
}

// minzoo 브랜치에서 이식: 최근 센서 기록 여러 개 조회 (센서 측정값 화면, 담당: 민주)
export async function getReadingHistory(limit = 8) {
  return request(`/api/readings/history?limit=${limit}`, { auth: true });
}

export async function getRecommendation() {
  return request("/api/recommendation", { auth: true });
}

export { API_BASE_URL };

export async function updateMyNickname(nickname) {
  return request("/api/auth/me/nickname", {
    method: "PATCH",
    auth: true,
    body: JSON.stringify({ nickname }),
  });
}

export async function updateMyPassword(payload) {
  return request("/api/auth/me/password", {
    method: "PATCH",
    auth: true,
    body: JSON.stringify(payload),
  });
}

export async function updateMyRecovery(payload) {
  return request("/api/auth/me/recovery", {
    method: "PATCH",
    auth: true,
    body: JSON.stringify(payload),
  });
}

export async function deleteMyAccount(password) {
  const result = await request("/api/auth/me", {
    method: "DELETE",
    auth: true,
    body: JSON.stringify({ password }),
  });

  // 계정 삭제가 성공했을 때만 저장된 로그인 토큰을 지운다.
  // 비밀번호 오입력 등으로 실패했을 때 토큰을 지우면
  // 이후 요청이 모두 "로그인이 필요합니다."로 바뀐다.
  clearAuthToken();
  return result;
}
