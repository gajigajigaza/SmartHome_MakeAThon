"""재실 시간대 패턴 학습·조회 모듈.

담당: 정현(나). `occupancy_logs`(재실 감지 원본 이력)로 장소별 요일유형
(평일/주말)×시간 재실 확률을 로지스틱 회귀로 학습해 `occupancy_models`에
저장하고, 추천 계산 시점엔 실측(라이브) 값이 항상 우선, 없거나 오래됐을
때만 학습된 패턴을 조회해 대신 돌려준다. 학습·추론 모두 순수 Python으로
직접 구현한 경사하강법이며 numpy/scikit-learn 등 외부 ML 의존성이 없다.
"""
import math
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from auth_utils import execute_supabase_with_retry
from db import OCCUPANCY_LOGS_TABLE, OCCUPANCY_MODELS_TABLE, supabase

KST = ZoneInfo("Asia/Seoul")

LIVE_FRESHNESS_MINUTES = 5
EMPTY_THRESHOLD = 0.15
MIN_SAMPLES_PER_DAY_TYPE = 20
MIN_HISTORY_DAYS = 14

LEARNING_RATE = 0.5
EPOCHS = 3000
L2_LAMBDA = 0.001
HOURS_IN_DAY = 24


def _sigmoid(z: float) -> float:
    if z < -35:
        return 0.0
    if z > 35:
        return 1.0
    return 1.0 / (1.0 + math.exp(-z))


def _train_logistic_regression_from_hour_counts(
    hour_counts: list[tuple[int, int]],
    *,
    learning_rate: float = LEARNING_RATE,
    epochs: int = EPOCHS,
    l2_lambda: float = L2_LAMBDA,
) -> tuple[list[float], float]:
    """전체배치 경사하강법으로 로지스틱 회귀를 학습한다(외부 ML 의존성 없음).

    hour_counts[h] = (그 시간 전체 샘플 수, 그중 재실=True 샘플 수).

    입력 특징이 시간의 24차원 원-핫 벡터라, 같은 시간의 샘플들은 매 학습
    스텝에서 항상 동일한 예측값·오차를 갖는다 — 그래서 샘플 하나하나를
    반복하지 않고 시간별 (개수, 양성 개수)만 미리 집계해서 그 위에서
    경사하강법을 돌려도 결과가 완전히 동일하며(근사가 아님), 장소당
    수천 개 로그가 있어도 매 epoch 24번 계산으로 끝나 훨씬 빠르다.

    L2 정규화 덕분에 샘플이 적거나 라벨이 한쪽으로 쏠린 시간도 가중치가
    발산하지 않고 0 쪽으로 수축되어 안정적으로 수렴한다 — 빈도표 방식의
    "셀당 최소 샘플수" 하드 컷오프 없이도 콜드스타트를 부드럽게 처리한다.
    """
    total_samples = sum(count for count, _ in hour_counts)
    weights = [0.0] * HOURS_IN_DAY
    bias = 0.0

    for _ in range(epochs):
        gradient_b = 0.0
        next_weights = list(weights)

        for hour, (count, positive_count) in enumerate(hour_counts):
            if count == 0:
                continue
            prediction = _sigmoid(bias + weights[hour])
            positive_rate = positive_count / count
            hour_gradient = count * (prediction - positive_rate)

            next_weights[hour] = weights[hour] - learning_rate * (
                hour_gradient / total_samples + l2_lambda * weights[hour]
            )
            gradient_b += hour_gradient

        weights = next_weights
        bias -= learning_rate * (gradient_b / total_samples)

    return weights, bias


def compute_day_type_model(logs: list[dict]) -> Optional[dict]:
    """순수 함수 — DB 접근 없음, 유닛 테스트 대상.

    logs: [{"hour": int, "person_detected": bool}], 이미 하나의 day_type
    (평일 또는 주말)로 필터링된 리스트. 시간을 24차원 원-핫으로 인코딩해서
    학습한다 — sin/cos 같은 단일 주기 인코딩과 달리, 하루 안에 재실 구간이
    두 번 나뉘는 패턴(예: 점심시간을 사이에 둔 오전/오후 근무)도 각 시간의
    독립적인 가중치로 정확히 표현할 수 있다.
    """
    if len(logs) < MIN_SAMPLES_PER_DAY_TYPE:
        return None

    hour_counts = [(0, 0) for _ in range(HOURS_IN_DAY)]
    for log in logs:
        count, positive_count = hour_counts[log["hour"]]
        hour_counts[log["hour"]] = (
            count + 1,
            positive_count + (1 if log["person_detected"] else 0),
        )

    weights, bias = _train_logistic_regression_from_hour_counts(hour_counts)

    hour_weights = {str(hour): weights[hour] for hour in range(HOURS_IN_DAY)}
    hour_weights["intercept"] = bias

    return {"hour_weights": hour_weights, "sample_count": len(logs)}


def _day_type_for(moment_kst: datetime) -> str:
    # Python weekday(): 월=0 ... 일=6. 토(5)/일(6)이 주말.
    return "weekend" if moment_kst.weekday() >= 5 else "weekday"


def _to_kst(raw_timestamp: str) -> datetime:
    detected_at = datetime.fromisoformat(str(raw_timestamp).replace("Z", "+00:00"))
    if detected_at.tzinfo is None:
        detected_at = detected_at.replace(tzinfo=timezone.utc)
    return detected_at.astimezone(KST)


