from __future__ import annotations

import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = PROJECT_ROOT / "dudeoji-api" / "device_connection_hub.py"


class FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.closed: list[tuple[int, str]] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)

    async def close(self, code: int, reason: str = "") -> None:
        self.closed.append((code, reason))


def load_device_hub_module():
    fake_fastapi = types.ModuleType("fastapi")
    fake_fastapi.WebSocket = FakeWebSocket
    previous = sys.modules.get("fastapi")
    sys.modules["fastapi"] = fake_fastapi
    try:
        spec = importlib.util.spec_from_file_location(
            "dudeoji_test_device_connection_hub",
            MODULE_PATH,
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("device_connection_hub 모듈을 읽지 못했습니다.")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("fastapi", None)
        else:
            sys.modules["fastapi"] = previous


class DeviceHubResultTests(unittest.IsolatedAsyncioTestCase):
    async def test_command_waits_for_matching_result(self) -> None:
        module = load_device_hub_module()
        hub = module.DeviceConnectionHub()
        websocket = FakeWebSocket()
        await hub.connect(websocket, user_id=7, place_id=54)

        command_task = asyncio.create_task(
            hub.send_command(
                user_id=7,
                requested_place_id=54,
                action="OPEN_WINDOW",
            )
        )
        await asyncio.sleep(0)

        command = websocket.sent[-1]
        matched = await hub.resolve_command_result(
            websocket=websocket,
            user_id=7,
            result={
                "type": "command_result",
                "command_id": command["command_id"],
                "action": "OPEN_WINDOW",
                "success": True,
                "detail": "servo_open_commanded",
            },
        )
        response = await command_task

        self.assertTrue(matched)
        self.assertTrue(response["accepted"])
        self.assertTrue(response["result_received"])
        self.assertTrue(response["success"])
        self.assertEqual(response["detail"], "servo_open_commanded")

    async def test_wrong_connection_cannot_resolve_result(self) -> None:
        module = load_device_hub_module()
        hub = module.DeviceConnectionHub()
        current = FakeWebSocket()
        other = FakeWebSocket()
        await hub.connect(current, user_id=7, place_id=54)

        matched = await hub.resolve_command_result(
            websocket=other,
            user_id=7,
            result={
                "command_id": "unknown",
                "action": "OPEN_WINDOW",
                "success": True,
                "detail": "",
            },
        )

        self.assertFalse(matched)

    async def test_disconnect_is_not_reported_as_device_result(self) -> None:
        module = load_device_hub_module()
        hub = module.DeviceConnectionHub()
        websocket = FakeWebSocket()
        await hub.connect(websocket, user_id=7, place_id=54)

        command_task = asyncio.create_task(
            hub.send_command(
                user_id=7,
                requested_place_id=54,
                action="TURN_ON_AIRCON",
            )
        )
        await asyncio.sleep(0)
        await hub.disconnect(websocket, user_id=7)
        response = await command_task

        self.assertFalse(response["result_received"])
        self.assertFalse(response["success"])
        self.assertEqual(
            response["detail"],
            "device_disconnected_before_result",
        )


if __name__ == "__main__":
    unittest.main()
