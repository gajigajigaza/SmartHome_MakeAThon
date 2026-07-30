import sys
import unittest
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from recommendation_engine import determine_action  # noqa: E402


class OccupancyAwareRecommendationTests(unittest.TestCase):
    """2026-07-30 실기기 연동 후 발견된 USE_AIRCON<->TURN_OFF_AIRCON 진동 회귀 테스트.

    AC가 꺼져 있고 방이 덥더라도, 재실 신호가 "확실히 없음"이면 다시 켜라고
    추천하면 안 된다 — 그래야 반대쪽(켜진 채 사람 없으면 꺼라)과 합쳐서
    빈 방에서는 꺼진 상태로 안정된다.
    """

    def test_hot_empty_room_ac_off_does_not_recommend_use_aircon(self):
        result = determine_action(
            indoor_temp=29.0,
            outdoor_temp=30.0,
            indoor_humidity=50.0,
            outdoor_humidity=50.0,
            wind_speed=0.0,
            window_is_open=False,
            is_ac_on=False,
            occupancy_signal={"present": False, "source": "LIVE"},
        )

        self.assertNotEqual(result["action"], "USE_AIRCON")

    def test_hot_occupied_room_ac_off_still_recommends_use_aircon(self):
        result = determine_action(
            indoor_temp=29.0,
            outdoor_temp=30.0,
            indoor_humidity=50.0,
            outdoor_humidity=50.0,
            wind_speed=0.0,
            window_is_open=False,
            is_ac_on=False,
            occupancy_signal={"present": True, "source": "LIVE"},
        )

        self.assertEqual(result["action"], "USE_AIRCON")

    def test_hot_room_ac_off_no_occupancy_signal_still_recommends_use_aircon(self):
        """occupancy_signal이 None(콜드스타트/신호 없음)이면 기존 동작을 유지한다."""
        result = determine_action(
            indoor_temp=29.0,
            outdoor_temp=30.0,
            indoor_humidity=50.0,
            outdoor_humidity=50.0,
            wind_speed=0.0,
            window_is_open=False,
            is_ac_on=False,
            occupancy_signal=None,
        )

        self.assertEqual(result["action"], "USE_AIRCON")

    def test_ac_on_empty_room_still_recommends_turn_off(self):
        """기존 반대 방향(켜진 채 사람 없으면 꺼라) 동작은 그대로다."""
        result = determine_action(
            indoor_temp=29.0,
            outdoor_temp=30.0,
            indoor_humidity=50.0,
            outdoor_humidity=50.0,
            wind_speed=0.0,
            window_is_open=False,
            is_ac_on=True,
            occupancy_signal={"present": False, "source": "LIVE"},
        )

        self.assertEqual(result["action"], "TURN_OFF_AIRCON")


if __name__ == "__main__":
    unittest.main()