_FETCH_PAGE_SIZE = 1000


def _fetch_all_occupancy_logs(place_id: int) -> list[dict]:
    """occupancy_logs를 페이지네이션으로 전부 가져온다.

    PostgREST(Supabase)는 .select()에 명시적 range를 안 주면 기본 최대
    행 수(보통 1000)에서 응답을 조용히 잘라낸다 — 명시하지 않으면 이력이
    많은 장소는 최근 몇 주 중 일부만 보고 학습하게 되는 심각한 버그가
    생긴다. 그래서 빈 페이지가 나올 때까지 range를 밀어가며 반복 조회한다.
    """
    all_logs: list[dict] = []
    start = 0

    while True:
        end = start + _FETCH_PAGE_SIZE - 1
        result = execute_supabase_with_retry(
            lambda start=start, end=end: (
                supabase.table(OCCUPANCY_LOGS_TABLE)
                .select("person_detected, detected_at")
                .eq("place_id", place_id)
                .range(start, end)
                .execute()
            )
        )
        page = result.data or []
        all_logs.extend(page)

        if len(page) < _FETCH_PAGE_SIZE:
            break
        start += _FETCH_PAGE_SIZE

    return all_logs


def train_occupancy_pattern(place_id: int) -> dict:
    """occupancy_logs 전체를 조회해 평일/주말 모델을 각각 학습하고
    occupancy_models에 저장한다(재학습은 delete-then-reinsert로 멱등).

    타임존 주의: 반드시 KST로 변환한 뒤 요일/시간을 뽑는다 — UTC 그대로
    쓰면 "평일 9~12시" 같은 시나리오가 실제로는 몇 시간 밀려서 학습된다.
    """
    logs = _fetch_all_occupancy_logs(place_id)

    if not logs:
        return {"place_id": place_id, "day_types_trained": [], "total_logs": 0}

    parsed = [
        (_to_kst(log["detected_at"]), bool(log["person_detected"])) for log in logs
    ]

    oldest = min(moment for moment, _ in parsed)
    newest = max(moment for moment, _ in parsed)
    if (newest - oldest).days < MIN_HISTORY_DAYS:
        return {
            "place_id": place_id,
            "day_types_trained": [],
            "total_logs": len(logs),
        }

    by_day_type: dict[str, list[dict]] = {"weekday": [], "weekend": []}
    for moment, person_detected in parsed:
        by_day_type[_day_type_for(moment)].append(
            {"hour": moment.hour, "person_detected": person_detected}
        )

    trained: dict[str, dict] = {}
    for day_type, day_logs in by_day_type.items():
        model = compute_day_type_model(day_logs)
        if model is not None:
            trained[day_type] = model

    execute_supabase_with_retry(
        lambda: (
            supabase.table(OCCUPANCY_MODELS_TABLE)
            .delete()
            .eq("place_id", place_id)
            .execute()
        )
    )

    if trained:
        rows = [
            {
                "place_id": place_id,
                "day_type": day_type,
                "hour_weights": model["hour_weights"],
                "sample_count": model["sample_count"],
            }
            for day_type, model in trained.items()
        ]
        execute_supabase_with_retry(
            lambda: supabase.table(OCCUPANCY_MODELS_TABLE).insert(rows).execute()
        )

    return {
        "place_id": place_id,
        "day_types_trained": list(trained.keys()),
        "total_logs": len(logs),
    }


def resolve_occupancy_signal(place_id: int) -> Optional[dict]:
    """실측(라이브) 값이 있으면 그걸, 없으면 학습된 패턴을 반환한다.

    라이브 값이 있으면 occupancy_models는 아예 조회하지 않는다 — "실측이
    학습된 패턴보다 항상 우선한다"는 규칙이 실제로 구현되는 지점.
    """
    latest_result = execute_supabase_with_retry(
        lambda: (
            supabase.table(OCCUPANCY_LOGS_TABLE)
            .select("person_detected, detected_at")
            .eq("place_id", place_id)
            .order("detected_at", desc=True)
            .limit(1)
            .execute()
        )
    )

    if latest_result.data:
        latest = latest_result.data[0]
        detected_at = _to_kst(latest["detected_at"])
        age_minutes = (
            datetime.now(timezone.utc) - detected_at.astimezone(timezone.utc)
        ).total_seconds() / 60
        if age_minutes <= LIVE_FRESHNESS_MINUTES:
            return {"present": bool(latest["person_detected"]), "source": "LIVE"}

    now_kst = datetime.now(KST)
    day_type = _day_type_for(now_kst)

    model_result = execute_supabase_with_retry(
        lambda: (
            supabase.table(OCCUPANCY_MODELS_TABLE)
            .select("hour_weights")
            .eq("place_id", place_id)
            .eq("day_type", day_type)
            .limit(1)
            .execute()
        )
    )

    if not model_result.data:
        return None

    hour_weights = model_result.data[0]["hour_weights"]
    z = hour_weights.get(str(now_kst.hour), 0.0) + hour_weights.get("intercept", 0.0)
    occupancy_probability = _sigmoid(z)

    if occupancy_probability <= EMPTY_THRESHOLD:
        return {"present": False, "source": "PATTERN"}

    return None
