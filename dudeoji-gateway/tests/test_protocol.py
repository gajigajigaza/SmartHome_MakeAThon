from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


GATEWAY_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GATEWAY_DIR))

from protocol import (  # noqa: E402
    ProtocolError,
    decode_json_message,
    result_ble_to_server,
    sensor_ble_to_device_state,
    sensor_ble_to_server,
    server_command_to_ble,
)


class ProtocolTests(unittest.TestCase):
    def test_sensor_ble_to_server(self) -> None:
        result = sensor_ble_to_server(
            {
                "type": "sensor",
                "temperature": 26.4,
                "humidity": 58.2,
                "window_open": False,
                "fan_on": True,
                "bme_ok": True,
            }
        )

        self.assertEqual(result["type"], "sensor_reading")
        self.assertEqual(result["data"]["indoor_temperature"], 26.4)
        self.assertEqual(result["data"]["indoor_humidity"], 58.2)
        self.assertIs(result["data"]["window_is_open"], False)
        self.assertIs(result["data"]["ac_is_on"], True)

    def test_invalid_bme_is_rejected(self) -> None:
        with self.assertRaises(ProtocolError):
            sensor_ble_to_server(
                {
                    "type": "sensor",
                    "temperature": None,
                    "humidity": None,
                    "window_open": False,
                    "fan_on": False,
                    "bme_ok": False,
                }
            )

    def test_device_state_does_not_require_bme(self) -> None:
        result = sensor_ble_to_device_state(
            {
                "type": "sensor",
                "temperature": None,
                "humidity": None,
                "window_open": True,
                "fan_on": False,
                "bme_ok": False,
            }
        )

        self.assertEqual(result["type"], "device_state")
        self.assertIs(result["data"]["window_is_open"], True)
        self.assertIs(result["data"]["ac_is_on"], False)
        self.assertIs(result["data"]["bme_available"], False)

    def test_demo_fallback_can_build_sensor_reading(self) -> None:
        result = sensor_ble_to_server(
            {
                "type": "sensor",
                "temperature": None,
                "humidity": None,
                "window_open": False,
                "fan_on": True,
                "bme_ok": False,
            },
            fallback_temperature=25.0,
            fallback_humidity=50.0,
        )

        self.assertEqual(result["data"]["indoor_temperature"], 25.0)
        self.assertEqual(result["data"]["indoor_humidity"], 50.0)
        self.assertIs(result["data"]["ac_is_on"], True)

    def test_demo_fallback_requires_both_values(self) -> None:
        with self.assertRaises(ProtocolError):
            sensor_ble_to_server(
                {
                    "type": "sensor",
                    "temperature": None,
                    "humidity": None,
                    "window_open": False,
                    "fan_on": False,
                    "bme_ok": False,
                },
                fallback_temperature=25.0,
            )

    def test_server_command_to_ble(self) -> None:
        raw = server_command_to_ble(
            {
                "type": "device_command",
                "command_id": "abc123",
                "action": "OPEN_WINDOW",
            }
        )
        decoded = json.loads(raw.decode("utf-8"))

        self.assertEqual(decoded["command_id"], "abc123")
        self.assertEqual(decoded["action"], "OPEN_WINDOW")

    def test_result_ble_to_server(self) -> None:
        result = result_ble_to_server(
            {
                "type": "result",
                "command_id": "abc123",
                "action": "TURN_ON_AIRCON",
                "success": True,
                "detail": "fan_turned_on",
            }
        )

        self.assertEqual(result["type"], "command_result")
        self.assertIs(result["success"], True)

    def test_decode_rejects_non_object(self) -> None:
        with self.assertRaises(ProtocolError):
            decode_json_message(b"[]")


if __name__ == "__main__":
    unittest.main()
