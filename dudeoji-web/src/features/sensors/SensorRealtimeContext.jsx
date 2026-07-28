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

const SensorRealtimeContext = createContext(null);

const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

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
  const socketRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let reconnectTimerId = null;
    let heartbeatTimerId = null;
    let reconnectAttempt = 0;

    setLatestReading(null);
    setLatestDeviceState(null);
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
          setConnectionStatus("connected");
          setConnectionError("");
          return;
        }

        if (
          message?.type === "device_state" &&
          String(message.place_id) === String(selectedPlaceId) &&
          message.data
        ) {
          setLatestDeviceState({
            ...message.data,
            place_id: message.place_id,
          });
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

  const value = useMemo(
    () => ({
      latestReading,
      latestDeviceState,
      connectionStatus,
      connectionError,
    }),
    [
      connectionError,
      connectionStatus,
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
