-- 두더지 v32: 판단 규칙 엔진 고도화(날씨/미세먼지/바람/창문상태)에 필요한
-- 컬럼을 readings 테이블에 추가합니다.
-- SensorReadingCreate에 추가된 필드와 1:1로 대응됩니다 (routers/readings_router.py 참고).

alter table public.readings
  add column if not exists weather_condition text default '맑음';

alter table public.readings
  add column if not exists pm25 double precision;

alter table public.readings
  add column if not exists wind_speed double precision;

alter table public.readings
  add column if not exists window_is_open boolean default false;

alter table public.readings
  add column if not exists current_mode text default 'MANUAL';
