from __future__ import annotations

import sys
import unittest
from pathlib import Path


GATEWAY_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GATEWAY_DIR))

from sensorless_live_test import (  # noqa: E402
    build_role_url,
    choose_test_state,
    device_state_matches,
)


class SensorlessLiveTestHelpers(unittest.TestCase):
    def test_builds_sensor_and_web_urls_for_same_place(self) -> None:
        base_url = (
            "wss://example.test/ws/sensors"
            "?transport=websocket&place_id=1"
        )

        sensor_url = build_role_url(base_url, "sensors", 54)
        readings_url = build_role_url(base_url, "readings", 54)

        self.assertEqual(
            sensor_url,
            "wss://example.test/ws/sensors"
            "?transport=websocket&place_id=54",
        )
        self.assertEqual(
            readings_url,
            "wss://example.test/ws/readings"
            "?transport=websocket&place_id=54",
        )

    def test_chooses_state_different_from_cached_state(self) -> None:
        previous = {
            "type": "device_state",
            "data": {
                "window_is_open": True,
                "ac_is_on": False,
                "bme_available": False,
            },
        }

        result = choose_test_state(previous)

        self.assertIs(result["window_is_open"], False)
        self.assertIs(result["ac_is_on"], True)
        self.assertIs(result["bme_available"], False)

    def test_matches_forwarded_web_state(self) -> None:
        expected = {
            "window_is_open": True,
            "ac_is_on": False,
            "bme_available": False,
        }
        message = {
            "type": "device_state",
            "place_id": 54,
            "data": {
                **expected,
                "gateway_connected": True,
                "received_at": "2026-07-29T00:00:00+00:00",
            },
        }

        self.assertTrue(
            device_state_matches(
                message,
                place_id=54,
                expected_state=expected,
            )
        )
        self.assertFalse(
            device_state_matches(
                message,
                place_id=55,
                expected_state=expected,
            )
        )


if __name__ == "__main__":
    unittest.main()
