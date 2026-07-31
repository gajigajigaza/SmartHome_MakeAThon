"""BLE로 재조립된 JPEG 프레임에서 YOLO26n으로 사람 재실을 감지합니다.

모델은 첫 detect() 호출 시 지연 로드합니다 — Sense 보드가 연결되지 않아
카메라 프레임이 전혀 오지 않는 실행(Control-only 등)에서는 다운로드/로드
비용을 피합니다.
"""

from __future__ import annotations

import io
import logging
import os
from typing import Any

LOGGER = logging.getLogger("dudeoji-gateway.occupancy")

PERSON_CLASS_NAME = "person"
# .pt(torch) 대신 ONNX를 기본값으로 씀 — Raspberry Pi 4(Cortex-A72)에서
# 최신 torch CPU 빌드의 conv 커널이 illegal instruction(SIGILL)으로
# 죽는 걸 실기기에서 확인함(ARMv8.2 dot-product 명령 의존으로 추정).
# onnxruntime은 같은 보드에서 문제없이 동작해서 이걸로 우회한다.
DEFAULT_MODEL_NAME = "yolo26n.onnx"

_model: Any | None = None


def _min_confidence() -> float:
    raw = os.getenv("DUDEOJI_OCCUPANCY_MIN_CONFIDENCE", "0.6")
    try:
        value = float(raw)
    except ValueError as error:
        raise RuntimeError(
            "DUDEOJI_OCCUPANCY_MIN_CONFIDENCE는 숫자여야 합니다."
        ) from error
    if not 0 <= value <= 1:
        raise RuntimeError(
            "DUDEOJI_OCCUPANCY_MIN_CONFIDENCE는 0~1 범위여야 합니다."
        )
    return value


def _get_model() -> Any:
    global _model
    if _model is None:
        from ultralytics import YOLO

        model_name = os.getenv("DUDEOJI_OCCUPANCY_MODEL", DEFAULT_MODEL_NAME)
        LOGGER.info("YOLO 모델 로드 중: %s", model_name)
        _model = YOLO(model_name)
        LOGGER.info("YOLO 모델 로드 완료: %s", model_name)
    return _model


def detect(jpeg_bytes: bytes) -> tuple[bool, float | None]:
    """JPEG 프레임에서 사람을 감지합니다.

    이 함수는 CPU를 오래 점유하므로(추론) 호출자가 asyncio 이벤트 루프를
    막지 않도록 스레드 실행기(run_in_executor)로 감싸서 호출해야 합니다.

    Returns:
        (person_detected, confidence). person 클래스가 전혀 검출되지
        않으면 confidence는 None입니다. 검출된 최고 confidence가 임계값
        (DUDEOJI_OCCUPANCY_MIN_CONFIDENCE, 기본 0.6) 이상일 때만
        person_detected=True.
    """

    from PIL import Image

    model = _get_model()
    image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    results = model.predict(source=image, verbose=False)

    best_confidence: float | None = None
    for result in results:
        boxes = result.boxes
        if boxes is None:
            continue
        for box in boxes:
            class_id = int(box.cls[0])
            if result.names.get(class_id) != PERSON_CLASS_NAME:
                continue
            confidence = float(box.conf[0])
            if best_confidence is None or confidence > best_confidence:
                best_confidence = confidence

    if best_confidence is None:
        return False, None

    return best_confidence >= _min_confidence(), best_confidence
