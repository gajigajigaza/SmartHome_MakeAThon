// src/features/sensors/SensorReadings.jsx
// 담당: 민주 (센서 측정값 전체 + 최근 온도 변화)
//
// 메뉴의 "센서 측정값"을 누르면 여기로 옵니다(App.jsx의 UserMenu
// onOpenSensorReadings 참고). 지금은 뼈대만 있고, getReadingHistory 등을
// 붙여서 최신 센서값 전체(온도/습도/미세먼지/바람 등)와
// TemperatureChart를 채우면 됩니다.
import TemperatureChart from "./TemperatureChart";

export default function SensorReadings({ history = [], onBack }) {
  return (
    <div className="app">
      <header className="header dashboard-header">
        <button type="button" onClick={onBack}>
          ← 뒤로
        </button>
        <h1>센서 측정값</h1>
      </header>

      <main>
        <section className="top-grid">
          <article className="card">
            <h3>최근 온도 변화</h3>
            <TemperatureChart history={history} />
          </article>
        </section>
      </main>
    </div>
  );
}
