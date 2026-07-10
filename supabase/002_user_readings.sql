-- 두더지 v31: 센서 기록을 로그인 사용자별로 분리
-- v30 SQL을 이미 실행한 경우 이 파일만 추가로 실행하면 됩니다.

alter table public.readings
  add column if not exists user_id bigint references public.users(id) on delete cascade;

create index if not exists idx_readings_user_measured_at
  on public.readings(user_id, measured_at desc);

-- 기존 공용 테스트 기록은 user_id가 null이므로 새 계정에 표시되지 않습니다.
-- 이후 생성되는 기록은 FastAPI가 로그인 사용자의 user_id를 함께 저장합니다.
