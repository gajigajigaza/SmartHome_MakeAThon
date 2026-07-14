-- 두더지 v33: 장소별 실외 날씨 조회(weather.py)를 위해 places 테이블에
-- 위경도 컬럼을 추가합니다. 기존에 등록된 place는 위치 정보가 없을 수 있으므로
-- nullable로 추가합니다.

alter table public.places
  add column if not exists lat double precision;

alter table public.places
  add column if not exists lon double precision;
