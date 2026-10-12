# M6-API 연동 중 발견한 문제

[M6-API 계획](../plan.md)을 진행하며 배포 백엔드(`https://managers-manager.duckdns.org`, 배포 커밋 `a1e623b`)와 프론트를 대조하거나 실제로 호출하다가 발견한 문제다. 문제마다 한 파일에 적는다.

- 기록일: 2026-10-12
- 근거: 배포 커밋 코드로 만든 OpenAPI 명세와 백엔드 코드 대조, 로컬 FE(`API_PROXY_TARGET`)와 배포 주소에서 한 실제 호출.

| 문제 | 구분 | 상태 |
|---|---|---|
| [수정 승인 이름을 잘못된 필드에서 읽음](2026-10-12-task-update-approval-title.md) | FE 수정 | 수정함 (`59e0b0c`) |
| [근거 화자에 Discord uid가 그대로 보임](2026-10-12-evidence-speaker-discord-uid.md) | FE 수정 | 수정함 (`a935bdb`) |
| [프론트 오류 코드 목록에 서버 코드 다섯 개가 없음](2026-10-12-missing-error-codes.md) | FE 수정 | 수정함 (`c5eedf0`) |
| [추출 항목에서 수정 제안의 승인 상태를 알 수 없음 (#211)](2026-10-12-extraction-approval-status.md) | BE 보완 | BE 논의 대기 |
| [업로드한 회의가 처리되지 않고 처리 중으로 남음](2026-10-12-upload-not-processed.md) | BE 보완 | 보류 (배포 서버에서 재현, 검증에서 제외) |
| [로컬 FE에서는 OAuth 왕복이 실패함](2026-10-12-oauth-local-roundtrip.md) | 구성 제약 | 배포 주소에서 검증 |
| [이미 연결된 Discord 서버를 고르면 이유 없이 실패로만 보임](2026-10-12-discord-guild-already-linked.md) | BE 요청 후보 | 미요청 |
| [배포 주소에서 Swagger·OpenAPI를 볼 수 없음](2026-10-12-openapi-not-exposed.md) | BE 요청 후보 | 미요청 |
| [Notion `revoked`가 실제로는 「연결 실패」만 뜻함](2026-10-12-notion-revoked-meaning.md) | 나중에 개선할 사항 | FE 문구 수정, BE 실패 이유·권한 해제 감지 미요청 |
| [그 밖의 계약 차이](2026-10-12-minor-contract-gaps.md) | 기록 (Notion `connecting`은 #204로 FE 대응) | 동작 영향 확인 필요 |

FE에서 수정한 항목도 실제 서버 데이터로 화면을 확인하기 전까지는 실제 검증 완료로 보지 않는다. 검증 결과는 이 마일스톤의 `result.md`에 따로 기록한다.
