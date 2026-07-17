// src/features/location/SavingsSummary.jsx
// 담당: 정현(나) (예상 절감 1일 / 1주 / 1달)
//
// GET /api/savings/summary(readings_router.py, 정현이 민주 승인받아 추가)를
// sensors/readingsApi.js의 getSavingsSummary(period)로 호출해서 채운다.
// period 탭(day/week/month)을 바꾸면 다시 조회한다.
import { useEffect, useState } from "react";

import { getSavingsSummary } from "../sensors/readingsApi";

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

export default function SavingsSummary() {
  const [period, setPeriod] = useState("month");
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setError("");

    getSavingsSummary(period)
      .then((data) => {
        if (!isCancelled) {
          setSummary(data);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(err.message);
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
  }, [period]);

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
      ) : (
        <div className="saving-box">
          <div>
            <span>{periodLabel} 예상 절감</span>
            <strong>{formatWon(summary.cost_won)}원</strong>
            <small>{summary.power_saved_kwh.toFixed(2)}kWh 절감</small>
          </div>
          <span className="saving-icon">⚡</span>
        </div>
      )}
    </div>
  );
}
