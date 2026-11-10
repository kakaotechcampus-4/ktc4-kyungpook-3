# #566 동의 화면 연결

기록일: 2026-11-09. 사용자의 “동의 화면 연결 개발” 요청에 따른 계획 밖 후속 작업이다. [기존 정책 진입점 결과](../566-policy-entrypoints/result.md)는 당시 범위를 설명하는 역사 기록으로 유지한다. 새 마일스톤 완료조건을 만들지 않는다.

## 구현

- [공개 상태](../../../../../src/shared/config/policyPublication.ts)는 현재 `preparing`이다. 승인된 두 문서의 본문·판본·시행일이 함께 있어야 `published`를 구성할 수 있다. 준비 상태는 기존 가입·로그인을 유지하며 동의 조회·저장·체크를 실행하지 않는다.
- 공개 후에는 일반·카카오 가입 프로필의 [공유 체크 영역](../../../../../src/entities/consent/ui/ConsentFields.tsx)에 두 필수 동의와 새 탭 보기 링크가 나타난다. 문서 페이지도 같은 본문을 표시한다.
- [인라인 가드](../../../../../src/app/router/guards/RequireConsent.tsx)는 인증 뒤·업무 레이아웃 앞에서 동의를 확인한다. 원래 주소를 유지하며 정책·계정 탈퇴는 밖에 둔다. 재동의도 동일한 가드를 쓴다.
- 가입은 이전 사용자 범위를 비운 후 새 계정의 동의를 저장하고 세션을 반영한다. 이미 만들어진 계정의 동의 저장 실패·응답 유실은 guard GET으로 복구한다. 재가입을 요청하지 않는다.
- 계정·두 판본으로 Query를 나누고, 잘못된 문서 개수·중복 종류·판본/시각 불완전 응답을 거절한다. `required`와 실제 두 현재 판본의 동의 기록이 모순인 응답도 경계에서 거절한다. 오류 때 체크를 초기화한다. 서버와 표시 문서의 판본이 다르면 새로고침을 안내하고 자동 수락하지 않는다. 끝난 세션의 늦은 응답은 성공 캐시를 쓰지 않는다.
- 실제 쿠키 계정이 폼의 계정과 다르면 선택 `X-Consent-Account-ID`를 검사하는 BE가 조회·저장 전에 `409 CONSENT_ACCOUNT_CHANGED`를 반환한다. FE는 항상 보낸다. 헤더 없는 기존 호출자는 호환되며 이 추가 보호가 적용되지 않는다.
- MSW 저장 형식은 21이다. 동의 기록·서버 판본을 복원하고 탈퇴 시 해당 사용자 동의를 제거한다. 합성 공개 검증 설정은 제품 모듈 하나만 alias하며 실제 본문이나 승인일을 만들지 않는다.

## 요청과 확인

