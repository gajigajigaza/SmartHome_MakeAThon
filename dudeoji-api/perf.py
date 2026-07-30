"""이벤트 루프 블로킹 계측 + 동기 호출 오프로딩 유틸.

담당: 공용

이슈 #38("게이트웨이가 5초 주기로 센서값을 보내는 동안 /health조차 응답
불가")의 실제 원인은 팬아웃이나 날씨 API가 아니라, `async def` 핸들러 안에서
**동기** supabase-py 클라이언트를 그대로 호출한 것이었다. supabase-py는
내부적으로 httpx 동기 클라이언트를 쓰기 때문에, 그 호출이 진행되는 동안
asyncio 이벤트 루프 스레드 자체가 소켓 read에 붙잡혀 있다 — 그 사이에는
다른 요청을 받아들이지도, 스레드풀로 넘기지도 못한다. 그래서 sync def로
선언돼 스레드풀에서 도는 /health까지 같이 멈췄던 것(=curl이 TLS 핸드셰이크는
성공하는데 0 bytes를 받는 증상).

이 모듈이 제공하는 것:

1. `run_blocking()` — 동기 DB/네트워크 호출을 워커 스레드로 넘겨 루프를 비운다.
2. `timed_blocking()` — 위와 같은데 소요시간을 `SegmentTimings`에 기록한다.
3. `SegmentTimings` — reading 1건 처리에 들어간 구간별 소요시간을 모아 한 줄로 남긴다.
4. `start_loop_lag_monitor()` — "루프가 실제로 몇 ms 막혔는지"를 직접 재는 샘플러.

(3)과 (4)가 이 이슈의 재발 감지용 핵심 지표다. 특히 (4)는 원인 추정 없이
"막힘" 자체를 측정하기 때문에, 앞으로 누가 어떤 경로에 동기 호출을 다시
집어넣어도 로그만 보고 바로 잡을 수 있다.

stdlib만 쓰고, 켜둔 채로 운영해도 부담이 없을 정도로 가볍게 유지한다.
"""
import asyncio
import os
import time
from typing import Any, Callable, Optional, TypeVar

T = TypeVar("T")


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, ""))
    except ValueError:
        return default


# reading 1건당 한 줄이라 5초 주기에서 로그량이 문제되지 않는다. 그래도 끄고
# 싶을 때가 있어서(예: 부하 테스트로 주기를 확 줄일 때) 환경변수로 뺐다.
SEGMENT_LOG_ENABLED = _env_flag("PERF_SEGMENT_LOG", True)

# 루프 지연 임계값. 100ms 주기로 sleep을 걸어보고 예상보다 이만큼 더 늦게
# 깨어나면 그 시간만큼 루프가 막혀 있었다는 뜻이다. 250ms는 "사람이 체감하기
# 시작하는 지점"이라 기본값으로 잡았다.
LOOP_LAG_THRESHOLD_MS = _env_float("PERF_LOOP_LAG_THRESHOLD_MS", 250.0)
LOOP_LAG_SAMPLE_INTERVAL_SECONDS = 0.1
LOOP_LAG_WINDOW_SECONDS = _env_float("PERF_LOOP_LAG_WINDOW_SECONDS", 10.0)


class SegmentTimings:
    """reading 1건을 처리하며 지나간 구간별 소요시간(ms)을 모은다.

    같은 이름이 여러 번 기록되면(팬아웃으로 장소마다 같은 구간을 반복 실행)
    합계와 호출 횟수를 함께 누적한다 — 장소 수에 비례해 늘어나는 비용을
    한눈에 보기 위함이다.
    """

    __slots__ = ("_total_ms", "_counts", "_started_monotonic", "label")

    def __init__(self, label: str = "reading") -> None:
        self.label = label
        self._total_ms: dict[str, float] = {}
        self._counts: dict[str, int] = {}
        self._started_monotonic = time.perf_counter()

    def record(self, name: str, elapsed_ms: float) -> None:
        self._total_ms[name] = self._total_ms.get(name, 0.0) + elapsed_ms
        self._counts[name] = self._counts.get(name, 0) + 1

    @property
    def elapsed_ms(self) -> float:
        return (time.perf_counter() - self._started_monotonic) * 1000

    def as_log_line(self, **context: Any) -> str:
        # 느린 구간이 위로 오게 정렬해서, 로그 한 줄만 봐도 범인이 보이게 한다.
        parts = []
        for name, total in sorted(
            self._total_ms.items(), key=lambda item: item[1], reverse=True
        ):
            count = self._counts[name]
            suffix = f"x{count}" if count > 1 else ""
            parts.append(f"{name}={total:.0f}ms{suffix}")

        context_text = " ".join(f"{key}={value}" for key, value in context.items())
        return (
            f"[perf] {self.label} total={self.elapsed_ms:.0f}ms "
            f"{context_text} | " + " ".join(parts)
        )

    def log(self, **context: Any) -> None:
        if SEGMENT_LOG_ENABLED:
            print(self.as_log_line(**context))


