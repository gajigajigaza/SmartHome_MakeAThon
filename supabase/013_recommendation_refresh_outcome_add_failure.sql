-- 두더지: recommendation_refresh_events.previous_outcome에 자동실행 실패
-- (AUTO_EXECUTION_FAILED)를 사용자 거절(REJECTED_MANUAL)과 구분해서 남긴다.
--
-- 지금까지는 자동실행이 기기 통신 실패로 넘어가도 화면이 "거절 후 수동
-- 모드"와 똑같은 phase로 전환돼서, 그 뒤 "다시 추천받기"를 누르면 실제로는
-- 실패였는데도 REJECTED_MANUAL로 남았다. 이 표를 만든 목적 자체가 "사용자가
-- 언제/왜 거절하는지" 분석용이라, 이 둘을 구분하지 않으면 실제 거절 횟수가
-- 부풀려진다.

ALTER TABLE public.recommendation_refresh_events
  DROP CONSTRAINT IF EXISTS recommendation_refresh_events_previous_outcome_check;

ALTER TABLE public.recommendation_refresh_events
  ADD CONSTRAINT recommendation_refresh_events_previous_outcome_check
  CHECK (
    previous_outcome IN (
      'AUTO_EXECUTED', 'REJECTED_MANUAL', 'NO_ACTION_NEEDED', 'AUTO_EXECUTION_FAILED'
    )
  );
