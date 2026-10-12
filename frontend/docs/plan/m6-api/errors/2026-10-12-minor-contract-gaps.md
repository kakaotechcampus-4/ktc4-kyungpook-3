# 그 밖의 계약 차이

- 구분: 기록
- 상태: 지금 프론트 동작에 문제가 생기는지는 실제 서버로 확인하지 않았다. 코드·명세 대조 결과다.

| 차이 | 근거 | 영향 |
|---|---|---|
| 없는 경로의 404가 `INVALID_REQUEST` 코드로 온다 | 배포 서버 `/api/v1/health` 실제 응답 | 404 전용 코드가 없어 화면 문구가 「요청 내용을 다시 확인해 주세요」가 된다 |
| 입력 검증 실패가 명세의 422가 아니라 400 `INVALID_REQUEST` 봉투로 온다 | `backend/app/main.py:74-88` | 프론트는 400 봉투로 처리하므로 문제없다. 명세만 실제와 다르다 |
| Notion 연결 상태가 DB 연결이 끝나기 전에도 임시로 `connected`다 | `backend/app/api/integrations.py:57-62` | 연결 직후에는 Notion 반영 준비가 안 됐어도 연결됨으로 보인다. 서버 주석에 따르면 원래는 `connecting`(「Notion 준비 중」)을 보내려 했으나, 프론트가 모르는 값을 `not_connected`로 바꿔 OAuth 직후 「연결 실패」를 띄워서 임시로 `connected`를 보낸다. 프론트 `entities/integration`에는 `connecting` 처리가 없다. **프론트가 `connecting`을 받으면 서버도 바꾸겠다는 대기 상태라 FE 수정 후보다** |
| 승인 목록·상세 조회에 PM 제한이 없다 | `backend/app/api/approvals.py:255,296` | 프론트 가드만 있다. 계약 요청 M6-4로 남아 있다 |
| 생성 승인 보완값 `task_overrides`를 서버가 받지 않는다 | `ApprovalResolveRequest` 스키마 | 프론트는 MSW일 때만 보낸다. 실 API에서는 보완이 필요한 생성 승인을 승인할 수 없다. 계약 요청 M6-1~M6-3 |
| 워크스페이스 이름 중복을 서비스 전체 기준으로 검사한다 | `backend/app/api/workspaces.py:75` | 프론트 주석(`frontend/src/entities/workspace/api/workspaceDetail.ts:32`)은 같은 계정 기준이라고 적혀 있다. 다른 사용자가 쓴 이름도 만들 수 없다 |
