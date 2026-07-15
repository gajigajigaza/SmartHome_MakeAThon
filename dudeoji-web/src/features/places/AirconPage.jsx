// src/features/places/AirconPage.jsx
// jh 수정함 - features/auth/FlowApp.jsx에 있던 AirconPage를 이 파일로 분리함.
// 회원가입 2단계 '에어컨 등록' 화면이었던 컴포넌트를 로그인 후(예: 새 위치 추가)에도 재사용할 수
// 있도록, pendingSignup 등 회원가입 전용 로직 없이 순수하게 "이름+위치+에어컨 입력을 받아서
// onComplete(placeName, aircons, lat, lon)을 호출"하는 역할만 담당한다.
// 회원가입 완료(completeSignup) vs 기존 사용자 장소 등록(createPlaceWithAircons) 분기,
// 그리고 onBack에서의 로그아웃 처리는 그대로 FlowApp.jsx에 남아 있다.
import { useEffect, useRef, useState } from "react";

import { request } from "../../api"; // jh 수정함 - 위치 검색(GET /places/geocode 등) 호출에 재사용
import { fetchAirconModels } from "./placesApi";
import { AuthShell, Progress } from "../auth/AuthShell";

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


function AirconPage({
  registeredAircons,
  setRegisteredAircons,
  onBack,
  onComplete,
  // jh 수정함 - "signup"(회원가입 2단계, AuthShell + 스텝 표시줄 그대로)과
  // "modal"(로그인 후 새 위치 추가, 가벼운 헤더 + 모달 안에서 렌더링)을 구분하는 prop.
  // 기본값이 "signup"이라 FlowApp.jsx 쪽 사용법은 그대로 유지된다.
  variant = "signup",
}) {
  const isModalVariant = variant === "modal";

  // jh 수정함 - variant="modal"은 빈 값으로 시작해서 placeholder("예: 우리 집, 자취방,
  // 사무실")가 보이게 하고, variant="signup"은 기존처럼 "우리 집"으로 미리 채워둔다.
  const [placeName, setPlaceName] = useState(
    isModalVariant ? "" : "우리 집",
  );

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
  // jh 수정함 - variant="modal"의 검증 에러는 전역 토스트(showInlineMessage) 대신
  // 이 상태로 모달 헤더 바로 아래에 인라인 배너로 보여준다(위치 계산 없음, 문서 흐름 그대로).
  // { field: "name" | "aircon", message } | null 형태 - 어떤 필드 때문에 뜬 에러인지
  // 구분해둬야, 아래 useEffect가 "그 필드가 실제로 채워졌을 때만" 지울 수 있다.
  // variant="signup"은 그대로 alert()를 쓴다.
  const [modalError, setModalError] = useState(null);

  // jh 수정함 - placeName/registeredAircons가 바뀔 때마다, 지금 떠 있는 modalError가
  // 어느 필드(field) 때문인지 보고 "그 필드"에 해당하는 조건만 다시 확인해서 지운다.
  // 두 검증을 getPlaceValidationError() 하나로 뭉뚱그려 재확인하지 않는다 - 예를 들어
  // 에어컨 에러가 떠 있는데 placeName만 채운 경우, 에어컨 문제는 그대로 안 지워진다.
  // hasValidAircons()는 handleComplete가 쓰는 getPlaceValidationError()와 같은
  // 판정 기준을 공유한다(아래, 함수 선언이라 정의보다 먼저 참조해도 문제없다).
  useEffect(() => {
    if (!isModalVariant || !modalError) {
      return;
    }

    if (modalError.field === "name" && placeName.trim()) {
      setModalError(null);
      return;
    }

    if (modalError.field === "aircon" && hasValidAircons()) {
      setModalError(null);
    }
  }, [placeName, registeredAircons, isModalVariant, modalError]);

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

  // jh 수정함 - "에어컨" 필드가 유효한지("한 대 이상 있고, 전부 등록됨")만 따로 뽑아둔다.
  // getPlaceValidationError()의 메시지 선택과, 위 useEffect의 "aircon 필드 해소 여부"
  // 판정이 같은 기준을 공유하게 하기 위함 - 여기서만 한 번 정의한다.
  function hasValidAircons() {
    return (
      registeredAircons.length > 0 &&
      !registeredAircons.some(
        (aircon) =>
          !aircon.airconId ||
          !aircon.ratedCoolingPowerW,
      )
    );
  }

  // jh 수정함 - handleComplete의 검증 규칙을 함수로 뽑아서, 위 useEffect(자동 해제)도
  // 같은 규칙을 재사용하게 한다 - 문구/조건이 두 곳에서 따로 놀며 어긋나는 걸 막는다.
  // 통과하면 null, 아니면 어떤 필드(field) 때문인지와 메시지를 함께 반환한다.
  function getPlaceValidationError() {
    if (!placeName.trim()) {
      return { field: "name", message: "장소 이름을 입력해 주세요." };
    }

    if (registeredAircons.length === 0) {
      return {
        field: "aircon",
        message: "에어컨을 한 대 이상 추가해 주세요.",
      };
    }

    if (!hasValidAircons()) {
      // jh 수정함 - variant="modal"에서만 문구를 짧게("에어컨을 등록해 주세요.")
      // 바꾸고, variant="signup"(회원가입 화면)은 기존 문구를 그대로 유지한다.
      return {
        field: "aircon",
        message: isModalVariant
          ? "에어컨을 등록해 주세요."
          : "추가한 에어컨을 모두 등록해 주세요.",
      };
    }

    return null;
  }

  // jh 수정함 - variant="modal"이면 modalError 인라인 배너({field, message})로,
  // variant="signup"이면 기존처럼 alert()(전역 토스트)로 검증 메시지를 보여주는 분기 헬퍼.
  function reportValidationError(validationError) {
    if (isModalVariant) {
      setModalError(validationError);
    } else {
      alert(validationError.message);
    }
  }

  async function handleComplete() {
    setModalError(null);

    const validationError = getPlaceValidationError();

    if (validationError) {
      reportValidationError(validationError);
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

  // jh 수정함 - variant="modal"일 때는 회원가입 chrome(스텝 표시줄/STEP 2 라벨/
  // 큰 제목/설명)을 걷어내고 가벼운 헤더로 교체한다.
  const content = (
    <>
      {/* jh 수정함 - variant="modal"일 때만 location-add-modal-card를 얹어서,
          모달 안 콘텐츠 블록 간 margin-bottom을 좁히는 CSS(DashboardOverrides.css)를
          이 카드에만 적용한다. variant="signup"(회원가입 화면)에는 이 클래스가
          안 붙으므로 기존 20px/22px 여백이 그대로 유지된다. */}
      <section
        className={`flow-card wide-card ${
          isModalVariant ? "location-add-modal-card" : ""
        }`}
      >
        {isModalVariant ? (
          // jh 수정함 - 닫기(×) 버튼을 .aircon-modal-header/.aircon-modal-close와
          // 같은 방식(position 없이, 헤더 flex row의 평범한 자식)으로 넣는다.
          // .aircon-modal도 이 버튼에 position을 안 주고 그냥 스크롤 콘텐츠 맨 위에
          // 두는 방식이라, 카드를 스크롤하면 같이 스크롤되다 화면 밖으로 나간다.
          <div className="location-add-modal-heading">
            <div>
              <h2>새 장소 추가</h2>
              <p className="flow-description">
                장소 이름과 위치를 입력해 주세요.
              </p>
            </div>

            <button
              type="button"
              className="location-add-modal-close"
              onClick={onBack}
              aria-label="새 위치 추가 닫기"
            >
              ×
            </button>
          </div>
        ) : (
          <>
            <Progress current={1} />

            <p className="flow-eyebrow">STEP 2 · 에어컨 등록</p>
            <h1>사용할 에어컨을 등록해 주세요</h1>

            <p className="flow-description">
              이름을 누르면 제목을 수정할 수 있고, 오른쪽
              화살표를 누르면 에어컨 종류를 선택할 수 있습니다.
            </p>
          </>
        )}

        {/* jh 수정함 - variant="modal"의 검증 에러 배너. 전역 토스트(showInlineMessage)
            대신 컴포넌트 상태(modalError)로 처리하고, position 계산 없이 문서 흐름
            그대로(모달 헤더 바로 아래) 렌더링한다. variant="signup"에는 이 블록이
            아예 렌더링되지 않고 기존 alert() 그대로 쓴다. */}
        {isModalVariant && modalError && (
          <p className="location-add-modal-error">{modalError.message}</p>
        )}

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

        {/* jh 수정함 - variant="modal"에는 "사용할 에어컨을 등록해 주세요" 큰 제목이
            없으므로, "장소 이름"/"위치 검색 (선택)"과 같은 라벨을 하나 둔다.
            place-field 클래스 대신 전용 클래스(location-add-modal-section-label,
            DashboardOverrides.css)를 쓴다 - 폰트/색상은 place-field와 동일하게
            복사해두고, margin-bottom만 "라벨→콘텐츠" 간격(10px)에 맞춰
            다른 두 섹션의 "섹션→섹션" 간격(20px)과 구분한다. */}
        {isModalVariant && (
          <p className="location-add-modal-section-label">에어컨 등록</p>
        )}

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

        {/* jh 수정함 - variant="modal"은 장소당 에어컨 1개 정책이라 슬롯 추가
            버튼을 숨긴다(기존 슬롯 삭제 기능은 그대로 둠). variant="signup"은
            지금처럼 여러 개 추가할 수 있다. */}
        {!isModalVariant && (
          <button
            className="add-aircon-button"
            type="button"
            onClick={addAirconSlot}
          >
            <span>＋</span>
            에어컨 추가
          </button>
        )}

        <div className="flow-button-row aircon-action-row">
          <button
            className="flow-secondary-button"
            type="button"
            onClick={onBack}
          >
            {/* jh 수정함 - variant="modal"(새 위치 추가)에서는 회원가입 흐름의
                "이전"이 아니라 "취소"가 맞는 표현이라 문구만 분기 */}
            {isModalVariant ? "취소" : "이전"}
          </button>

          <button
            className="flow-primary-button"
            type="button"
            onClick={handleComplete}
            disabled={isSaving}
          >
            {/* jh 수정함 - variant="modal"에서는 "등록하고 시작하기"(회원가입 완료 느낌)
                대신 "추가하기"로 문구만 분기 */}
            {isSaving
              ? "저장 중..."
              : isModalVariant
                ? "추가하기"
                : "등록하고 시작하기"}
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
    </>
  );

  return isModalVariant ? content : <AuthShell>{content}</AuthShell>;
}

// jh 수정함 - FlowApp.jsx의 createInitialAirconSlots를 이 파일로 이전.
// AirconPage가 다루는 에어컨 슬롯(registeredAircons) 데이터 모양에 속하는
// 헬퍼라, AirconPage를 쓰는 곳(FlowApp.jsx, LocationListPanel.jsx)이 공용으로 가져다 쓴다.
export function createInitialAirconSlots() {
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

export default AirconPage;
