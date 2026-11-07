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
- 화자 지정 제출 UI 구현 후 `409 MEETING_NOT_AWAITING_SPEAKERS(details.status=failed)`의 상세 재조회·재제출 차단을 연결해야 한다. 2026-11-05에 연결했다(아래 추가 결과).
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

## 2026-11-05 추가 결과: 화자 지정 화면과 샘플 구간 (#256, #342)

### 작업 근거와 요약

2026-11-05 사용자가 #256의 화자 지정 화면과 #342의 샘플 구간 규칙을 구현하도록 지시했다. 진입점 세 곳, 별도 주소, 후보 범위, 제출 규칙은 사용자가 정했고 나머지는 기본값으로 정했다. 위 「남은 작업」의 409 만료 연결도 이번에 했다. M5 계획과 완료조건 원문은 고치지 않았고 마일스톤 완료를 다시 판정하지 않는다.

### 실제 구현 및 관련 코드

- 회의 상태에 `awaiting_speakers`를 더했다. 화자 조회·제출 API와 원본 재생 주소를 이었다([types.ts](../../../src/entities/meeting/model/types.ts), [speakers.ts](../../../src/entities/meeting/api/speakers.ts)).
- [처리 추적](../../../src/features/meeting-processing/model/trackerOutcome.ts)은 대기 중에도 30초 간격으로 지켜본다. PM에게만 처리 화면 이동이나 `화자 지정이 필요해요` 토스트로 한 번 안내한다. [처리 화면](../../../src/pages/meeting-processing/ui/MeetingProcessingPage.tsx)은 대기 안내를 보인다.
- [지정 화면](../../../src/pages/meeting-speakers/ui/MeetingSpeakersPage.tsx)은 `/workspaces/:workspaceId/meetings/:meetingId/speakers`에 있다. 라벨을 `화자 N`과 총 발화 시간으로 보이고 샘플 구간을 재생한다. 참석자, 펼치는 다른 팀원, 외부 참석자 중에서 고른다. 모든 라벨을 골라야 제출되고, 제출 오류는 [이유 하나](../../../src/features/speaker-assignment/model/submitRejection.ts)로 바꿔 안내한다. 팀원에게는 안내만 보인다.
- [회의록 목록·상세](../../../src/widgets/meeting-minutes/ui/MeetingMinutes.tsx)가 대기 회의를 `화자 지정 필요`로 보이고 지정 화면으로 잇는다.
- #256 A1에 따라 [근거 화자 이름](../../../src/entities/member/lib/speakerName.ts)을 팀원 ID로 먼저 찾는다. BE 응답에 `evidence.speaker_member_id`와 승인 payload의 `evidence_speaker_member_id`가 실리는 것을 `backend/app/schemas/meeting.py`와 `backend/app/api/extractions.py`에서 확인했다.
- MSW에 화자 조회·제출·녹음 재생 목, 코드로 만든 무음 WAV, `meeting-speakers*` 시나리오 다섯 개를 더했다. 모의 DB 버전은 8이다. 대표 계약 §2.3.1·§2.4·§2.5·§4.4.1·§5.5와 [MSW 안내](../../msw-guide.md)를 갱신했다.

### 완료조건 확인

이번 작업은 M5 계획의 완료조건이 아니라 사용자 지시로 진행했다. 아래는 지시 항목별 상태다.

| 지시 항목 | 상태 | 근거 |
|---|---|---|
| 처리 화면을 보던 PM을 대기 순간 지정 화면으로 안내 | 충족(MSW) | 브라우저 여정 `meeting-speakers`, `meetingSpeakersTracking.test.tsx` |
| 목록 `화자 지정 필요` 행에서 지정 화면 진입 | 충족(MSW) | 브라우저 여정 `meeting-speakers-list`, `meetingMinutes.test.tsx`, E2E `meeting-speakers.e2e.ts` |
| 다른 화면이면 토스트로 알리고 지정 화면으로 이동 | 충족(Vitest), 브라우저 미검증 | `meetingSpeakersTracking.test.tsx`. MSW 흐름은 첫 조회에 대기가 되어 브라우저에서 다른 화면으로 떠날 틈이 없다 |
| 별도 주소, 새로고침·직접 진입, 팀원 안내 | 충족(MSW) | 여정 `meeting-speakers-edges`, `meetingSpeakers.test.tsx` |
| 후보 범위(참석자, 다른 팀원, 외부 참석자 `null`), 다중 지정 | 충족(MSW) | 여정 `meeting-speakers`의 PUT 본문, `assignmentDraft.test.ts` |
| 모든 라벨을 골라야 제출, 남은 수 표시 | 충족(MSW) | 여정 `meeting-speakers`, `meetingSpeakers.test.tsx` |
| 샘플 재생(구간 끝 멈춤, 1개·2초 미만, `audio: null`) | 충족(MSW·jsdom) | 여정의 0.8초 샘플 자동 멈춤, `samplePlayback.test.ts`. m4a 시작 지연은 미검증 |
| 409 `details.status=failed` 상세 재조회·재제출 차단 | 충족(MSW) | 여정 `meeting-speakers-edges`, E2E `meeting-speakers.e2e.ts` |
| 제출 뒤 처리 재개, `done`까지 추적 | 충족(MSW) | 여정 `meeting-speakers`가 회의록까지 감 |
| A1 근거 화자 이름 | 충족(MSW) | `speakerName.test.ts`, `approvals.test.tsx` |

