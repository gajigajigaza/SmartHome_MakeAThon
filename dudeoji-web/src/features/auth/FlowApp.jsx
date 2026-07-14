import { useEffect, useRef, useState } from "react";

import Dashboard from "../../App";
import "../../FlowApp.css";
import sproutMenuIcon from "../../assets/sprout-menu.svg";
import {
  clearAuthToken,
  getStoredToken,
  request, // jh 수정함 - 위치 검색(GET /places/geocode) 호출에 재사용
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
  fetchAirconModels,
  fetchMyPlaces,
} from "../places/placesApi";

// 현재는 화면 흐름 테스트를 위한 임시 유사 제품 추정 기준이다.
// 이후 Supabase의 실제 제품 표본 중앙값으로 교체한다.
const ESTIMATE_PROFILES = [
  {
    id: "wall-6",
    type: "벽걸이형",
    areaLabel: "약 6평",
    representativePowerW: 700,
    minPowerW: 600,
    maxPowerW: 800,
    sampleCount: 4,
  },
  {
    id: "wall-9",
    type: "벽걸이형",
    areaLabel: "약 9평",
    representativePowerW: 950,
    minPowerW: 800,
    maxPowerW: 1100,
    sampleCount: 4,
  },
  {
    id: "wall-16",
    type: "벽걸이형",
    areaLabel: "약 16평",
    representativePowerW: 1950,
    minPowerW: 1700,
    maxPowerW: 2200,
    sampleCount: 3,
  },
  {
    id: "stand-17",
    type: "스탠드형",
    areaLabel: "약 17평",
    representativePowerW: 2050,
    minPowerW: 1800,
    maxPowerW: 2300,
    sampleCount: 5,
  },
  {
    id: "stand-19",
    type: "스탠드형",
    areaLabel: "약 19평",
    representativePowerW: 2250,
    minPowerW: 2000,
    maxPowerW: 2500,
    sampleCount: 4,
  },
  {
    id: "combo-17-6",
    type: "2in1",
    areaLabel: "스탠드 17평 + 벽걸이 6평",
    representativePowerW: 2200,
    minPowerW: 2000,
    maxPowerW: 2400,
    sampleCount: 4,
  },
  {
    id: "window-6",
    type: "창문형",
    areaLabel: "약 5~7평",
    representativePowerW: 850,
    minPowerW: 700,
    maxPowerW: 1000,
    sampleCount: 3,
  },
  {
    id: "portable-7",
    type: "이동식",
    areaLabel: "약 5~8평",
    representativePowerW: 1250,
    minPowerW: 1000,
    maxPowerW: 1500,
    sampleCount: 3,
  },
];




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

function Brand() {
  return (
    <div className="flow-brand">
      <div className="flow-logo">
        <img
          src={sproutMenuIcon}
          alt="새싹 로고"
          className="flow-logo-image"
        />
      </div>

      <div>
        <strong>두더지</strong>
        <span>더 효율적인 냉방 선택을 지능적으로</span>
      </div>
    </div>
  );
}

function Progress({ current }) {
  const steps = ["계정 설정", "에어컨 등록", "완료"];

  return (
    <div className="flow-progress">
      {steps.map((step, index) => (
        <div
          className={`flow-progress-item ${
            index <= current ? "active" : ""
          }`}
          key={step}
        >
          <span>{index + 1}</span>
          <small>{step}</small>
        </div>
      ))}
    </div>
  );
}

function AuthShell({ children }) {
  return (
    <div className="flow-page">
      <header className="flow-topbar">
        <Brand />
      </header>

      <main className="flow-center">{children}</main>
    </div>
  );
}

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

