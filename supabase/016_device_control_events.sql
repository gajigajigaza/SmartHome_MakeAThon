-- 두더지: 프로필(뱃지) 퀘스트 중 "첫 수동 조작" 판정을 위해, /api/devices/control
-- 호출을 자동실행(추천 카운트다운 완료)과 수동조작(거절 후 HeaderQuickControls
-- 버튼 클릭)으로 구분해서 남긴다. device_hub.send_command() 자체는 인메모리라
-- 영구 기록이 없었고, recommendation_refresh_events는 "추천을 어떻게 받았는지"만
-- 남기지 "실제로 버튼을 눌러 기기를 조작했는지"는 남기지 않아서 별도 표로 둔다.

CREATE TABLE IF NOT EXISTS public.device_control_events (
  id BIGSERIAL PRIMARY KEY,
  place_id BIGINT NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'auto')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_control_events_user_source_idx
  ON public.device_control_events (user_id, source);

-- readings/occupancy_logs와 동일한 패턴: RLS는 켜두고 정책은 만들지 않는다 ->
-- anon/authenticated 키로는 전부 막히고, 백엔드가 쓰는 service role
-- (RLS를 우회함)만 접근 가능하다.
ALTER TABLE public.device_control_events ENABLE ROW LEVEL SECURITY;
