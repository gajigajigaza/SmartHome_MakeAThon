import { useEffect, useRef } from "react";

import crawlingMoleImage from "../../assets/crawling-mole.svg";
import "./CrawlingMole.css";

const MOLE_WIDTH = 108;
const MOLE_HEIGHT = 68;
const SPEED_PX_PER_SEC = 24;
const EDGE_TURN_RATE_DEG_PER_SEC = 90;
const EDGE_MARGIN = 90;
const MIN_WANDER_DURATION_MS = 1800;
const MAX_WANDER_DURATION_MS = 5200;
const MIN_WANDER_TURN_RATE = 20;
const MAX_WANDER_TURN_RATE = 44;
const MIN_SPEED_FACTOR = 0.72;
const MAX_SPEED_FACTOR = 1.14;
const MAX_VISUAL_TILT_DEG = 14;
const GAIT_CYCLE_MS = 900;
const TRAIL_SPACING_PX = 5;
const GRAB_HANG_OFFSET_Y = 32;
const MAX_GRAB_TILT_DEG = 18;

function normalizeAngle(deg) {
  return ((deg % 360) + 360) % 360;
}

function signedAngleDelta(from, to) {
  let diff = normalizeAngle(to - from);
  if (diff > 180) diff -= 360;
  return diff;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function headingTo(fromX, fromY, toX, toY) {
  return normalizeAngle((Math.atan2(toY - fromY, toX - fromX) * 180) / Math.PI);
}

function getSafeRange(min, max) {
  const size = Math.max(max - min, 0);
  const inset = Math.min(EDGE_MARGIN, size * 0.24);
  return {
    min: min + inset,
    max: max - inset,
  };
}

function randomBetween(min, max) {
  return min + Math.random() * Math.max(max - min, 0);
}

function chooseWanderDirection(state, timestamp) {
  const mostlyStraight = Math.random() < 0.24;
  const maxHeadingChange = mostlyStraight ? 28 : 125;
  const headingChange = randomBetween(-maxHeadingChange, maxHeadingChange);

  state.targetHeading = normalizeAngle(state.heading + headingChange);
  state.turnRate = randomBetween(
    MIN_WANDER_TURN_RATE,
    MAX_WANDER_TURN_RATE,
  );
  state.speedFactor = randomBetween(MIN_SPEED_FACTOR, MAX_SPEED_FACTOR);
  state.nextWanderAt =
    timestamp +
    randomBetween(MIN_WANDER_DURATION_MS, MAX_WANDER_DURATION_MS);
}

function isNearEdge(x, y, bounds) {
  return (
    x < bounds.left + EDGE_MARGIN ||
    x > bounds.right - EDGE_MARGIN ||
    y < bounds.top + EDGE_MARGIN ||
    y > bounds.bottom - EDGE_MARGIN
  );
}

function CrawlingMole() {
  const moleRef = useRef(null);
  const visualRef = useRef(null);
  const shadowRef = useRef(null);
  const stateRef = useRef({
    x: -200,
    y: -200,
    heading: 0,
    targetHeading: 0,
    turnRate: MIN_WANDER_TURN_RATE,
    speedFactor: 1,
    nextWanderAt: 0,
    wasNearEdge: false,
    facing: 1,
    lastTrailX: null,
    lastTrailY: null,
    grabbed: false,
    pointerId: null,
    dragTilt: 0,
    dragVelocityX: 0,
    dragVelocityY: 0,
    lastPointerX: 0,
    lastPointerY: 0,
    lastPointerAt: 0,
    ready: false,
  });
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);
  const trailRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }

    const trailLayer = trailRef.current;
    const moleElement = moleRef.current;
    const layerElement = moleElement?.closest(
      ".dudeoji-crawling-mole-layer",
    );

    function getBounds() {
      const halfW = MOLE_WIDTH / 2;
      const halfH = MOLE_HEIGHT / 2;
      const right = Math.max(halfW, window.innerWidth - halfW);
      const bottom = Math.max(halfH, window.innerHeight - halfH);

      return {
        left: halfW,
        top: halfH,
        right,
        bottom,
      };
    }

    function moveMoleToPointer(event) {
      const state = stateRef.current;
      const bounds = getBounds();
      const elapsed = Math.max(event.timeStamp - state.lastPointerAt, 1);
      const deltaX = event.clientX - state.lastPointerX;
      const deltaY = event.clientY - state.lastPointerY;

      state.dragVelocityX = deltaX / elapsed;
      state.dragVelocityY = deltaY / elapsed;
      state.dragTilt = clamp(
        state.dragVelocityX * 34,
        -MAX_GRAB_TILT_DEG,
        MAX_GRAB_TILT_DEG,
      );

      if (state.dragVelocityX > 0.02) state.facing = 1;
      if (state.dragVelocityX < -0.02) state.facing = -1;

      state.x = clamp(event.clientX, bounds.left, bounds.right);
      state.y = clamp(
        event.clientY + GRAB_HANG_OFFSET_Y,
        bounds.top,
        bounds.bottom,
      );
      state.lastPointerX = event.clientX;
      state.lastPointerY = event.clientY;
      state.lastPointerAt = event.timeStamp;
    }

    function beginGrab(event) {
      if (!moleElement || stateRef.current.grabbed) return;

      event.preventDefault();
      event.stopPropagation();

      const state = stateRef.current;
      state.grabbed = true;
      state.pointerId = event.pointerId;
      state.dragVelocityX = 0;
      state.dragVelocityY = 0;
      state.lastPointerX = event.clientX;
      state.lastPointerY = event.clientY;
      state.lastPointerAt = event.timeStamp;
      moveMoleToPointer(event);

      moleElement.classList.add("is-grabbed");
      layerElement?.classList.add("is-grabbing-mole");
      moleElement.setPointerCapture?.(event.pointerId);
    }

    function finishGrab(pointerId = stateRef.current.pointerId) {
      if (!moleElement || !stateRef.current.grabbed) return;

      const state = stateRef.current;
      const releaseSpeed = Math.hypot(
        state.dragVelocityX,
        state.dragVelocityY,
      );

      if (releaseSpeed > 0.025) {
        state.heading = headingTo(
          0,
          0,
          state.dragVelocityX,
          state.dragVelocityY,
        );
      } else {
        state.heading = normalizeAngle(
          (state.facing === 1 ? 0 : 180) + randomBetween(-24, 24),
        );
      }

      state.grabbed = false;
      state.pointerId = null;
      state.dragTilt = 0;
      state.lastTrailX = state.x;
      state.lastTrailY = state.y;
      chooseWanderDirection(state, performance.now());
      lastTimeRef.current = null;

      moleElement.classList.remove("is-grabbed");
      layerElement?.classList.remove("is-grabbing-mole");
      if (
        pointerId != null &&
        moleElement.hasPointerCapture?.(pointerId)
      ) {
        moleElement.releasePointerCapture(pointerId);
      }
    }

    function handlePointerMove(event) {
      const state = stateRef.current;
      if (!state.grabbed || event.pointerId !== state.pointerId) return;

      event.preventDefault();
      moveMoleToPointer(event);
    }

    function handlePointerEnd(event) {
      if (event.pointerId !== stateRef.current.pointerId) return;
      finishGrab(event.pointerId);
    }

    function handleWindowBlur() {
      finishGrab();
    }

    moleElement?.addEventListener("pointerdown", beginGrab, {
      passive: false,
    });
    moleElement?.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    moleElement?.addEventListener("pointerup", handlePointerEnd);
    moleElement?.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", handleWindowBlur);

    function addTrailMark(x, y, tilt) {
      if (!trailLayer) return;

      const mark = document.createElement("span");
      mark.className = "mole-trail-mark";
      mark.style.left = `${x}px`;
      mark.style.top = `${y}px`;
      mark.style.setProperty(
        "--trail-rotation",
        `${tilt + randomBetween(-2.5, 2.5)}deg`,
      );
      mark.style.setProperty(
        "--trail-scale",
        randomBetween(0.94, 1.06).toFixed(2),
      );
      mark.addEventListener("animationend", () => mark.remove(), {
        once: true,
      });
      trailLayer.appendChild(mark);
    }

    function step(timestamp) {
      const bounds = getBounds();
      const state = stateRef.current;

      if (!state.ready) {
        const xRange = getSafeRange(bounds.left, bounds.right);
        const yRange = getSafeRange(bounds.top, bounds.bottom);
        state.x = randomBetween(xRange.min, xRange.max);
        state.y = randomBetween(yRange.min, yRange.max);
        state.heading = Math.random() * 360;
        chooseWanderDirection(state, timestamp);
        state.facing = Math.cos((state.heading * Math.PI) / 180) < 0 ? -1 : 1;
        state.ready = true;
        if (moleRef.current) {
          moleRef.current.style.opacity = "0.72";
        }
      }

      if (lastTimeRef.current == null) {
        lastTimeRef.current = timestamp;
      }
      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = timestamp;

      state.x = clamp(state.x, bounds.left, bounds.right);
      state.y = clamp(state.y, bounds.top, bounds.bottom);

      if (state.grabbed) {
        state.dragTilt *= 0.9;

        if (moleRef.current) {
          moleRef.current.style.transform =
            `translate3d(${state.x - MOLE_WIDTH / 2}px, ${state.y - MOLE_HEIGHT / 2}px, 0)`;
        }
        if (visualRef.current) {
          visualRef.current.style.transform =
            `rotate(${state.dragTilt}deg) scaleX(${state.facing})`;
        }

        rafRef.current = requestAnimationFrame(step);
        return;
      }

      const nearEdge = isNearEdge(state.x, state.y, bounds);
      if (nearEdge && !state.wasNearEdge) {
        const centerHeading = headingTo(
          state.x,
          state.y,
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
        );
        state.targetHeading = normalizeAngle(
          centerHeading + randomBetween(-32, 32),
        );
        state.nextWanderAt =
          timestamp + randomBetween(2200, MAX_WANDER_DURATION_MS);
      } else if (!nearEdge && timestamp >= state.nextWanderAt) {
        chooseWanderDirection(state, timestamp);
      }
      state.wasNearEdge = nearEdge;

      const delta = signedAngleDelta(state.heading, state.targetHeading);
      const turnRate = nearEdge
        ? EDGE_TURN_RATE_DEG_PER_SEC
        : state.turnRate;
      const maxTurn = turnRate * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, delta));
      state.heading = normalizeAngle(state.heading + turn);

      const rad = (state.heading * Math.PI) / 180;
      const gaitProgress = (timestamp % GAIT_CYCLE_MS) / GAIT_CYCLE_MS;
      const gaitSpeedFactor =
        0.88 + 0.2 * ((Math.sin(gaitProgress * Math.PI * 2) + 1) / 2);
      const speed =
        SPEED_PX_PER_SEC * state.speedFactor * gaitSpeedFactor;
      state.x = clamp(
        state.x + Math.cos(rad) * speed * dt,
        bounds.left,
        bounds.right,
      );
      state.y = clamp(
        state.y + Math.sin(rad) * speed * dt,
        bounds.top,
        bounds.bottom,
      );

      const horizontalDirection = Math.cos(rad);
      if (horizontalDirection > 0.2) state.facing = 1;
      if (horizontalDirection < -0.2) state.facing = -1;

      const visualBaseHeading = state.facing === 1 ? 0 : 180;
      const visualTilt = clamp(
        signedAngleDelta(visualBaseHeading, state.heading),
        -MAX_VISUAL_TILT_DEG,
        MAX_VISUAL_TILT_DEG,
      );

      const distanceSinceLastTrail =
        state.lastTrailX == null
          ? Number.POSITIVE_INFINITY
          : Math.hypot(
              state.x - state.lastTrailX,
              state.y - state.lastTrailY,
            );
      if (distanceSinceLastTrail >= TRAIL_SPACING_PX) {
        addTrailMark(
          state.x,
          state.y + MOLE_HEIGHT / 2 - 6,
          visualTilt,
        );
        state.lastTrailX = state.x;
        state.lastTrailY = state.y;
      }

      if (moleRef.current) {
        moleRef.current.style.transform =
          `translate3d(${state.x - MOLE_WIDTH / 2}px, ${state.y - MOLE_HEIGHT / 2}px, 0)`;
      }

      if (visualRef.current) {
        visualRef.current.style.transform =
          `rotate(${visualTilt}deg) scaleX(${state.facing})`;
        if (shadowRef.current) {
          shadowRef.current.style.setProperty(
            "--shadow-tilt",
            `${visualTilt}deg`,
          );
        }
      }

      rafRef.current = requestAnimationFrame(step);
    }

    lastTimeRef.current = null;
    stateRef.current.lastTrailX = null;
    stateRef.current.lastTrailY = null;
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = null;
      if (trailLayer) {
        trailLayer.replaceChildren();
      }
      moleElement?.removeEventListener("pointerdown", beginGrab);
      moleElement?.removeEventListener("pointermove", handlePointerMove);
      moleElement?.removeEventListener("pointerup", handlePointerEnd);
      moleElement?.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", handleWindowBlur);
      layerElement?.classList.remove("is-grabbing-mole");
    };
  }, []);

  return (
    <>
      <div
        className="mole-trail-layer"
        ref={trailRef}
        aria-hidden="true"
      />
      <div className="dudeoji-crawling-mole-layer" aria-hidden="true">
        <div className="dudeoji-crawling-mole-track">
          <div className="dudeoji-crawling-mole" ref={moleRef}>
            <span className="mole-shadow" ref={shadowRef} />
            <span className="mole-visual" ref={visualRef}>
              <span className="mole-body-motion">
                <img
                  className="mole-character"
                  src={crawlingMoleImage}
                  alt=""
                  draggable="false"
                />
                <span className="mole-front-paw" />
              </span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

export default CrawlingMole;
