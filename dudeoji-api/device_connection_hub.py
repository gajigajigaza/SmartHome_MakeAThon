"""XIAO ESP32S3 WebSocket 연결과 제어 명령 전송을 관리합니다.

현재 제품 결정은 "사용자당 물리 센서 보드 1대"입니다.
센서값은 사용자의 모든 장소로 팬아웃되므로, 제어용 보드 연결도 user_id 기준으로
관리합니다. 연결 시 사용한 place_id는 진단과 응답 메타데이터로 보존합니다.
"""

from __future__ import annotations

import asyncio
import os
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
# jh 수정함 - 8.0초에서 낮췄다. 이 값은 "기기가 command_result를 돌려줄 때까지
# HTTP 응답을 붙잡고 기다리는 시간"이고, 프론트는 이 시간 내내 창문/에어컨 버튼
# 둘 다 비활성화한 채 "전송 중…"을 띄운다(HeaderQuickControls.jsx).
#
# 중요한 건, 명령 자체는 기다리기 전에 이미 나갔다는 점이다 — send_json()이
# 끝난 순간 게이트웨이→BLE→서보로 진행되고, 실측 왕복은 150~300ms다. 8초는
# 이벤트 루프가 막혀서 ack를 읽어줄 receive 루프가 멈춰 있던 시절의 값이고,
# 그때는 정상 동작하는 기기도 매번 8초를 꽉 채웠다(이슈 #38). 그 원인을 고친
# 뒤에는 2.5초도 정상 왕복의 8배 이상 여유다.
#
# 타임아웃돼도 명령이 실패한 게 아니라 "확인만 못 받은" 상태이고, 프론트도
# 그렇게 표시한다("명령 전송됨 · 기기 응답 시간 초과"). 실제 상태는 곧바로
# 뒤따라오는 device_state 알림으로 갱신된다.
COMMAND_RESULT_TIMEOUT_SECONDS = float(
    os.getenv("COMMAND_RESULT_TIMEOUT_SECONDS", "2.5")
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


@dataclass(slots=True)
class _PendingCommand:
    action: str
    future: asyncio.Future[dict[str, Any]]


class DeviceConnectionHub:
    """사용자당 하나의 XIAO WebSocket 연결을 메모리에서 관리합니다."""

    def __init__(self) -> None:
        self._connections: dict[int, _DeviceConnection] = {}
        self._pending_commands: dict[
            tuple[int, str],
            _PendingCommand,
        ] = {}
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

        replaced_pending: list[_PendingCommand] = []
        async with self._registry_lock:
            previous = self._connections.get(normalized_user_id)
            if previous is not None and previous.websocket is not websocket:
                replaced_keys = [
                    key
                    for key in self._pending_commands
                    if key[0] == normalized_user_id
                ]
                for key in replaced_keys:
                    replaced_pending.append(
                        self._pending_commands.pop(key)
                    )
            self._connections[normalized_user_id] = new_connection

        if previous is not None and previous.websocket is not websocket:
            for pending in replaced_pending:
                if not pending.future.done():
                    pending.future.set_result(
                        {
                            "result_received": False,
                            "success": False,
                            "detail": "device_connection_replaced",
                        }
                    )
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
    ) -> bool:
        """현재 등록된 소켓과 같은 연결일 때만 목록에서 제거합니다."""

        normalized_user_id = int(user_id)
        disconnected_pending: list[_PendingCommand] = []
        removed_current_connection = False

        async with self._registry_lock:
            current = self._connections.get(normalized_user_id)
            if current is not None and current.websocket is websocket:
                removed_current_connection = True
                self._connections.pop(normalized_user_id, None)
                disconnected_keys = [
                    key
                    for key in self._pending_commands
                    if key[0] == normalized_user_id
                ]
                for key in disconnected_keys:
                    disconnected_pending.append(
                        self._pending_commands.pop(key)
                    )

        for pending in disconnected_pending:
            if not pending.future.done():
                pending.future.set_result(
                    {
                        "result_received": False,
                        "success": False,
                        "detail": "device_disconnected_before_result",
                    }
                )

        return removed_current_connection

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
        command_id = uuid4().hex
        sent_at = datetime.now(timezone.utc).isoformat()

        loop = asyncio.get_running_loop()
        result_future: asyncio.Future[dict[str, Any]] = (
            loop.create_future()
        )

        async with self._registry_lock:
            connection = self._connections.get(normalized_user_id)
            if connection is None:
                raise DeviceNotConnectedError(
                    "연결된 XIAO BLE 게이트웨이가 없습니다. "
                    "게이트웨이와 /ws/sensors 연결 상태를 확인해 주세요."
                )
            self._pending_commands[(normalized_user_id, command_id)] = (
                _PendingCommand(
                    action=action,
                    future=result_future,
                )
            )

        payload = {
            "type": "device_command",
            "command_id": command_id,
            "place_id": int(requested_place_id),
            "action": action,
            "sent_at": sent_at,
        }

        try:
            await self._send(connection, payload)
            try:
                command_result = await asyncio.wait_for(
                    asyncio.shield(result_future),
                    timeout=COMMAND_RESULT_TIMEOUT_SECONDS,
                )
                result_received = bool(
                    command_result.get("result_received")
                )
            except asyncio.TimeoutError:
                command_result = {
                    "result_received": False,
                    "success": None,
                    "detail": "command_result_timeout",
                }
                result_received = False
        finally:
            async with self._registry_lock:
                pending = self._pending_commands.pop(
                    (normalized_user_id, command_id),
                    None,
                )
            if (
                pending is not None
                and not pending.future.done()
            ):
                pending.future.cancel()

        return {
            "accepted": True,
            "transport": "websocket",
            "command_id": command_id,
            "place_id": int(requested_place_id),
            "device_connected_place_id": connection.connected_place_id,
            "action": action,
            "sent_at": sent_at,
            "result_received": result_received,
            "success": command_result.get("success"),
            "detail": command_result.get("detail", ""),
        }

    async def resolve_command_result(
        self,
        *,
        websocket: WebSocket,
        user_id: int,
        result: dict[str, Any],
    ) -> bool:
        """현재 XIAO 연결의 결과를 대기 중인 HTTP 제어 요청에 연결합니다."""

        normalized_user_id = int(user_id)
        command_id = result.get("command_id")
        if not isinstance(command_id, str) or not command_id:
            return False

        async with self._registry_lock:
            connection = self._connections.get(normalized_user_id)
            if connection is None or connection.websocket is not websocket:
                return False

            pending = self._pending_commands.get(
                (normalized_user_id, command_id)
            )
            if pending is None or pending.future.done():
                return False

            action = result.get("action")
            if action != pending.action:
                normalized_result = {
                    "result_received": True,
                    "success": False,
                    "detail": "command_result_action_mismatch",
                }
            else:
                normalized_result = {
                    "result_received": True,
                    "success": result.get("success"),
                    "detail": str(result.get("detail", ""))[:200],
                }

            pending.future.set_result(normalized_result)
            return True

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
