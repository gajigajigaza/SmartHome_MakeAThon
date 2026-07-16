-- 두더지 v34: 여러 장소 중 기본으로 선택할 장소를 표시하기 위해
-- places 테이블에 is_default 컬럼을 추가합니다.
-- 기존에 등록된 place는 전부 false로 시작합니다(기본 장소 지정은 별도 로직에서 처리).

alter table public.places
  add column if not exists is_default boolean not null default false;
