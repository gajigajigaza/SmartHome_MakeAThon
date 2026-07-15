// src/features/auth/AuthShell.jsx
// jh 수정함 - FlowApp.jsx에 있던 Brand/Progress/AuthShell을 이 파일로 뽑아냄.
// AirconPage를 features/places/AirconPage.jsx로 분리하면서, FlowApp.jsx와 AirconPage.jsx가
// 순환 참조 없이 이 세 컴포넌트를 함께 쓸 수 있도록 공용 파일로 옮겼다. 내용은 그대로다.
import "../../FlowApp.css";
import sproutMenuIcon from "../../assets/sprout-menu.svg";

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

export { Brand, Progress, AuthShell };
