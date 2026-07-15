import { useEffect, useState } from "react";

import Dashboard from "../../App";
import "../../FlowApp.css";
import sproutMenuIcon from "../../assets/sprout-menu.svg";
import {
  clearAuthToken,
  getStoredToken,
} from "../../api";
import {
  completeSignup,
  getCurrentUser,
  checkUsernameAvailability,
  loginAccount,
  logoutAccount,
  resetPasswordWithToken,
  verifyRecoveryIdentity,
} from "./authApi";
import {
  createPlaceWithAircons,
  fetchMyPlaces,
} from "../places/placesApi";
// jh 수정함 - AirconPage(에어컨 등록 화면)를 별도 파일로 분리. createInitialAirconSlots도
// AirconPage가 다루는 에어컨 슬롯 데이터 모양에 속하는 헬퍼라 같이 옮김
import AirconPage, { createInitialAirconSlots } from "../places/AirconPage";
// jh 수정함 - Brand/Progress/AuthShell을 AirconPage와 공유하기 위해 별도 파일로 분리
import { AuthShell, Progress } from "./AuthShell";

let dudeojiToastTimerId = null;

function showInlineMessage(message) {
  if (typeof document === "undefined") {
    return;
  }

  const normalizedMessage = String(message || "알림을 확인해 주세요.");
  let toast = document.querySelector(".dudeoji-screen-message");

  if (!toast) {
    toast = document.createElement("div");
    toast.className = "dudeoji-screen-message";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  toast.textContent = normalizedMessage;
  toast.classList.add("show");

  if (dudeojiToastTimerId) {
    window.clearTimeout(dudeojiToastTimerId);
  }

  dudeojiToastTimerId = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

const RECOVERY_ITEMS = [
  { value: "acorn", label: "도토리", icon: "🌰" },
  { value: "leaf", label: "나뭇잎", icon: "🍃" },
  { value: "ice", label: "얼음", icon: "🧊" },
  { value: "bulb", label: "전구", icon: "💡" },
  { value: "shovel", label: "삽", icon: "🪏" },
  { value: "wind", label: "바람", icon: "🌀" },
];

function LoginPage({ onSignup, onLogin, onForgotPassword }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!username.trim() || !password) {
      alert("아이디와 비밀번호를 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      await onLogin({
        username: username.trim(),
        password,
      });
    } catch (error) {
      alert(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <section className="flow-card auth-card">
        <div className="flow-hero-icon flow-hero-image-wrap">
          <img
            src={sproutMenuIcon}
            alt="새싹 아이콘"
            className="flow-hero-image"
          />
        </div>

        <p className="flow-eyebrow">SMART COOLING</p>
        <h1>두더지와 에너지를 아껴봐요</h1>

        <p className="flow-description">
          로그인하고 우리 집 냉방 환경을 더 효율적으로
          관리해 보세요.
        </p>

        <form className="flow-form" onSubmit={handleSubmit}>
          <label>
            아이디
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value)
              }
              placeholder="아이디를 입력해 주세요"
            />
          </label>

          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="비밀번호를 입력해 주세요"
            />
          </label>

          <button
            className="forgot-password-link"
            type="button"
            onClick={onForgotPassword}
          >
            비밀번호를 잊으셨나요?
          </button>

          <button
            className="flow-primary-button"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <div className="flow-separator">
          <span>또는</span>
        </div>

        <button
          className="flow-secondary-button"
          type="button"
          onClick={onSignup}
          disabled={isSubmitting}
        >
          새 계정 만들기
        </button>
      </section>
    </AuthShell>
  );
}

