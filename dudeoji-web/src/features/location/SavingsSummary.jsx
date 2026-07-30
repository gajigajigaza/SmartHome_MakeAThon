// src/features/location/SavingsSummary.jsx
// 담당: 정현(나) (예상 절감 1일 / 1주 / 1달)
//
// GET /api/savings/summary(readings_router.py, 정현이 민주 승인받아 추가)를
// sensors/readingsApi.js의 getSavingsSummary(period, placeId)로 호출해서 채운다.
// period 탭(day/week/month)이나 placeId(선택된 장소)가 바뀌면 다시 조회한다.
// jh 수정함 - placeId를 안 넘기던 걸 고쳐서, 이제 대시보드에서 장소를 바꾸면
// 그 장소의 절감량만 집계해서 보여준다(App.jsx의 DashboardHome이 넘겨줌).
import { useEffect, useState } from "react";

import {
  getRecommendation,
  getSavingsSummary,
  isRetryableReadError,
} from "../sensors/readingsApi";

const SERVER_WAKING_MESSAGE =
  "서버를 깨우는 중이에요. 잠시 후 다시 시도해주세요.";

const PERIOD_OPTIONS = [
  { value: "day", label: "오늘" },
  { value: "week", label: "이번 주" },
  { value: "month", label: "이번 달" },
];

const PERIOD_LABEL_BY_VALUE = Object.fromEntries(
  PERIOD_OPTIONS.map((option) => [option.value, option.label]),
);

function formatWon(amount) {
  return Math.round(amount).toLocaleString("ko-KR");
}

export default function SavingsSummary({ placeId = null }) {
  const [period, setPeriod] = useState("month");
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  // jh 수정함 - 창문 센서(리드 스위치) 미연결 시 절감액이 항상 0원으로
  // 나오는데, 이걸 "실제로 0원 절감했다"와 구분하려고 최신 추천의
  // window_data_available을 따로 확인한다. period가 바뀌어도 센서 연결
  // 여부는 안 바뀌므로 placeId에만 의존하는 별도 effect로 둔다.
  const [windowSensorAvailable, setWindowSensorAvailable] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    getRecommendation(placeId)
      .then((recommendation) => {
        if (!isCancelled) {
          setWindowSensorAvailable(recommendation.window_data_available === true);
        }
      })
      .catch(() => {
        // 기록이 아직 없거나 조회 실패면 "측정 대기 중"과 동일하게 취급한다.
        if (!isCancelled) {
          setWindowSensorAvailable(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [placeId]);

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setError("");

    getSavingsSummary(period, placeId)
      .then((data) => {
        if (!isCancelled) {
          setSummary(data);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(
            isRetryableReadError(err) ? SERVER_WAKING_MESSAGE : err.message,
          );
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [period, placeId]);

  const periodLabel = PERIOD_LABEL_BY_VALUE[period];

  return (
    <div className="saving-summary">
      <div className="saving-summary-header">
        <h3>절감 리포트</h3>

        <div
          className="saving-period-tabs"
          role="tablist"
          aria-label="예상 절감 기간"
        >
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={period === option.value}
              className={`saving-period-tab ${
                period === option.value ? "is-active" : ""
              }`}
              onClick={() => setPeriod(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div
          className="saving-box saving-box-skeleton"
          role="status"
          aria-busy="true"
          aria-label="예상 절감 불러오는 중"
        >
          <div>
            <span>불러오는 중...</span>
            <strong className="saving-skeleton-bar" />
            <small className="saving-skeleton-bar saving-skeleton-bar-small" />
          </div>
          <span className="saving-icon">⏳</span>
        </div>
      ) : error ? (
        <div className="saving-box saving-box-error" role="alert">
          <div>
            <span>예상 절감을 불러오지 못했어요</span>
            <strong>{error}</strong>
          </div>
          <span className="saving-icon">⚠️</span>
        </div>
      ) : !windowSensorAvailable ? (
        <div className="saving-box saving-box-pending">
          <div>
            <span>{periodLabel} 예상 절감</span>
            <strong>측정 대기 중</strong>
            <small>창문 센서가 연결되면 절감량이 계산돼요</small>
          </div>
          <span className="saving-icon">🛰️</span>
        </div>
      ) : (
        <div className="saving-box">
          <div>
            <span>{periodLabel} 예상 절감</span>
            <strong>{summary.power_saved_kwh.toFixed(2)}kWh</strong>
            <small>{formatWon(summary.cost_won)}원 절감</small>
          </div>
          <span className="saving-icon">⚡</span>
        </div>
      )}
    </div>
  );
}
