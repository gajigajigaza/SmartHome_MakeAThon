-- 006_backfill_default_place.sql
-- is_default가 하나도 설정 안 된 사용자들에게, 가장 오래된 장소를 기본으로 지정.
-- 005_add_place_default.sql로 is_default 컬럼을 추가한 뒤 기존에 등록된
-- place들은 전부 false로 시작하므로, 한 번 실행해서 채워준다.

update public.places
set is_default = true
where id in (
  select distinct on (user_id) id
  from public.places
  where user_id not in (
    select user_id from public.places where is_default = true
  )
  order by user_id, created_at asc
);