function ForgotPasswordPage({ onBack, onComplete }) {
  const [username, setUsername] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [pin, setPin] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] =
    useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function verifyRecovery(event) {
    event.preventDefault();

    if (!username.trim() || !selectedItem || !/^\d{4}$/.test(pin)) {
      alert("가입 아이디, 복구 항목, 4자리 PIN을 확인해 주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await verifyRecoveryIdentity({
        username: username.trim(),
        recovery_item: selectedItem,
        recovery_pin: pin,
      });

      setRecoveryToken(result.recovery_token);
    } catch (error) {
      alert(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resetPassword(event) {
    event.preventDefault();

    if (newPassword.length < 8) {
      alert("새 비밀번호는 8자 이상 입력해 주세요.");
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      alert("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setIsSubmitting(true);

    try {
      await resetPasswordWithToken({
        recovery_token: recoveryToken,
        new_password: newPassword,
      });

      alert("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.");
      onComplete();
    } catch (error) {
      alert(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const verified = Boolean(recoveryToken);

  return (
    <AuthShell>
      <section className="flow-card wide-card password-recovery-card">
        <p className="flow-eyebrow">PASSWORD RECOVERY</p>
        <h1>비밀번호 찾기</h1>

        <p className="flow-description">
          가입할 때 설정한 복구 항목과 4자리 PIN으로
          본인 확인을 진행해 주세요.
        </p>

        {!verified ? (
          <form className="flow-form" onSubmit={verifyRecovery}>
            <label>
              가입 아이디
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                placeholder="가입한 아이디를 입력해 주세요"
              />
            </label>

            <fieldset className="recovery-item-fieldset">
              <legend>복구 항목</legend>

              <div className="secret-option-grid">
                {RECOVERY_ITEMS.map((option) => (
                  <button
                    className={
                      selectedItem === option.value
                        ? "selected"
                        : ""
                    }
                    type="button"
                    key={option.value}
                    onClick={() => setSelectedItem(option.value)}
                    aria-label={option.label}
                    title={option.label}
                  >
                    <span aria-hidden="true">{option.icon}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label>
              4자리 복구 PIN
              <input
                type="password"
                inputMode="numeric"
                maxLength="4"
                value={pin}
                onChange={(event) =>
                  setPin(
                    event.target.value
                      .replace(/\D/g, "")
                      .slice(0, 4),
                  )
                }
                placeholder="숫자 4자리"
              />
            </label>

            <div className="flow-button-row">
              <button
                className="flow-secondary-button"
                type="button"
                onClick={onBack}
                disabled={isSubmitting}
              >
                로그인으로
              </button>

              <button
                className="flow-primary-button"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "확인 중..." : "본인 확인"}
              </button>
            </div>
          </form>
        ) : (
          <form className="flow-form" onSubmit={resetPassword}>
            <div className="recovery-success-message">
              <span>✓</span>
              본인 확인이 완료되었습니다.
            </div>

            <label>
              새 비밀번호
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) =>
                  setNewPassword(event.target.value)
                }
                placeholder="8자 이상"
              />
            </label>

            <label>
              새 비밀번호 확인
              <input
                type="password"
                autoComplete="new-password"
                value={newPasswordConfirm}
                onChange={(event) =>
                  setNewPasswordConfirm(event.target.value)
                }
                placeholder="한 번 더 입력"
              />
            </label>

            <div className="flow-button-row">
              <button
                className="flow-secondary-button"
                type="button"
                onClick={onBack}
                disabled={isSubmitting}
              >
                취소
              </button>

              <button
                className="flow-primary-button"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "변경 중..." : "비밀번호 변경"}
              </button>
            </div>
          </form>
        )}
      </section>
    </AuthShell>
  );
}

function SignupPage({
  onBack,
  onNext,
  signupData,
  setSignupData,
  recovery,
  setRecovery,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameCheck, setUsernameCheck] = useState({
    status: "idle",
    message: "",
    username: "",
  });

  const normalizedUsername =
    signupData.username.trim().toLowerCase();

  const isUsernameFormatValid =
    /^[A-Za-z0-9_-]{4,20}$/.test(
      normalizedUsername,
    );

  const isUsernameAvailable =
    usernameCheck.status === "available" &&
    usernameCheck.username === normalizedUsername;

  async function handleUsernameCheck() {
    if (!isUsernameFormatValid) {
      setUsernameCheck({
        status: "invalid",
        message:
          "아이디는 영문, 숫자, 밑줄, 하이픈을 사용해 4~20자로 입력해 주세요.",
        username: normalizedUsername,
      });
      return;
    }

    setUsernameCheck({
      status: "checking",
      message: "아이디 중복을 확인하는 중입니다...",
      username: normalizedUsername,
    });

    try {
      const result = await checkUsernameAvailability(
        normalizedUsername,
      );

      setUsernameCheck({
        status: result.available ? "available" : "taken",
        message: result.message,
        username: result.username || normalizedUsername,
      });
    } catch (error) {
      setUsernameCheck({
        status: "error",
        message: error.message,
        username: normalizedUsername,
      });
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!signupData.nickname.trim()) {
      alert("별명을 입력해 주세요.");
      return;
    }

    if (!signupData.username || !signupData.password) {
      alert("아이디와 비밀번호를 입력해 주세요.");
      return;
    }

    if (!/^[A-Za-z0-9_-]{4,20}$/.test(signupData.username)) {
      alert(
        "아이디는 영문, 숫자, 밑줄, 하이픈을 사용해 4~20자로 입력해 주세요.",
      );
      return;
    }

    if (!isUsernameAvailable) {
      alert("아이디 중복 확인을 먼저 완료해 주세요.");
      return;
    }

    if (signupData.password.length < 8) {
      alert("비밀번호는 8자 이상 입력해 주세요.");
      return;
    }

    if (
      signupData.password !==
      signupData.passwordConfirm
    ) {
      alert("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    if (!recovery.item) {
      alert("비밀번호 복구 항목을 선택해 주세요.");
      return;
    }

    if (!/^\d{4}$/.test(recovery.pin)) {
      alert("복구 PIN은 숫자 4자리로 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      await onNext({
        nickname: signupData.nickname.trim(),
        username: signupData.username.trim(),
        password: signupData.password,
        recovery_item: recovery.item,
        recovery_pin: recovery.pin,
      });
    } catch (error) {
      alert(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <section className="flow-card wide-card">
        <Progress current={0} />

        <p className="flow-eyebrow">STEP 1 · 계정 설정</p>

        <h1>
          {signupData.nickname.trim()
            ? `${signupData.nickname.trim()} 계정 만들기`
            : "두더지 계정 만들기"}
        </h1>

        <p className="flow-description">
          계정 정보와 비밀번호 복구 정보를 설정해 주세요.
        </p>

        <form className="flow-form" onSubmit={handleSubmit}>
          <label>
            별명
            <input
              type="text"
              maxLength="12"
              value={signupData.nickname}
              onChange={(event) =>
                setSignupData((previous) => ({
                  ...previous,
                  nickname: event.target.value,
                }))
              }
              placeholder="예: 두두"
            />
          </label>

          <label className="username-check-field">
            아이디
            <div className="username-check-row">
              <input
                type="text"
                autoComplete="username"
                maxLength="20"
                value={signupData.username}
                onChange={(event) => {
                  setSignupData((previous) => ({
                    ...previous,
                    username: event.target.value,
                  }));

                  setUsernameCheck({
                    status: "idle",
                    message: "",
                    username: "",
                  });
                }}
                placeholder="영문·숫자 4~20자"
              />

              <button
                className="username-check-button"
                type="button"
                onClick={handleUsernameCheck}
                disabled={
                  isSubmitting ||
                  usernameCheck.status === "checking"
                }
              >
                {usernameCheck.status === "checking"
                  ? "확인 중"
                  : "중복 확인"}
              </button>
            </div>

            {usernameCheck.message && (
              <small
                className={`username-check-message ${usernameCheck.status}`}
              >
                {usernameCheck.message}
              </small>
            )}
          </label>

          <div className="flow-two-columns">
            <label>
              비밀번호
              <input
                type="password"
                value={signupData.password}
                onChange={(event) =>
                  setSignupData((previous) => ({
                    ...previous,
                    password: event.target.value,
                  }))
                }
                placeholder="8자 이상"
              />
            </label>

            <label>
              비밀번호 확인
              <input
                type="password"
                value={signupData.passwordConfirm}
                onChange={(event) =>
                  setSignupData((previous) => ({
                    ...previous,
                    passwordConfirm:
                      event.target.value,
                  }))
                }
                placeholder="한 번 더 입력"
              />
            </label>
          </div>

          <div className="recovery-divider">
            <span>비밀번호 복구 설정</span>
          </div>

          <section className="recovery-section">
            <div className="recovery-section-heading">
              <span>🔐</span>

              <div>
                <strong>
                  비밀 소품과 4자리 복구 PIN을 설정해 주세요.
                </strong>

                <p>
                  이 정보는 비밀번호를 재설정할 때만 사용됩니다.
                </p>
              </div>
            </div>

            <div className="recovery-grid">
              <fieldset className="recovery-item-fieldset">
                <legend>복구 항목</legend>

                <div className="secret-option-grid">
                  {RECOVERY_ITEMS.map((option) => (
                    <button
                      className={
                        recovery.item === option.value
                          ? "selected"
                          : ""
                      }
                      type="button"
                      key={option.value}
                      onClick={() =>
                        setRecovery((previous) => ({
                          ...previous,
                          item: option.value,
                        }))
                      }
                      aria-label={option.label}
                      title={option.label}
                    >
                      <span aria-hidden="true">{option.icon}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="recovery-pin-field">
                4자리 복구 PIN
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength="4"
                  value={recovery.pin}
                  onChange={(event) =>
                    setRecovery((previous) => ({
                      ...previous,
                      pin: event.target.value
                        .replace(/\D/g, "")
                        .slice(0, 4),
                    }))
                  }
                  placeholder="숫자 4자리"
                />
              </label>
            </div>
          </section>

          <div className="flow-button-row signup-action-row">
            <button
              className="flow-secondary-button"
              type="button"
              onClick={onBack}
              disabled={isSubmitting}
            >
              로그인으로
            </button>

            <button
              className="flow-primary-button"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "확인 중..."
                : "에어컨 등록하기"}
            </button>
          </div>
        </form>
      </section>
    </AuthShell>
  );
}

function FlowApp() {
  const [screen, setScreen] = useState("loading");
  const [currentUser, setCurrentUser] = useState(null);
  const [shouldShowInitialTutorial, setShouldShowInitialTutorial] =
    useState(false);

  // 1단계에서 검증한 가입 정보는 에어컨 등록이 끝날 때까지
  // 브라우저 메모리에만 보관하고 DB에는 아직 저장하지 않는다.
  const [pendingSignup, setPendingSignup] = useState(null);

  const [signupData, setSignupData] = useState({
    nickname: "",
    username: "",
    password: "",
    passwordConfirm: "",
  });

  const [recovery, setRecovery] = useState({
    item: "",
    pin: "",
  });

  const [registeredAircons, setRegisteredAircons] =
    useState(createInitialAirconSlots);

  useEffect(() => {
    const originalAlert = window.alert;

    window.alert = (message) => {
      showInlineMessage(message);
    };

    return () => {
      window.alert = originalAlert;
    };
  }, []);

  useEffect(() => {
    let ignoreResult = false;

    async function restoreSession() {
      if (!getStoredToken()) {
        setScreen("login");
        return;
      }

      try {
        const user = await getCurrentUser();
        const places = await fetchMyPlaces();

        if (!ignoreResult) {
          setCurrentUser(user);
          setShouldShowInitialTutorial(false);
          setScreen(places.length > 0 ? "dashboard" : "aircon");
        }
      } catch {
        clearAuthToken();

        if (!ignoreResult) {
          setScreen("login");
        }
      }
    }

    restoreSession();

    return () => {
      ignoreResult = true;
    };
  }, []);

  function handleSignup(payload) {
    // 계정은 아직 생성하지 않고 2단계 입력을 위해 임시 저장만 한다.
    // 2단계에서 이전을 눌렀다가 다시 넘어온 경우에는
    // 이미 선택한 에어컨 정보를 그대로 유지한다.
    if (!pendingSignup) {
      setRegisteredAircons(createInitialAirconSlots());
    }

    setPendingSignup(payload);
    setScreen("aircon");
  }

  async function handleLogin(credentials) {
    const authResult = await loginAccount(credentials);
    const places = await fetchMyPlaces();

    setCurrentUser(authResult.user);
    setShouldShowInitialTutorial(false);
    setRegisteredAircons(createInitialAirconSlots());
    setScreen(places.length > 0 ? "dashboard" : "aircon");
  }

  async function handleLogout() {
    try {
      await logoutAccount();
    } finally {
      setCurrentUser(null);
      setShouldShowInitialTutorial(false);
      setPendingSignup(null);
      setRegisteredAircons(createInitialAirconSlots());
      setScreen("login");
    }
  }

  function handleUserUpdated(updatedUser) {
    setCurrentUser((previousUser) => ({
      ...(previousUser || {}),
      ...updatedUser,
    }));
  }

  function handleAccountDeleted() {
    clearAuthToken();
    setCurrentUser(null);
    setShouldShowInitialTutorial(false);
    setPendingSignup(null);
    setRegisteredAircons(createInitialAirconSlots());
    setScreen("login");
  }

  async function handleAirconBack() {
    if (pendingSignup) {
      setScreen("signup");
      return;
    }

    // 이전 버전에서 계정만 생성된 상태로 로그인한 경우에는
    // 뒤로갈 때 세션을 정리하고 로그인 화면으로 이동한다.
    await handleLogout();
  }

  async function handleAirconComplete(placeName, aircons, lat, lon) {
    const payload = {
      place_name: placeName,
      // jh 수정함 - 위치 검색을 안 했으면 lat/lon은 null로 전달됨
      lat: lat ?? null,
      lon: lon ?? null,
      aircons: aircons.map((aircon) => ({
        nickname: aircon.roomName,
        aircon_model_id:
          aircon.powerSource === "database"
            ? Number(aircon.airconId)
            : null,
        manufacturer: aircon.manufacturer,
        product_name: aircon.productName || null,
        model_number: aircon.modelNumber || null,
        aircon_type: aircon.airconType || null,
        rated_cooling_power_w:
          aircon.ratedCoolingPowerW,
        power_source: aircon.powerSource,
        verification_status:
          aircon.verificationStatus || null,
        estimated_min_power_w:
          aircon.estimatedMinPowerW || null,
        estimated_max_power_w:
          aircon.estimatedMaxPowerW || null,
      })),
    };

    if (pendingSignup) {
      const authResult = await completeSignup({
        ...pendingSignup,
        ...payload,
      });

      localStorage.setItem(
        `dudeoji-profile-badge-${authResult.user.username}`,
        "sprout",
      );
      setCurrentUser(authResult.user);
      setPendingSignup(null);
      setShouldShowInitialTutorial(true);
      setScreen("dashboard");
      return;
    }

    // 이전 버전에서 이미 계정만 생성된 사용자는 로그인 후
    // 이 경로로 에어컨 등록을 이어서 완료할 수 있다.
    await createPlaceWithAircons(payload);
    setScreen("dashboard");
  }

  if (screen === "loading") {
    return (
      <AuthShell>
        <section className="flow-card auth-card flow-loading-card">
          <div className="flow-hero-icon flow-hero-image-wrap">
            <img
              src={sproutMenuIcon}
              alt="새싹 아이콘"
              className="flow-hero-image"
            />
          </div>
          <h1>로그인 상태를 확인하고 있어요</h1>
          <p className="flow-description">
            잠시만 기다려 주세요.
          </p>
        </section>
      </AuthShell>
    );
  }

  if (screen === "dashboard") {
    return (
      <Dashboard
        user={currentUser}
        nickname={currentUser?.nickname || "두더지"}
        onLogout={handleLogout}
        onUserUpdated={handleUserUpdated}
        onAccountDeleted={handleAccountDeleted}
        showTutorialOnFirstVisit={shouldShowInitialTutorial}
        onTutorialShown={() => setShouldShowInitialTutorial(false)}
      />
    );
  }

  if (screen === "forgot-password") {
    return (
      <ForgotPasswordPage
        onBack={() => setScreen("login")}
        onComplete={() => setScreen("login")}
      />
    );
  }

  if (screen === "signup") {
    return (
      <SignupPage
        signupData={signupData}
        setSignupData={setSignupData}
        recovery={recovery}
        setRecovery={setRecovery}
        onBack={() => {
          setPendingSignup(null);
          setScreen("login");
        }}
        onNext={handleSignup}
      />
    );
  }

  if (screen === "aircon") {
    return (
      <AirconPage
        registeredAircons={registeredAircons}
        setRegisteredAircons={setRegisteredAircons}
        onBack={handleAirconBack}
        onComplete={handleAirconComplete}
      />
    );
  }

  return (
    <LoginPage
      onSignup={() => {
        setPendingSignup(null);
        setSignupData({
          nickname: "",
          username: "",
          password: "",
          passwordConfirm: "",
        });
        setRecovery({ item: "", pin: "" });
        setRegisteredAircons(createInitialAirconSlots());
        setScreen("signup");
      }}
      onLogin={handleLogin}
      onForgotPassword={() =>
        setScreen("forgot-password")
      }
    />
  );
}

export default FlowApp;
