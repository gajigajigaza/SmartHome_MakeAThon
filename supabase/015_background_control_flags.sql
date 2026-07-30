-- 두더지: 웹 앱이 열려있지 않아도 서버가 알아서 기기를 조작하는 "백그라운드
-- 자동 제어"에 대한 사용자 동의 플래그 두 개.
--
-- 기존 auto_control_enabled(자동 제어 설정)는 에어컨 최소 가동시간 기준만
-- 바꿀 뿐 실제 무인 실행과는 무관하다 — 그 토글을 켠 사용자도 "웹 앱 없이
-- 알아서 기기를 조작해도 된다"에 동의한 건 아니므로, 완전히 별개의 명시적
-- 동의 플래그로 둔다.
--
-- - background_condition_control_enabled: 그때그때 실측 온습도/날씨 등
--   현재 조건에 따른 반응형 추천을 서버가 직접 실행(예: 더우면 자동으로
--   에어컨을 켜고, 시원해지면 자동으로 끔).
-- - background_occupancy_control_enabled: 재실 패턴 예측(도착/퇴근 10분
--   전)에 따른 사전조치를 사람 확인(팝업) 없이 서버가 바로 수락·실행.

ALTER TABLE public.places
  ADD COLUMN IF NOT EXISTS background_condition_control_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS background_occupancy_control_enabled BOOLEAN NOT NULL DEFAULT false;
