"""이슈 #38 회귀 테스트 — reading 저장이 이벤트 루프를 막지 않는지 검증한다.

증상은 "게이트웨이가 5초 주기로 센서값을 보내는 동안 /health조차 응답 없음"
이었고, 원인은 async 함수인 _save_reading_to_place() 안에서 **동기**
supabase-py 클라이언트를 그대로 호출한 것이었다. 동기 호출이 진행되는 동안
이벤트 루프 스레드가 소켓 read에 붙잡혀 있어서, 그 사용자와 아무 상관 없는
요청까지 전부 멈춘다.

이 테스트는 원인을 직접 재현한다. 모든 DB 호출을 "time.sleep()으로 실제로
스레드를 막는" 가짜 함수로 바꿔 놓고, save_reading_for_user()를 돌리는 동안
별도 코루틴이 10ms 간격으로 깨어나며 지연(=루프가 막힌 시간)을 측정한다.

- 고치기 전 코드: 지연이 저장 시간(수백 ms~수 초)만큼 그대로 튄다 → 실패
- 고친 뒤 코드: DB 호출이 워커 스레드로 넘어가므로 지연은 수 ms 수준 → 통과

즉 "저장이 오래 걸리는 것"은 이 테스트의 관심사가 아니다. 저장이 오래 걸리는
동안에도 **루프가 다른 일을 계속 할 수 있는지**만 본다.
"""
import asyncio
import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

# db.py가 import 시점에 환경변수를 요구하므로 더미 값을 먼저 넣는다
# (실제 네트워크 호출은 이 테스트에서 전부 가짜로 대체된다).
import os  # noqa: E402

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SECRET_KEY", "dummy-key-for-tests")

from routers import readings_router  # noqa: E402

# 동기 DB 호출 1회가 걸리는 시간. Render→Supabase 왕복(수십~수백 ms)을 흉내낸다.
FAKE_DB_LATENCY_SECONDS = 0.05

# 루프 지연 허용치는 절대값이 아니라 "저장 시간에 대한 비율"로 잡는다.
#
# 동기 호출이 루프에서 돌면 정의상 지연 ≈ 저장 시간이 된다. 실측(장소 3개,
# 가짜 DB 지연 50ms):
#   고치기 전: 저장 890ms / 루프 지연 874~922ms  → 비율 98%
#   고친 뒤  : 저장 903ms / 루프 지연  10~ 21ms  → 비율  2%
# 두 값이 50배 차이라 중간 어디에 선을 그어도 판정이 갈린다. 비율로 재면
# CI 머신이 느리든 빠르든, 다른 작업으로 바쁘든 결과가 흔들리지 않는다
# (절대값으로 두면 머신이 바쁠 때 그냥 깨진다).
MAX_LOOP_LAG_RATIO = 0.4

# 비율 검사를 통과하더라도 이만큼은 절대 넘지 않아야 한다(sanity).
MAX_LOOP_LAG_SECONDS = 0.4

# 이보다 짧은 지연은 판정 대상에서 뺀다.
#
# 비율만 보면, 머신이 순간적으로 바빠 저장이 유난히 빨리 끝난 회차에서 OS
# 스케줄링 딸꾹질 한 번이 비율을 넘겨버릴 수 있다(실제로 테스트 여러 개를
# 연달아 돌릴 때 한 번 발생했다). 잡으려는 회귀는 "루프가 저장 시간 내내
# 막힌다"(실측 874~922ms)라서, 100ms 미만은 그 회귀일 수가 없다. 이 하한을
# 두면 CI가 바쁠 때 헛되이 깨지지 않으면서 진짜 회귀는 그대로 잡는다.
LOOP_LAG_NOISE_FLOOR_SECONDS = 0.1

HEARTBEAT_INTERVAL_SECONDS = 0.01


def _blocking(return_value):
    """호출되면 실제로 스레드를 막는 가짜 동기 DB 호출."""

    def call(*_args, **_kwargs):
        time.sleep(FAKE_DB_LATENCY_SECONDS)
        return return_value

    return call


def _fake_saved_row(place_id: int) -> dict:
    return {
        "id": 1,
        "place_id": place_id,
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "indoor_temperature": 28.0,
        "indoor_humidity": 55.0,
        "outdoor_temperature": 30.0,
        "outdoor_humidity": 60.0,
        "weather_condition": "맑음",
        "pm25": 20.0,
        "wind_speed": 1.5,
        "window_is_open": False,
        "current_mode": "MANUAL",
        "power_watt": None,
        "person_detected": None,
        "recommendation": {
            "action": "MAINTAIN",
            "title": "t",
            "summary": "s",
            "reason": "r",
        },
    }


class LoopLagProbe:
    """일정 간격으로 깨어나며 "예상보다 얼마나 늦게 깨어났는지"를 기록한다.

    perf.start_loop_lag_monitor()와 같은 원리다. 지연값이 곧 루프가 막힌 시간.
    """

    def __init__(self) -> None:
        self.max_lag_seconds = 0.0
        self.samples = 0
        self._stop = False

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        while not self._stop:
            before = loop.time()
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            lag = loop.time() - before - HEARTBEAT_INTERVAL_SECONDS
            self.max_lag_seconds = max(self.max_lag_seconds, lag)
            self.samples += 1

    def stop(self) -> None:
        self._stop = True


