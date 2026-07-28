// src/features/background/CrawlingMole.jsx
//
// 배경 장식용 두더지. 카드 회피 없이 화면 전체를 자유롭게 떠다니고, 화면
// 가장자리에 가까워지면 중앙 쪽으로 서서히 방향을 튼다(경계만 처리). 카드
// 위를 그냥 지나갈 수 있지만 z-index가 카드보다 낮아(CrawlingMole.css)
// 카드 뒤로 지나가는 것처럼 보인다.
//
// jh 수정함 - 스프라이트 방향을 8방향/16방향으로 스냅해봤는데(회전이 매끄러워
// 떠다니는 느낌이 어색하다는 피드백 때문) 오히려 회전이 뚝뚝 끊겨 부자연스럽고
// 경계 근처에서 떨리는 문제까지 있었다. 다시 매끄럽게 해달라는 요청으로 스냅을
// 걷어내고, 이동 방향(heading, TURN_RATE_DEG_PER_SEC로 서서히 도는 연속값)을
// 스프라이트 회전에 그대로 반영한다 — 이동 경로 자체가 이미 부드러운 곡선이라
// 스프라이트도 자연스럽게 함께 돈다.
import { useEffect, useRef } from "react";

import "./CrawlingMole.css";

const MOLE_WIDTH = 92;
const MOLE_HEIGHT = 56;
// 예전 CSS 버전(68s에 화면 폭 이동)과 같은 체감 속도로 맞춘 값.
const SPEED_PX_PER_SEC = 24;
// 초당 최대 회전 각도(부드러운 커브).
const TURN_RATE_DEG_PER_SEC = 70;
// 이 거리 안으로 화면 가장자리에 다가가면 중앙 쪽으로 방향을 틀기 시작한다.
const EDGE_MARGIN = 90;

function normalizeAngle(deg) {
  return ((deg % 360) + 360) % 360;
}

// from에서 to로 회전할 때, 짧은 쪽으로 도는 부호 있는 각도차(-180, 180].
function signedAngleDelta(from, to) {
  let diff = normalizeAngle(to - from);
  if (diff > 180) diff -= 360;
  return diff;
}

// 화면 가장자리 근처가 아니면 지금 방향 그대로, 가까우면 화면 중앙을
// 향하는 각도를 목표로 삼는다.
function pickTargetHeading(x, y, heading, bounds) {
  const nearEdge =
    x < bounds.left + EDGE_MARGIN ||
    x > bounds.right - EDGE_MARGIN ||
    y < bounds.top + EDGE_MARGIN ||
    y > bounds.bottom - EDGE_MARGIN;

  if (!nearEdge) {
    return heading;
  }

  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  return (Math.atan2(centerY - y, centerX - x) * 180) / Math.PI;
}

function CrawlingMole() {
  const moleRef = useRef(null);
  const stateRef = useRef({ x: -200, y: -200, heading: 0, ready: false });
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }

    function getBounds() {
      const halfW = MOLE_WIDTH / 2;
      const halfH = MOLE_HEIGHT / 2;
      return {
        left: halfW,
        top: halfH,
        right: window.innerWidth - halfW,
        bottom: window.innerHeight - halfH,
      };
    }

    function step(timestamp) {
      const bounds = getBounds();
      const state = stateRef.current;

      if (!state.ready) {
        state.x = bounds.left + Math.random() * Math.max(bounds.right - bounds.left, 1);
        state.y = bounds.top + Math.random() * Math.max(bounds.bottom - bounds.top, 1);
        state.heading = Math.random() * 360;
        state.ready = true;
        if (moleRef.current) {
          moleRef.current.style.opacity = "0.58";
        }
      }

      if (lastTimeRef.current == null) {
        lastTimeRef.current = timestamp;
      }
      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = timestamp;

      const targetHeading = pickTargetHeading(state.x, state.y, state.heading, bounds);
      const delta = signedAngleDelta(state.heading, targetHeading);
      const maxTurn = TURN_RATE_DEG_PER_SEC * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, delta));
      state.heading = normalizeAngle(state.heading + turn);

      const rad = (state.heading * Math.PI) / 180;
      state.x = Math.min(bounds.right, Math.max(bounds.left, state.x + Math.cos(rad) * SPEED_PX_PER_SEC * dt));
      state.y = Math.min(bounds.bottom, Math.max(bounds.top, state.y + Math.sin(rad) * SPEED_PX_PER_SEC * dt));

      if (moleRef.current) {
        moleRef.current.style.transform =
          `translate(${state.x - MOLE_WIDTH / 2}px, ${state.y - MOLE_HEIGHT / 2}px) rotate(${state.heading}deg)`;
      }

      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="dudeoji-crawling-mole-layer" aria-hidden="true">
      <div className="dudeoji-crawling-mole-track">
        <div className="dudeoji-crawling-mole" ref={moleRef}>
          <span className="mole-shadow" />
          <span className="mole-body">
            <span className="mole-ear mole-ear-left" />
            <span className="mole-ear mole-ear-right" />
            <span className="mole-head">
              <span className="mole-eye" />
              <span className="mole-nose" />
            </span>
            <span className="mole-paw mole-paw-front" />
            <span className="mole-paw mole-paw-back" />
          </span>
          <span className="mole-dirt mole-dirt-one" />
          <span className="mole-dirt mole-dirt-two" />
          <span className="mole-dirt mole-dirt-three" />
        </div>
      </div>
    </div>
  );
}

export default CrawlingMole;