| 요청 범위 | 확인 상태 | 근거 |
|---|---|---|
| 준비 상태에서 수집 방지와 기존 인증 유지 | Chromium·MSW 확인 | [준비 상태 여정](../../../history/unavailable-references.md#%EA%B8%B0%EB%A1%9D-1), 기존 정책·가입·Kakao·복원 여정 |
| 문서 보기·두 체크·정확한 계정과 판본·복귀·reload | 합성 공개 Chromium·MSW 확인 | [공개 상태 여정](../../../../../e2e/consent-published.spec.ts) |
| 계정 변경·판본 변경·읽기/쓰기 오류·응답 유실·늦은 응답 | 단위·통합 확인 | [가드](../../../../../src/features/consent/ConsentGate.test.tsx), [가입 전체 배선](../../../../../src/app/consentFlow.test.tsx), [계약](../../../../../src/entities/consent/consent.test.ts) |
| A의 폼에서 B의 쿠키 계정에 잘못 저장 방지 | 실제 API 확인 | [SQLite·PostgreSQL 회귀](../../../../../../backend/tests/api/test_consents_api.py) |
| 운영 정책 공개·실사용자 수집 | 미실행 | 본문·공급사·법률 검토와 새 공개 판본 확정 필요 |

## 실제 검증

기준 `e2e5cfb2`, Node 24.21.0·Chromium·MSW 및 격리 Python 테스트 환경에서 실행했다. Linux CI·실제 Kakao·메일·운영 HTTPS 왕복과는 구분한다.

- 기존 인증·가입·Kakao·정책·탈퇴·영속과 동의 10파일의 Vitest 회귀: 154 통과 (`--maxWorkers=2`). #593 일반 merge 뒤 동의 3파일도 다시 확인했다.
- 독립 리뷰가 `required=false`와 미동의 기록의 모순을 발견했다. 미동의·옛 판본·양쪽 현재 동의와 반대 `required`의 schema 3건 및 실제 가드 노출 1건이 수정 전 모두 실패했다. 응답 schema의 교차 검증 한 곳에서 보완했다. 이후 동의 3파일의 최종 결과는 25 통과다. 판본 변경·늦은 401·이전 세션 응답·탈퇴 시 동의 제거를 포함한다.
- `playwright test --config playwright.consent.config.ts`: 합성 공개 7 통과, 재시도 없음.
- `playwright test e2e/consent-preparing.e2e.ts e2e/policy.e2e.ts e2e/signup-kakao.e2e.ts e2e/restore.e2e.ts --workers=2 --trace on`: 준비 상태 21 통과, 재시도 없음.
- BE `pytest tests/api/test_consents_api.py -q`: 기대 계정 보호 전 SQLite·PG GET/POST 반례 4개 실패, 수정 뒤 30 통과·SQLite 전용 변형 4 건너뜀.

#593의 MSW 영속 경계 수정을 일반 merge한 뒤 preparing 21·published 7을 다시 통과했다. 최종 모순 응답 schema 보완 뒤에도 공용 Doctor를 동반한 합성 공개 7개가 재시도 없이 통과했고, 준비 상태의 동의 HTTP 0 여정 1개와 TypeScript·제품 build를 다시 통과했다. PNG로 동의 폼을 직접 확인해 실제 타이포 토큰에 맞췄다. 로컬 포트 5213·5266의 종료도 확인했다.

TypeScript·전체 ESLint·전체 Prettier·제품 build·BE 변경 파일 Ruff가 통과했다. #593 merge 뒤 TypeScript·전체 Prettier·동의 대상 ESLint도 다시 통과했다. 보호 계획·사람의 트러블슈팅 37파일과 별도 AI 전체 계획 1파일은 불변 기준 `e2e5cfb2`와 일치한다. 변경 문서 상대 링크의 존재를 확인했다. 로컬 증거·생성된 검증 스킬은 원격 제출 대상에 포함하지 않는다.

제품 기본 Vite 설정은 유지했다. 검증은 독립 cache·strict port·`reuseExistingServer: false`를 사용한다. 합성 공개 판본·시나리오·본문이 일반 제품 JS 번들에 없는 것을 확인했다. 최종 검증은 공용 Doctor의 동일 바이트 복사본을 로컬에서 재사용해 Vite·MSW 제어·비로그인 401을 먼저 확인했다. 일부 업무 조회의 proxy 거절 경고는 동의 단언과 구분한다. 해당 테스트는 동의 기록과 복귀를 확인하며 설정 화면의 모든 업무 기능 성공까지 주장하지 않는다.

CI는 기존 E2E 다음 `test:e2e:consent`를 순차 실행하며 별도 결과·HTML 보고서를 남기도록 설정했다. 이는 구성 반영이며 Linux CI 실행 성공을 선행 선언한 것은 아니다. 실제 운영 계정·제공자·정책 공개는 검증하지 않았다.

## 한계와 다음 단계

가드는 업무 화면의 진입 규칙이다. 모든 서버 API의 접근 권한이나 가입·동의의 원자적 저장을 바꾸지 않았다. 실제 공개 정책 본문과 시행일을 확정하고 BE·FE를 새 판본으로 함께 맞춘 뒤 운영 환경에서 확인해야 한다. [선택 근거](../../basis-for-decision/2026-11-09-consent-publication-and-account-scope.md)와 [대표 계약](../../../../contracts/frontend-api-contract.md#415-이용약관개인정보처리방침-동의-564-be-제안-fe-합의-전)을 참고한다.
