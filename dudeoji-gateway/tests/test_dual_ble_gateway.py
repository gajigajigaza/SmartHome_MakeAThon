from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


GATEWAY_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GATEWAY_DIR))

from gateway import (  # noqa: E402
    CONTROL_DEVICE_ID,
    SENSE_DEVICE_ID,
    DeviceSnapshot,
    DudeojiGateway,
    SERVICE_UUID,
    Settings,
)


def make_settings(*, stale_after: float = 30.0) -> Settings:
    return Settings(
        websocket_url="wss://example.test/ws/sensors",
        place_id=54,
        auth_token="test-token",
        ble_device_name="DUDEOJI-XIAO",
        ble_scan_timeout=1.0,
        demo_fallback_bme=False,
        demo_temperature=25.0,
        demo_humidity=50.0,
        api_base_url="https://example.test",
        sense_ble_name="DUDEOJI-SENSE",
        control_ble_name="DUDEOJI-CONTROL",
        state_stale_after=stale_after,
    )


def sense_message(*, bme_ok: bool = True) -> dict:
    return {
        "type": "environment",
        "device_id": "sense-01",
        "temperature": 25.2 if bme_ok else None,
        "humidity": 48.5 if bme_ok else None,
        "bme_ok": bme_ok,
        "camera_ready": True,
        "person_detected": True,
    }


def control_message() -> dict:
    return {
        "type": "control_state",
        "device_id": "control-01",
        "window_open": False,
        "fan_on": True,
        "ina_available": True,
        "bus_voltage": 12.0,
        "current_ma": 500.0,
        "power_watt": 6.0,
    }


class FakeBleClient:
    def __init__(self, *, connected: bool = True) -> None:
        self.is_connected = connected
        self.writes: list[tuple[str, bytes, bool]] = []

    async def write_gatt_char(
        self,
        characteristic: str,
        payload: bytes,
        *,
        response: bool,
    ) -> None:
        self.writes.append((characteristic, payload, response))


class DualBleGatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.gateway = DudeojiGateway(make_settings())
        self.gateway.event_loop = asyncio.get_running_loop()
        for spec in self.gateway.device_specs.values():
            self.gateway._set_device_connected(spec, True)
            self.gateway.ble_ready[spec.device_id].set()

    async def test_sense_disconnect_keeps_control_connected(self) -> None:
        spec = self.gateway.device_specs[SENSE_DEVICE_ID]
        disconnected = asyncio.Event()

        self.gateway._handle_device_disconnected(spec, disconnected)

        self.assertTrue(disconnected.is_set())
        self.assertFalse(self.gateway.sense_connected)
        self.assertTrue(self.gateway.control_connected)
        self.assertTrue(
            self.gateway.device_connected[CONTROL_DEVICE_ID]
        )
        self.assertFalse(self.gateway.stop_event.is_set())

    async def test_control_disconnect_keeps_sense_connected(self) -> None:
        spec = self.gateway.device_specs[CONTROL_DEVICE_ID]
        disconnected = asyncio.Event()

        self.gateway._handle_device_disconnected(spec, disconnected)

        self.assertTrue(disconnected.is_set())
        self.assertTrue(self.gateway.sense_connected)
        self.assertFalse(self.gateway.control_connected)
        self.assertTrue(self.gateway.device_connected[SENSE_DEVICE_ID])
        self.assertFalse(self.gateway.stop_event.is_set())

    async def test_command_is_written_only_to_control(self) -> None:
        sense_client = FakeBleClient()
        control_client = FakeBleClient()
        self.gateway.ble_clients[SENSE_DEVICE_ID] = sense_client
        self.gateway.ble_clients[CONTROL_DEVICE_ID] = control_client

        await self.gateway._send_command_to_xiao(
            {
                "type": "device_command",
                "command_id": "command-1",
                "action": "OPEN_WINDOW",
            }
        )

        self.assertEqual(sense_client.writes, [])
        self.assertEqual(len(control_client.writes), 1)
        payload = json.loads(
            control_client.writes[0][1].decode("utf-8")
        )
        self.assertEqual(payload["command_id"], "command-1")

    async def test_camera_chunks_reassemble_into_full_frame(self) -> None:
        self.gateway._on_camera_chunk_notification(
            None, bytes([3, 0x00, 0x00, 0]) + b"ABC"
        )
        self.gateway._on_camera_chunk_notification(
            None, bytes([3, 0x00, 0x01, 1]) + b"DEF"
        )

        frame = self.gateway.camera_frame_queue.get_nowait()
        self.assertEqual(frame, b"ABCDEF")

    async def test_camera_new_frame_id_resets_buffer(self) -> None:
        self.gateway._on_camera_chunk_notification(
            None, bytes([1, 0, 0, 0]) + b"stale"
        )
        self.gateway._on_camera_chunk_notification(
            None, bytes([2, 0, 0, 1]) + b"fresh"
        )

        frame = self.gateway.camera_frame_queue.get_nowait()
        self.assertEqual(frame, b"fresh")

    async def test_camera_queue_full_drops_oldest_frame(self) -> None:
        def send_frame(frame_id: int, payload: bytes) -> None:
            self.gateway._on_camera_chunk_notification(
                None, bytes([frame_id, 0, 0, 1]) + payload
            )

        send_frame(1, b"first")
        send_frame(2, b"second")
        send_frame(3, b"third")

        remaining = []
        while not self.gateway.camera_frame_queue.empty():
            remaining.append(
                self.gateway.camera_frame_queue.get_nowait()
            )

        self.assertEqual(remaining, [b"second", b"third"])

    async def test_dual_scan_requires_exact_advertised_name(self) -> None:
        spec = self.gateway.device_specs[SENSE_DEVICE_ID]
        matching = SimpleNamespace(
            name="DUDEOJI-SENSE",
            address="sense-address",
        )
        wrong_name = SimpleNamespace(
            name="DUDEOJI-CONTROL",
            address="control-address",
        )
        advertisement = SimpleNamespace(
            local_name="DUDEOJI-CONTROL",
            service_uuids=[SERVICE_UUID],
        )

        async def fake_find(predicate, *, timeout):
            self.assertEqual(timeout, 1.0)
            self.assertFalse(predicate(wrong_name, advertisement))
            self.assertTrue(predicate(matching, advertisement))
            return matching

        with patch(
            "gateway.BleakScanner.find_device_by_filter",
            side_effect=fake_find,
        ):
            found = await self.gateway._find_ble_device(spec)

        self.assertIs(found, matching)

    async def test_disconnected_control_returns_failed_result(self) -> None:
        self.gateway.ble_clients[CONTROL_DEVICE_ID] = None
        self.gateway.ble_ready[CONTROL_DEVICE_ID].clear()

        await self.gateway._send_command_to_xiao(
            {
                "type": "device_command",
                "command_id": "command-2",
                "action": "TURN_ON_AIRCON",
            }
        )

        item = self.gateway.outbound_queue.get_nowait()
        self.gateway.outbound_queue.task_done()
        self.assertEqual(item.message["type"], "command_result")
        self.assertFalse(item.message["success"])
        self.assertEqual(
            item.message["detail"],
            "control_ble_not_connected",
        )

    async def test_dual_cache_combines_fresh_states(self) -> None:
        self.gateway._on_sensor_notification(
            SENSE_DEVICE_ID,
            None,
            bytearray(json.dumps(sense_message()).encode("utf-8")),
        )
        self.gateway._on_sensor_notification(
            CONTROL_DEVICE_ID,
            None,
            bytearray(json.dumps(control_message()).encode("utf-8")),
        )
        await asyncio.sleep(0)

        messages = []
        while not self.gateway.outbound_queue.empty():
            item = self.gateway.outbound_queue.get_nowait()
            self.gateway.outbound_queue.task_done()
            messages.append(item.message)

        reading = next(
            message
            for message in messages
            if message["type"] == "sensor_reading"
        )
        state = next(
            message
            for message in messages
            if message["type"] == "device_state"
        )
        self.assertEqual(reading["data"]["power_watt"], 6.0)
        self.assertIs(reading["data"]["person_detected"], True)
        self.assertIs(state["data"]["bme_available"], True)
        self.assertTrue(self.gateway.ina_available)

    async def test_missing_bme_keeps_device_state_without_reading(self) -> None:
        self.gateway._on_sensor_notification(
            SENSE_DEVICE_ID,
            None,
            bytearray(
                json.dumps(sense_message(bme_ok=False)).encode("utf-8")
            ),
        )
        self.gateway._on_sensor_notification(
            CONTROL_DEVICE_ID,
            None,
            bytearray(json.dumps(control_message()).encode("utf-8")),
        )
        await asyncio.sleep(0)

        messages = []
        while not self.gateway.outbound_queue.empty():
            item = self.gateway.outbound_queue.get_nowait()
            self.gateway.outbound_queue.task_done()
            messages.append(item.message)

        self.assertFalse(
            any(
                message["type"] == "sensor_reading"
                for message in messages
            )
        )
        state = next(
            message
            for message in messages
            if message["type"] == "device_state"
        )
        self.assertIs(state["data"]["bme_available"], False)

    async def test_stale_snapshot_is_not_reused(self) -> None:
        stale_gateway = DudeojiGateway(make_settings(stale_after=5.0))
        for spec in stale_gateway.device_specs.values():
            stale_gateway._set_device_connected(spec, True)
        stale_gateway.latest_states[SENSE_DEVICE_ID] = DeviceSnapshot(
            data=sense_message(),
            received_at=10.0,
        )

        self.assertIsNotNone(
            stale_gateway._fresh_snapshot(
                SENSE_DEVICE_ID,
                now=14.9,
            )
        )
        self.assertIsNone(
            stale_gateway._fresh_snapshot(
                SENSE_DEVICE_ID,
                now=15.1,
            )
        )

    async def test_queue_coalesces_by_source_and_data_kind(self) -> None:
        self.gateway._enqueue_from_ble_callback(
            {"type": "sensor_reading", "data": {"value": 1}},
            source_id=SENSE_DEVICE_ID,
            data_kind="combined_sensor_reading",
        )
        self.gateway._enqueue_from_ble_callback(
            {"type": "device_state", "data": {"value": 2}},
            source_id=CONTROL_DEVICE_ID,
            data_kind="device_state",
        )
        self.gateway._enqueue_from_ble_callback(
            {"type": "sensor_reading", "data": {"value": 3}},
            source_id=SENSE_DEVICE_ID,
            data_kind="combined_sensor_reading",
        )
        await asyncio.sleep(0)

        items = []
        while not self.gateway.outbound_queue.empty():
            item = self.gateway.outbound_queue.get_nowait()
            self.gateway.outbound_queue.task_done()
            items.append(item)

        self.assertEqual(len(items), 2)
        self.assertEqual(
            {
                item.coalesce_key
                for item in items
            },
            {
                (SENSE_DEVICE_ID, "combined_sensor_reading"),
                (CONTROL_DEVICE_ID, "device_state"),
            },
        )
        sensor_item = next(
            item
            for item in items
            if item.message["type"] == "sensor_reading"
        )
        self.assertEqual(sensor_item.message["data"]["value"], 3)


