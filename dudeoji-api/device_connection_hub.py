"""XIAO ESP32S3 WebSocket 연결과 제어 명령 전송을 관리합니다.

현재 제품 결정은 "사용자당 물리 센서 보드 1대"입니다.
센서값은 사용자의 모든 장소로 팬아웃되므로, 제어용 보드 연결도 user_id 기준으로
관리합니다. 연결 시 사용한 place_id는 진단과 응답 메타데이터로 보존합니다.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import WebSocket


ALLOWED_DEVICE_ACTIONS = frozenset(
    {
        "OPEN_WINDOW",
        "CLOSE_WINDOW",
        "TURN_ON_AIRCON",
        "TURN_OFF_AIRCON",
    }
)


class DeviceConnectionError(RuntimeError):
    """기기 WebSocket 연결 또는 전송 실패의 공통 예외입니다."""


class DeviceNotConnectedError(DeviceConnectionError):
    """현재 사용자에게 연결된 XIAO가 없을 때 발생합니다."""


class DeviceSendError(DeviceConnectionError):
    """연결된 XIAO로 메시지를 보내지 못했을 때 발생합니다."""


@dataclass(slots=True)
class _DeviceConnection:
    websocket: WebSocket
    user_id: int
    connected_place_id: int
    send_lock: asyncio.Lock


class DeviceConnectionHub:
    """사용자당 하나의 XIAO WebSocket 연결을 메모리에서 관리합니다."""

    def __init__(self) -> None:
        self._connections: dict[int, _DeviceConnection] = {}
        self._registry_lock = asyncio.Lock()

    async def connect(
        self,
        websocket: WebSocket,
        user_id: int,
        place_id: int,
    ) -> None:
        """새 XIAO 연결을 등록하고, 같은 사용자의 기존 연결은 교체합니다."""

        normalized_user_id = int(user_id)
        new_connection = _DeviceConnection(
            websocket=websocket,
            user_id=normalized_user_id,
            connected_place_id=int(place_id),
            send_lock=asyncio.Lock(),
        )

        async with self._registry_lock:
            previous = self._connections.get(normalized_user_id)
            self._connections[normalized_user_id] = new_connection

        if previous is not None and previous.websocket is not websocket:
            try:
                await previous.websocket.close(
                    code=1012,
                    reason="새 XIAO 연결로 교체되었습니다.",
                )
            except Exception:
                pass

    async def disconnect(
        self,
        websocket: WebSocket,
        user_id: int,
    ) -> None:
        """현재 등록된 소켓과 같은 연결일 때만 목록에서 제거합니다."""

        normalized_user_id = int(user_id)

        async with self._registry_lock:
            current = self._connections.get(normalized_user_id)
            if current is not None and current.websocket is websocket:
                self._connections.pop(normalized_user_id, None)

    async def is_connected(self, user_id: int) -> bool:
        async with self._registry_lock:
            return int(user_id) in self._connections

    async def send_to_connection(
        self,
        *,
        websocket: WebSocket,
        user_id: int,
        message: dict[str, Any],
    ) -> None:
        """해당 XIAO 연결 자체에 응답을 보냅니다.

        연결이 새 소켓으로 교체된 경우, 오래된 핸들러가 새 소켓에 응답하지
        못하도록 websocket 객체까지 확인합니다.
        """

        connection = await self._get_connection(int(user_id))
        if connection is None or connection.websocket is not websocket:
            raise DeviceNotConnectedError(
                "현재 XIAO 연결이 이미 종료되었거나 새 연결로 교체되었습니다."
            )

        await self._send(connection, message)

    async def send_command(
        self,
        *,
        user_id: int,
        requested_place_id: int,
        action: str,
    ) -> dict[str, Any]:
        """웹 제어 요청을 현재 사용자의 XIAO WebSocket으로 전달합니다."""

        if action not in ALLOWED_DEVICE_ACTIONS:
            raise ValueError("지원하지 않는 기기 제어 명령입니다.")

        normalized_user_id = int(user_id)
        connection = await self._get_connection(normalized_user_id)
        if connection is None:
            raise DeviceNotConnectedError(
                "연결된 XIAO 보드가 없습니다. "
                "보드의 Wi-Fi와 /ws/sensors 연결 상태를 확인해 주세요."
            )

        command_id = uuid4().hex
        sent_at = datetime.now(timezone.utc).isoformat()
        payload = {
            "type": "device_command",
            "command_id": command_id,
            "place_id": int(requested_place_id),
            "action": action,
            "sent_at": sent_at,
        }

        await self._send(connection, payload)

        return {
            "accepted": True,
            "transport": "websocket",
            "command_id": command_id,
            "place_id": int(requested_place_id),
            "device_connected_place_id": connection.connected_place_id,
            "action": action,
            "sent_at": sent_at,
        }

    async def _get_connection(
        self,
        user_id: int,
    ) -> _DeviceConnection | None:
        async with self._registry_lock:
            return self._connections.get(int(user_id))

    async def _send(
        self,
        connection: _DeviceConnection,
        message: dict[str, Any],
    ) -> None:
        """같은 WebSocket에 대한 동시 send_json 호출을 직렬화합니다."""

        async with connection.send_lock:
            try:
                await connection.websocket.send_json(message)
            except Exception as error:
                await self.disconnect(
                    connection.websocket,
                    connection.user_id,
                )
                raise DeviceSendError(
                    "XIAO 보드로 메시지를 전송하지 못했습니다. "
                    "보드 연결 상태를 확인해 주세요."
                ) from error


device_hub = DeviceConnectionHub()
