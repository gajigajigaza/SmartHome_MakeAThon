-- 두더지: 게이트웨이(라즈베리파이) 전용 인증 토큰.
--
-- 왜 필요한가: 지금까지 게이트웨이는 사람이 웹에서 로그인해 만든 세션 토큰을
-- localStorage에서 꺼내 .env의 DUDEOJI_AUTH_TOKEN에 넣어 쓰고 있었다. 그런데
-- /api/auth/logout은 그 token_hash 행을 sessions에서 지운다 -> **브라우저에서
-- 로그아웃하면 게이트웨이가 같이 죽는다.** 2026-07-30에 이 증상이 하루에도
-- 여러 번 재현됐고("토큰이 또 만료됐다"), 그때마다 다시 로그인해 토큰을 손으로
-- 옮겨 심어야 했다. 사람 세션과 기기 자격증명의 수명이 애초에 다른데 같은
-- 표를 쓰고 있던 것이 원인이다.
--
-- 그래서 기기용 자격증명을 별도 표로 분리한다. 사람이 로그인/로그아웃을 몇 번
-- 하든 영향을 받지 않고, 반대로 이 토큰이 유출됐을 때 그것만 따로 폐기할 수 있다.
--
-- 권한 범위(백엔드 device_auth.py에서 강제): 이 토큰으로는 게이트웨이가 실제로
-- 쓰는 두 경로(WS /ws/sensors, POST /api/occupancy/logs)만 통한다. 비밀번호
-- 변경이나 회원탈퇴 같은 계정 조작은 할 수 없다 — 벽에 붙어 있는 기기의 .env에
-- 들어가는 값이므로 사람 세션과 같은 권한을 주면 안 된다.

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- 이 기기가 어느 장소에 설치됐는지. 감사/표시용이며 권한 판정에는 쓰지 않는다
  -- (게이트웨이는 이미 place_id를 요청마다 명시하고, 소유권은 user_id로 확인한다).
  place_id BIGINT REFERENCES public.places(id) ON DELETE SET NULL,
  -- 원문 토큰은 저장하지 않는다. sessions와 같은 방식(sha256 hex).
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 매 요청마다 쓰면 5초 주기 부하가 그대로 늘어나므로, 백엔드가 5분에 한 번만
  -- 갱신한다(device_auth.LAST_USED_UPDATE_INTERVAL_SECONDS).
  last_used_at TIMESTAMPTZ,
  -- 만료는 두지 않는다. 기기는 계속 붙어 있어야 하고, 대신 폐기는 명시적으로 한다.
  revoked_at TIMESTAMPTZ
);

-- 인증 경로에서 매 요청 타는 조회라 인덱스가 필수다.
CREATE INDEX IF NOT EXISTS device_tokens_token_hash_idx
  ON public.device_tokens (token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS device_tokens_user_idx
  ON public.device_tokens (user_id);

-- readings/occupancy_logs/device_control_events와 동일한 패턴: RLS는 켜두고
-- 정책은 만들지 않는다 -> anon/authenticated 키로는 전부 막히고, 백엔드가 쓰는
-- service role(RLS를 우회함)만 접근 가능하다.
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 곁다리 수정: sessions.token_hash 인덱스
--
-- sessions는 대시보드에서 만들어져 이 저장소의 마이그레이션에 없다. 그런데
-- get_current_user()가 인증이 필요한 **모든** 요청에서 token_hash로 이 표를
-- 조회하고, create_session()은 로그인할 때마다 행을 추가하기만 할 뿐 만료된
-- 행을 지우는 코드가 어디에도 없다. 인덱스가 없으면 시스템에서 가장 자주 도는
-- 쿼리가 계속 커지는 표의 순차 스캔이 된다.
--
-- IF NOT EXISTS라서 이미 있으면 아무 일도 하지 않는다.
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx
  ON public.sessions (token_hash);

-- 만료 세션 정리는 데이터를 지우는 작업이라 이 마이그레이션에 넣지 않았다.
-- 필요해지면 아래를 수동으로 실행하면 된다(만료된 행만 지운다):
--   DELETE FROM public.sessions WHERE expires_at <= now();
