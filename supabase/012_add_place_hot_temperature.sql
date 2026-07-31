-- 장소별로 "덥다"고 판단하는 실내 온도 기준을 사용자가 직접 설정할 수 있게 함.
-- recommendation_engine.py의 LOGIC_THRESHOLDS["indoor_hot"](기본 26.0)를
-- 대체하는 값이며, 설정하지 않은 장소는 계속 그 기본값을 그대로 쓴다.
ALTER TABLE places
  ADD COLUMN target_indoor_hot_temperature double precision NOT NULL DEFAULT 26.0
    CHECK (target_indoor_hot_temperature >= 24.0 AND target_indoor_hot_temperature <= 30.0);
