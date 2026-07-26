-- 두더지 v36: 현장 하드웨어 연동을 앞두고 전력 측정·재실 감지 컬럼을
-- 미리 열어둡니다. 재료 리스트에 전력 측정 모듈이 확정되어 있고,
-- 대회 미션에 재실(PIR) 데이터가 명시되어 있어 수신부만 먼저 뚫어둡니다.
--
-- 둘 다 nullable — 하드웨어가 아직 안 붙은 동안은 계속 NULL로 남습니다.
-- ac_is_on은 이번 마이그레이션에 포함하지 않습니다(컬럼 승격/백필/
-- dual-write 안 하기로 확정 — recommendation jsonb 안의 값만 계속 씁니다).

ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS power_watt double precision,   -- 전력 측정(W), 미연결 시 null
  ADD COLUMN IF NOT EXISTS person_detected boolean;        -- 재실 감지(PIR), 미연결 시 null
