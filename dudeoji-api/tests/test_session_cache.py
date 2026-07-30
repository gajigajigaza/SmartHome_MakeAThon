"""get_current_user()의 세션 캐시 정확성 테스트 (이슈 #38).

캐시는 성능을 위한 것이지만, 인증 경로라서 틀리면 곧 보안 문제다. 지켜야 할 것:

1. 두 번째 요청은 DB를 다시 안 본다(성능 목적 자체).
2. 로그아웃하면 즉시 안 통한다 — TTL이 남아 있어도.
3. 만료된 세션은 캐시로 통과하지 못한다(만료 판정이 캐시에 가려지면 안 됨).
4. 사용자 단위 무효화(탈퇴/비밀번호 재설정)가 그 사용자 항목만 지운다.
"""
import os
import sys
import unittest
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SECRET_KEY", "dummy-key-for-tests")

import auth_utils  # noqa: E402
from fastapi import HTTPException  # noqa: E402

RAW_TOKEN = "test-raw-session-token"
USER = {"id": 7, "username": "tester", "nickname": "테스터"}


class SessionCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        auth_utils._session_cache.clear()
        self.db_calls = 0
        self.expires_at = auth_utils.utc_now() + timedelta(days=30)
        self._original = auth_utils.execute_supabase_with_retry

        def fake_execute(operation, attempts: int = 3):
            """sessions 조회 → users 조회 순서로 호출된다고 보고 순서대로 응답한다."""
            self.db_calls += 1
            if self.db_calls % 2 == 1:
                return SimpleNamespace(
                    data=[
                        {
                            "id": 1,
                            "user_id": USER["id"],
                            "expires_at": self.expires_at.isoformat(),
                        }
                    ]
                )
            return SimpleNamespace(data=[dict(USER)])

        auth_utils.execute_supabase_with_retry = fake_execute

    def tearDown(self) -> None:
        auth_utils.execute_supabase_with_retry = self._original
        auth_utils._session_cache.clear()

    def _authenticate(self) -> dict:
        return auth_utils.get_current_user(f"Bearer {RAW_TOKEN}")

    def test_second_request_is_served_from_cache(self) -> None:
        self.assertEqual(self._authenticate(), USER)
        self.assertEqual(self.db_calls, 2, "첫 요청은 sessions+users 2회 조회")

        self.assertEqual(self._authenticate(), USER)
        self.assertEqual(self.db_calls, 2, "두 번째 요청은 DB를 다시 보지 않아야 한다")

    def test_logout_invalidates_immediately(self) -> None:
        self._authenticate()
        auth_utils.invalidate_session_cache_token(RAW_TOKEN)

        # 캐시가 비었으니 다시 DB를 봐야 한다. 실제 로그아웃에서는 sessions
        # 행이 이미 삭제돼 401이 되고, 여기서는 "DB를 다시 봤다"만 확인한다.
        self._authenticate()
        self.assertEqual(self.db_calls, 4, "로그아웃 후에는 캐시를 쓰지 않아야 한다")

    def test_user_level_invalidation_only_clears_that_user(self) -> None:
        self._authenticate()
        auth_utils._store_session_in_cache(
            auth_utils.token_hash("other-user-token"),
            self.expires_at,
            {"id": 99, "username": "other", "nickname": "다른사람"},
        )

        auth_utils.invalidate_session_cache_user(USER["id"])

        self.assertNotIn(auth_utils.token_hash(RAW_TOKEN), auth_utils._session_cache)
        self.assertIn(
            auth_utils.token_hash("other-user-token"),
            auth_utils._session_cache,
            "다른 사용자의 캐시는 남아 있어야 한다",
        )

    def test_expired_session_is_not_served_from_cache(self) -> None:
        # 아직 TTL 안에 있지만 세션 자체가 만료된 상태를 캐시에 심는다.
        auth_utils._store_session_in_cache(
            auth_utils.token_hash(RAW_TOKEN),
            auth_utils.utc_now() - timedelta(seconds=1),
            USER,
        )

        # 캐시를 그냥 통과시키면 만료 검사가 무력화된다. DB 경로로 내려가야 하고,
        # 그 경로가 만료를 보고 401을 던진다.
        self.expires_at = auth_utils.utc_now() - timedelta(seconds=1)
        with self.assertRaises(HTTPException) as caught:
            self._authenticate()
        self.assertEqual(caught.exception.status_code, 401)

    def test_ttl_expiry_falls_back_to_db(self) -> None:
        self._authenticate()
        original_ttl = auth_utils.SESSION_CACHE_TTL_SECONDS
        auth_utils.SESSION_CACHE_TTL_SECONDS = 0.0
        try:
            self._authenticate()
        finally:
            auth_utils.SESSION_CACHE_TTL_SECONDS = original_ttl
        self.assertEqual(self.db_calls, 4, "TTL이 지나면 DB를 다시 봐야 한다")


if __name__ == "__main__":
    unittest.main()
