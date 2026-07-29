-- 두더지 v38: 카메라 재실 감지 이력 저장용 전용 테이블.
--
-- readings.person_detected(008)는 PIR 센서용으로 예약해둔 컬럼이고, 온습도
-- 센서 팬아웃 파이프라인(물리 센서 1개 -> 사용자의 모든 장소, 매번 날씨
-- API 호출 + 추천 재계산)에 얹혀 있다. 카메라는 장소 1곳에만 설치되고
-- 10~30초 주기로 자주 기록되므로, 그 무거운 경로에 태우지 않고 완전히
-- 분리된 lightweight 테이블에 쌓는다.

CREATE TABLE IF NOT EXISTS public.occupancy_logs (
  id BIGSERIAL PRIMARY KEY,
  place_id BIGINT NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
  person_detected BOOLEAN NOT NULL,
  confidence REAL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS occupancy_logs_place_time_idx
  ON public.occupancy_logs (place_id, detected_at DESC);
