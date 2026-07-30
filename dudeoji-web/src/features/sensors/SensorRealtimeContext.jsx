// 선택 장소의 새 센서 측정값을 WebSocket으로 받아 앱 내부에 공유합니다.
// 최초 기록 조회와 연결 실패 시 갱신은 기존 HTTP API가 계속 담당합니다.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { API_BASE_URL, getStoredToken } from "../../api";
import { buildRealtimeDeviceState } from "./deviceState";

const SensorRealtimeContext = createContext(null);

const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

// jh 추가 - "소켓이 열려 있음"과 "실제로 값이 들어오고 있음"은 다른 상태다.
// 예전에는 폴링 폴백이 connectionStatus === "connected"만 보고 꺼졌는데, 소켓은
// 정상 연결됐지만 값이 하나도 안 오는 경우가 실제로 존재한다(게이트웨이가 다른
// 계정으로 붙어 있거나, 보고 있는 장소에 좌표가 없어서 저장이 스킵되는 경우).
// 그러면 폴링도 꺼지고 실시간도 없어서 60초 타이머만 남아 값이 낡는다.
// 마지막 수신 후 이 시간이 지나면 실시간을 "죽은 것"으로 보고 폴백을 되살린다.
// 센서 발행 주기는 5초지만 서버가 밀릴 때 합쳐질 수 있어(coalesce) 넉넉히 잡았다.
const READING_STALE_AFTER_MS = 20_000;

function buildReadingsWebSocketUrl(placeId) {
  const url = new URL(API_BASE_URL);

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/readings`;
  url.search = "";
  url.searchParams.set("place_id", String(placeId));

  return url.toString();
}

export function SensorRealtimeProvider({ selectedPlaceId, children }) {
  const [latestReading, setLatestReading] = useState(null);
  const [latestDeviceState, setLatestDeviceState] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [connectionError, setConnectionError] = useState("");
  // 마지막으로 sensor_reading을 실제로 받은 시각(ms). 화면의 "마지막 측정"
  // 표시와 폴링 폴백 판정이 모두 이 값을 쓴다.
  const [lastReadingAt, setLastReadingAt] = useState(null);
  // 감시 타이머가 만료된 시각. lastReadingAt과 비교해 생존 여부를 계산한다.
  const [staleSince, setStaleSince] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let reconnectTimerId = null;
    let heartbeatTimerId = null;
    let reconnectAttempt = 0;

    setLatestReading(null);
    setLatestDeviceState(null);
    setLastReadingAt(null);
    setConnectionError("");

    if (!selectedPlaceId) {
      setConnectionStatus("idle");
      return undefined;
    }

    function clearHeartbeat() {
      if (heartbeatTimerId != null) {
        window.clearInterval(heartbeatTimerId);
        heartbeatTimerId = null;
      }
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimerId != null) return;

      const delay = Math.min(
        1000 * 2 ** reconnectAttempt,
        MAX_RECONNECT_DELAY_MS,
      );
      reconnectAttempt += 1;
      setConnectionStatus("reconnecting");

      reconnectTimerId = window.setTimeout(() => {
        reconnectTimerId = null;
        connect();
      }, delay);
    }

    function connect() {
      if (disposed) return;

      const token = getStoredToken();
      if (!token) {
        setConnectionStatus("error");
        setConnectionError("로그인이 필요합니다.");
        return;
      }

      setConnectionStatus(
        reconnectAttempt === 0 ? "connecting" : "reconnecting",
      );

      const socket = new WebSocket(buildReadingsWebSocketUrl(selectedPlaceId));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed || socket !== socketRef.current) return;

        socket.send(JSON.stringify({ type: "auth", token }));

        clearHeartbeat();
        heartbeatTimerId = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, HEARTBEAT_INTERVAL_MS);
      });

      socket.addEventListener("message", (event) => {
        if (disposed || socket !== socketRef.current) return;

        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message?.type === "connected") {
          reconnectAttempt = 0;
          setConnectionStatus("connected");
          setConnectionError("");
          return;
        }

        if (
          message?.type === "sensor_reading" &&
          String(message.place_id) === String(selectedPlaceId) &&
          message.data
        ) {
          setLatestReading(message.data);
          setLastReadingAt(Date.now());
          setConnectionStatus("connected");
          setConnectionError("");
          return;
        }

        if (
          message?.type === "device_state" &&
          String(message.place_id) === String(selectedPlaceId) &&
          message.data
        ) {
          setLatestDeviceState(buildRealtimeDeviceState(message));
          setConnectionStatus("connected");
          setConnectionError("");
        }
      });

      socket.addEventListener("error", () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      });

      socket.addEventListener("close", (event) => {
        clearHeartbeat();
        if (socket === socketRef.current) socketRef.current = null;
        if (disposed) return;

        if (event.code === 4401) {
          setConnectionStatus("error");
          setConnectionError("로그인이 만료되었거나 유효하지 않습니다.");
          return;
        }

        if (event.code === 4403) {
          setConnectionStatus("error");
          setConnectionError("선택한 장소의 센서값에 접근할 수 없습니다.");
          return;
        }

        scheduleReconnect();
      });
    }

    connect();

    return () => {
      disposed = true;
      clearHeartbeat();
      if (reconnectTimerId != null) window.clearTimeout(reconnectTimerId);

      const socket = socketRef.current;
      socketRef.current = null;
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING)
      ) {
        socket.close(1000, "화면 이동 또는 장소 변경");
      }
    };
  }, [selectedPlaceId]);

  // jh 추가 - 값이 하나 들어오면 감시 타이머를 다시 걸고, 그 타이머가 만료되면
  // (=READING_STALE_AFTER_MS 동안 아무 값도 안 옴) 실시간이 죽은 것으로 본다.
  //
  // 타이머 콜백에서만 상태를 건드리고, "지금 살아 있는지"는 두 시각을 비교해
  // 계산한다 — effect 본문에서 setState를 부르면 불필요한 연쇄 렌더가 생긴다
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (lastReadingAt == null) return undefined;

    const staleTimerId = window.setTimeout(() => {
      setStaleSince(Date.now());
    }, READING_STALE_AFTER_MS);

    return () => window.clearTimeout(staleTimerId);
  }, [lastReadingAt]);

  // 마지막 수신 이후에 만료 신호가 찍혔다면 죽은 것으로 본다.
  const isReceivingReadings =
    lastReadingAt != null && (staleSince == null || staleSince <= lastReadingAt);

  const value = useMemo(
    () => ({
      latestReading,
      latestDeviceState,
      connectionStatus,
      connectionError,
      lastReadingAt,
      // 폴링 폴백은 이 값으로 판단해야 한다 — connectionStatus만 보면
      // "연결됐지만 값이 안 오는" 상태에서 폴백까지 같이 꺼진다.
      realtimeIsLive: connectionStatus === "connected" && isReceivingReadings,
    }),
    [
      connectionError,
      connectionStatus,
      isReceivingReadings,
      lastReadingAt,
      latestDeviceState,
      latestReading,
    ],
  );

  return (
    <SensorRealtimeContext.Provider value={value}>
      {children}
    </SensorRealtimeContext.Provider>
  );
}

export function useSensorRealtimeContext() {
  const context = useContext(SensorRealtimeContext);
  if (!context) {
    throw new Error(
      "useSensorRealtimeContext는 SensorRealtimeProvider 안에서만 사용할 수 있습니다.",
    );
  }
  return context;
}
