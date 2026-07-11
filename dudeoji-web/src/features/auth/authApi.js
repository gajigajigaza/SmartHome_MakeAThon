// src/features/auth/authApi.js
// 담당: 류은
//
// 백엔드 routers/auth_router.py(/api/auth/*)에 1:1로 대응합니다.
// 회원가입/로그인 + 마이페이지(닉네임/비번/복구정보/탈퇴)를 여기서 다룹니다.
import { clearAuthToken, request, saveAuthToken } from "../../api";

export async function checkUsernameAvailability(username) {
  const query = new URLSearchParams({
    username: username.trim(),
  });

  return request(`/api/auth/check-username?${query.toString()}`);
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
