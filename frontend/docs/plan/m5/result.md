# M5 추가 결과 — 수동 업로드 실패 안내와 화자 지정 만료 이력

## 작업 근거와 요약

2026-11-04 사용자가 이슈 #256의 BE 알림에 대한 FE 결정을 댓글로 남기고 구현·PR을 작성하도록 요청했다. 실패 사유를 구분하고, 화자 지정 기한이 지난 회의는 나중에도 확인할 수 있게 하는 범위다. 기존 M5 전체 결과를 소급 작성하거나 마일스톤 전체 완료를 재판정하지 않는다.

## 실제 구현 및 관련 코드

- [실패 안내](../../../src/entities/meeting/lib/meetingFailure.ts)에서 `diarize`·`speaker_assignment_expired`·알 수 없는 값을 구분한다. 알려진 사유는 Notion 연결 재조회보다 우선한다.
- [처리 추적기](../../../src/features/meeting-processing/model/useProcessingTracker.ts)는 만료 회의를 목록 캐시에 유지한다. 처리 화면을 보고 있으면 실패 상세를 열고, 다른 화면을 이용 중이면 알림만 표시한다.
- [목록](../../../src/widgets/meeting-minutes/ui/MeetingMinutes.tsx)에 만료 이력·상태·회의 일시를 표시하고, [상세](../../../src/widgets/meeting-minutes/ui/MinutesDetail.tsx)에 사유와 PM 재업로드 링크를 제공한다. 일반 팀원은 PM에게 요청하는 안내를 본다.
- [BE 목록](../../../../backend/app/api/workspaces.py)은 수동 업로드의 화자 지정 만료만 실패 제외 정책의 예외로 남기고 `failed_stage`를 반환한다. FE는 구버전 목록의 필드 누락을 `null`로 읽는다.
- 대표 계약 §4.4.1, D-091~D-093, MSW 시나리오, 회의 검증 기능 지도를 갱신했다.

## 완료조건 확인

| 기존 조건 또는 작업 요청 | 이번 범위 상태 | 근거 |
|---|---|---|
| U4-6 일반 실패 제외·안내·다른 화면 유지 | 일반 실패 정책 유지, 화자 지정 만료에 예외 추가 | E2E ④·⑤·⑥, 처리 추적 통합 테스트 |
| U4-7 실패 시 Notion 연결 재조회 | 알려진 두 사유는 해당 사유를 우선하고, 나머지는 기존 분기 유지 | E2E ⑥, 기존 처리 추적 회귀 |
| U5-2 실패 회의 제외·빈 상태·PM CTA | 수동 업로드의 만료 이력만 보존. 만료만 있는 목록도 표시 | E2E ⑤·⑦, 회의록 통합 테스트 |
| #256 만료 이력을 나중에도 확인 | FE·MSW에서 충족 | 새로고침·다른 화면 이동 후 목록에서 다시 선택하는 E2E ⑤ |
| 지정 제출 직후 409 처리 | 미구현, 예정 계약 기록 | 현재 develop에 화자 지정 제출 UI가 없음 |

## 검증 내역

실행일은 2026-11-04이며 Node v24.11.0과 Python 3.12를 사용했다.

