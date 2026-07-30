-- 두더지: "다시 추천받기" 버튼을 누른 시점을 기록한다. 추천은 이제 새 센서
-- 기록이 들어와도(60초 폴링) 화면에서 자동으로 갱신되지 않고, 사용자가
-- 직접 이 버튼을 눌러야 새 추천으로 교체된다(App.jsx/RecommendationCard.jsx
-- 참고). 그래서 "얼마나 오래 유지했는지"를 서버가 도입하는 고정 타이머
-- 대신, 실제로 사용자가 언제/어떤 상황에서 다시 받았는지를 이 표에 쌓아
-- 나중에 target_cooldown_minutes 등 임계값 튜닝 근거로 쓴다.

CREATE TABLE IF NOT EXISTS public.recommendation_refresh_events (
  id BIGSERIAL PRIMARY KEY,
  place_id BIGINT NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  previous_action TEXT NOT NULL,
  previous_outcome TEXT NOT NULL CHECK (
    previous_outcome IN ('AUTO_EXECUTED', 'REJECTED_MANUAL', 'NO_ACTION_NEEDED')
  ),
  shown_at TIMESTAMPTZ NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_seconds INTEGER NOT NULL,
  indoor_temperature REAL,
  indoor_humidity REAL,
  outdoor_temperature REAL,
  outdoor_humidity REAL,
  window_is_open BOOLEAN,
  ac_is_on BOOLEAN
);

CREATE INDEX IF NOT EXISTS recommendation_refresh_events_place_time_idx
  ON public.recommendation_refresh_events (place_id, refreshed_at DESC);

-- readings/occupancy_logs와 동일한 패턴: RLS는 켜두고 정책은 만들지 않는다 ->
-- anon/authenticated 키로는 전부 막히고, 백엔드가 쓰는 service role
-- (RLS를 우회함)만 접근 가능하다.
ALTER TABLE public.recommendation_refresh_events ENABLE ROW LEVEL SECURITY;
