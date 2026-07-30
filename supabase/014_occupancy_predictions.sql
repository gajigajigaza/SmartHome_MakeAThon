-- 두더지: 재실 패턴 예측(도착/퇴근 전 사전조치) 팝업/오버라이드 상태 저장.
--
-- occupancy_models(로지스틱 회귀로 학습된 시간대별 재실 확률)로 "다음 정시에
-- 재실 상태가 낮음<->높음으로 바뀌는지"를 미리 계산해두는 곳이 없어서, 매
-- 폴링마다 새로 계산하면 팝업이 몇 번 응답됐는지/언제까지 유지할지를 알 수
-- 없다. transition_key(날짜+시간+방향)로 같은 전환에 대해 딱 한 행만
-- 만들고, 사용자 응답(수락/거절)과 수락 시 오버라이드 유지 시각까지 여기
-- 남긴다.

CREATE TABLE IF NOT EXISTS public.occupancy_predictions (
  id BIGSERIAL PRIMARY KEY,
  place_id BIGINT NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
  transition_key TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('ARRIVAL', 'DEPARTURE')),
  transition_at TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')
  ),
  override_until TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (place_id, transition_key)
);

CREATE INDEX IF NOT EXISTS occupancy_predictions_place_status_idx
  ON public.occupancy_predictions (place_id, status, transition_at DESC);

-- readings/occupancy_logs와 동일한 패턴: RLS는 켜두고 정책은 만들지 않는다 ->
-- anon/authenticated 키로는 전부 막히고, 백엔드가 쓰는 service role
-- (RLS를 우회함)만 접근 가능하다.
ALTER TABLE public.occupancy_predictions ENABLE ROW LEVEL SECURITY;