class GatewaySettingsTests(unittest.IsolatedAsyncioTestCase):
    def test_dual_settings_create_two_named_devices(self) -> None:
        settings = make_settings()

        self.assertTrue(settings.dual_ble_enabled)
        devices = {
            spec.device_id: spec
            for spec in settings.ble_devices()
        }
        self.assertEqual(
            devices[SENSE_DEVICE_ID].ble_name,
            "DUDEOJI-SENSE",
        )
        self.assertEqual(
            devices[CONTROL_DEVICE_ID].ble_name,
            "DUDEOJI-CONTROL",
        )

    def test_legacy_settings_keep_single_esp_mode(self) -> None:
        settings = Settings(
            websocket_url="wss://example.test/ws/sensors",
            place_id=54,
            auth_token="test-token",
            ble_device_name="DUDEOJI-XIAO",
            ble_scan_timeout=1.0,
            demo_fallback_bme=False,
            demo_temperature=25.0,
            demo_humidity=50.0,
            api_base_url="https://example.test",
        )

        self.assertFalse(settings.dual_ble_enabled)
        devices = settings.ble_devices()
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0].ble_name, "DUDEOJI-XIAO")

    def test_sense_only_environment_creates_sense_device(self) -> None:
        environment = {
            "DUDEOJI_WEBSOCKET_URL": (
                "wss://example.test/ws/sensors"
            ),
            "DUDEOJI_PLACE_ID": "54",
            "DUDEOJI_AUTH_TOKEN": "test-token",
            "DUDEOJI_BLE_DEVICE_NAME": "DUDEOJI-XIAO",
            "DUDEOJI_SENSE_BLE_NAME": "DUDEOJI-SENSE",
            "DUDEOJI_CONTROL_BLE_NAME": "",
        }

        with patch.dict(os.environ, environment, clear=True), patch("gateway.load_dotenv"):
            settings = Settings.from_environment()

        self.assertTrue(settings.sense_only_enabled)
        self.assertFalse(settings.control_only_enabled)
        devices = settings.ble_devices()
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0].device_id, SENSE_DEVICE_ID)

    def test_control_only_environment_creates_control_device(self) -> None:
        environment = {
            "DUDEOJI_WEBSOCKET_URL": "wss://example.test/ws/sensors",
            "DUDEOJI_PLACE_ID": "54",
            "DUDEOJI_AUTH_TOKEN": "test-token",
            "DUDEOJI_BLE_DEVICE_NAME": "DUDEOJI-XIAO",
            "DUDEOJI_SENSE_BLE_NAME": "",
            "DUDEOJI_CONTROL_BLE_NAME": "DUDEOJI-CONTROL",
        }

        with patch.dict(os.environ, environment, clear=True), patch("gateway.load_dotenv"):
            settings = Settings.from_environment()

        self.assertTrue(settings.control_only_enabled)
        devices = settings.ble_devices()
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0].device_id, CONTROL_DEVICE_ID)

    async def test_sense_only_emits_sensor_reading(self) -> None:
        settings = Settings(
            websocket_url="wss://example.test/ws/sensors",
            place_id=54,
            auth_token="test-token",
            ble_device_name="DUDEOJI-XIAO",
            ble_scan_timeout=1.0,
            demo_fallback_bme=False,
            demo_temperature=25.0,
            demo_humidity=50.0,
            api_base_url="https://example.test",
            sense_ble_name="DUDEOJI-SENSE",
        )
        gateway = DudeojiGateway(settings)
        gateway.event_loop = asyncio.get_running_loop()
        gateway._set_device_connected(
            gateway.device_specs[SENSE_DEVICE_ID],
            True,
        )

        gateway._on_sensor_notification(
            SENSE_DEVICE_ID,
            None,
            bytearray(json.dumps(sense_message()).encode("utf-8")),
        )
        await asyncio.sleep(0)

        items = []
        while not gateway.outbound_queue.empty():
            item = gateway.outbound_queue.get_nowait()
            gateway.outbound_queue.task_done()
            items.append(item.message)

        reading = next(item for item in items if item["type"] == "sensor_reading")
        state = next(item for item in items if item["type"] == "device_state")
        self.assertIsNone(reading["data"]["window_is_open"])
        self.assertIsNone(reading["data"]["ac_is_on"])
        self.assertTrue(state["data"]["sense_connected"])
        self.assertFalse(state["data"]["control_connected"])


if __name__ == "__main__":
    unittest.main()
