# #626 백엔드 통합 검증

2026-11-10 사용자 요청으로 [BE #626](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/626)을 최신 develop에 통합했다. 마일스톤 계획 밖의 PR 보완 작업이며, 비어 있는 M1 계획의 완료조건을 만들지 않았다.

## 작업 근거와 변경

모든 계정의 아이디와 이메일 없는 카카오 가입은 BE #626과 [FE #638](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/638)의 요청·응답 계약이 함께 바뀐다. develop에 push할 때마다 자동 배포하므로 두 PR을 연속 병합하면 중간 버전이 배포될 수 있다. [통합 PR #641](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/641)에 두 원본 head를 함께 포함해 develop에 한 번 반영한다. 배포 워크플로는 변경하지 않았다.

원본 구현 위에 추가한 코드 수정은 `backend/tests/api/test_withdrawal_concurrency.py`의 신원 잠금 키 한 곳이다. 새 `identity_lock`은 접두사를 포함한 신원 키를 받으므로 테스트도 `email_identity("alice@example.com")`를 사용한다. 가입·초대·탈퇴와 같은 잠금을 잡아 경합을 검증하도록 맞췄다. 운영 앱 코드는 원본 #626과 최신 develop의 통합 결과를 유지했다.

## 확인한 조건

| 작업 조건 | 확인 결과 |
| --- | --- |
| 최신 develop 기능 보존 | 팀원 추가와 `has_login_account`, 세션 해시, 알림·승인 변경을 유지했다. |
| 이메일·카카오 가입과 아이디 변경 | 독립 HTTPS 검증에서 실제 API와 저장 상태를 대조했다. |
| FE와 BE의 같은 배포 | 두 원본 head를 포함한 통합 PR을 준비했다. 실제 병합·배포 결과는 #641에서 확인한다. |
| 원본 문서 보존 | 전체 계획·plan.md·trouble-shooting·design·mascot은 변경하지 않았다. |

## 로컬 검증

- Python 3.12.13에서 `python -m pytest`가 3165 passed, 2240 skipped로 종료했다. `ruff check .`도 통과했다.
- 가입·아이디·카카오·이메일 없는 계정·초대·탈퇴·마이그레이션 12개 파일은 242 passed, 232 skipped다.
- 테스트 한 줄 보완 뒤 `python -m pytest tests/api/test_withdrawal_concurrency.py`는 PostgreSQL 전용 8개가 skip되었다. 해당 파일 ruff와 앱 compileall은 통과했다.
- 별도 검증자가 실제 HTTPS 서버에서 45개 동작을 확인했다. 이메일 코드 확인과 가입, 아이디 중복·변경·재로그인 후 저장, 이메일 없는 카카오 가입·재로그인·초대 목록·탈퇴를 포함한다. 최종 백엔드 커밋 `1ba0a1b5`에서 같은 검증을 다시 실행해 45개가 통과했다. 실행 중 소스는 바뀌지 않았고 임시 서버·DB는 정리했다.

## 제한과 후속 작업

HTTPS 검증은 격리한 SQLite를 사용했다. 메일은 `send_mail` 경계에서 수집하고 Kakao는 HTTP MockTransport로 대체했다. 실제 Kakao 로그인과 공급사 메일 발송의 성공을 의미하지 않는다. 로컬 PostgreSQL 도구가 없어 동시성 및 전체 Alembic 검증은 #641의 PostgreSQL CI 결과로 확인한다.

공개 `GET /auth/username-availability`의 IP별 상한은 구현하지 않았다. #626 리뷰와 작성자 기록에 따라 아이디 초대 작업에서 재검토할 후속 항목이다. 팀원 삭제 #637과 아이디 초대 #631·#640은 이 통합 범위에 포함하지 않았다.

## 관련 기록

- [백엔드 원본 구현 기록](../../../../backend/docs/plan/m1/basis-for-decision/2026-11-10-signup-username-progress.md)
- [프론트엔드 #627 구현 기록](../627-signup-username/result.md)
- [대표 API 계약](../../contracts/frontend-api-contract.md)
