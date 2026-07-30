"""게이트웨이 전용 기기 토큰 테스트.

배경: 게이트웨이가 사람의 세션 토큰을 빌려 쓰고 있어서, 브라우저에서
로그아웃하면(sessions에서 그 행이 삭제됨) 게이트웨이가 401로 죽었다.
2026-07-30에 실제로 여러 번 발생했고, 마지막 발생 때는 28분간 센서값이
한 건도 저장되지 않았다.

여기서 지키려는 것:
1. 기기 토큰은 사람 세션과 완전히 독립적이다(로그아웃과 무관).
2. 기기 토큰은 게이트웨이가 쓰는 경로에서만 통한다 — 계정 조작은 못 한다.
3. 폐기하면 즉시 막힌다.
4. 접두사가 없는 기존 세션 토큰은 그대로 동작한다(하위호환).
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

import device_auth  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class FakeTable:
    def __init__(self, rows, sink):
        self.rows = rows
        self.sink = sink
        self.filters = {}
        self.op = "select"
        self.payload = None
        self.columns = None

    def select(self, columns="*", *_a, **_k):
        # 실제 PostgREST는 요청한 컬럼만 돌려준다. 여기서 그걸 흉내내지 않으면
        # "목록에 비밀값이 안 들어간다"는 보장을 테스트할 수 없다.
        self.op = "select"
        self.columns = None if columns == "*" else [c.strip() for c in columns.split(",")]
        return self

    def _project(self, row):
        if self.columns is None:
            return dict(row)
        return {k: v for k, v in row.items() if k in self.columns}

    def insert(self, payload):
        self.op = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.op = "update"
        self.payload = payload
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, _n):
        return self

    def execute(self):
        if self.op == "insert":
            self.sink.append(self.payload)
            return SimpleNamespace(data=[self.payload])

        matched = [
            r
            for r in self.rows
            if all(r.get(k) == v for k, v in self.filters.items())
        ]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
            self.sink.append(("update", dict(self.filters), self.payload))
            return SimpleNamespace(data=matched)

        return SimpleNamespace(data=[self._project(r) for r in matched])


class FakeSupabase:
    def __init__(self, rows):
        self.rows = rows
        self.sink = []

    def table(self, _name):
        return FakeTable(self.rows, self.sink)


class DeviceTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self._original = device_auth.supabase
        device_auth._last_used_marks.clear()
        self.raw = device_auth.generate_device_token()
        self.rows = [
            {
                "id": 1,
                "user_id": 42,
                "place_id": 54,
                "label": "pi-gateway",
                "revoked_at": None,
                "token_hash": device_auth.token_hash(self.raw),
            }
        ]
        device_auth.supabase = FakeSupabase(self.rows)

    def tearDown(self) -> None:
        device_auth.supabase = self._original
        device_auth._last_used_marks.clear()

    def test_generated_token_is_recognisable_and_random(self) -> None:
        a = device_auth.generate_device_token()
        b = device_auth.generate_device_token()
        self.assertTrue(a.startswith(device_auth.DEVICE_TOKEN_PREFIX))
        self.assertTrue(device_auth.looks_like_device_token(a))
        self.assertNotEqual(a, b)
        self.assertGreater(len(a), 40)

    def test_resolves_to_owning_user(self) -> None:
        result = device_auth.resolve_device_token(self.raw)
        self.assertEqual(result["id"], 42)
        self.assertTrue(result["is_device"])
        self.assertEqual(result["device_place_id"], 54)

    def test_revoked_token_is_rejected(self) -> None:
        self.rows[0]["revoked_at"] = "2026-07-30T00:00:00Z"
        self.assertIsNone(device_auth.resolve_device_token(self.raw))

        with self.assertRaises(HTTPException) as caught:
            device_auth.authenticate_device_or_user(self.raw)
        self.assertEqual(caught.exception.status_code, 401)

    def test_unknown_device_token_is_rejected(self) -> None:
        other = device_auth.generate_device_token()
        with self.assertRaises(HTTPException) as caught:
            device_auth.authenticate_device_or_user(other)
        self.assertEqual(caught.exception.status_code, 401)

    def test_session_token_still_works(self) -> None:
        """하위호환: 접두사가 없으면 기존 사람 세션 경로로 간다."""
        calls = []

        def fake_get_current_user(authorization):
            calls.append(authorization)
            return {"id": 7, "username": "human"}

        original = device_auth.get_current_user
        device_auth.get_current_user = fake_get_current_user
        try:
            result = device_auth.authenticate_device_or_user("plain-session-token")
        finally:
            device_auth.get_current_user = original

        self.assertEqual(result["id"], 7)
        self.assertNotIn("is_device", result)
        self.assertEqual(calls, ["Bearer plain-session-token"])

    def test_session_lookup_is_skipped_for_device_tokens(self) -> None:
        """기기 토큰이면 sessions를 아예 조회하지 않아야 한다(불필요한 왕복 방지)."""
        called = []

        original = device_auth.get_current_user
        device_auth.get_current_user = lambda *a, **k: called.append(1)
        try:
            device_auth.authenticate_device_or_user(self.raw)
        finally:
            device_auth.get_current_user = original

        self.assertEqual(called, [], "기기 토큰인데 사람 세션 조회를 했다")

    def test_last_used_write_is_throttled(self) -> None:
        """5초 주기 스트리밍에서 매 요청마다 UPDATE가 나가면 안 된다."""
        for _ in range(5):
            device_auth.resolve_device_token(self.raw)

        updates = [e for e in device_auth.supabase.sink if e[0] == "update"]
        self.assertEqual(len(updates), 1, "last_used_at은 한 번만 갱신돼야 한다")

    def test_last_used_failure_does_not_break_auth(self) -> None:
        class Exploding(FakeSupabase):
            def table(self, _name):
                raise RuntimeError("db down")

        device_auth._last_used_marks.clear()
        good = device_auth.supabase

        # 조회는 성공하고 갱신만 실패하는 상황을 만든다.
        original_touch = device_auth._touch_last_used

        def touch_that_fails(hashed):
            device_auth.supabase = Exploding([])
            try:
                original_touch(hashed)
            finally:
                device_auth.supabase = good

        device_auth._touch_last_used = touch_that_fails
        try:
            result = device_auth.resolve_device_token(self.raw)
        finally:
            device_auth._touch_last_used = original_touch

        self.assertEqual(result["id"], 42, "갱신 실패가 인증을 막으면 안 된다")

    def test_revoke_is_scoped_to_owner(self) -> None:
        self.assertFalse(
            device_auth.revoke_device_token(user_id=999, token_id=1),
            "다른 사용자의 토큰을 폐기할 수 있으면 안 된다",
        )
        self.assertTrue(device_auth.revoke_device_token(user_id=42, token_id=1))

    def test_listing_never_exposes_secrets(self) -> None:
        rows = device_auth.list_device_tokens(42)
        self.assertTrue(rows)
        for row in rows:
            self.assertNotIn("token_hash", row)
            self.assertNotIn("token", row)


if __name__ == "__main__":
    unittest.main()
