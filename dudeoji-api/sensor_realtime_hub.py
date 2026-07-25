"""센서 측정값을 브라우저 WebSocket 구독자에게 전달하는 연결 관리자."""

from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class SensorReadingHub:
    """사용자·장소별 브라우저 WebSocket 연결을 메모리에서 관리합니다."""

    def __init__(self) -> None:
        self._connections: dict[tuple[int, int], list[WebSocket]] = defaultdict(list)

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


reading_hub = SensorReadingHub()
