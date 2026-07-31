"""재실 시간대 패턴 학습·조회 모듈.

담당: 정현(나). `occupancy_logs`(재실 감지 원본 이력)로 장소별 요일유형
(평일/주말)×시간 재실 확률을 로지스틱 회귀로 학습해 `occupancy_models`에
저장하고, 추천 계산 시점엔 실측(라이브) 값이 항상 우선, 없거나 오래됐을
때만 학습된 패턴을 조회해 대신 돌려준다. 학습·추론 모두 순수 Python으로
직접 구현한 경사하강법이며 numpy/scikit-learn 등 외부 ML 의존성이 없다.
"""
import math
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from postgrest.exceptions import APIError

from auth_utils import execute_supabase_with_retry
from db import (
    OCCUPANCY_LOGS_TABLE,
    OCCUPANCY_MODELS_TABLE,
    OCCUPANCY_PREDICTIONS_TABLE,
    supabase,
)

# Postgres unique_violation. occupancy_predictions(place_id, transition_key)에
# UNIQUE 제약이 있어서, 같은 place를 여러 탭에서 동시에 폴링하다가 같은
# transition_key가 "처음" 생성되는 그 순간에 두 요청이 모두 "아직 없다"고
# 보고 INSERT를 시도하면 하나는 이 코드로 실패한다(get_prediction_state 참고).
_UNIQUE_VIOLATION_CODE = "23505"

KST = ZoneInfo("Asia/Seoul")

