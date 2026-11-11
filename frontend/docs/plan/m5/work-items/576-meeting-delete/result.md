# #576 회의 삭제와 보존 태스크 표시

## 작업 근거와 요약

#572 정책 확인과 #576을 근거로 한 마일스톤 계획 밖 이슈 작업이다. 회의 원문을 삭제해도 생성된 태스크와 이력을 남기고, 삭제된 원본을 다시 열지 않도록 한다. 전체 계획과 마일스톤 완료 상태는 바꾸지 않았다.

## 실제 구현

| 사용자 동작 | 코드 |
|---|---|
| PM의 done/failed 회의에서 삭제 확인·취소·중복 제출 차단·실패 재시도 | `src/features/meeting-delete/ui/MeetingDelete.tsx` |
| 계보 receipt 검증, 늦은 성공 응답의 원문 cache 정리, 세션·경로 변경 뒤 이동·토스트 차단 | 같은 파일과 `src/entities/meeting/api/meetingQueries.ts` |
| 410 회의 링크에서 원문 숨김, 이전 표시 상태 제거 | `src/widgets/meeting-minutes/ui/MinutesDetail.tsx`, `model/useShownMeeting.ts` |
| `meeting_deleted`를 명시적 도메인 값으로 변환하고 원본 삭제 안내 | `src/entities/task/model/mapper.ts`, `src/widgets/task-detail/ui/TaskDetail.tsx`, `TaskHistory.tsx` |
| MSW 삭제·receipt·멱등성·403·409·410와 영속화 version19 | `src/shared/mock/meetingDeletion.ts`, `db.ts`, `persistence.ts`와 meeting/minutes/speaker 핸들러 |

삭제 성공 시 상세·회의록·추출·승인 cache와 이전 요청을 제거하고 목록·태스크를 다시 조회한다. 화면을 떠났어도 같은 세션이면 원문 cache를 지운다. 사용자 화면 이동과 토스트만 생략한다. 목록에서 회의가 보이지 않는다는 이유로 태스크의 출처 삭제를 추정하지 않는다.

## 실제 검증

2026-11-09 Windows, Node 24.21.0에서 실행했다.

- 구현 단계의 관련 9파일 169개 테스트, TypeScript 검사, 전체 ESLint, Vite 빌드를 통과했다.
- 격리 포트의 Chromium Doctor와 삭제 E2E 2개를 통과했다. 삭제 확인창과 보존 태스크 화면을 직접 확인하고 trace·스크린샷을 로컬에 보관했다. E2E는 MSW를 사용하며 실서버 fallback을 차단했다.
- 독립 Chromium 영속화 검증은 4개를 통과했다. version19 복원, OAuth와 손상 상태를 확인했다.
- 독립 전체 단위 테스트는 3,592 passed, 4 failed였다. 그중 늦은 삭제 성공 뒤 cache가 남는 회귀와 새 Task 응답 필드 단언 2개는 수정 대상이었다. 비밀번호 재설정의 나머지 실패는 단독 재실행에서 21개 모두 통과했다.
- 늦은 성공 응답 테스트를 유효한 receipt로 바꾸어 cache가 남는 실패를 먼저 확인했고, 화면 변경 guard와 cache 정리를 분리한 뒤 같은 파일 11개가 통과했다. 전체 단위 테스트 성공으로 기록하지 않는다.

리뷰 수정 후 `meetingDelete.test.tsx`, `taskApprovalFlow.test.ts`, `passwordReset.test.tsx`의 107개가 통과했다. 늦은 성공 뒤 삭제된 회의로 돌아가도 410 안내가 나타나고 원문이 렌더링되지 않음을 확인했다. 삭제되지 않은 다른 회의의 추출 결과가 새로 로드될 수 있으므로 cache 단언은 실제 삭제 대상 `ex_01`에 맞췄다. 공개 재실행 진입점은 `src/app/meetingDelete.test.tsx`, `src/shared/mock/meetingDeletion.test.ts`, `e2e/meeting-delete.e2e.ts`다.