function AirconPage({
  registeredAircons,
  setRegisteredAircons,
  onBack,
  onComplete,
}) {
  const [placeName, setPlaceName] =
    useState("우리 집");

  // jh 수정함 - 위치 검색(선택사항). 검색 안 하면 lat/lon은 null로 유지된다.
  // 탭: "주소로 찾기" / "현재 위치로 찾기"
  const [locationMode, setLocationMode] = useState("address");
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResults, setAddressResults] = useState([]);
  const [isAddressSearching, setIsAddressSearching] = useState(false);
  const [addressSearchError, setAddressSearchError] = useState("");
  // "현재 위치로 찾기" 탭 전용 표시 문구("현재 위치: {주소}"). 주소 검색 탭은
  // 선택한 주소를 addressQuery(입력창 값) 자체로 표시하므로 이 상태를 쓰지 않는다.
  const [currentLocationLabel, setCurrentLocationLabel] = useState("");
  const [placeLat, setPlaceLat] = useState(null);
  const [placeLon, setPlaceLon] = useState(null);
  const [isLocatingCurrentPosition, setIsLocatingCurrentPosition] =
    useState(false);
  const [currentLocationError, setCurrentLocationError] = useState("");
  // 검색 결과를 선택하면 addressQuery를 그 주소로 채우는데, 이때 디바운스
  // 검색 effect가 곧바로 다시 실행되면서 방금 고른 결과로 또 검색해
  // 드롭다운이 재등장하는 걸 막기 위한 플래그
  const skipNextAddressSearchRef = useRef(false);
  // jh 수정함 - 탭을 전환한 뒤에 이전 현재위치 요청(navigator.geolocation)이
  // 뒤늦게 응답해서 상태를 덮어쓰는 걸 막기 위한 요청 토큰
  const currentLocationRequestIdRef = useRef(0);

  // 현재 어떤 등록 칸에서 에어컨을 선택 중인지 저장한다.
  const [selectingIndex, setSelectingIndex] =
    useState(null);

  // 선택 팝업 안에서 현재 보여줄 화면을 저장한다.
  const [selectorView, setSelectorView] =
    useState("list");

  // 제조사·제품명·모델명 검색어
  const [searchTerm, setSearchTerm] =
    useState("");

  // Supabase API에서 불러온 에어컨 제품 목록
  const [airconModels, setAirconModels] = useState([]);
  const [isAirconLoading, setIsAirconLoading] =
    useState(false);
  const [airconLoadError, setAirconLoadError] =
    useState("");
  const [isSaving, setIsSaving] = useState(false);

  // 직접 입력 화면의 값
  const [manualForm, setManualForm] = useState({
    manufacturer: "",
    modelNumber: "",
    ratedPowerW: "",
  });

  // 유사 제품 추정 화면의 값
  const [estimateForm, setEstimateForm] = useState({
    manufacturer: "",
    modelNumber: "",
    profileId: "",
  });

  // 현재 제목을 수정 중인 항목을 저장한다.
  const [editingIndex, setEditingIndex] =
    useState(null);

  const [editingTitle, setEditingTitle] =
    useState("");

  const filteredAircons = airconModels;

  const selectedEstimateProfile =
    ESTIMATE_PROFILES.find(
      (profile) =>
        profile.id === estimateForm.profileId,
    );

  useEffect(() => {
    if (selectingIndex === null || selectorView !== "list") {
      return undefined;
    }

    let ignoreResult = false;

    const timerId = window.setTimeout(async () => {
      setIsAirconLoading(true);
      setAirconLoadError("");

      try {
        const models = await fetchAirconModels(searchTerm);

        if (!ignoreResult) {
          setAirconModels(models);
        }
      } catch (error) {
        if (!ignoreResult) {
          setAirconModels([]);
          setAirconLoadError(error.message);
        }
      } finally {
        if (!ignoreResult) {
          setIsAirconLoading(false);
        }
      }
    }, 250);

    return () => {
      ignoreResult = true;
      window.clearTimeout(timerId);
    };
  }, [searchTerm, selectingIndex, selectorView]);

  // jh 수정함 - 위치 검색: GET /places/geocode를 300ms 디바운스로 호출.
  // 검색 결과를 방금 선택해서 addressQuery가 바뀐 경우(skipNextAddressSearchRef)엔
  // 같은 텍스트로 또 검색해서 드롭다운이 다시 뜨는 걸 막는다.
  useEffect(() => {
    if (skipNextAddressSearchRef.current) {
      skipNextAddressSearchRef.current = false;
      setAddressResults([]);
      setAddressSearchError("");
      return undefined;
    }

    const trimmedQuery = addressQuery.trim();

    if (!trimmedQuery) {
      setAddressResults([]);
      setAddressSearchError("");
      return undefined;
    }

    let ignoreResult = false;
    setIsAddressSearching(true);
    setAddressSearchError("");

    const timerId = window.setTimeout(async () => {
      try {
        // jh 수정함 - 회원가입 도중(로그인 전, 토큰 없음)에도 호출해야 해서
        // 인증 없이 요청한다(백엔드도 이 엔드포인트는 인증을 요구하지 않음).
        const results = await request(
          `/api/places/geocode?query=${encodeURIComponent(trimmedQuery)}`,
        );

        if (!ignoreResult) {
          setAddressResults(results);
        }
      } catch (error) {
        if (!ignoreResult) {
          setAddressResults([]);
          setAddressSearchError(error.message);
        }
      } finally {
        if (!ignoreResult) {
          setIsAddressSearching(false);
        }
      }
    }, 300);

    return () => {
      ignoreResult = true;
      window.clearTimeout(timerId);
    };
  }, [addressQuery]);

  // jh 수정함 - 검색 결과 선택: lat/lon 저장 + 입력창 값 자체를 선택한 주소로 채움(자동완성처럼).
  // 다시 타이핑을 시작하면(=addressQuery가 또 바뀌면) 위 effect가 정상적으로 재검색한다.
  function selectAddressResult(result) {
    setPlaceLat(result.lat);
    setPlaceLon(result.lon);
    setCurrentLocationLabel("");
    skipNextAddressSearchRef.current = true;
    setAddressQuery(result.address);
    setAddressResults([]);
  }

  // jh 수정함 - ESC로 검색어/드롭다운만 취소, 이미 확정된 선택(placeLat/placeLon)은 그대로 둔다
  function handleAddressInputKeyDown(event) {
    if (event.key === "Escape") {
      setAddressQuery("");
      setAddressResults([]);
    }
  }

  // jh 수정함 - "위치 선택 취소" 버튼을 눌렀을 때 선택값(양쪽 탭 표시 상태 포함)을 초기화한다
  function clearSelectedLocation() {
    // 진행 중이던 현재 위치 요청이 있으면 나중에 응답이 와도 무시하게 만든다
    currentLocationRequestIdRef.current += 1;
    setPlaceLat(null);
    setPlaceLon(null);
    setAddressQuery("");
    setAddressResults([]);
    setAddressSearchError("");
    setCurrentLocationLabel("");
    setCurrentLocationError("");
    setIsLocatingCurrentPosition(false);
  }

  // jh 수정함 - 탭을 전환하면 이전 탭에서 선택했던 위치(placeLat/placeLon,
  // 양쪽 탭의 입력창 상태)를 전부 초기화한 뒤 탭을 바꾼다
  function switchLocationMode(nextMode) {
    if (nextMode === locationMode) {
      return;
    }

    clearSelectedLocation();
    setLocationMode(nextMode);
  }

  // jh 수정함 - "현재 위치로 찾기" 탭: navigator.geolocation으로 lat/lon을 받고,
  // GET /places/reverse-geocode로 그 좌표를 실제 주소 문자열로 바꿔서 같이 보여준다.
  // 성공하면 버튼 자리가 주소 탭과 같은 place-address-input(selected) 입력창으로 바뀐다.
  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setCurrentLocationError(
        "이 브라우저는 위치 정보 조회를 지원하지 않습니다. 주소로 찾기를 이용해 주세요.",
      );
      return;
    }

    const requestId = ++currentLocationRequestIdRef.current;
    setIsLocatingCurrentPosition(true);
    setCurrentLocationError("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        // jh 수정함 - 요청 도중 탭이 바뀌었으면(=취소/재요청됨) 이 응답은 버린다
        if (currentLocationRequestIdRef.current !== requestId) {
          return;
        }

        const { latitude, longitude } = position.coords;
        setPlaceLat(latitude);
        setPlaceLon(longitude);

        let resolvedLabel = "현재 위치로 설정됨";

        try {
          const result = await request(
            `/api/places/reverse-geocode?lat=${latitude}&lon=${longitude}`,
          );

          if (result.address) {
            resolvedLabel = `현재 위치: ${result.address}`;
          }
        } catch {
          // jh 수정함 - 주소 변환이 실패해도 좌표는 이미 받았으니 선택 자체는 유지한다
        }

        if (currentLocationRequestIdRef.current !== requestId) {
          return;
        }

        setCurrentLocationLabel(resolvedLabel);
        setIsLocatingCurrentPosition(false);
      },
      () => {
        if (currentLocationRequestIdRef.current !== requestId) {
          return;
        }

        setCurrentLocationError(
          "위치 권한이 거부되었거나 위치를 가져오지 못했습니다. 주소로 찾기를 이용해 주세요.",
        );
        setIsLocatingCurrentPosition(false);
      },
    );
  }

  function resetSelectorForms() {
    setSearchTerm("");
    setSelectorView("list");
    setManualForm({
      manufacturer: "",
      modelNumber: "",
      ratedPowerW: "",
    });
    setEstimateForm({
      manufacturer: "",
      modelNumber: "",
      profileId: "",
    });
  }

  function openAirconSelector(index) {
    setEditingIndex(null);
    resetSelectorForms();
    setSelectingIndex(index);
  }

  function closeAirconSelector() {
    setSelectingIndex(null);
    resetSelectorForms();
  }

  function updateSelectedSlot(newData) {
    setRegisteredAircons((previous) =>
      previous.map((registered, index) =>
        index === selectingIndex
          ? {
              ...registered,
              ...newData,
              icon: "❄️",
            }
          : registered,
      ),
    );
  }

  function selectAircon(aircon) {
    updateSelectedSlot({
      airconId: aircon.id,
      manufacturer: aircon.manufacturer,
      productName: aircon.productName,
      airconType: aircon.type,
      name: `${aircon.manufacturer} ${aircon.productName}`,
      modelNumber: aircon.modelNumber,
      model: `${aircon.modelNumber} · ${aircon.ratedCoolingPowerW.toLocaleString("ko-KR")}W`,
      ratedCoolingPowerW:
        aircon.ratedCoolingPowerW,
      powerSource: "database",
      verificationStatus:
        aircon.verificationStatus,
      estimatedMinPowerW: null,
      estimatedMaxPowerW: null,
    });

    closeAirconSelector();
  }

  function saveManualAircon(event) {
    event.preventDefault();

    const manufacturer =
      manualForm.manufacturer.trim();
    const modelNumber =
      manualForm.modelNumber.trim();
    const ratedPowerW = Number(
      manualForm.ratedPowerW,
    );

    // 제조사는 필수지만 모델명은 모를 수 있으므로 선택사항으로 둔다.
    if (!manufacturer) {
      alert("제조사를 입력해 주세요.");
      return;
    }

    if (
      !Number.isInteger(ratedPowerW) ||
      ratedPowerW <= 0 ||
      ratedPowerW > 20000
    ) {
      alert(
        "정격 냉방 소비전력을 1~20,000W 사이의 숫자로 입력해 주세요.",
      );
      return;
    }

    const displayedModelNumber =
      modelNumber || "모델명 미입력";

    updateSelectedSlot({
      airconId: `manual-${Date.now()}`,
      manufacturer,
      productName: null,
      airconType: null,
      name: modelNumber
        ? `${manufacturer} ${modelNumber}`
        : manufacturer,
      modelNumber: modelNumber || null,
      model: `${displayedModelNumber} · ${ratedPowerW.toLocaleString("ko-KR")}W · 직접 입력`,
      ratedCoolingPowerW: ratedPowerW,
      powerSource: "user_input",
      verificationStatus: "미확인",
      estimatedMinPowerW: null,
      estimatedMaxPowerW: null,
    });

    closeAirconSelector();
  }

  function saveEstimatedAircon(event) {
    event.preventDefault();

    const manufacturer =
      estimateForm.manufacturer.trim();
    const modelNumber =
      estimateForm.modelNumber.trim();

    // 유사 제품 추정에서도 모델명은 선택사항이다.
    if (!manufacturer) {
      alert("제조사를 입력해 주세요.");
      return;
    }

    if (!selectedEstimateProfile) {
      alert("비슷한 제품 유형을 선택해 주세요.");
      return;
    }

    const displayedModelNumber =
      modelNumber || "모델명 미입력";

    updateSelectedSlot({
      airconId: `estimated-${Date.now()}`,
      manufacturer,
      productName: null,
      airconType: selectedEstimateProfile.type,
      name: modelNumber
        ? `${manufacturer} ${modelNumber}`
        : manufacturer,
      modelNumber: modelNumber || null,
      model: `${displayedModelNumber} · 약 ${selectedEstimateProfile.representativePowerW.toLocaleString("ko-KR")}W · 추정`,
      ratedCoolingPowerW:
        selectedEstimateProfile.representativePowerW,
      powerSource: "estimated",
      verificationStatus: "추정값",
      estimatedMinPowerW:
        selectedEstimateProfile.minPowerW,
      estimatedMaxPowerW:
        selectedEstimateProfile.maxPowerW,
      estimateProfileId:
        selectedEstimateProfile.id,
      estimateSampleCount:
        selectedEstimateProfile.sampleCount,
    });

    closeAirconSelector();
  }

  function startEditingTitle(index) {
    setSelectingIndex(null);
    setEditingIndex(index);
    setEditingTitle(
      registeredAircons[index]?.roomName || "",
    );
  }

  function saveEditingTitle() {
    if (editingIndex === null) {
      return;
    }

    const trimmedTitle = editingTitle.trim();

    if (!trimmedTitle) {
      alert("에어컨 이름을 입력해 주세요.");
      return;
    }

    setRegisteredAircons((previous) =>
      previous.map((aircon, index) =>
        index === editingIndex
          ? {
              ...aircon,
              roomName: trimmedTitle,
            }
          : aircon,
      ),
    );

    setEditingIndex(null);
    setEditingTitle("");
  }

  function handleTitleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      saveEditingTitle();
    }

    if (event.key === "Escape") {
      setEditingIndex(null);
      setEditingTitle("");
    }
  }

  function deleteAircon(index) {
    setRegisteredAircons((previous) =>
      previous.filter(
        (_, airconIndex) => airconIndex !== index,
      ),
    );

    if (selectingIndex === index) {
      closeAirconSelector();
    }

    if (editingIndex === index) {
      setEditingIndex(null);
      setEditingTitle("");
    }
  }

  function addAirconSlot() {
    const newIndex = registeredAircons.length;

    setRegisteredAircons((previous) => [
      ...previous,
      {
        slotId: `aircon-slot-${Date.now()}`,
        roomName: `에어컨 ${previous.length + 1}`,
        airconId: "",
        name: "에어컨을 선택해 주세요",
        model: "등록된 에어컨 목록에서 선택",
        icon: "❄️",
        ratedCoolingPowerW: null,
        powerSource: "",
      },
    ]);

    // 새 항목을 추가하면 바로 에어컨 선택창을 연다.
    setEditingIndex(null);
    resetSelectorForms();
    setSelectingIndex(newIndex);
  }

  async function handleComplete() {
    if (!placeName.trim()) {
      alert("장소 이름을 입력해 주세요.");
      return;
    }

    if (registeredAircons.length === 0) {
      alert("에어컨을 한 대 이상 추가해 주세요.");
      return;
    }

    const hasEmptyAircon = registeredAircons.some(
      (aircon) =>
        !aircon.airconId ||
        !aircon.ratedCoolingPowerW,
    );

    if (hasEmptyAircon) {
      alert("추가한 에어컨을 모두 등록해 주세요.");
      return;
    }

    setIsSaving(true);

    try {
      // jh 수정함 - 위치 검색을 안 했으면 placeLat/placeLon은 null 그대로 전달
      await onComplete(
        placeName.trim(),
        registeredAircons,
        placeLat,
        placeLon,
      );
    } catch (error) {
      alert(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function getSelectorTitle() {
    if (selectorView === "missing") {
      return "소비전력 등록 방법";
    }

    if (selectorView === "manual") {
      return "소비전력 직접 입력";
    }

    if (selectorView === "estimate") {
      return "유사 제품으로 추정";
    }

    return "에어컨 선택";
  }

  return (
    <AuthShell>
      <section className="flow-card wide-card">
        <Progress current={1} />

        <p className="flow-eyebrow">STEP 2 · 에어컨 등록</p>
        <h1>사용할 에어컨을 등록해 주세요</h1>

        <p className="flow-description">
          이름을 누르면 제목을 수정할 수 있고, 오른쪽
          화살표를 누르면 에어컨 종류를 선택할 수 있습니다.
        </p>

        <label className="place-field">
          장소 이름
          <input
            type="text"
            value={placeName}
            onChange={(event) =>
              setPlaceName(event.target.value)
            }
            placeholder="예: 우리 집, 자취방, 사무실"
          />
        </label>

        {/* jh 수정함 - 위치 검색(선택). 검색 안 해도 장소 등록은 그대로 진행됨 */}
        <div className="place-field place-address-field">
          <span className="place-address-field-label">위치 검색 (선택)</span>

          <div className="place-location-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={locationMode === "address"}
              className={locationMode === "address" ? "active" : ""}
              onClick={() => switchLocationMode("address")}
            >
              주소로 찾기
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={locationMode === "current"}
              className={locationMode === "current" ? "active" : ""}
              onClick={() => switchLocationMode("current")}
            >
              현재 위치로 찾기
            </button>
          </div>

          {locationMode === "address" ? (
            <div className="place-location-panel">
              {/* jh 수정함 - 선택한 주소는 별도 표시 줄 없이 입력창 값 자체로 보여줌(자동완성처럼).
                  편집은 그대로 가능하고, 다시 타이핑하면 위 디바운스 effect가 재검색한다. */}
              <input
                type="text"
                className={
                  placeLat !== null && placeLon !== null
                    ? "place-address-input selected"
                    : "place-address-input"
                }
                value={addressQuery}
                onChange={(event) => setAddressQuery(event.target.value)}
                onKeyDown={handleAddressInputKeyDown}
                placeholder="예: 서울 강남구 테헤란로, 강남역 스타벅스"
              />

              {isAddressSearching && (
                <small className="place-address-status">검색 중...</small>
              )}

              {!isAddressSearching && addressSearchError && (
                <small className="place-address-status error">
                  {addressSearchError}
                </small>
              )}

              {addressResults.length > 0 && (
                <ul className="place-address-results">
                  {addressResults.map((result, index) => (
                    <li key={`${result.address}-${index}`}>
                      <button
                        type="button"
                        className="place-address-result-card"
                        onClick={() => selectAddressResult(result)}
                      >
                        <span className="place-address-result-icon">📍</span>
                        <span>{result.address}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* jh 수정함 - "위치 선택 취소"를 탭 안에서 오른쪽 정렬로 배치 */}
              {placeLat !== null &&
                placeLon !== null &&
                addressResults.length === 0 && (
                  <div className="place-location-clear-row">
                    <button
                      type="button"
                      className="place-address-clear-link"
                      onClick={clearSelectedLocation}
                    >
                      위치 선택 취소
                    </button>
                  </div>
                )}
            </div>
          ) : (
            <div className="place-location-panel">
              {/* jh 수정함 - 주소 탭과 같은 패턴: 성공하면 버튼 자리가
                  place-address-input(selected) 스타일의 읽기 전용 입력창으로 바뀐다 */}
              {currentLocationLabel ? (
                <input
                  type="text"
                  className="place-address-input selected"
                  value={currentLocationLabel}
                  readOnly
                />
              ) : (
                <button
                  type="button"
                  className="place-current-location-button"
                  onClick={handleUseCurrentLocation}
                  disabled={isLocatingCurrentPosition}
                >
                  {isLocatingCurrentPosition
                    ? "위치 확인 중..."
                    : "📍 현재 위치 가져오기"}
                </button>
              )}

              {currentLocationError && (
                <div className="place-address-status error place-current-location-error">
                  <p>{currentLocationError}</p>
                  <button
                    type="button"
                    onClick={() => switchLocationMode("address")}
                  >
                    주소로 찾기로 전환
                  </button>
                </div>
              )}

              {/* jh 수정함 - "위치 선택 취소"를 탭 안에서 오른쪽 정렬로 배치 */}
              {placeLat !== null && placeLon !== null && (
                <div className="place-location-clear-row">
                  <button
                    type="button"
                    className="place-address-clear-link"
                    onClick={clearSelectedLocation}
                  >
                    위치 선택 취소
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="aircon-list">
          {registeredAircons.map((aircon, index) => (
            <div
              className="aircon-option"
              key={aircon.slotId}
            >
              <button
                className="aircon-delete-button"
                type="button"
                onClick={() => deleteAircon(index)}
                aria-label={`${aircon.roomName} 삭제`}
                title="에어컨 삭제"
              >
                <span className="aircon-default-icon">
                  ❄️
                </span>

                <span className="aircon-trash-icon">
                  🗑️
                </span>
              </button>

              <div className="aircon-info">
                {editingIndex === index ? (
                  <input
                    className="aircon-title-input"
                    type="text"
                    maxLength="20"
                    value={editingTitle}
                    onChange={(event) =>
                      setEditingTitle(
                        event.target.value,
                      )
                    }
                    onKeyDown={handleTitleKeyDown}
                    onBlur={saveEditingTitle}
                    autoFocus
                    aria-label="에어컨 이름 수정"
                  />
                ) : (
                  <button
                    className="aircon-title-button"
                    type="button"
                    onClick={() =>
                      startEditingTitle(index)
                    }
                    title="이름 수정"
                  >
                    <strong>{aircon.roomName}</strong>
                  </button>
                )}

                <small>
                  {aircon.airconId
                    ? `${aircon.name} · ${aircon.model}`
                    : aircon.model}
                </small>

                {aircon.powerSource === "estimated" && (
                  <span className="power-source-badge estimated">
                    유사 제품 추정
                  </span>
                )}

                {aircon.powerSource === "user_input" && (
                  <span className="power-source-badge manual">
                    사용자 입력
                  </span>
                )}
              </div>

              <button
                className="aircon-arrow-button"
                type="button"
                onClick={() =>
                  openAirconSelector(index)
                }
                aria-label={`${aircon.roomName} 에어컨 종류 선택`}
                title="에어컨 종류 선택"
              >
                &gt;
              </button>
            </div>
          ))}
        </div>

        <button
          className="add-aircon-button"
          type="button"
          onClick={addAirconSlot}
        >
          <span>＋</span>
          에어컨 추가
        </button>

        <div className="flow-button-row aircon-action-row">
          <button
            className="flow-secondary-button"
            type="button"
            onClick={onBack}
          >
            이전
          </button>

          <button
            className="flow-primary-button"
            type="button"
            onClick={handleComplete}
            disabled={isSaving}
          >
            {isSaving ? "저장 중..." : "등록하고 시작하기"}
          </button>
        </div>
      </section>

      {selectingIndex !== null && (
        <div
          className="aircon-modal-backdrop"
          role="presentation"
          onMouseDown={closeAirconSelector}
        >
          <section
            className="aircon-modal aircon-modal-v23"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aircon-modal-title"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="aircon-modal-header">
              <div>
                <p className="flow-eyebrow">
                  AIR CONDITIONER
                </p>
                <h2 id="aircon-modal-title">
                  {getSelectorTitle()}
                </h2>
              </div>

              <button
                className="aircon-modal-close"
                type="button"
                onClick={closeAirconSelector}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            {selectorView === "list" && (
              <>
                <p className="aircon-modal-description">
                  제조사 또는 모델명을 검색한 뒤 사용할
                  제품을 선택해 주세요.
                </p>

                <label className="aircon-search-box">
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) =>
                      setSearchTerm(event.target.value)
                    }
                    placeholder="삼성, LG 또는 모델명 검색"
                    autoFocus
                  />
                </label>

                <button
                  className="aircon-not-found-button aircon-not-found-button-top"
                  type="button"
                  onClick={() =>
                    setSelectorView("missing")
                  }
                >
                  <span>＋</span>
                  내 에어컨이 목록에 없어요
                </button>

                <div className="aircon-selector-toolbar">
                  <span>
                    검색 결과 {filteredAircons.length}개
                  </span>

                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm("")}
                    >
                      검색 초기화
                    </button>
                  )}
                </div>

                {isAirconLoading ? (
                  <div className="aircon-empty-state">
                    <span>⏳</span>
                    <strong>에어컨 목록을 불러오는 중입니다.</strong>
                  </div>
                ) : airconLoadError ? (
                  <div className="aircon-empty-state">
                    <span>!</span>
                    <strong>목록을 불러오지 못했습니다.</strong>
                    <p>{airconLoadError}</p>
                  </div>
                ) : filteredAircons.length > 0 ? (
                  <div className="aircon-selector-list">
                    {filteredAircons.map((aircon) => {
                      const isSelected =
                        registeredAircons[
                          selectingIndex
                        ]?.airconId === aircon.id;

                      return (
                        <button
                          className={`aircon-selector-option ${
                            isSelected ? "selected" : ""
                          }`}
                          type="button"
                          key={aircon.id}
                          onClick={() =>
                            selectAircon(aircon)
                          }
                        >
                          <span className="aircon-icon">
                            ❄️
                          </span>

                          <span>
                            <strong>
                              {aircon.manufacturer}{" "}
                              {aircon.productName}
                            </strong>
                            <small>
                              {aircon.modelNumber} ·{" "}
                              {aircon.type} ·{" "}
                              {aircon.ratedCoolingPowerW.toLocaleString(
                                "ko-KR",
                              )}
                              W
                            </small>
                          </span>

                          <span className="aircon-selector-mark">
                            {isSelected ? "✓" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="aircon-empty-state">
                    <span>🔎</span>
                    <strong>
                      검색 결과가 없습니다.
                    </strong>
                    <p>
                      모델명을 다시 확인하거나 직접 입력·추정
                      방법을 이용해 주세요.
                    </p>
                  </div>
                )}

              </>
            )}

            {selectorView === "missing" && (
              <>
                <button
                  className="aircon-modal-back-button"
                  type="button"
                  onClick={() =>
                    setSelectorView("list")
                  }
                >
                  ‹ 목록으로 돌아가기
                </button>

                <p className="aircon-modal-description">
                  제품 라벨을 확인할 수 있으면 직접 입력하고,
                  확인하기 어려우면 비슷한 제품으로 추정할 수
                  있습니다.
                </p>

                <div className="power-method-grid">
                  <button
                    className="power-method-card"
                    type="button"
                    onClick={() =>
                      setSelectorView("manual")
                    }
                  >
                    <span className="power-method-icon">
                      ✍️
                    </span>
                    <strong>직접 입력하기</strong>
                    <small>
                      라벨이나 설명서의 정격 냉방 소비전력을
                      입력합니다.
                    </small>
                  </button>

                  <button
                    className="power-method-card"
                    type="button"
                    onClick={() =>
                      setSelectorView("estimate")
                    }
                  >
                    <span className="power-method-icon">
                      ≈
                    </span>
                    <strong>
                      비슷한 제품으로 추정하기
                    </strong>
                    <small>
                      같은 종류와 비슷한 냉방면적의 제품을
                      기준으로 계산합니다.
                    </small>
                  </button>
                </div>

                <div className="aircon-helper-box">
                  <span>!</span>
                  <p>
                    추정값은 실제 사용량과 차이가 있을 수
                    있으며, 결과 화면에서도 추정값임을
                    표시합니다.
                  </p>
                </div>
              </>
            )}

            {selectorView === "manual" && (
              <form
                className="aircon-power-form"
                onSubmit={saveManualAircon}
              >
                <button
                  className="aircon-modal-back-button"
                  type="button"
                  onClick={() =>
                    setSelectorView("missing")
                  }
                >
                  ‹ 방법 다시 선택하기
                </button>

                <p className="aircon-modal-description">
                  제조사와 정격 냉방 소비전력을 입력해 주세요.
                  모델명은 확인 가능한 경우에만 입력해 주세요.
                </p>

                <label>
                  제조사
                  <input
                    type="text"
                    value={manualForm.manufacturer}
                    onChange={(event) =>
                      setManualForm((previous) => ({
                        ...previous,
                        manufacturer:
                          event.target.value,
                      }))
                    }
                    placeholder="예: 삼성전자, LG전자"
                  />
                </label>

                <label>
                  모델명 (선택)
                  <input
                    type="text"
                    value={manualForm.modelNumber}
                    onChange={(event) =>
                      setManualForm((previous) => ({
                        ...previous,
                        modelNumber:
                          event.target.value,
                      }))
                    }
                    placeholder="예: AF60F19D11GS (선택)"
                  />
                </label>

                <label>
                  정격 냉방 소비전력
                  <div className="power-input-with-unit">
                    <input
                      type="number"
                      min="1"
                      max="20000"
                      step="1"
                      value={manualForm.ratedPowerW}
                      onChange={(event) =>
                        setManualForm((previous) => ({
                          ...previous,
                          ratedPowerW:
                            event.target.value,
                        }))
                      }
                      placeholder="예: 1800"
                    />
                    <span>W</span>
                  </div>
                </label>

                <div className="aircon-form-guide">
                  <strong>어디에서 확인하나요?</strong>
                  <p>
                    제품 라벨에서 ‘정격 냉방 소비전력’,
                    ‘냉방 소비전력’ 또는 단위 W·kW가 적힌
                    항목을 확인해 주세요.
                  </p>
                </div>

                <button
                  className="flow-primary-button flow-full-button"
                  type="submit"
                >
                  이 소비전력으로 등록
                </button>
              </form>
            )}

            {selectorView === "estimate" && (
              <form
                className="aircon-power-form"
                onSubmit={saveEstimatedAircon}
              >
                <button
                  className="aircon-modal-back-button"
                  type="button"
                  onClick={() =>
                    setSelectorView("missing")
                  }
                >
                  ‹ 방법 다시 선택하기
                </button>

                <p className="aircon-modal-description">
                  제조사와 비슷한 제품 유형을 선택해 주세요.
                  모델명은 확인 가능한 경우에만 입력해 주세요.
                </p>

                <label>
                  제조사
                  <input
                    type="text"
                    value={estimateForm.manufacturer}
                    onChange={(event) =>
                      setEstimateForm((previous) => ({
                        ...previous,
                        manufacturer:
                          event.target.value,
                      }))
                    }
                    placeholder="예: 삼성전자, LG전자"
                  />
                </label>

                <label>
                  모델명 (선택)
                  <input
                    type="text"
                    value={estimateForm.modelNumber}
                    onChange={(event) =>
                      setEstimateForm((previous) => ({
                        ...previous,
                        modelNumber:
                          event.target.value,
                      }))
                    }
                    placeholder="예: AF60F19D11GS (선택)"
                  />
                </label>

                <label>
                  비슷한 제품 유형
                  <select
                    value={estimateForm.profileId}
                    onChange={(event) =>
                      setEstimateForm((previous) => ({
                        ...previous,
                        profileId: event.target.value,
                      }))
                    }
                  >
                    <option value="">
                      종류와 냉방면적을 선택해 주세요
                    </option>

                    {ESTIMATE_PROFILES.map((profile) => (
                      <option
                        value={profile.id}
                        key={profile.id}
                      >
                        {profile.type} · {profile.areaLabel}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedEstimateProfile && (
                  <div className="estimate-preview">
                    <span>예상 소비전력</span>
                    <strong>
                      약{" "}
                      {selectedEstimateProfile.representativePowerW.toLocaleString(
                        "ko-KR",
                      )}
                      W
                    </strong>
                    <p>
                      예상 범위{" "}
                      {selectedEstimateProfile.minPowerW.toLocaleString(
                        "ko-KR",
                      )}
                      ~
                      {selectedEstimateProfile.maxPowerW.toLocaleString(
                        "ko-KR",
                      )}
                      W · 유사 제품{" "}
                      {selectedEstimateProfile.sampleCount}개 기준
                    </p>
                  </div>
                )}

                <div className="aircon-helper-box estimate-warning">
                  <span>!</span>
                  <p>
                    현재 추정 기준은 화면 테스트용 임시값이며,
                    이후 Supabase에 쌓인 실제 제품 데이터의
                    중앙값으로 교체해야 합니다.
                  </p>
                </div>

                <button
                  className="flow-primary-button flow-full-button"
                  type="submit"
                >
                  이 추정값으로 등록
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </AuthShell>
  );
}

function createInitialAirconSlots() {
  return [
    {
      slotId: "living-room-slot",
      roomName: "거실 에어컨",
      airconId: "",
      name: "에어컨을 선택해 주세요",
      model: "오른쪽 화살표를 눌러 선택",
      icon: "❄️",
      ratedCoolingPowerW: null,
      powerSource: "",
    },
  ];
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