LIVE_FRESHNESS_MINUTES = 5
# 최근 몇 개의 감지가 모두 같은 값이어야 라이브 신호로 신뢰할지. 카메라가
# 수~수십 초 간격으로 새 프레임을 보내는데, 단발성 오탐 하나로 바로 신호가
# 뒤집히면 재실 여부에 반응하는 추천(TURN_OFF_AIRCON 등)이 매 프레임마다
# 같이 뒤집힌다 — 2026-07-30 실기기 연동 후 실제로 관찰됨.
# 2026-07-31: 확정까지 걸리는 시간(10초 간격 * N)을 줄이려고 1로 낮춤 —
# 즉 디바운스 사실상 비활성화. 단발 오탐에 다시 취약해진다는 뜻이니, 추천이
# 실측값에 즉시 반응하는 기능(예: background 자동제어)을 켤 때 이 트레이드오프를
# 다시 검토할 것.
LIVE_DEBOUNCE_SAMPLES = 1
EMPTY_THRESHOLD = 0.15
# "곧 재실 예상"으로 볼 확률 하한. EMPTY_THRESHOLD(0.15)와 비대칭인 이유는
# "없다"는 낮은 확률에서 바로 확신해도 되지만(에어컨 꺼도 그만), "온다"는
# 예열/예냉을 미리 실행하는 것이라 확신이 더 필요해서 기준을 보수적으로 높였다.
ARRIVAL_THRESHOLD = 0.5
# 예측 전환 시점 몇 분 전부터 팝업을 띄울지. resolve_occupancy_signal의
# 실측/패턴 판단 자체와는 무관한, 순수 UX 타이밍 값이다.
PREDICTION_LOOKAHEAD_MINUTES = 10
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

    최근 LIVE_DEBOUNCE_SAMPLES개의 감지가 모두 같은 값일 때만 라이브로
    신뢰한다. 표본이 부족하거나(콜드스타트) 값이 엇갈리면 아직 확신할 수
    없다고 보고 패턴 기반 판단으로 폴백한다.
    """
    recent_result = execute_supabase_with_retry(
        lambda: (
            supabase.table(OCCUPANCY_LOGS_TABLE)
            .select("person_detected, detected_at")
            .eq("place_id", place_id)
            .order("detected_at", desc=True)
            .limit(LIVE_DEBOUNCE_SAMPLES)
            .execute()
        )
    )

    if recent_result.data:
        latest = recent_result.data[0]
        detected_at = _to_kst(latest["detected_at"])
        age_minutes = (
            datetime.now(timezone.utc) - detected_at.astimezone(timezone.utc)
        ).total_seconds() / 60
        if age_minutes <= LIVE_FRESHNESS_MINUTES:
            recent_values = {bool(row["person_detected"]) for row in recent_result.data}
            if (
                len(recent_result.data) >= LIVE_DEBOUNCE_SAMPLES
                and len(recent_values) == 1
            ):
                return {"present": recent_values.pop(), "source": "LIVE"}

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


def _hour_probability(hour_weights: dict, hour: int) -> float:
    z = hour_weights.get(str(hour), 0.0) + hour_weights.get("intercept", 0.0)
    return _sigmoid(z)


def predict_upcoming_transition(
    place_id: int, lookahead_minutes: int = PREDICTION_LOOKAHEAD_MINUTES
) -> Optional[dict]:
    """학습된 시간대별 패턴으로 "곧(lookahead_minutes 이내) 재실 상태가 바뀔지"를 본다.

    resolve_occupancy_signal()이 "지금 재실 여부"만 답하는 것과 달리, 이 함수는
    다음 정시(예: 지금 7:52면 8:00)로 넘어가면서 확률이 낮음→높음(ARRIVAL) 또는
    높음→낮음(DEPARTURE)으로 넘어가는 시점을 미리 알려준다. 트리거 판단만 하고
    실제 켤지/끌지(에어컨이냐 창문이냐)는 여기서 정하지 않는다 — 그건 호출부가
    지금 실측 센서값으로 recommendation_engine.determine_action()을 그대로
    돌려서 정한다(occupancy_engine은 "언제"만 안다, "무엇을"은 모른다).

    lookahead_minutes 창 안에 있을 때만 값을 반환하고, 그 밖에는 매번 None —
    같은 전환에 대해 몇 시부터 팝업을 띄울지는 이 값 하나로 조절된다.
    """
    now_kst = datetime.now(KST)
    minutes_to_next_hour = 60 - now_kst.minute
    if minutes_to_next_hour > lookahead_minutes:
        return None

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
    current_hour = now_kst.hour
    next_hour = (current_hour + 1) % 24
    current_prob = _hour_probability(hour_weights, current_hour)
    next_prob = _hour_probability(hour_weights, next_hour)

    if current_prob <= EMPTY_THRESHOLD and next_prob >= ARRIVAL_THRESHOLD:
        direction = "ARRIVAL"
    elif current_prob >= ARRIVAL_THRESHOLD and next_prob <= EMPTY_THRESHOLD:
        direction = "DEPARTURE"
    else:
        return None

    transition_at_kst = (now_kst + timedelta(minutes=minutes_to_next_hour)).replace(
        minute=0, second=0, microsecond=0
    )

    # 라이브 신호가 이미 예측이 말하려는 미래 상태와 같으면(예: 이미 사람이
    # 와 있는데 "곧 올 거예요" 라고 하는 상황) 팝업을 띄우지 않는다 — 그 경우는
    # resolve_occupancy_signal()의 실측 기반 반응 로직이 이미 처리하고 있어서,
    # 예측 팝업까지 겹치면 같은 상황에 안내가 두 번 나가게 된다.
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
            live_present = bool(latest["person_detected"])
            predicted_present = direction == "ARRIVAL"
            if live_present == predicted_present:
                return None

    transition_key = (
        f"{transition_at_kst.date().isoformat()}_{transition_at_kst.hour:02d}_{direction}"
    )

    return {
        "direction": direction,
        "transition_key": transition_key,
        "transition_at": transition_at_kst.astimezone(timezone.utc),
        "eta_minutes": minutes_to_next_hour,
    }


_ACTIONABLE_PREDICTION_ACTIONS = ("USE_AIRCON", "OPEN_WINDOW", "TURN_OFF_AIRCON")


def get_prediction_state(place_id: int, compute_preview) -> Optional[dict]:
    """place의 현재 예측 팝업/오버라이드 상태를 조회, 없으면 새로 만든다.

    compute_preview(direction, eta_minutes) -> {"action","title","summary","reason"} 는
    호출부(occupancy_router)가 넘겨주는 콜백이다. 이 모듈은 "recommendation_engine
    으로 무엇을 판단해야 하는지"를 몰라도 되게 하기 위해 의도적으로 주입받는다
    (occupancy_engine이 readings_router/recommendation_engine을 직접 import하지
    않도록 하기 위함 — 순환 참조 방지).
    """
    now = datetime.now(timezone.utc)

    active_result = execute_supabase_with_retry(
        lambda: (
            supabase.table(OCCUPANCY_PREDICTIONS_TABLE)
            .select("*")
            .eq("place_id", place_id)
            .eq("status", "ACCEPTED")
            .order("transition_at", desc=True)
            .limit(1)
            .execute()
        )
    )
    if active_result.data:
        row = active_result.data[0]
        override_until = datetime.fromisoformat(
            str(row["override_until"]).replace("Z", "+00:00")
        )
        if override_until > now:
            remaining_minutes = max(0, int((override_until - now).total_seconds() / 60))
            return {
                "status": "OVERRIDE_ACTIVE",
                "direction": row["direction"],
                "remaining_minutes": remaining_minutes,
                "action": row["action"],
                "title": row["title"],
                "summary": row["summary"],
                "reason": row["reason"],
            }

    transition = predict_upcoming_transition(place_id)
    if transition is None:
        return None

    def build_pending_confirm(row: dict) -> Optional[dict]:
        """이미 조회해둔 occupancy_predictions 행을 PENDING_CONFIRM 응답으로
        변환한다(PENDING이 아니면 None). DB를 다시 조회하지 않는다 — 호출부가
        이미 갖고 있는 row를 그대로 넘긴다.
        """
        if row["status"] != "PENDING":
            return None
        return {
            "status": "PENDING_CONFIRM",
            "transition_key": row["transition_key"],
            "direction": row["direction"],
            "eta_minutes": transition["eta_minutes"],
            "action": row["action"],
            "title": row["title"],
            "summary": row["summary"],
            "reason": row["reason"],
        }

    existing_result = execute_supabase_with_retry(
        lambda: (
            supabase.table(OCCUPANCY_PREDICTIONS_TABLE)
            .select("*")
            .eq("place_id", place_id)
            .eq("transition_key", transition["transition_key"])
            .limit(1)
            .execute()
        )
    )
    if existing_result.data:
        return build_pending_confirm(existing_result.data[0])

    preview = compute_preview(transition["direction"], transition["eta_minutes"])
    row_status = "PENDING" if preview["action"] in _ACTIONABLE_PREDICTION_ACTIONS else "EXPIRED"

    try:
        execute_supabase_with_retry(
            lambda: (
                supabase.table(OCCUPANCY_PREDICTIONS_TABLE)
                .insert(
                    {
                        "place_id": place_id,
                        "transition_key": transition["transition_key"],
                        "direction": transition["direction"],
                        "transition_at": transition["transition_at"].isoformat(),
                        "action": preview["action"],
                        "title": preview["title"],
                        "summary": preview["summary"],
                        "reason": preview["reason"],
                        "status": row_status,
                    }
                )
                .execute()
            )
        )
    except APIError as error:
        if error.code != _UNIQUE_VIOLATION_CODE:
            raise
        # 같은 place를 다른 탭/요청이 거의 동시에 폴링해서 이 transition_key를
        # 먼저 만들었다 — 내가 진 것뿐이니 그 행을 다시 조회해서(이번엔 반드시
        # 존재함) 그대로 신뢰하고 반환한다(여기서 500을 내는 대신, 어차피 둘 다
        # 같은 preview로 계산했을 상황이라 결과는 동일하다).
        refetch_result = execute_supabase_with_retry(
            lambda: (
                supabase.table(OCCUPANCY_PREDICTIONS_TABLE)
                .select("*")
                .eq("place_id", place_id)
                .eq("transition_key", transition["transition_key"])
                .limit(1)
                .execute()
            )
        )
        return build_pending_confirm(refetch_result.data[0])

    if row_status == "EXPIRED":
        return None

    return {
        "status": "PENDING_CONFIRM",
        "transition_key": transition["transition_key"],
        "direction": transition["direction"],
        "eta_minutes": transition["eta_minutes"],
        "action": preview["action"],
        "title": preview["title"],
        "summary": preview["summary"],
        "reason": preview["reason"],
    }


def respond_to_prediction(place_id: int, transition_key: str, accept: bool) -> dict:
    """PENDING 상태의 예측 이벤트에 사용자 응답(수락/거절)을 기록한다.

    수락 시 override_until을 transition_at(예측된 전환 시각)으로 맞춘다 —
    그 시각이 지나면 실측(LIVE) 신호가 자연스럽게 넘겨받으므로 별도 타이머나
    스케줄러 없이 "10분만 유지"가 성립한다.
    """
    result = execute_supabase_with_retry(
        lambda: (
            supabase.table(OCCUPANCY_PREDICTIONS_TABLE)
            .select("*")
            .eq("place_id", place_id)
            .eq("transition_key", transition_key)
            .limit(1)
            .execute()
        )
    )
    if not result.data:
        raise ValueError("해당 예측 이벤트를 찾을 수 없습니다.")

    row = result.data[0]
    if row["status"] != "PENDING":
        raise ValueError("이미 응답한 예측 이벤트입니다.")

    now_iso = datetime.now(timezone.utc).isoformat()
    update_payload = {
        "status": "ACCEPTED" if accept else "DECLINED",
        "responded_at": now_iso,
    }
    if accept:
        update_payload["override_until"] = row["transition_at"]

    execute_supabase_with_retry(
        lambda: (
            supabase.table(OCCUPANCY_PREDICTIONS_TABLE)
            .update(update_payload)
            .eq("id", row["id"])
            .execute()
        )
    )

    return {"status": update_payload["status"], "action": row["action"]}
