# 결과 — 채팅 출처 회의 표시 (#379)

- 기록일: 2026-11-05
- 대상: [#379](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/379)의 프론트엔드 요청 4개와 '확인할 것' 2개
- PR: [#386](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/386) (병합 2026-11-05, 병합 커밋 `61730e72`)
- 상태: **요청 4개를 모두 반영했다.** MSW 기준으로 검증했고, 실서버(PR #378 병합 뒤 BE가 `chat`을 내리는 환경)는 미검증이다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #379의 프론트엔드 요청이다. AI가 매일 09:00(KST)에 디스코드 채팅을 읽어 `source: "chat"` 회의 하나로 올린다(#378). 이전 FE는 모르는 source를 `'discord'`로 바꿔서 채팅 회의가 음성 회의로 보였다. 첫 메시지부터 마지막 메시지까지의 기간(수십 시간)도 회의 길이와 `mm:ss`로 찍혔다.

이번 작업으로 채팅 회의는 회의록 목록에서 `채팅` 배지로 구분된다. 회의록 머리, 전사문, 근거 시각은 실제 메시지 작성 시각으로 보인다. 녹음 회의(`discord`, `manual_upload`)의 표시는 바뀌지 않았다.

## 실제 구현 및 관련 코드

- `MeetingSource`에 `'chat'`을 더했다. 회의와 회의록 mapper가 이 값을 받는다. 모르는 값의 대체값 `'discord'`는 그대로다. 코드는 [common.ts](../../../src/shared/types/common.ts), [meeting mapper](../../../src/entities/meeting/model/mapper.ts), [minutes mapper](../../../src/entities/minutes/model/mapper.ts)에 있다.
- [sourceTraits.ts](../../../src/entities/meeting/model/sourceTraits.ts)에 source마다 시간 축(`recording`, `wall_clock`)과 처리 화면 여부를 두는 표 `MEETING_SOURCE_TRAITS`를 새로 뒀다. 화면은 `source === 'chat'` 조건 대신 이 표를 읽는다.
- [format.ts](../../../src/widgets/meeting-minutes/lib/format.ts)는 시간 축에 따라 표시를 고른다.
  - 목록 한 줄 메타는 채팅 회의에서 길이를 뺀다(`09/11 09:12 · 3명`).
  - 회의록 머리는 서울 시각 범위로 보인다(`2026-09-11 09:12 ~ 09/12 08:40`, 같은 날이면 `~ 18:40`).
  - 전사문 줄과 근거 시각은 `formatMoment`가 정한다. 녹음 회의는 `mm:ss`, 채팅 회의는 `started_at + at_ms`를 `MM/DD HH:mm`로 보인다.
  - 출처 칩은 `Discord 채팅`, 목록 배지는 `채팅`이다.
- [MeetingMinutes.tsx](../../../src/widgets/meeting-minutes/ui/MeetingMinutes.tsx)는 제목 옆에 배지를 단다. 정리 중인 채팅 회의는 처리 화면으로 잇지 않는다. 처리 화면의 단계가 녹음 기준이라서다.
- [MinutesBody.tsx](../../../src/widgets/meeting-minutes/ui/MinutesBody.tsx)와 [MinutesDetail.tsx](../../../src/widgets/meeting-minutes/ui/MinutesDetail.tsx)는 시각 함수를 받아 전사문과 추출된 일에 쓴다. 전사문 시각 칸은 `w-44`에서 `min-w-44 whitespace-nowrap`이 되어 채팅 회의에서만 글자만큼 넓어진다.
- [Dashboard.tsx](../../../src/widgets/dashboard/ui/Dashboard.tsx)의 최근 회의 안내는 채팅 회의에서 `N분 분량`을 뺀다.
- MSW 목에 정리가 끝난 채팅 회의 `mt_08`(메시지 4개, 추출 1건)을 더했다. 대시보드 빈 회의 시나리오와 자동 회의 없음 시나리오에서는 뺀다. 기본 진입 회의는 그대로 `mt_09`다.

## 완료조건 확인

이슈의 체크 항목을 완료조건으로 대응시켰다.

| 이슈 #379의 조건 | 상태 | 근거 |
|---|---|---|
| `MeetingSource` 타입에 `'chat'`을 더한다 | 충족 | 두 mapper 테스트가 `chat`을 그대로 받는 것을 확인한다 |
| 회의 목록·회의록에서 채팅 회의를 구분해 보여 준다 | 충족(MSW) | `meetingMinutes.test.tsx`의 `채팅 회의 (#379)` 묶음, Playwright Chromium에서 목록 배지 확인 |
| 채팅 회의의 길이·시각 표시를 정한다 | 충족(MSW) | `format.test.ts`(날짜를 넘는 범위, 같은 날, 길이 0, 실제 시각), 회의록 머리·전사문·근거 시각 테스트, 대시보드 안내 테스트 |
| 녹음 재생 UI를 숨긴다 | 해당 없음 | FE에 녹음 재생 UI가 없다. `/meetings/{id}/audio`를 부르는 코드가 0건이다 |
| 확인할 것: 목록에 섞을지 따로 둘지 | 정함 | 같은 목록에 시간순으로 섞고 배지를 단다. 목록이 시간순 타임라인이고, 묶음을 나누면 기본 진입 '최근 회의'의 기준이 둘이 된다 |
| 확인할 것: 길이·근거 시각 표시 | 정함 | 목록은 길이 생략, 머리는 시각 범위, 근거와 전사문은 실제 작성 시각. 목록 요약 응답에 메시지 수가 없고, 오프셋은 수십 시간이 되어 읽을 수 없다 |

## 검증 내역

| 시점 | 명령·범위 | 결과 |
|---|---|---|
| PR 작성 전 | `npm run typecheck`, `npm run lint` (`frontend/`) | 통과 |
| PR 작성 전 | `npx vitest run --maxWorkers=4` | 193개 파일, 2,288개 테스트 통과. 기본 병렬 수에서는 부하로 15개 파일의 워커가 시작되지 않아 병렬 수를 줄였다 |
| PR 작성 전 | MSW 모드 Vite와 Playwright Chromium | 목록 배지, 채팅 회의 머리 범위, 전사문과 근거의 실제 시각, 녹음 회의 표시 유지를 확인. 콘솔 오류 0건 |
| develop 병합 후 | `npm run typecheck`, `npm run lint` | 통과 |
| develop 병합 후 | 전체 vitest | 200개 파일, 2,385개 테스트 통과. 한 파일은 워커 시작 실패로 따로 다시 돌려 8개 통과 |
| develop 병합 후 | `npm run test:storybook`의 `화자 지정 기한 만료` 스토리 | 로컬 3회 통과 |
| 병합 직전 CI | check, build, e2e, storybook (run 41988929037, 커밋 `a4337bea`) | 모두 통과 |

## 계획 대비 변경

계획 문서가 없는 작업이라 이슈 요청과 비교한다.

- develop의 #256이 근거 데이터에 `speaker_member_id`를 필수로 넣어, 병합 뒤 채팅 회의의 추출 픽스처에 `speaker_member_id: 'mb_01'`을 채웠다.
- develop의 #256이 목록 행 진행 상태 처리를 `inProgressStatus`로 바꿔, 채팅 회의의 처리 화면 조건을 그 함수에 합쳤다.
- CI storybook에서 `화자 지정 기한 만료` 스토리가 두 번 실패했다. 원인은 상세 제목만 기다리고 따로 불러오는 회의 목록을 바로 확인한 것이다. `findByRole`로 목록을 기다리게 고쳤다(`a4337bea`). #379 범위 밖의 한 줄 테스트 수정이라 같은 PR에 넣었다.
- MSW 목 DB 버전은 올리지 않았다. 저장 모양이 아니라 픽스처 행만 늘었다. 이전 목 DB가 저장된 개발 화면에서는 `?msw-scenario=`로 시작해야 `mt_08`이 보인다.
- 계약 문서는 PR #378이 갱신하므로 고치지 않았다.

## 남은 작업과 제한 사항

- 승인 카드(대시보드 확인 필요 목록, 승인 검토, 태스크 보드)의 근거 시각은 채팅 회의에서 나온 승인도 여전히 `mm:ss`다. 승인 payload에 회의 source와 시작 시각이 없어서다. 후속 이슈 [#397](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/397)로 남겼다.
- PR #378이 병합되어 BE가 실제로 `chat`을 내리는 환경에서의 화면은 미검증이다. BE가 아직 `chat`을 내리지 않아도 동작은 이전과 같다.
- 채팅 회의의 표시 방식(목록 배치, 길이·시각 표기)은 이슈의 '확인할 것'에 대한 FE의 기본값이다. 팀이 다르게 정하면 바꿔야 한다.

## 관련 기록

- 관련 PR: [#378](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/378)(AI·BE 채팅 회의, 2026-11-05 기준 열림). 후속 이슈: [#397](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/397)
- [MSW 사용 안내](../../msw-guide.md)
