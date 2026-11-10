# #631 아이디 초대 백엔드 통합 검증

2026-11-10 사용자 요청으로 [BE #631](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/631)을 검토하고 최신 develop에 통합했다. 마일스톤 계획 밖의 PR 보완 작업이며 빈 M1 계획의 완료조건을 새로 만들지 않았다.

## 실제 보완

- #626 통합 때 고친 옛 이메일 초대 잠금 테스트와 충돌했다. #631의 사용자 ID 기반 실제 초대 API 경합 검증을 유지해 해소했다.
- `GET /users/search`는 없는·삭제된 공간에 이미 404 `WORKSPACE_NOT_FOUND`를 반환했다. 대표 API 계약의 검색 규칙과 오류 표에 이 동작을 기록하고 HTTP 상태·오류 코드를 검사하는 두 회귀 사례를 추가했다. 앱 검색 로직은 바꾸지 않았다.
- [FE #640](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/640)을 함께 통합했다. 대표 계약의 FE 연결 설명과 위 404 규칙을 모두 유지했다. 원본 두 PR의 커밋을 보존하며 develop에는 통합 PR 한 번으로 반영한다.

## 확인한 검증

- Python 3.12.13의 집중 7파일은 137 passed, 155 skipped로 종료했다. 초대·탈퇴·이메일 없는 계정·아이디·카카오·초대 마이그레이션을 포함한다. `ruff check .`도 통과했다.
- 독립 검증자가 실제 HTTPS 서버에서 62개 동작을 확인했다. API 가입·공간·팀원 생성, 아이디 검색, 초대, 이메일 없는 카카오 계정의 수락·재로그인·저장 확인, 연결 끊기·거절·취소·탈퇴를 포함한다. HTTP 결과와 읽기 전용 DB 관찰이 일치했다.
- HTTPS 실행 전후 소스 해시와 수정 시각이 같았다. 자체 인증서를 검증했고 임시 서버·DB를 정리했다. 직접 User·Session을 심어 로그인을 대체하지 않았다.
- 전체 테스트·Chromium·최종 PostgreSQL CI의 결과는 #631의 후속 검증 댓글과 통합 PR에서 확인한다. 이 문서 작성 시점의 위 실행과 아직 완료되지 않은 검사를 구분한다.

## 운영 조건과 한계

기존 이메일 대기 초대는 마이그레이션에서 모두 취소된다. 대상 계정을 찾지 못한 초대 이력은 삭제되고 이메일 컬럼도 사라진다. 취소·삭제한 값은 downgrade로 복구되지 않는다. 원본 결정 기록은 모두 팀 테스트 데이터라는 전제다. 이번 검증에서는 운영 DB를 조회하지 않았다. 현재 데이터 처리 범위를 확인한 뒤 운영에 반영한다.

BE와 FE를 따로 배포하면 검색 API 또는 초대 본문이 맞지 않는다. 한 통합 PR로 같은 배포에 넣으며, 기존 BE 재시작 후 FE 교체 순서까지 무중단으로 바꾸지는 않는다. migration 리비전을 유지하는 수정 배포를 우선하며, 이메일 없는 초대가 있으면 downgrade는 데이터를 지우지 않고 중단한다.

HTTPS 검증은 격리 SQLite와 메일 수집·Kakao MockTransport를 사용했다. 실제 공급사 성공·PostgreSQL 잠금·기존 운영 데이터 마이그레이션을 증명하지 않는다. FE 검색 MSW가 없는 공간에 403을 내는 차이도 확인했으며 실제 BE의 404와 구분한다. 팀원 삭제 #637은 이 통합 범위가 아니다.

## 관련 기록

- [아이디 초대 결정](../../../../../../backend/docs/plan/m1/basis-for-decision/2026-11-10-invite-by-username-decision.md)
- [원본 백엔드 진행 기록](../../../../../../backend/docs/plan/m1/basis-for-decision/2026-11-10-invite-by-username-progress.md)
- [프론트엔드 #632 결과](../632-invite-by-username/result.md)
- [대표 API 계약](../../../../contracts/frontend-api-contract.md)
