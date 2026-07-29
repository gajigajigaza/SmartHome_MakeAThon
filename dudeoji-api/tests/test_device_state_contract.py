import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from device_state_contract import (  # noqa: E402
    DeviceStateContractError,
    validate_device_state_data,
)
from sensor_realtime_hub import SensorReadingHub  # noqa: E402
from routers.readings_router import (  # noqa: E402
    SensorReadingCreate,
    SensorReadingResponse,
    _build_reading_insert_payload,
)


class FakeWebSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


class DeviceStateContractTests(unittest.TestCase):
    def test_legacy_three_field_state_remains_valid(self):
        state = validate_device_state_data(
            {
                "window_is_open": False,
                "ac_is_on": True,
                "bme_available": True,
            }
        )

        self.assertEqual(
            state,
            {
                "window_is_open": False,
                "ac_is_on": True,
                "bme_available": True,
            },
        )

    def test_new_optional_fields_are_validated_and_preserved(self):
        state = validate_device_state_data(
            {
                "window_is_open": True,
                "ac_is_on": False,
                "bme_available": True,
                "sense_connected": True,
                "control_connected": False,
                "ina_available": True,
            }
        )

        self.assertEqual(state["sense_connected"], True)
        self.assertEqual(state["control_connected"], False)
        self.assertEqual(state["ina_available"], True)

    def test_optional_fields_must_be_boolean_when_present(self):
        with self.assertRaises(DeviceStateContractError):
            validate_device_state_data(
                {
                    "window_is_open": False,
                    "ac_is_on": False,
                    "bme_available": True,
                    "control_connected": "false",
                }
            )


class SensorReadingHubDeviceStateTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_state_is_cached_and_forwarded_without_new_fields(self):
        hub = SensorReadingHub()
        websocket = FakeWebSocket()
        hub.connect(websocket, user_id=7, place_id=54)

        await hub.broadcast_device_state(
            user_id=7,
            state={
                "window_is_open": False,
                "ac_is_on": True,
                "bme_available": True,
            },
        )

        forwarded = websocket.messages[-1]
        cached = hub.latest_device_state_message(user_id=7, place_id=54)
        self.assertEqual(forwarded["place_id"], 54)
        self.assertTrue(forwarded["data"]["gateway_connected"])
        self.assertNotIn("sense_connected", forwarded["data"])
        self.assertEqual(cached, forwarded)

    async def test_new_state_is_cached_and_forwarded_with_all_optional_fields(self):
        hub = SensorReadingHub()
        websocket = FakeWebSocket()
        hub.connect(websocket, user_id=7, place_id=54)

        await hub.broadcast_device_state(
            user_id=7,
            state={
                "window_is_open": True,
                "ac_is_on": False,
                "bme_available": True,
                "sense_connected": True,
                "control_connected": True,
                "ina_available": False,
            },
        )

        forwarded = websocket.messages[-1]
        cached = hub.latest_device_state_message(user_id=7, place_id=54)
        self.assertEqual(forwarded["data"]["sense_connected"], True)
        self.assertEqual(forwarded["data"]["control_connected"], True)
        self.assertEqual(forwarded["data"]["ina_available"], False)
        self.assertEqual(cached, forwarded)

    async def test_gateway_disconnect_marks_both_esp_nodes_unavailable(self):
        hub = SensorReadingHub()
        websocket = FakeWebSocket()
        hub.connect(websocket, user_id=7, place_id=54)

        await hub.broadcast_device_disconnected(user_id=7)

        state = websocket.messages[-1]["data"]
        self.assertFalse(state["gateway_connected"])
        self.assertFalse(state["sense_connected"])
        self.assertFalse(state["control_connected"])
        self.assertFalse(state["ina_available"])


class HardwareReadingFieldTests(unittest.TestCase):
    def test_power_and_person_fields_are_stored_and_returned(self):
        sensor_data = SensorReadingCreate(
            indoor_temperature=24.5,
            indoor_humidity=51,
            power_watt=18.75,
            person_detected=True,
        )

        insert_payload = _build_reading_insert_payload(sensor_data)
        self.assertEqual(insert_payload["power_watt"], 18.75)
        self.assertEqual(insert_payload["person_detected"], True)

        response = SensorReadingResponse.model_validate(
            {
                **insert_payload,
                "id": 101,
                "place_id": 54,
                "measured_at": datetime.now(timezone.utc),
                "recommendation": {
                    "action": "MAINTAIN",
                    "title": "상태 유지",
                    "summary": "테스트 응답",
                    "reason": "경로 검증",
                },
            }
        )
        response_payload = response.model_dump(mode="json")
        self.assertEqual(response_payload["power_watt"], 18.75)
        self.assertEqual(response_payload["person_detected"], True)


if __name__ == "__main__":
    unittest.main()
