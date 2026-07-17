-- 두더지 v35: readings를 특정 place와 연결하기 위해 place_id 컬럼을 추가합니다.
-- 지금까지 readings는 user_id로만 조회되어 어느 장소의 센서값인지 구분할 수
-- 없었습니다(사용자가 장소를 여러 개 등록한 경우 부정확해지는 원인).
-- 기존에 저장된 행은 place_id가 NULL로 남습니다 — savings.py의
-- get_cumulative_kwh()는 NULL인 행에 대해 기존 방식(대표 에어컨 근사치)으로
-- 폴백 계산하도록 되어 있습니다.
--
-- 주의: 이 마이그레이션은 제안 단계입니다. readings_router.py의
-- save_reading_for_user()가 저장 시 place_id를 함께 기록하도록 바뀌기 전까지는
-- 새로 들어오는 행도 계속 NULL로 쌓입니다(민주 승인 후 별도 반영 예정).

ALTER TABLE readings
  ADD COLUMN place_id INTEGER REFERENCES places(id);

create index if not exists idx_readings_place_id
  on public.readings(place_id);
