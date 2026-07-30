"""로그인 실패 횟수 기반 rate limit.

담당: 공용

jh 추가 - PBKDF2_ITERATIONS를 310,000에서 29,000으로 낮추면서 함께 넣었다
(auth_utils.py 주석 참고). 반복 횟수를 낮추면 오프라인 대입 비용이 싸지는데,
그 보완책은 "온라인으로 비밀번호를 마구 시도하는 것"을 막는 것이다. 기존에는
/login에 아무 제한이 없어서, 0.1 vCPU 서버에 로그인 요청을 쏟아붓는 것만으로도
비밀번호 추측과 서비스 마비를 동시에 노릴 수 있었다.

설계 원칙:

- **실패만 센다.** 성공한 로그인은 카운트하지 않고, 성공 시 해당 아이디의
  카운터를 지운다. 정상 사용자가 시연 중에 잠기는 일이 없어야 한다.
- **아이디와 IP를 따로 센다.** 아이디 기준은 한 계정을 노린 대입을, IP 기준은
  여러 계정을 훑는 스캔을 막는다.
- **슬라이딩 윈도우.** 고정 윈도우는 경계에서 두 배를 허용한다.

⚠️ 프로세스 메모리 기반이라 **워커 1개** 전제에서만 정확하다. 지금 배포는
`uvicorn main:app`(워커 1개)이다. 이 앱은 device_hub/reading_hub/세션 캐시도
같은 전제로 동작한다 — 워커를 늘릴 때 이 네 가지를 함께 옮겨야 한다.
"""
import os
import threading
import time
from collections import deque
from typing import Optional

# 사람이 비밀번호를 오타내는 횟수는 이 안에 충분히 들어가고, 대입 공격에는
# 전혀 부족한 수준으로 잡았다.
LOGIN_MAX_FAILURES_PER_USERNAME = int(
    os.getenv("LOGIN_MAX_FAILURES_PER_USERNAME", "10")
)
LOGIN_MAX_FAILURES_PER_IP = int(os.getenv("LOGIN_MAX_FAILURES_PER_IP", "30"))
LOGIN_FAILURE_WINDOW_SECONDS = float(
    os.getenv("LOGIN_FAILURE_WINDOW_SECONDS", "300")
)


class SlidingWindowLimiter:
    """키별 실패 시각을 deque로 들고 있는 아주 작은 슬라이딩 윈도우 카운터."""

    __slots__ = ("_max_events", "_window_seconds", "_events", "_lock")

    def __init__(self, max_events: int, window_seconds: float) -> None:
        self._max_events = max_events
        self._window_seconds = window_seconds
        self._events: dict[str, deque] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> Optional[deque]:
        bucket = self._events.get(key)
        if bucket is None:
            return None
        cutoff = now - self._window_seconds
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if not bucket:
            # 빈 항목을 남기면 키가 무한히 쌓인다.
            self._events.pop(key, None)
            return None
        return bucket

    def retry_after(self, key: str) -> Optional[int]:
        """한도를 넘었으면 몇 초 뒤에 다시 시도할 수 있는지, 아니면 None."""
        now = time.monotonic()
        with self._lock:
            bucket = self._prune(key, now)
            if bucket is None or len(bucket) < self._max_events:
                return None
            # 가장 오래된 실패가 윈도우에서 빠지면 다시 한 칸이 생긴다.
            return max(1, int(bucket[0] + self._window_seconds - now) + 1)

    def record_failure(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            bucket = self._events.get(key)
            if bucket is None:
                bucket = deque()
                self._events[key] = bucket
            bucket.append(now)
            self._prune(key, now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)


_username_limiter = SlidingWindowLimiter(
    LOGIN_MAX_FAILURES_PER_USERNAME, LOGIN_FAILURE_WINDOW_SECONDS
)
_ip_limiter = SlidingWindowLimiter(
    LOGIN_MAX_FAILURES_PER_IP, LOGIN_FAILURE_WINDOW_SECONDS
)


def client_ip_from_request(request) -> str:
    """Render는 프록시 뒤에 있어서 request.client.host는 항상 프록시 주소다.

    X-Forwarded-For의 첫 항목이 원래 클라이언트다. 헤더는 위조될 수 있으므로
    이 값만으로 보안 결정을 하지는 않는다 — 아이디 기준 제한이 함께 걸린다.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return getattr(getattr(request, "client", None), "host", "") or "unknown"


def check_login_allowed(username: str, client_ip: str) -> Optional[int]:
    """차단 상태면 재시도까지 남은 초, 통과면 None."""
    return _username_limiter.retry_after(username) or _ip_limiter.retry_after(
        client_ip
    )


def record_login_failure(username: str, client_ip: str) -> None:
    _username_limiter.record_failure(username)
    _ip_limiter.record_failure(client_ip)


def record_login_success(username: str, client_ip: str) -> None:
    """성공하면 그 아이디의 실패 이력을 지운다.

    IP 쪽은 일부러 남긴다 — 한 IP에서 여러 계정을 훑는 중에 하나만 맞혔다고
    해서 나머지 스캔 이력을 지워줄 이유가 없다.
    """
    _username_limiter.reset(username)


def reset_all_for_tests() -> None:
    _username_limiter._events.clear()
    _ip_limiter._events.clear()
