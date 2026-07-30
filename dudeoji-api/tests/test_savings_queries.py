"""savings.py의 조회 경로 테스트 (이슈 #38).

이 파일이 필요한 이유는 실제로 두 번 물린 곳이라서다.

1. 원래 두 함수는 range 없는 select를 써서 PostgREST의 max-rows(보통 1000)에
   조용히 잘렸다. 예외도 안 나고 결과만 틀린다 — 이번 달 "가장 오래된" 1000행만
   집계돼서, 누적 kWh가 어느 시점부터 멈추고 누진 단가가 최저 구간에 고정됐다.
2. 트림된 JSONB select로 바꾸면서 호출부 하나에 인자를 빠뜨려 /api/savings/summary가
   배포 직후 100% 500이 됐다. 단위 테스트가 하나라도 이 함수를 실제로 호출했다면
   즉시 잡혔을 것이다.

그래서 여기서는 "많은 행 + 페이지 경계"와 "폴백 경로"를 모두 실제로 태운다.
"""
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SECRET_KEY", "dummy-key-for-tests")

import savings  # noqa: E402


class FakeQuery:
    """supabase-py의 체이닝 쿼리 빌더 흉내. range/select만 실제로 본다."""

    def __init__(self, table_state):
        self.state = table_state
        self.columns = ""
        self.start = 0
        self.end = None

    def select(self, columns, **_kwargs):
        self.columns = columns
        return self

    def eq(self, *_args):
        return self

    def gte(self, *_args):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, _n):
        self.end = self.start + _n - 1
        return self

    def range(self, start, end):
        self.start, self.end = start, end
        return self

    def execute(self):
        self.state["selects"].append(self.columns)
        uses_json_path = "->" in self.columns

        if uses_json_path and self.state["reject_json_path"]:
            raise RuntimeError("PGRST100: unexpected character in select")

        rows = self.state["rows"]
        end = self.end if self.end is not None else len(rows) - 1
        page = rows[self.start : end + 1]
        shaped = [
            self.state["shape"](row, uses_json_path) for row in page
        ]
        return SimpleNamespace(data=shaped)


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return FakeQuery(self.tables[name])


def savings_shape(row, uses_json_path):
    if uses_json_path:
        # ->> 는 text를 준다. 숫자를 문자열로 돌려주는 것까지 흉내낸다.
        return {
            "power_saved_kwh": str(row["kwh"]),
            "cost_won": str(row["won"]),
        }
    return {
        "recommendation": {
            "savings": {"power_saved_kwh": row["kwh"], "cost_won": row["won"]}
        }
    }


class SavingsSummaryTests(unittest.TestCase):
    def setUp(self) -> None:
        savings._jsonb_path_select_supported = True
        self._original = savings.supabase

    def tearDown(self) -> None:
        savings.supabase = self._original
        savings._jsonb_path_select_supported = True

    def _install(self, rows, reject_json_path=False):
        state = {
            "rows": rows,
            "selects": [],
            "reject_json_path": reject_json_path,
            "shape": savings_shape,
        }
        savings.supabase = FakeSupabase({savings.READINGS_TABLE: state})
        return state

    def test_summary_runs_and_sums_positive_only(self) -> None:
        """이 테스트가 없어서 인자 누락(TypeError)이 배포까지 갔다."""
        state = self._install(
            [
                {"kwh": 1.5, "won": 300},
                {"kwh": -2.0, "won": -400},  # 소비(음수)는 합계에서 제외
                {"kwh": 0.5, "won": 100},
            ]
        )

        result = savings.get_savings_summary("u1", "all")

        self.assertEqual(result["power_saved_kwh"], 2.0)
        self.assertEqual(result["cost_won"], 400)
        self.assertIn("->", state["selects"][0], "트림된 select를 먼저 시도해야 한다")

    def test_summary_paginates_past_the_1000_row_cap(self) -> None:
        rows = [{"kwh": 0.001, "won": 1} for _ in range(2500)]
        state = self._install(rows)

        result = savings.get_savings_summary("u1", "all")

        # 전부 합산돼야 한다. 잘리면 1000건(=1.0kWh)에서 멈춘다.
        self.assertEqual(result["cost_won"], 2500)
        self.assertAlmostEqual(result["power_saved_kwh"], 2.5, places=3)
        self.assertEqual(len(state["selects"]), 3, "1000/1000/500 세 페이지")

    def test_summary_falls_back_when_json_path_select_rejected(self) -> None:
        state = self._install(
            [{"kwh": 2.0, "won": 500}], reject_json_path=True
        )

        result = savings.get_savings_summary("u1", "all")

        self.assertEqual(result["power_saved_kwh"], 2.0)
        self.assertEqual(result["cost_won"], 500)
        self.assertIn("->", state["selects"][0])
        self.assertNotIn(
            "->", state["selects"][1], "거부되면 전체 recommendation으로 폴백"
        )

    def test_summary_falls_back_when_alias_key_missing(self) -> None:
        """PostgREST가 예외 없이 다른 키 이름을 주는 경우도 폴백해야 한다.

        이게 없으면 합계가 조용히 0이 된다 — 예외보다 나쁜 실패다.
        """

        def wrong_key_shape(row, uses_json_path):
            if uses_json_path:
                return {"unexpected": str(row["kwh"])}
            return savings_shape(row, False)

        state = self._install([{"kwh": 3.0, "won": 700}])
        state["shape"] = wrong_key_shape

        result = savings.get_savings_summary("u1", "all")

        self.assertEqual(
            result["power_saved_kwh"], 3.0, "폴백해서 올바른 값을 내야 한다"
        )
        self.assertNotIn("->", state["selects"][-1])


