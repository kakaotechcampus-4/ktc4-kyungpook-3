-- 심사용 시드(#621) 워크스페이스를 KPI 에서 뺀다(#675). 운영 DB 에서 슈퍼유저로 실행한다. 팀 워크스페이스는 빼지 않는다.
--   1) ID 를 찾는다: SELECT workspace_id, name, created_at FROM workspace ORDER BY created_at;
--   2) 아래 <시드 워크스페이스 ID> 를 그 값으로 바꿔 실행한다.
-- 빼는 데 쓰는 표는 view 세 개의 WHERE 에서 읽는다. 뺀 것을 되돌리려면 DELETE 한다.
INSERT INTO kpi.excluded_workspace (workspace_id)
VALUES ('<시드 워크스페이스 ID>')
ON CONFLICT DO NOTHING;

-- 확인: 빠진 공간 목록
SELECT workspace_id FROM kpi.excluded_workspace;
