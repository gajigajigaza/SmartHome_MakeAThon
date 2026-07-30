"""로그인 rate limit 테스트.

PBKDF2 반복 횟수를 310,000 → 29,000으로 낮춘 것에 대한 보완책이라
(auth_utils.py 주석 참고) 실제로 막히는지, 그리고 **정상 사용자를 막지 않는지**
양쪽을 확인한다. 시연 중에 팀원이 잠기는 게 제일 나쁜 실패다.
"""
import os
import sys
import unittest
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SECRET_KEY", "dummy-key-for-tests")

import rate_limit  # noqa: E402


class FakeRequest:
    def __init__(self, headers=None, host="203.0.113.9"):
        self.headers = headers or {}
        self.client = type("C", (), {"host": host})()


class LoginRateLimitTests(unittest.TestCase):
    def setUp(self) -> None:
        rate_limit.reset_all_for_tests()

    def test_allows_normal_use(self) -> None:
        self.assertIsNone(rate_limit.check_login_allowed("alice", "1.2.3.4"))

    def test_blocks_after_username_failure_limit(self) -> None:
        limit = rate_limit.LOGIN_MAX_FAILURES_PER_USERNAME
        for _ in range(limit - 1):
            rate_limit.record_login_failure("alice", "1.2.3.4")
        self.assertIsNone(
            rate_limit.check_login_allowed("alice", "1.2.3.4"),
            "한도 직전까지는 통과해야 한다",
        )

        rate_limit.record_login_failure("alice", "1.2.3.4")
        retry_after = rate_limit.check_login_allowed("alice", "1.2.3.4")
        self.assertIsNotNone(retry_after, "한도에 도달하면 막혀야 한다")
        self.assertGreater(retry_after, 0)

    def test_other_username_unaffected(self) -> None:
        for _ in range(rate_limit.LOGIN_MAX_FAILURES_PER_USERNAME):
            rate_limit.record_login_failure("alice", "1.2.3.4")
        # bob은 같은 IP지만 아이디 한도와는 무관하다. IP 한도(30)에는 아직
        # 여유가 있으므로 통과해야 한다.
        self.assertIsNone(rate_limit.check_login_allowed("bob", "1.2.3.4"))

    def test_success_clears_username_failures(self) -> None:
        for _ in range(rate_limit.LOGIN_MAX_FAILURES_PER_USERNAME):
            rate_limit.record_login_failure("alice", "1.2.3.4")
        self.assertIsNotNone(rate_limit.check_login_allowed("alice", "1.2.3.4"))

        rate_limit.record_login_success("alice", "1.2.3.4")
        self.assertIsNone(
            rate_limit.check_login_allowed("alice", "1.2.3.4"),
            "로그인에 성공하면 그 아이디의 실패 이력은 지워져야 한다",
        )

    def test_ip_limit_catches_account_scan(self) -> None:
        # 아이디를 계속 바꿔가며 훑는 경우 — 아이디 한도로는 절대 안 걸린다.
        for index in range(rate_limit.LOGIN_MAX_FAILURES_PER_IP):
            rate_limit.record_login_failure(f"victim{index}", "9.9.9.9")
        self.assertIsNotNone(
            rate_limit.check_login_allowed("victim-new", "9.9.9.9"),
            "IP 기준 한도가 계정 스캔을 막아야 한다",
        )

    def test_client_ip_prefers_forwarded_header(self) -> None:
        request = FakeRequest(
            headers={"x-forwarded-for": "198.51.100.7, 10.0.0.1"},
            host="10.0.0.1",
        )
        self.assertEqual(rate_limit.client_ip_from_request(request), "198.51.100.7")

    def test_client_ip_falls_back_to_socket_peer(self) -> None:
        self.assertEqual(
            rate_limit.client_ip_from_request(FakeRequest(host="203.0.113.9")),
            "203.0.113.9",
        )

    def test_window_expiry_releases_the_block(self) -> None:
        limiter = rate_limit.SlidingWindowLimiter(max_events=2, window_seconds=0.05)
        limiter.record_failure("k")
        limiter.record_failure("k")
        self.assertIsNotNone(limiter.retry_after("k"))

        import time

        time.sleep(0.06)
        self.assertIsNone(
            limiter.retry_after("k"), "윈도우가 지나면 다시 시도할 수 있어야 한다"
        )


if __name__ == "__main__":
    unittest.main()
