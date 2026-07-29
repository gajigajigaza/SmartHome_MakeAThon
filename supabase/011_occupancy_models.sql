-- 두더지 v39: occupancy_logs 이력으로 학습한 장소별 재실 패턴 모델(로지스틱
-- 회귀 가중치) 저장. place당 최대 2행(평일/주말). 추천 계산(매 센서 기록마다
-- 발생)은 이 표에서 1행만 읽어 시그모이드 계산 한 번이면 되고, 원본 로그를
-- 매번 스캔하지 않는다. 배치(수동/dev 트리거) 학습 작업만 이 테이블을 쓴다.

CREATE TABLE IF NOT EXISTS public.occupancy_models (
  place_id BIGINT NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
  day_type TEXT NOT NULL CHECK (day_type IN ('weekday', 'weekend')),
  hour_weights JSONB NOT NULL,
  sample_count INTEGER NOT NULL,
  trained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (place_id, day_type)
);

-- readings/places와 동일한 패턴: RLS는 켜두고 정책은 만들지 않는다 ->
-- anon/authenticated 키로는 전부 막히고, 백엔드가 쓰는 service role
-- (RLS를 우회함)만 접근 가능하다.
ALTER TABLE public.occupancy_models ENABLE ROW LEVEL SECURITY;