class ReadingSaveDoesNotBlockLoopTests(unittest.TestCase):
    def setUp(self) -> None:
        self.places = [
            {
                "id": place_id,
                "lat": 37.5665,
                "lon": 126.9780,
                "is_default": place_id == 1,
                "auto_control_enabled": False,
                "target_cooldown_minutes": 30,
                # 백그라운드 자동 제어는 이 테스트의 관심사가 아니다(별 task로
                # 분리돼 있어서 켜도 저장 경로를 막지 않는다).
                "background_condition_control_enabled": False,
                "background_occupancy_control_enabled": False,
            }
            for place_id in (1, 2, 3)
        ]

        self._patches: list[tuple[str, object]] = []

        def patch(name: str, value) -> None:
            self._patches.append((name, getattr(readings_router, name)))
            setattr(readings_router, name, value)

        # --- 동기 DB 호출들을 "실제로 스레드를 막는" 가짜로 교체 ---
        patch("_get_all_places_for_user", _blocking(self.places))
        patch("get_cumulative_kwh", _blocking(120.0))
        patch("get_rated_power", _blocking(2000))
        patch("calculate_ac_run_time", _blocking((None, 0)))
        patch("resolve_occupancy_signal", _blocking({"present": True, "source": "LIVE"}))
        patch(
            "_insert_reading_row",
            lambda reading_data: (
                time.sleep(FAKE_DB_LATENCY_SECONDS)
                or SimpleNamespace(
                    data=[_fake_saved_row(reading_data.get("place_id", 1))]
                )
            ),
        )

        # 첫 reading과 동일 취급(404) — 이 경로도 동기 호출이라 함께 막아본다.
        def blocking_latest(*_args, **_kwargs):
            time.sleep(FAKE_DB_LATENCY_SECONDS)
            raise readings_router.HTTPException(status_code=404, detail="none")

        patch("get_latest_reading", blocking_latest)

        # --- 이미 async인 것들은 네트워크만 제거 ---
        async def fake_weather(place_id, lat, lon, *, force_refresh=False):
            return (
                {
                    "outdoor_temperature": 30.0,
                    "outdoor_humidity": 60.0,
                    "wind_speed": 1.5,
                    "pm25": 20.0,
                    "weather_condition": "맑음",
                    "observed_at": "2026-07-30 12:00",
                    "air_quality_observed_at": "2026-07-30T12:00:00+09:00",
                    "weather_fetched_at": "2026-07-30T12:00:00+00:00",
                },
                {"cache_used": True, "kma": {"status": "OK"}, "air_quality": {"status": "OK"}},
            )

        patch("_load_outdoor_weather", fake_weather)

        async def fake_broadcast(**_kwargs):
            return None

        self._original_broadcast = readings_router.reading_hub.broadcast_reading
        readings_router.reading_hub.broadcast_reading = fake_broadcast

    def tearDown(self) -> None:
        for name, original in reversed(self._patches):
            setattr(readings_router, name, original)
        readings_router.reading_hub.broadcast_reading = self._original_broadcast

    def test_loop_stays_responsive_while_saving(self) -> None:
        async def scenario():
            probe = LoopLagProbe()
            probe_task = asyncio.create_task(probe.run())
            # 프로브가 먼저 안정적으로 돌기 시작하도록 한 틱 양보한다.
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS * 3)

            started = time.perf_counter()
            saved = await readings_router.save_reading_for_user(
                user_id=1,
                sensor_data_dict={
                    "indoor_temperature": 28.0,
                    "indoor_humidity": 55.0,
                },
            )
            save_seconds = time.perf_counter() - started

            probe.stop()
            await probe_task
            return saved, save_seconds, probe

        saved, save_seconds, probe = asyncio.run(scenario())

        # 저장 자체는 정상 동작해야 한다(팬아웃 대표 1건 반환).
        self.assertEqual(saved.place_id, 1)

        # 가짜 DB 지연이 실제로 걸렸는지 확인 — 안 걸렸으면 이 테스트는
        # 아무것도 증명하지 못한다.
        self.assertGreater(
            save_seconds,
            FAKE_DB_LATENCY_SECONDS * 5,
            "가짜 DB 지연이 적용되지 않았습니다. 테스트가 무의미합니다.",
        )
        self.assertGreater(probe.samples, 5, "루프 프로브가 거의 못 돌았습니다.")

        # 핵심 단정: 저장이 오래 걸리는 동안에도 루프는 자유로워야 한다.
        ratio = probe.max_lag_seconds / save_seconds
        detail = (
            f"이벤트 루프가 {probe.max_lag_seconds * 1000:.0f}ms 막혔습니다 "
            f"(저장 {save_seconds * 1000:.0f}ms, 비율 {ratio * 100:.0f}%). "
            "async 경로에서 동기 DB 호출을 직접 부르고 있는지 확인하세요 "
            "— perf.timed_blocking()/run_blocking()으로 감싸야 합니다."
        )
        if probe.max_lag_seconds > LOOP_LAG_NOISE_FLOOR_SECONDS:
            self.assertLess(ratio, MAX_LOOP_LAG_RATIO, detail)
        self.assertLess(probe.max_lag_seconds, MAX_LOOP_LAG_SECONDS, detail)


if __name__ == "__main__":
    unittest.main()
