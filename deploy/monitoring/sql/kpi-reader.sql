-- Grafana Cloud 가 쓰는 읽기 전용 계정(#675). 운영 DB 에서 슈퍼유저(POSTGRES_USER)로 한 번 실행한다.
--   read -rs PW   # 비밀번호를 입력한다(셸 기록에 남기지 않는다)
--   docker compose -f backend/docker-compose.prod.yml exec -T db \
--     psql -U <POSTGRES_USER> -d <POSTGRES_DB> -v pw="$PW" < deploy/monitoring/sql/kpi-reader.sql
-- 이 파일에는 비밀번호가 없다. psql 변수 pw 로만 받는다. 다시 실행해도 안전하다(비밀번호를 바꾸고 권한을 다시 준다).
-- kpi view 를 DROP 하고 다시 만든 마이그레이션 뒤에는 이 파일을 다시 실행한다(GRANT 가 view 와 함께 사라진다).
-- kpi.excluded_workspace 는 일부러 권한을 주지 않는다. 읽기 계정은 view 세 개만 본다.

SELECT 'CREATE ROLE kpi_reader LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kpi_reader')
\gexec

ALTER ROLE kpi_reader LOGIN CONNECTION LIMIT 3 PASSWORD :'pw';
ALTER ROLE kpi_reader SET default_transaction_read_only = on;
ALTER ROLE kpi_reader SET statement_timeout = '5s';

GRANT USAGE ON SCHEMA kpi TO kpi_reader;
GRANT SELECT ON kpi.meeting_fact TO kpi_reader;
GRANT SELECT ON kpi.extraction_item_fact TO kpi_reader;
GRANT SELECT ON kpi.approval_fact TO kpi_reader;