### 검증 내역

실행일은 2026-11-05, Node v24.11.0이다. 모두 `frontend/`에서 실행했다.

- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run format:check`, `npm.cmd run build`: 통과. 빌드 산출물에 `meeting-speakers` 시나리오 이름은 없고 지연 로드 화면 조각 이름만 있다.
- 범위 Vitest(`npx vitest run --maxWorkers=1 <파일>`): 화자·추적·회의 엔티티·MSW 20개 파일 159개, 회의록 목록·상세 2개 파일 42개, A1·승인·추출·MSW 흐름 7개 파일 113개가 통과했다. 전체 `npm run test`는 다른 워크트리 부하 때문에 실행하지 않았다.
- E2E `E2E_PORT=5236 npx playwright test e2e/meeting-speakers.e2e.ts`: 두 사례가 로그에서 통과했다. 실행 뒤 메모리 부족으로 프로세스가 회수되어 요약 줄과 종료 코드는 남지 않았다. E2E 전체는 실행하지 않았다.
- 로컬 검증 스킬의 브라우저 여정(MSW, Chromium 1280×900, 포트 5246): `meeting-speakers`, `meeting-speakers-edges`, `meeting-speakers-list` 모두 `JOURNEY PASS`. 증거는 git 무시 경로 `frontend/.verify/artifacts/spk-2/`, `spk-3/`이다. 화면 선택, 만료 안내, 목록 행 스크린샷을 직접 확인했다. 콘솔 오류는 없었다.
- 브랜치를 origin/develop 위로 옮긴 뒤 같은 검사를 다시 실행했다. 모의 DB 버전이 #315의 7과 겹쳐 8로 올렸고 `e2e/restore.e2e.ts`의 단언도 맞췄다.

### 계획 대비 변경

M5 계획에는 화자 지정 단계가 없었다. 수동 업로드에 AI 화자 분리와 PM 지정 단계가 생겨(#255, #266) 이번 지시로 화면과 상태를 추가했다. 처리 추적의 「정리 중일 때만 polling」 규칙에 대기 상태 30초 polling을 더했다. 이유와 대안은 [결정 기록](basis-for-decision/2026-11-05-speaker-assignment-screen.md)에 있다.

### 남은 작업과 제한 사항

- 실서버 연동은 검증하지 않았다. 화자 조회·제출·원본 재생과 m4a 원본의 재생 시각 어긋남(#342)을 실서버에서 확인해야 한다.
- 후보를 참석자로 제한하지 않는다는 FE 결정을 #256에 답하고 BE 확인을 받아야 한다. BE가 제출을 참석자로 제한하면 「다른 팀원」 묶음을 지운다.
- 다른 화면 토스트는 브라우저 여정 없이 Vitest로만 확인했다.
- 전체 단위 테스트와 E2E 전체는 실행하지 않았다.

### 관련 기록

- [화자 지정 화면 결정](basis-for-decision/2026-11-05-speaker-assignment-screen.md)
- [대표 계약 §2.3.1](../../contracts/frontend-api-contract.md#231-업로드-회의-화자-지정--pm-경로-266)
- [이슈 #256](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/256), [이슈 #342](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/342)

## 2026-11-07 추가 결과: 참석자 줄 깜빡임 원인과 재는 칸 가로 넘침 (#490)

### 작업 근거와 요약

#490 은 회의 상세 참석자 줄(UX1-M03)이 1440px·20명에서 맞는 상태를 그린 직후 칩 하나가 잠깐 빠졌다 돌아온다는 보고다. #486 의 E2E 가 develop 에서 10번 중 2번 이 순간을 읽었다. 원인을 먼저 찾았고, 칩 수 계산에는 원인이 없었다. 조사 중 같은 컴포넌트의 실제 결함(숨은 재는 칸의 가로 넘침)을 찾아 고쳤다. M5 계획과 완료조건 원문은 고치지 않았다.

### 원인

- 창 폭이 1280px 경계를 처음 넘을 때 Chromium 이 NanumSquare `@font-face` 를 다시 등록한다. 개발 서버에서는 이때 글꼴 파일을 다시 받아 오고, 받는 약 50ms 동안 페이지 전체 글자가 대체 글꼴로 그려진다. 참석자 줄은 넓어진 칩 폭을 맞게 재서 한 칩을 덜 보이고, 글꼴이 돌아오면 다시 한 칩을 더 보인다.
- 근거: 프레임별 기록에서 1024 → 1440 을 10/10 회 7 → 11 → 12 로 지났다. 11 인 동안 `document.fonts.status` 는 `loading` 이었고, 재는 칸과 화면의 첫 칩 폭이 모두 76.08px 에서 81.73px 로 바뀌었다. 같은 순간 `NanumSquare-Bold.woff2`·`NanumSquare-Regular.woff2` 를 다시 요청했다. 경계를 넘지 않는 1024 → 1200 에서는 생기지 않았다.
- 회의 화면과 무관하다. 로그인 화면에서 같은 크기 바꾸기를 하면 개발 서버는 3/3 회 대체 글꼴 프레임이 보였다. 운영 빌드(`vite build` + `vite preview`)는 0/3 회였다. 운영 빌드는 MSW 가 돌지 않아 회의 화면 대신 로그인 화면으로 보았다.
- 칩 수를 글꼴을 받는 동안 붙잡으면 넓어진 칩이 줄 밖으로 잘린다. 이것은 잘림을 숨기는 우회라 하지 않았다. 개발 서버의 글꼴 재등록은 운영에서 재현되지 않아 이번 범위에서 고치지 않았다.

### 실제 구현 및 관련 코드

- [참석자 줄](../../../src/widgets/meeting-minutes/ui/AttendeeRow.tsx)의 숨은 재는 칸이 `inset-0` 을 썼다. tokens.css 가 간격 스케일을 꺼서 이 유틸은 생성되지 않는다(Modal 과 같은 까닭, [M4 결정](../m4/basis-for-decision/2026-09-29-modal-inset-zero.md)). 그래서 재는 칸이 줄 폭이 아니라 칩 전체 길이(20명이면 1720px)만큼 넓었고 페이지가 가로로 스크롤됐다. 1440px·20명에서 624px, 360px·20명에서 1704px 였다. `inset-[0px]` 로 바꿔 1440px 에서 0px 가 되었다. 칩 수는 12 그대로다.
- [E2E](../../../e2e/meeting-skeleton.e2e.ts)에 두 단언을 더했다. 1·4·10·20명 × 1024·1440·1920px 마다 페이지 가로 스크롤이 없는지 본다. 1440px·20명으로 바로 들어가 참석자 줄이 처음 그려진 뒤 1초 동안 프레임마다, 그리고 칩 class 가 바뀔 때마다 보이는 칩 수를 적어 한 값뿐인지 본다. #486 의 두 번 읽기 단언에는 위 원인을 주석으로 남겼다.

### 검증 내역

실행일은 2026-11-07, Node v24.11.0 이다. 모두 `frontend/` 에서 실행했다.

- 고치기 전 E2E `참석자 1·4·10·20명 × …` 는 가로 스크롤 178px 로 실패했다. 고친 뒤 참석자 묶음 6개가 통과했다. `meeting-skeleton`·`meeting-layout`·`layout` E2E 58개가 통과했다.
- 새 칩 수 단언은 `--repeat-each=10` 으로 10/10 통과했다. 첫 그리기 전 재기를 일부러 빼면 첫 기록이 20(모두 보임)이라 실패하는 것도 확인했다.
- `src/widgets/meeting-minutes` Vitest 6개 파일 39개가 통과했다. jsdom 은 배치를 하지 않아 이번 원인(CSS 유틸 생성, 글꼴 교체)은 단위 테스트로 잡을 수 없어 단위 테스트는 더하지 않았다.
- 전체 게이트 결과는 PR 본문에 적는다.

### 남은 작업과 제한 사항

- 360·390px 의 칩 계산은 지금 develop 에서 볼 수 없다. 768px 미만 회의 화면의 본문 칸이 52·82px 로 눌려 참석자 줄 폭이 0·10px 이고 `+N` 만 남는다. #478 PR2a 뒤에 다시 봐야 한다.
- 개발 서버에서 1280px 경계를 처음 넘을 때의 글꼴 재등록은 그대로다. #486 의 두 번 읽기 단언이 이 순간을 견딘다.
- 생성되지 않는 `*-0` 유틸이 다른 파일에 남아 있다(`min-w-0` 다섯 파일 여덟 곳, `px-0` 한 곳). 별도 과제다.

### 관련 기록

- [이슈 #490](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/490)
- [회의록 로딩 자리 결정](basis-for-decision/2026-10-06-minutes-skeleton-and-selection.md)
