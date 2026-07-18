import { useEffect, useState } from "react";

import { fetchAirconModels } from "./placesApi";

// 마이페이지의 "변경" 버튼에서 사용하는 에어컨 제품 선택 모달입니다.
// 에어컨 이름은 이 모달에서 바꾸지 않고, 목록 선택 또는 직접 입력만 처리합니다.
function AirconSelectorModal({
  currentAircon,
  isSaving = false,
  onClose,
  onSelect,
}) {
  const [view, setView] = useState("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [airconModels, setAirconModels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [manualForm, setManualForm] = useState({
    manufacturer: currentAircon?.manufacturer || "",
    modelNumber: currentAircon?.model_number || "",
    ratedPowerW: String(currentAircon?.rated_cooling_power_w || ""),
  });

  useEffect(() => {
    if (view !== "list") {
      return undefined;
    }

    let ignoreResult = false;

    const timerId = window.setTimeout(async () => {
      setIsLoading(true);
      setLoadError("");

      try {
        const models = await fetchAirconModels(searchTerm);

        if (!ignoreResult) {
          setAirconModels(models);
        }
      } catch (error) {
        if (!ignoreResult) {
          setAirconModels([]);
          setLoadError(error.message || "에어컨 목록을 불러오지 못했습니다.");
        }
      } finally {
        if (!ignoreResult) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      ignoreResult = true;
      window.clearTimeout(timerId);
    };
  }, [searchTerm, view]);

  function closeModal() {
    if (!isSaving) {
      onClose();
    }
  }

  async function selectDatabaseAircon(aircon) {
    setSubmitError("");

    try {
      await onSelect({
        power_source: "database",
        aircon_model_id: aircon.id,
      });
    } catch (error) {
      setSubmitError(error.message || "에어컨 제품을 변경하지 못했습니다.");
    }
  }

  async function saveManualAircon(event) {
    event.preventDefault();
    setSubmitError("");

    const manufacturer = manualForm.manufacturer.trim();
    const modelNumber = manualForm.modelNumber.trim();
    const ratedPowerW = Number(manualForm.ratedPowerW);

    if (!manufacturer) {
      setSubmitError("제조사를 입력해 주세요.");
      return;
    }

    if (
      !Number.isInteger(ratedPowerW) ||
      ratedPowerW < 1 ||
      ratedPowerW > 20000
    ) {
      setSubmitError(
        "정격 냉방 소비전력은 1~20,000W 사이의 정수로 입력해 주세요.",
      );
      return;
    }

    try {
      await onSelect({
        power_source: "user_input",
        manufacturer,
        model_number: modelNumber || null,
        rated_cooling_power_w: ratedPowerW,
      });
    } catch (error) {
      setSubmitError(error.message || "에어컨 제품을 변경하지 못했습니다.");
    }
  }

  return (
    <div
      className="aircon-modal-backdrop"
      role="presentation"
      onMouseDown={closeModal}
    >
      <section
        className="aircon-modal aircon-modal-v23"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mypage-aircon-selector-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="aircon-modal-header">
          <div>
            <p className="flow-eyebrow">AIR CONDITIONER</p>
            <h2 id="mypage-aircon-selector-title">
              {view === "list" ? "에어컨 변경" : "에어컨 직접 설정"}
            </h2>
          </div>

          <button
            className="aircon-modal-close"
            type="button"
            onClick={closeModal}
            disabled={isSaving}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {view === "list" ? (
          <>
            <p className="aircon-modal-description">
              제조사 또는 모델명을 검색한 뒤 변경할 제품을 선택해 주세요.
              에어컨 이름은 그대로 유지됩니다.
            </p>

            <label className="aircon-search-box">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="삼성, LG 또는 모델명 검색"
                disabled={isSaving}
                autoFocus
              />
            </label>

            <button
              className="aircon-not-found-button aircon-not-found-button-top"
              type="button"
              onClick={() => {
                setSubmitError("");
                setView("manual");
              }}
              disabled={isSaving}
            >
              <span>＋</span>
              내 에어컨이 목록에 없어요
            </button>

            <div className="aircon-selector-toolbar">
              <span>검색 결과 {airconModels.length}개</span>

              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  disabled={isSaving}
                >
                  검색 초기화
                </button>
              )}
            </div>

            {submitError && (
              <div className="aircon-empty-state">
                <span>!</span>
                <strong>{submitError}</strong>
              </div>
            )}

            {isLoading ? (
              <div className="aircon-empty-state">
                <span>⏳</span>
                <strong>에어컨 목록을 불러오는 중입니다.</strong>
              </div>
            ) : loadError ? (
              <div className="aircon-empty-state">
                <span>!</span>
                <strong>목록을 불러오지 못했습니다.</strong>
                <p>{loadError}</p>
              </div>
            ) : airconModels.length > 0 ? (
              <div className="aircon-selector-list">
                {airconModels.map((aircon) => {
                  const isSelected =
                    String(currentAircon?.aircon_model_id || "") ===
                    String(aircon.id);

                  return (
                    <button
                      className={`aircon-selector-option ${
                        isSelected ? "selected" : ""
                      }`}
                      type="button"
                      key={aircon.id}
                      onClick={() => selectDatabaseAircon(aircon)}
                      disabled={isSaving}
                    >
                      <span className="aircon-icon">❄️</span>

                      <span>
                        <strong>
                          {aircon.manufacturer} {aircon.productName}
                        </strong>
                        <small>
                          {aircon.modelNumber || "모델명 미입력"} ·{" "}
                          {aircon.type} ·{" "}
                          {Number(aircon.ratedCoolingPowerW).toLocaleString(
                            "ko-KR",
                          )}
                          W
                        </small>
                      </span>

                      <span className="aircon-selector-mark">
                        {isSaving && isSelected ? "…" : isSelected ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="aircon-empty-state">
                <span>🔎</span>
                <strong>검색 결과가 없습니다.</strong>
                <p>
                  모델명을 다시 확인하거나 ‘내 에어컨이 목록에 없어요’를
                  선택해 직접 설정해 주세요.
                </p>
              </div>
            )}
          </>
        ) : (
          <form className="aircon-power-form" onSubmit={saveManualAircon}>
            <button
              className="aircon-modal-back-button"
              type="button"
              onClick={() => {
                setSubmitError("");
                setView("list");
              }}
              disabled={isSaving}
            >
              ‹ 목록으로 돌아가기
            </button>

            <p className="aircon-modal-description">
              제품 라벨이나 설명서에서 제조사와 정격 냉방 소비전력을
              확인해 주세요. 모델명은 모를 경우 비워두어도 됩니다.
            </p>

            {submitError && (
              <div className="aircon-empty-state">
                <span>!</span>
                <strong>{submitError}</strong>
              </div>
            )}

            <label>
              제조사
              <input
                type="text"
                value={manualForm.manufacturer}
                onChange={(event) =>
                  setManualForm((previous) => ({
                    ...previous,
                    manufacturer: event.target.value,
                  }))
                }
                placeholder="예: 삼성전자, LG전자"
                maxLength={100}
                disabled={isSaving}
                autoFocus
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
                    modelNumber: event.target.value,
                  }))
                }
                placeholder="예: AF60F19D11GS"
                maxLength={100}
                disabled={isSaving}
              />
            </label>

            <label>
              정격 냉방 소비전력
              <div className="power-input-with-unit">
                <input
                  type="number"
                  min={1}
                  max={20000}
                  step={1}
                  inputMode="numeric"
                  value={manualForm.ratedPowerW}
                  onChange={(event) =>
                    setManualForm((previous) => ({
                      ...previous,
                      ratedPowerW: event.target.value,
                    }))
                  }
                  placeholder="예: 1800"
                  disabled={isSaving}
                />
                <span>W</span>
              </div>
            </label>

            <div className="aircon-form-guide">
              <strong>어디에서 확인하나요?</strong>
              <p>
                제품 라벨에서 ‘정격 냉방 소비전력’, ‘냉방 소비전력’
                또는 W·kW 단위가 적힌 항목을 확인해 주세요.
              </p>
            </div>

            <button
              className="flow-primary-button flow-full-button"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? "변경 중..." : "이 정보로 변경"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

export default AirconSelectorModal;
