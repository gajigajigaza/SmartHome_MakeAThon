"""센서 측정값과 기기 상태를 브라우저 WebSocket 구독자에게 전달합니다."""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket


class SensorReadingHub:
    """사용자·장소별 브라우저 WebSocket 연결을 메모리에서 관리합니다."""

    def __init__(self) -> None:
        self._connections: dict[tuple[int, int], list[WebSocket]] = defaultdict(list)
        # BME280 저장 기록과 별개인 리드·릴레이 최신 상태입니다.
        # 서버 재시작 전까지 유지하며 새 브라우저 연결에도 즉시 전달합니다.
        self._latest_device_states: dict[int, dict[str, Any]] = {}

    def connect(self, websocket: WebSocket, user_id: int, place_id: int) -> None:
        key = (int(user_id), int(place_id))
        if websocket not in self._connections[key]:
            self._connections[key].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int, place_id: int) -> None:
        key = (int(user_id), int(place_id))
        connections = self._connections.get(key, [])

        if websocket in connections:
            connections.remove(websocket)

        if not connections:
            self._connections.pop(key, None)

    async def broadcast_reading(
        self,
        *,
        user_id: int,
        place_id: int,
        reading: dict[str, Any],
    ) -> None:
        key = (int(user_id), int(place_id))
        connections = list(self._connections.get(key, []))
        disconnected: list[WebSocket] = []

        message = {
            "type": "sensor_reading",
            "place_id": int(place_id),
            "data": reading,
        }

        for websocket in connections:
            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append(websocket)

        for websocket in disconnected:
            self.disconnect(websocket, user_id, place_id)

    def latest_device_state_message(
        self,
        *,
        user_id: int,
        place_id: int,
    ) -> dict[str, Any] | None:
        state = self._latest_device_states.get(int(user_id))
        if state is None:
            return None

        return {
            "type": "device_state",
            "place_id": int(place_id),
            "data": dict(state),
        }

    async def broadcast_device_state(
        self,
        *,
        user_id: int,
        state: dict[str, Any],
    ) -> None:
        """사용자당 물리 보드 1대의 상태를 모든 활성 장소 화면에 보냅니다."""

        normalized_user_id = int(user_id)
        normalized_state = {
            "window_is_open": state["window_is_open"],
            "ac_is_on": state["ac_is_on"],
            "bme_available": state["bme_available"],
            "gateway_connected": True,
            "received_at": datetime.now(timezone.utc).isoformat(),
        }
        self._latest_device_states[normalized_user_id] = normalized_state
        await self._broadcast_normalized_device_state(
            user_id=normalized_user_id,
            state=normalized_state,
        )

    async def broadcast_device_disconnected(
        self,
        *,
        user_id: int,
    ) -> None:
        """현재 게이트웨이가 끊겼음을 모든 장소 화면에 즉시 알립니다."""

        normalized_user_id = int(user_id)
        normalized_state = {
            "window_is_open": None,
            "ac_is_on": None,
            "bme_available": False,
            "gateway_connected": False,
            "received_at": datetime.now(timezone.utc).isoformat(),
        }
        self._latest_device_states[normalized_user_id] = normalized_state
        await self._broadcast_normalized_device_state(
            user_id=normalized_user_id,
            state=normalized_state,
        )

    async def _broadcast_normalized_device_state(
        self,
        *,
        user_id: int,
        state: dict[str, Any],
    ) -> None:
        targets = [
            (place_id, list(connections))
            for (connected_user_id, place_id), connections
            in self._connections.items()
            if connected_user_id == user_id
        ]

        for place_id, connections in targets:
            disconnected: list[WebSocket] = []
            message = {
                "type": "device_state",
                "place_id": int(place_id),
                "data": dict(state),
            }

            for websocket in connections:
                try:
                    await websocket.send_json(message)
                except Exception:
                    disconnected.append(websocket)

            for websocket in disconnected:
                self.disconnect(
                    websocket,
                    user_id,
                    place_id,
                )


reading_hub = SensorReadingHub()