class CumulativeKwhTests(unittest.TestCase):
    def setUp(self) -> None:
        savings._jsonb_path_select_supported = True
        savings._cumulative_kwh_cache._entries.clear()
        savings._rated_power_cache._entries.clear()
        self._original = savings.supabase

    def tearDown(self) -> None:
        savings.supabase = self._original
        savings._cumulative_kwh_cache._entries.clear()
        savings._rated_power_cache._entries.clear()

    def test_cached_after_first_call(self) -> None:
        """5초 주기 저장 경로에서 매번 이번 달 전체를 다시 훑지 않아야 한다."""
        calls = {"n": 0}

        def fake_compute(_user_id):
            calls["n"] += 1
            return 42.0

        original = savings._compute_cumulative_kwh
        savings._compute_cumulative_kwh = fake_compute
        try:
            self.assertEqual(savings.get_cumulative_kwh("u1"), 42.0)
            self.assertEqual(savings.get_cumulative_kwh("u1"), 42.0)
            self.assertEqual(savings.get_cumulative_kwh("u1"), 42.0)
        finally:
            savings._compute_cumulative_kwh = original

        self.assertEqual(calls["n"], 1, "TTL 안에서는 한 번만 계산해야 한다")

    def test_failure_does_not_propagate(self) -> None:
        """절감 추정치 조회 실패가 센서 reading 저장을 죽이면 안 된다."""

        def boom(_user_id):
            raise RuntimeError("supabase down")

        original = savings._compute_cumulative_kwh
        savings._compute_cumulative_kwh = boom
        try:
            self.assertEqual(savings.get_cumulative_kwh("u-new"), 0.0)
        finally:
            savings._compute_cumulative_kwh = original

    def test_no_self_deadlock_between_the_two_caches(self) -> None:
        """get_cumulative_kwh 계산 중 get_rated_power를 부르는 경로.

        두 캐시가 같은 비재진입 lock을 공유하면 여기서 영구히 멈춘다
        (배포 직후 첫 reading에서 확정적으로 재현되던 형태).
        """
        state = {
            "rows": [],
            "selects": [],
            "reject_json_path": False,
            "shape": lambda row, _p: row,
        }
        savings.supabase = FakeSupabase(
            {
                savings.READINGS_TABLE: state,
                savings.PLACES_TABLE: dict(state, rows=[{"id": 1}]),
                savings.USER_AIRCONS_TABLE: dict(
                    state, rows=[{"rated_cooling_power_w": 1800}]
                ),
            }
        )

        # rated_power 캐시를 비운 상태에서 호출 — 락을 공유했다면 여기서 멈춘다.
        self.assertEqual(savings.get_rated_power(1), 1800)
        self.assertEqual(savings.get_cumulative_kwh("u1"), 0.0)


if __name__ == "__main__":
    unittest.main()
