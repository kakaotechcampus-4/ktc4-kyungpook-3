# 결과 — 받아 둔 회의 상세 뒤 403·404를 볼 수 없는 회의로 (#405)

- 기록일: 2026-11-06
- 대상: [#405](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/405)의 세부 작업 5개
- 기준: develop `bd44cec6`. PR은 아직 만들지 않았다.
- 상태: **세부 작업 5개를 반영했다.** MSW 기준으로 검증했고, 실서버는 미검증이다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #405이고, #349(PR #402)가 다른 공간 응답만 다루고 남긴 후속이다. 회의 화면이 상세를 한 번 받은 뒤 다시 받기가 403(공간에서 빠짐)·404(회의가 지워짐)면, TanStack Query가 이전 `data`를 남기고 `viewableMeeting`이 다른 공간 응답만 걸러서 받아 둔 회의를 계속 그렸다.

이번 작업으로 처리 화면, 화자 지정 화면, 회의록 본문이 받아 둔 상세가 있어도 403·404를 받으면 처음부터 볼 수 없는 회의와 같은 「이 회의를 볼 수 없어요」로 바뀐다. 대시보드 최근 반영은 사용자 결정(2026-11-05)대로 404면 다음 완료 회의로 넘어가고, 403이면 오류 카드다.

## 재현(고치기 전)

처리 화면이 「정리 중」에 멈추는지 먼저 확인했다. 이슈에는 코드를 읽고 추정했다고 적혀 있었다.

- 방법: `meetingProcessing.test.tsx`의 `#405` 테스트. 처리 화면(`mt_10`, 정리 중)을 연 뒤 상세 응답을 403 또는 404로 바꾸고 polling 간격(3초)을 민다.
- 고치기 전 결과: 상세 요청이 2번으로 끝나고 추적 목록이 비었다(추적기 `lost`, polling 멈춤). 그런데 화면은 제목 「정리하고 있어요」와 상태 안내 「1 / 3 단계 완료 · 음성을 텍스트로 옮기기 진행 중」을 그대로 보였다. 안내도 없었다. 403·404 둘 다 같다.
- 결론: 추정이 맞았다. 추적기는 멈췄는데 화면은 마지막 정리 중 상태에 멈춘다.

## 실제 구현 및 관련 코드

- [meetingQueries.ts](../../../src/entities/meeting/api/meetingQueries.ts)
  - `isAccessLost`(403·404)와 `isMeetingUnavailable`(403·404 + 다른 공간)을 `features/meeting-processing`에서 회의 엔티티로 옮겼다. 엔티티의 `viewableMeeting`이 feature를 가져올 수 없어서다(레이어 방향).
  - `isMeetingGone`(404)을 더했다. 대시보드가 쓴다.
  - `viewableMeeting`이 `isMeetingUnavailable`로 거른다. 처리·화자 지정·회의록 본문과 선택·대시보드가 함께 따른다.
- [trackerOutcome.ts](../../../src/features/meeting-processing/model/trackerOutcome.ts)는 엔티티의 `isAccessLost`를 쓴다. 판정은 그대로다.
- [MinutesDetail.tsx](../../../src/widgets/meeting-minutes/ui/MinutesDetail.tsx)의 회의록 본문(`minutesQueryOptions`)과 [MeetingSpeakersPage.tsx](../../../src/pages/meeting-speakers/ui/MeetingSpeakersPage.tsx)의 화자 목록(`speakerViewQueryOptions`)은 403·404를 받으면 받아 둔 값을 쓰지 않는다.
- [MeetingProcessingPage.tsx](../../../src/pages/meeting-processing/ui/MeetingProcessingPage.tsx)의 U4-8(네트워크 오류면 마지막 상태 유지)은 그대로다. 403·404는 일시적 실패가 아니라는 경계를 주석에 적었다.
- [useDashboardData.ts](../../../src/widgets/dashboard/model/useDashboardData.ts)와 [dashboard.ts](../../../src/widgets/dashboard/lib/dashboard.ts)
  - 최신 완료 회의의 상세가 404면 그 ID를 기억해 `latestDoneMeeting(meetings, excluded)`에서 빼고, 회의 목록을 무효화해 다시 받는다.
  - 다시 받은 목록에 그 회의가 남아 있어도 같은 상세를 다시 묻지 않는다. 처음부터 404인 경우도 같다.
  - 제목 아래 안내(`MeetingLead`)는 같은 `recent.meeting`을 쓴다. 완료 회의가 모두 404면 「아직 정리한 회의가 없어요」다.
  - 403은 다른 공간 응답과 같이 「최근 반영을 불러오지 못했어요」 오류 카드다.
- [API 계약](../../contracts/frontend-api-contract.md)의 캐시 행에 403·404 처리를 더했다. 서버 규약은 바뀌지 않았다.
- 결정 기록: [받아 둔 회의 상세 뒤 403·404](../../plan/m5/basis-for-decision/2026-11-06-meeting-unavailable-after-cached-detail.md).

## 완료조건 확인

| 이슈 #405의 세부 작업 | 상태 | 근거 |
|---|---|---|
| `viewableMeeting`을 `isMeetingUnavailable`로 넓힌다. U4-8은 두고 경계를 주석·결정 기록에 남긴다. 판정 위치를 레이어 방향에 맞게 정한다 | 충족(MSW) | 판정을 `entities/meeting`으로 옮겼다. `meetingApi.test.ts`의 `viewableMeeting` 테스트가 403·404는 null, 네트워크 오류는 받아 둔 상세를 확인한다 |
| 하위 조회(회의록 본문, 화자 목록)를 맞춘다 | 충족(MSW) | `meetingMinutes.test.tsx`·`meetingSpeakers.test.tsx`의 `#405` 테스트 |
| 대시보드 최근 반영의 동작을 정한다 | 정함, 충족(MSW) | 사용자 결정. `dashboard.test.tsx`의 `#405` 테스트 4개(받아 둔 뒤 404 → 다음 회의, 연속 404, 모두 404 → 빈 상태, 403 → 오류 카드)와 `dashboard.test.ts`의 `excluded` 테스트 |
| 화면마다 받아 둔 상세가 있는 상태의 403·404 테스트를 더하고, 고치기 전 실패를 확인한다 | 충족 | 테스트 커밋 `c4b8ec73`. 고치기 전 14개 모두 실패, 고친 뒤 14개 통과 |
| 처리 화면이 「정리 중」에 멈추는지 먼저 재현한다 | 재현함 | 위 재현 절 |

## 검증 내역

| 시점 | 명령·범위 | 결과 |
|---|---|---|
| 고치기 전 | `npx vitest run src/app/{meetingProcessing,meetingMinutes,meetingSpeakers,dashboard}.test.tsx -t "#405" --maxWorkers=1` | 14개 실패(14 failed, 156 skipped) |
| 고친 뒤 | 같은 명령 | 14개 통과 |
| 고친 뒤 | 바꾼 영역의 테스트 24개 파일(`--maxWorkers=1`) | 345개 통과 |
| 커밋 전 | `npm run typecheck`, `npm run build` | 통과 |
| 커밋 전 | `npm run lint` | git에서 제외한 로컬 검증 스크립트 `.verify/405-browser.cjs`만 걸렸다(`process` 미정의). `.verify`를 뺀 `eslint .`는 통과 |
| 커밋 전 | `npm run format:check` | git에서 제외한 `.verify/` 파일만 걸렸다. 그 밖은 통과 |
| 커밋 전 | `npm run test -- --maxWorkers=1` | 222개 파일, 2,647개 테스트 통과 |
| 커밋 전 | MSW 모드 Vite와 Playwright Chromium(로컬 스크립트) | 8개 경로 통과. 처리 화면 polling 403·404, 회의록 상세 403·404, 화자 지정 상세 403·404, 대시보드 404(회의를 지운 뒤 다음 회의 「채팅 2026-09-11」과 그 항목 「배포 스크립트」로 넘어감, 상세 요청 `mt_09` 404 → `mt_08` → 추출 `ex_02`), 대시보드 403(오류 카드). 콘솔 오류는 일부러 넣은 403·404 응답 한 건씩뿐이다 |

## 계획 대비 변경

계획 문서가 없는 작업이라 이슈 요청과 비교한다.

- 대시보드는 이슈의 두 안(오류 상태, 건너뛰기)이 아니라 사용자가 정한 절충을 따랐다. 404는 건너뛰고 403은 오류 카드다.
- `isMeetingGone`(404)을 새로 더했다. 대시보드가 404와 403을 다르게 다뤄야 해서다.
- 회의록 선택(`useShownMeeting`)은 `viewableMeeting`을 따라가지만 보이는 동작이 바뀌지 않아 따로 테스트를 더하지 않았다. 받아 둔 상세 뒤 403·404면 「그릴 수 있음」 판정이 그대로 참이다.

## 남은 작업과 제한 사항

- 실서버의 403·404 응답으로는 확인하지 않았다.
- 대시보드는 404 받은 회의 ID를 화면이 떠 있는 동안 기억한다. 화면을 다시 열면 비워진다.
- 회의록 본문을 이전 회의로 들고 있는 동안(회의를 바꾸는 중) 그 본문이 403·404를 받으면 본문 대신 뼈대를 보인다. 고른 회의로 넘어가면 그 회의의 상태를 그린다.
