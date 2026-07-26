-- 두더지 v37: 안 쓰는 sensor_readings 테이블 정리
--
-- device_id/room/temperature/humidity/power_watt/person_detected 컬럼을 가진
-- 초기 프로토타입 흔적으로 추정됨(스키마가 지금 앱의 readings 테이블과
-- 전혀 다름). 코드 전체(dudeoji-api/dudeoji-web) grep 결과 이 테이블을
-- 참조하는 곳이 하나도 없음을 확인함 — 죽은 dudeoji-api/database.py
-- (SQLite 버전 흔적, 이번에 파일 자체도 삭제함)의 CREATE TABLE 문과
-- 이름만 같고 컬럼은 다름.
--
-- 실행 전 주의: 되돌리기 어려운 파괴적 작업입니다. 이 테이블을 만든
-- 사람에게 한 번 더 확인한 뒤 Supabase 콘솔/SQL 편집기에서 직접
-- 실행하세요.

DROP TABLE IF EXISTS public.sensor_readings;
