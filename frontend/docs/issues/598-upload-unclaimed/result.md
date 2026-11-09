# #598 가져가지 않은 업로드의 만료 이력과 안내

## 작업 근거와 요약

#598을 근거로 한 마일스톤 계획 밖 이슈 작업이다. BE #567(#563)은 24시간 동안 AI 가 가져가지 않은 수동 업로드를 `failed_stage=upload_unclaimed`로 끝내고 회의 목록에 남긴다. FE 는 이 실패를 목록에서 빼고 일반 실패 안내만 보였다. 이 작업은 목록·상세·처리 화면·토스트가 사유를 보이고 다시 올리기 경로를 주게 한다. 보존 기간·삭제 정책·복구 기능은 바꾸지 않았다. 전체 계획과 마일스톤 완료 상태도 바꾸지 않았다.

## 실제 구현

| 사용자에게 보이는 것 | 코드 |
|---|---|
| 실패 사유별 제목·설명·다시 올리기 여부·목록 배지를 한 표로 둔다. `upload_unclaimed` 항목을 더하고 읽는 곳이 없던 `kind` 를 지웠다 | `src/entities/meeting/lib/meetingFailure.ts` |
| 수동 업로드 실패 중 배지가 있는 사유(화자 지정·정리 시작 만료)만 「기한 만료」 묶음에 남긴다 | `src/entities/meeting/lib/minutesList.ts` |
| 묶음 이름을 「기한 만료」로, 행 배지를 사유별로, 회의록이 없을 때 빈 상태 제목을 「기한이 지나 정리가 종료된 회의가 있어요」로 바꿨다 | `src/widgets/meeting-minutes/ui/MeetingMinutes.tsx` |
| 처리 추적기가 `upload_unclaimed` 도 목록 캐시에 남기고 처리 화면을 보던 사용자를 그 회의 상세로 옮긴다. 전에는 `kind === 'expired'` 로 갈라 이 사유를 목록에서 빼고 목록 첫 화면으로 보냈을 것이다 | `src/features/meeting-processing/model/useProcessingTracker.ts` |
| MSW 목록 조건을 BE `list_workspace_meetings` 와 같게, 업로드 뒤 첫 조회에 `upload_unclaimed` 로 끝나는 흐름 `fail-unclaimed` 와 시나리오 `meeting-fail-unclaimed` | `src/shared/mock/handlers/meeting.ts`, `db.ts`, `meetingFlow.ts`, `scenarios.ts`, `e2e/support.ts` |

상세·처리 화면·화자 지정 화면·토스트는 모두 `meetingFailure` 를 읽으므로 새 항목 하나로 같은 문구를 보인다. PM 은 「다시 업로드」 링크를, 팀원은 기존처럼 「PM에게 파일 재업로드를 요청해 주세요.」를 본다.

응답 검증(#348, D-184)은 목록·상세의 `failed_stage` 를 `z.string()` 자유 문자열로 받는다(`src/shared/types/api/meeting.ts`). 새 값을 거절하지 않아 스키마는 바꾸지 않았다.

### 문구

기존 `speaker_assignment_expired` 안내의 문체를 따랐다. 2026-11-09 사용자가 이 문구를 그대로 확정했다.

| 자리 | 문구 |
|---|---|
| 상세·처리 화면·화자 지정 화면 제목 | 정리 시작 기한이 지났어요 |
| 같은 화면과 토스트의 설명 | 업로드 뒤 24시간 동안 정리가 시작되지 않아 회의 정리가 종료됐어요. 다시 진행하려면 원본 파일을 다시 올려 주세요. |
| 목록 행 배지 | 정리 시작 기한 만료 |
| 목록 묶음 이름(두 사유 공통) | 기한 만료 |
| 회의록이 없고 만료 이력만 있을 때 빈 상태 제목 | 기한이 지나 정리가 종료된 회의가 있어요 |

BE 는 실패를 저장한 뒤 녹음 정리를 시도하고 오류면 다음 sweep 에서 다시 시도한다. 그래서 문구는 파일이 지워졌다고 말하지 않는다.

## 문서

- [대표 계약](../../contracts/frontend-api-contract.md) §4.4.1 `upload_unclaimed` 행에 FE 구현 사실을 적었다.
- [제품·기술 결정](../../decision/frontend-decisions.md) D-091·D-092·D-093 에 #256 보완과 같은 꼴로 2026-11-09 보완 줄을 더했다. 새 번호는 쓰지 않았다.

## 실제 검증

2026-11-09 Windows, Node 24.11.0, MSW 기준으로 실행했다.

- 바꾼 곳의 18파일 271개 테스트가 통과했다(`npx vitest run <파일들> --maxWorkers=1`). 새 테스트는 목록 필터 표, BE 회귀 표와 같은 MSW 목록 조건 8줄, 다른 공간 격리, 시나리오, 목록·상세 RTL, 처리 화면을 보던 중 만료되면 그 회의 상세로 옮기는 추적기 회귀다.
- 구현 세 파일(`minutesList.ts`, `handlers/meeting.ts`, `useProcessingTracker.ts`)만 이전 코드로 되돌리면 새 테스트 6개가 실패하는 것을 확인했다.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`를 통과했다. build 는 기존 CSS 경고만 냈다.
- `verify-managers-manager` 의 `meetings` 실행(`--grep '⑤|⑦'`)에서 E2E 3개가 통과했다. 새 ⑤-1 은 업로드 → 상세 안내 → 목록 배지 → 새로고침 뒤 선택 유지 → 다시 업로드 이동을 본다. 정리 뒤 포트가 닫혔다.
- 1280·390 폭에서 상세와 목록을 따로 찍었다. 두 폭 모두 가로 넘침이 없었다.
- 전체 단위 테스트(`npm run test -- --maxWorkers=1`)는 305파일 3,980개 모두 통과했다.

## 제한과 남은 검증

- MSW 기준이다. 실서버에서 24시간 경과로 생긴 `upload_unclaimed` 회의는 확인하지 않았다.
- 토스트 제목은 `speaker_assignment_expired` 와 같이 일반 실패 제목 「회의를 정리하지 못했어요」이고 설명만 사유별이다. 다시 업로드 링크와 팀원 안내는 상세와 화자 지정 화면에만 있다.
