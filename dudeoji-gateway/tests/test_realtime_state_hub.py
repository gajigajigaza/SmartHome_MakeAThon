from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = PROJECT_ROOT / "dudeoji-api" / "sensor_realtime_hub.py"


class FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)


def load_realtime_hub_module():
    fake_fastapi = types.ModuleType("fastapi")
    fake_fastapi.WebSocket = FakeWebSocket
    previous = sys.modules.get("fastapi")
    sys.modules["fastapi"] = fake_fastapi
    try:
        spec = importlib.util.spec_from_file_location(
            "dudeoji_test_sensor_realtime_hub",
            MODULE_PATH,
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("sensor_realtime_hub 모듈을 읽지 못했습니다.")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("fastapi", None)
        else:
            sys.modules["fastapi"] = previous


class DeviceStateHubTests(unittest.IsolatedAsyncioTestCase):
    async def test_state_fans_out_and_is_cached(self) -> None:
        module = load_realtime_hub_module()
        hub = module.SensorReadingHub()
        place_54 = FakeWebSocket()
        place_55 = FakeWebSocket()
        hub.connect(place_54, user_id=7, place_id=54)
        hub.connect(place_55, user_id=7, place_id=55)

        await hub.broadcast_device_state(
            user_id=7,
            state={
                "window_is_open": True,
                "ac_is_on": False,
                "bme_available": False,
            },
        )

        self.assertEqual(place_54.sent[-1]["place_id"], 54)
        self.assertEqual(place_55.sent[-1]["place_id"], 55)
        self.assertTrue(
            place_54.sent[-1]["data"]["window_is_open"]
        )

        cached = hub.latest_device_state_message(
            user_id=7,
            place_id=54,
        )
        self.assertIsNotNone(cached)
        self.assertFalse(cached["data"]["bme_available"])
        self.assertTrue(cached["data"]["gateway_connected"])

        await hub.broadcast_device_disconnected(user_id=7)
        disconnected = place_54.sent[-1]["data"]
        self.assertFalse(disconnected["gateway_connected"])
        self.assertIsNone(disconnected["window_is_open"])
        self.assertIsNone(disconnected["ac_is_on"])


if __name__ == "__main__":
    unittest.main()