- `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run meetings`: Chromium 7개 통과. 업로드 완료·백그라운드 완료·권한·일반 실패와 새 만료 이력·실패 사유 우선순위를 확인했다.
- 증거: `.verify/managers-manager/2026-11-03T16-27-58-761Z-meetings-1cba6bfa/`. `expired-history.png`를 직접 확인했고 `cleanup.json`의 `portOpen=false`를 확인했다.
- BE 관련 API 테스트: 52 passed, 33 skipped. 만료 목록 보존·다른 실패 제외·상세 사유 일치·다른 워크스페이스 접근 제한을 포함한다. skip은 PostgreSQL 전용 변형으로 `TEST_DATABASE_URL`이 없어 실행하지 않았다.
- `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js .`: 통과. 첫 타입 검사의 E2E 시나리오 이름 누락을 보완하고 타입 검사를 다시 실행했다.
- Storybook 빌드와 `playwright test -c playwright.storybook.config.ts --workers=1 --grep 'm5-회의-(회의록|처리)'`: 22개 통과. 새 만료 스토리와 기존 회의록·처리 화면 play를 확인했다.
- 문서 검사: 변경 문서 8개의 상대 링크 누락 없음, 보호 문서 20개가 작업 시작 SHA-256과 일치한다.
- 회의 엔티티·처리 판정·메타 표시 집중 단위 검사: `vitest run src/entities/meeting src/features/meeting-processing src/widgets/meeting-minutes/lib/format.test.ts --maxWorkers=2`, 10개 파일·53개 테스트 통과.
- `node node_modules/vite/bin/vite.js build`: 통과.
- `node node_modules/prettier/bin/prettier.cjs --check .`: 통과. 배포 산출물에 새 MSW 시나리오 이름 `meeting-fail-expired`가 없는 것도 확인했다.
- 전체 Vitest 확대 실행은 온보딩·가드 4건 실패를 확인한 뒤 중단했다. 이 실행에서 회의 처리 32개·업로드 38개·회의록 32개는 통과했다. 온보딩 생성의 실패 케이스는 단독 실행에서도 기본 5초 제한을 초과했다. 변경 전 HEAD `910e241`에서 가드 2개는 통과했지만, 온보딩 생성은 워커 시작 제한 시간 초과로 실행되지 않았다. 전체 통과나 회귀 원인 확정으로 해석하지 않는다.
- 후속 요청으로 [M4 테스트 모션 환경](../m4/result.md#2026-11-04-추가-결과-온보딩가드-테스트의-모션-환경)을 고정한 뒤 원래 네 사례와 관련 104개가 통과했고, 전체 단위도 176개 파일·2,141개가 실패·skip 없이 통과했다. 위 확대 실행은 당시의 실패 기록으로 보존한다.

## 계획 대비 변경

기존 U4-6·U4-7·U5-2와 D-093은 모든 실패를 목록에서 빼고 Notion 상태로 안내를 나누었다. 사용자가 접속하지 않은 동안 만료될 수 있어, 이번 지시를 근거로 만료 이력 예외와 알려진 사유 우선 처리를 추가했다. 보호하는 계획 원문은 수정하지 않았다.

## 남은 작업과 제한 사항

- 자동 실패 전환은 미병합 BE PR #301의 담당 범위다. 이 작업에서 실제 3시간·7일 경과를 검증하지 않았다.
- 화자 지정 제출 UI 구현 후 `409 MEETING_NOT_AWAITING_SPEAKERS(details.status=failed)`의 상세 재조회·재제출 차단을 연결해야 한다.
- BE 목록 변경은 구현 제안이며 파트 간 리뷰·합의와 실서버 배포 검증이 남았다. 운영 API·실제 AI 처리·Notion 반영은 이번 검증 대상이 아니다.

## 관련 기록

- [대표 계약](../../contracts/frontend-api-contract.md#441-수동-업로드-실패-사유와-만료-이력-256-2026-11-04)
- [만료 이력 보존 결정](basis-for-decision/2026-11-04-upload-failure-history.md)
- [이슈 결정 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/256#issuecomment-6609243822)

## 2026-11-04 추가 결과: 탭 패널 초점과 회의 날짜 Tab 순서 (#337)

### 작업 근거와 요약

2026.10.30 접근성 상세 이슈 보고서(KWCAG 2.2)의 초점 지적 두 건을 다룬 이슈 #337이 근거다. 먼저 실제 브라우저에서 재현하고, 근거에 따라 고칠지 설명할지 정하는 범위다. 탭 패널은 고쳤다. 회의 날짜는 갇힘이 재현되지 않아 기본 날짜 입력을 유지하고 근거를 남겼다. M5 전체 완료를 다시 판정하지 않는다.

### 실제 구현 및 관련 코드

- [panelTabStop](../../../src/shared/lib/tab-panel/panelTabStop.ts): `role="tabpanel"`에 거는 ref다. 패널 안에 Tab으로 갈 요소가 없을 때만 `tabindex="0"`을 두고, DOM이 바뀌면 다시 판단한다.
- [회의록 탭](../../../src/widgets/meeting-minutes/ui/MinutesTabs.tsx)과 [태스크 목록 탭](../../../src/widgets/task-board/ui/TaskBoard.tsx)의 고정 `tabIndex={0}`을 이 ref로 바꿨다. 두 화면에 같은 기준을 적용한다.
- [회의 올리기 폼](../../../src/features/meeting-upload/ui/MeetingUploadForm.tsx)은 바꾸지 않았다.
- 테스트: [회의록](../../../src/app/meetingMinutes.test.tsx)은 `요약`에서 Tab이 패널로, `추출된 일`에서 첫 링크로 가는지 본다. [태스크](../../../src/app/tasks.test.tsx)는 목록이 있으면 첫 항목 링크로, 누를 것이 없는 빈 패널이면 패널로 가는지 본다.

### 재현과 화면 검증

MSW 모의 서버(verify-frontend 절차)를 띄워 Tab마다 초점이 간 접근성 노드를 기록했다. 대상 브라우저는 Playwright Chromium 153과 설치된 Google Chrome 156(한국어 UI)이다.

| 화면 | 변경 전 | 변경 후 |
|---|---|---|
| 회의록 `요약` | 탭 → 패널 | 탭 → 패널(유지) |
| 회의록 `추출된 일` | 탭 → 패널 → `로그인 API 연동` | 탭 → `로그인 API 연동` |
| 태스크 `전체` | 탭 → 마감 조건 → 담당자 → 정렬 → 패널 → `알림 문구 검토` | 탭 → 마감 조건 → 담당자 → 정렬 → `알림 문구 검토` |
| 회의 올리기 | 회의 제목 → 연도 → 월 → 일 → 날짜 선택도구 → (참석자 빼기) → `추가` → `정리 시작하기` | 같음(코드 변경 없음) |

회의 날짜의 순서는 빈 폼, 파일·참석자 선택 뒤, 제목을 비우고 제출해 오류가 난 뒤, 날짜를 일부만 입력한 뒤, 참석자 메뉴를 열었다 닫은 뒤, Shift+Tab 역방향에서 모두 같았다. 보고서 환경인 Chrome 155는 직접 실행하지 못했다. 증거는 로컬 `.verify/evidence/`(before·after·chrome156)에 있으며 저장소에는 올리지 않는다.

### 검증 내역

실행일은 2026-11-04이며 Node v24.11.0를 사용했다.

- `npm run typecheck`, `npm run lint`, `npm run build`: 통과.
- `npm run format:check`: 통과. 처음 실행에서는 git이 무시하는 로컬 증거 폴더 `frontend/.verify/`만 걸렸고, 그 폴더를 잠시 옮긴 뒤 다시 실행해 통과했다.
- `npm run test`: 178개 파일 중 158개, 2,018개 테스트 중 1,961개가 통과했다. 실패 57건은 다른 작업 트리의 설치·테스트와 함께 돈 부하에서 난 5~15초 시간 초과와 첫 화면 조회 실패였고, 이번에 바꾸지 않은 업로드 폼 테스트(23건)가 가장 많았다. 실패한 20개 파일을 `--maxWorkers=2`로 다시 돌려 20개 파일·481개 테스트가 모두 통과했다.
- 새 테스트 중 Tab 건너뛰기 두 건(회의록·태스크 목록)은 수정 전 코드에서 실패하고 수정 뒤 통과했다. 빈 패널 테스트는 수정 전후 모두 통과하는 회귀 방지용이다.

### 계획 대비 변경

보고서 개선안은 패널의 `tabindex="0"`을 모두 빼는 것이다. APG 탭 패턴과 맞추기 위해, 안에 누를 것이 없는 패널에는 남겼다. 회의 날짜의 `role="spinbutton"` 제거안은 브라우저가 만드는 역할이라 적용할 수 없고, 갇힘도 재현되지 않아 코드를 바꾸지 않았다. 근거는 [결정 기록](basis-for-decision/2026-11-04-tab-panel-and-date-focus.md)에 있다.

### 남은 작업과 제한 사항

- 검수 측이 회의 날짜 갇힘을 다른 환경(보조기술, 확장 프로그램, Chrome 155)에서 다시 보이면 재현 절차를 받아 다시 확인한다. 회신 문안은 이슈 #337 댓글에 남겼다.
- 숨겨진 요소나 비활성 `fieldset` 안의 버튼은 Tab 대상으로 셀 수 있다. 현재 두 패널에는 그런 구성이 없다.
