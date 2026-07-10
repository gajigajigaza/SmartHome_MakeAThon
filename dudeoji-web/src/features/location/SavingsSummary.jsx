// src/features/location/SavingsSummary.jsx
// 담당: 나 (예상 절감 1일 / 1주 / 1달)
//
// 지금은 자리만 잡아둔 placeholder입니다.
// 백엔드 Recommendation.savings(power_saved_kwh, cost_won 등)를
// /api/readings/history로 누적 합산해서 채우면 됩니다.
export default function SavingsSummary({ todaySavingText = "계산 준비 중" }) {
  return (
    <div className="saving-box">
      <div>
        <span>오늘의 예상 절감</span>
        <strong>{todaySavingText}</strong>
        <small>추후 1일 / 1주 / 1달 단위로 확장 예정</small>
      </div>
      <span className="saving-icon">⚡</span>
    </div>
  );
}