같은 수정 상태에서 전체 단위 테스트를 다시 실행해 **283파일 3,596개 모두 통과**했다. 그 단계의 TypeScript 검사·전체 ESLint·Vite 빌드도 통과했다. 기존 전체 실행의 실패 기록과 재실행 결과를 구분한다. 이 결과는 아래 서버 gate 연동 추가 전의 기록이다.

### 삭제 가능 여부 gate 추가

이전 서버 응답을 포함해 `deletion_available`이 없거나 false이면 삭제 CTA를 숨긴다. 완료·실패 회의의 PM에게도 같은 규칙을 적용한다. 준비된 모의 회의와 새 수동 업로드는 terminal 상태일 때만 true를 반환하며, 명시적인 false는 완료 이후에도 유지한다. 직접 MSW 삭제 요청도 검증되지 않은 회의는 409로 거절한다.

이 추가의 수정 전 실패 7건을 확인했고, 최종 관련 8파일 124개와 TypeScript·대상 ESLint를 통과했다. Chromium Doctor와 삭제 E2E 2개도 통과했다. 화자 지정과 같은 기존 PM 기능은 삭제 가능 여부와 별개로 검증했다. 커밋 기준 통합 검증은 PR의 실행 기록과 구분한다.

gate를 포함한 최종 전체 단위 테스트는 **283파일 3,605개 모두 통과**했다. 전체 ESLint와 Vite 빌드도 다시 통과했다. 실제 백엔드의 명시적 삭제 가능 응답과 39개 HTTPS 동작은 [BE 결과](../../../../../../backend/docs/plan/m3/result.md)의 별도 검증이며 MSW 결과로 대체하지 않았다.

### 전체 CI와 열린 화면 회귀 보완

전체 CI E2E는 292개 통과, 8개 실패와 설정 화면의 재시도 통과 1개를 기록했다. 실패 8개는 새 삭제 버튼 행이 높이 32px를 추가해 기존 회의록 skeleton과 실제 화면의 탭 위치가 달라진 문제였다. 삭제 버튼을 기존 고정 높이 메타데이터 행으로 옮겼다. 수정 전 실패를 재현했고, 기존 위치 고정 19개와 삭제 2개 E2E를 재시도 없이 통과했다. 1024px의 긴 제목·참석자 10명과 키보드 Enter·Escape·초점 복귀도 실제 브라우저에서 확인했다. 관련 단위 테스트 79개와 TypeScript·ESLint·Prettier도 통과했다. 기존 위치 단언은 완화하지 않았다.

별도 실제 라우팅 검증에서 삭제 요청 중 승인 화면으로 이동하면 원문이 남는 문제도 재현했다. QueryCache에서 활성 쿼리를 제거해도 이미 열린 observer가 이전 데이터를 표시했고, 제거된 쿼리는 무효화만으로 재조회되지 않았다. 비활성 쿼리만 제거하고 활성 쿼리는 reset·재조회하도록 바꿨다. 현재 경로는 이전 요청 취소가 끝난 뒤, reset으로 삭제 컨트롤이 사라지기 전에 판정한다. 정상 삭제의 이동·토스트와 다른 화면으로 이동한 뒤의 조용한 처리를 함께 유지한다.

공개 회귀 테스트는 새 조회를 일부러 지연한 동안에도 원문이 즉시 사라지고, 404 응답 뒤 승인 없음 안내가 나타나며 경로·토스트가 바뀌지 않음을 확인한다. 수정 전 실패를 확인한 뒤 관련 5파일 **97개 모두 통과**했다. 이 실행은 이전 전체 3,605개 결과와 구분하며 겹치는 수를 합산하지 않는다. 추가 변경은 독립 읽기 전용 리뷰도 거쳤다.

## 제한과 남은 검증

- MSW는 단일 회의 기여를 모델링한다. 실제 여러 회의의 혼합 승인 재구성은 BE 검증 범위다.
- `pending`은 남은 파일 정리 중임을 알리며 완료로 표시하지 않는다. 실제 운영 계정에서 새 삭제 API는 실행하지 않았다.
- Vite 빌드는 기존 CSS 표현 경고를 출력했으며 exit 0이다.
- API 형식은 [대표 계약](../../../../contracts/frontend-api-contract.md), 서버 검증과 환경 한계는 [BE M3 결과](../../../../../../backend/docs/plan/m3/result.md)에 있다.
