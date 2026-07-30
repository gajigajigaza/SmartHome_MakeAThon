from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


GATEWAY_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GATEWAY_DIR))

from protocol import (  # noqa: E402
    ProtocolError,
    combined_sensor_to_server,
    control_ble_to_state,
    control_state_to_device_state,
    decode_camera_chunk,
    decode_json_message,
    environment_ble_to_state,
    result_ble_to_server,
    sensor_ble_to_device_state,
    sensor_ble_to_server,
    server_command_to_ble,
)


class ProtocolTests(unittest.TestCase):
    def test_environment_ble_to_state(self) -> None:
        result = environment_ble_to_state(
            {
                "type": "environment",
                "device_id": "sense-01",
                "temperature": 24.8,
                "humidity": 51.3,
                "bme_ok": True,
                "camera_ready": True,
                "person_detected": False,
            }
        )

        self.assertEqual(result["device_id"], "sense-01")
        self.assertEqual(result["temperature"], 24.8)
        self.assertIs(result["camera_ready"], True)
        self.assertIs(result["person_detected"], False)

    def test_control_ble_to_state(self) -> None:
        result = control_ble_to_state(
            {
                "type": "control_state",
                "device_id": "control-01",
                "window_open": True,
                "fan_on": False,
                "ina_available": True,
                "bus_voltage": 12.1,
                "current_ma": 320.0,
                "power_watt": 3.87,
            }
        )

        self.assertEqual(result["device_id"], "control-01")
        self.assertIs(result["window_open"], True)
        self.assertEqual(result["power_watt"], 3.87)

    def test_control_rejects_negative_power(self) -> None:
        with self.assertRaises(ProtocolError):
            control_ble_to_state(
                {
                    "type": "control_state",
                    "device_id": "control-01",
                    "window_open": False,
                    "fan_on": False,
                    "ina_available": True,
                    "bus_voltage": 12.0,
                    "current_ma": -10.0,
                    "power_watt": -0.12,
                }
            )

    def test_combines_sense_and_control_for_server(self) -> None:
        result = combined_sensor_to_server(
            {
                "type": "environment",
                "device_id": "sense-01",
                "temperature": 24.8,
                "humidity": 51.3,
                "bme_ok": True,
                "camera_ready": True,
                "person_detected": True,
            },
            {
                "type": "control_state",
                "device_id": "control-01",
                "window_open": False,
                "fan_on": True,
                "ina_available": True,
                "bus_voltage": 12.0,
                "current_ma": 500.0,
                "power_watt": 6.0,
            },
        )

        self.assertEqual(result["type"], "sensor_reading")
        self.assertEqual(result["data"]["indoor_temperature"], 24.8)
        self.assertIs(result["data"]["window_is_open"], False)
        self.assertIs(result["data"]["ac_is_on"], True)
        self.assertEqual(result["data"]["power_watt"], 6.0)
        self.assertIs(result["data"]["person_detected"], True)

    def test_combined_reading_rejects_missing_bme(self) -> None:
        with self.assertRaises(ProtocolError):
            combined_sensor_to_server(
                {
                    "type": "environment",
                    "device_id": "sense-01",
                    "temperature": None,
                    "humidity": None,
                    "bme_ok": False,
                    "camera_ready": True,
                    "person_detected": None,
                },
                {
                    "type": "control_state",
                    "device_id": "control-01",
                    "window_open": False,
                    "fan_on": False,
                    "ina_available": False,
                    "bus_voltage": None,
                    "current_ma": None,
                    "power_watt": None,
                },
            )

    def test_control_state_builds_device_state_without_bme(self) -> None:
        result = control_state_to_device_state(
            {
                "type": "control_state",
                "device_id": "control-01",
                "window_open": True,
                "fan_on": False,
                "ina_available": False,
                "bus_voltage": None,
                "current_ma": None,
                "power_watt": None,
            },
            bme_available=False,
        )

        self.assertIs(result["data"]["window_is_open"], True)
        self.assertIs(result["data"]["bme_available"], False)

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

    def test_decode_camera_chunk_middle(self) -> None:
        raw = bytes([7, 0x01, 0x2C, 0]) + b"jpegbytes"
        result = decode_camera_chunk(raw)

        self.assertEqual(result["frame_id"], 7)
        self.assertEqual(result["chunk_index"], 0x012C)
        self.assertIs(result["is_last"], False)
        self.assertEqual(result["payload"], b"jpegbytes")

    def test_decode_camera_chunk_last(self) -> None:
        raw = bytes([7, 0x00, 0x00, 1]) + b"end"
        result = decode_camera_chunk(raw)

        self.assertIs(result["is_last"], True)
        self.assertEqual(result["payload"], b"end")

    def test_decode_camera_chunk_rejects_short_header(self) -> None:
        with self.assertRaises(ProtocolError):
            decode_camera_chunk(bytes([1, 0, 0]))

    def test_decode_camera_chunk_rejects_bad_is_last(self) -> None:
        with self.assertRaises(ProtocolError):
            decode_camera_chunk(bytes([1, 0, 0, 2]) + b"x")


if __name__ == "__main__":
    unittest.main()