async def run_blocking(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """동기(블로킹) 호출을 워커 스레드에서 실행해 이벤트 루프를 비운다.

    `asyncio.to_thread`는 기본 ThreadPoolExecutor를 쓴다 — FastAPI가 `def`
    엔드포인트를 돌리는 anyio 스레드풀(기본 정원 40)과는 별도 풀이라, 여기서
    DB 호출을 아무리 많이 넘겨도 `def` 엔드포인트(/health 등)가 쓸 스레드를
    빼앗지 않는다.

    주의: 이제 supabase 클라이언트가 여러 스레드에서 동시에 호출된다.
    httpx.Client는 스레드 세이프하지만, 이 경로에서 건드리는 **모듈 레벨
    캐시**는 더 이상 "이벤트 루프 단일 스레드라서 안전"하지 않다. 새로
    캐시를 추가할 때는 lock을 같이 붙여야 한다(savings.py의 `_CACHE_LOCK` 참고).
    """
    if kwargs:
        return await asyncio.to_thread(lambda: fn(*args, **kwargs))
    return await asyncio.to_thread(fn, *args)


async def timed_blocking(
    timings: Optional[SegmentTimings],
    name: str,
    fn: Callable[..., T],
    *args: Any,
    **kwargs: Any,
) -> T:
    """`run_blocking`과 같지만 소요시간을 구간 이름으로 기록한다."""
    if timings is None:
        return await run_blocking(fn, *args, **kwargs)

    started = time.perf_counter()
    try:
        return await run_blocking(fn, *args, **kwargs)
    finally:
        timings.record(name, (time.perf_counter() - started) * 1000)


class timed:
    """이미 async인 구간(날씨 API, 브로드캐스트 등)의 소요시간을 재는 컨텍스트 매니저.

    사용법:
        async with timed(timings, "weather"):
            ...
    """

    __slots__ = ("_timings", "_name", "_started")

    def __init__(self, timings: Optional[SegmentTimings], name: str) -> None:
        self._timings = timings
        self._name = name
        self._started = 0.0

    async def __aenter__(self) -> "timed":
        self._started = time.perf_counter()
        return self

    async def __aexit__(self, *_exc_info: Any) -> bool:
        if self._timings is not None:
            self._timings.record(
                self._name, (time.perf_counter() - self._started) * 1000
            )
        return False


async def _loop_lag_sampler() -> None:
    """루프가 실제로 막힌 시간을 직접 측정한다.

    `asyncio.sleep(0.1)`을 걸고 실제로 몇 ms 뒤에 깨어났는지 본다. 루프가
    비어 있으면 오차가 수 ms지만, 누군가 동기 호출로 루프를 붙잡고 있으면
    그 시간만큼 그대로 늦게 깨어난다 — 즉 지연값이 곧 "블로킹된 시간"이다.
    윈도우(기본 10초)마다 최대값만 남겨서 로그가 넘치지 않게 한다.
    """
    loop = asyncio.get_running_loop()
    window_started = loop.time()
    window_max_lag_ms = 0.0
    window_blocked_ms = 0.0

    while True:
        before = loop.time()
        await asyncio.sleep(LOOP_LAG_SAMPLE_INTERVAL_SECONDS)
        lag_ms = (
            loop.time() - before - LOOP_LAG_SAMPLE_INTERVAL_SECONDS
        ) * 1000

        if lag_ms > 0:
            window_max_lag_ms = max(window_max_lag_ms, lag_ms)
            if lag_ms >= LOOP_LAG_THRESHOLD_MS:
                window_blocked_ms += lag_ms

        if loop.time() - window_started >= LOOP_LAG_WINDOW_SECONDS:
            if window_max_lag_ms >= LOOP_LAG_THRESHOLD_MS:
                window_seconds = loop.time() - window_started
                blocked_ratio = window_blocked_ms / (window_seconds * 1000)
                print(
                    f"[perf] event-loop 지연 감지 — 최근 {window_seconds:.0f}초 중 "
                    f"최대 {window_max_lag_ms:.0f}ms 막힘 "
                    f"(임계 {LOOP_LAG_THRESHOLD_MS:.0f}ms 초과 누적 "
                    f"{window_blocked_ms:.0f}ms, 약 {blocked_ratio * 100:.0f}%). "
                    "async 경로에 동기 호출이 들어갔는지 확인하세요."
                )
            window_started = loop.time()
            window_max_lag_ms = 0.0
            window_blocked_ms = 0.0


_lag_monitor_task: Optional[asyncio.Task] = None


def start_loop_lag_monitor() -> None:
    """앱 startup에서 한 번 호출한다. 이미 돌고 있으면 아무 것도 하지 않는다."""
    global _lag_monitor_task

    if not _env_flag("PERF_LOOP_LAG_MONITOR", True):
        print("[perf] PERF_LOOP_LAG_MONITOR=false 라서 루프 지연 감시를 끕니다.")
        return

    if _lag_monitor_task is not None and not _lag_monitor_task.done():
        return

    _lag_monitor_task = asyncio.create_task(_loop_lag_sampler())
    print(
        f"[perf] event-loop 지연 감시 시작 "
        f"(임계 {LOOP_LAG_THRESHOLD_MS:.0f}ms, "
        f"윈도우 {LOOP_LAG_WINDOW_SECONDS:.0f}초)"
    )
