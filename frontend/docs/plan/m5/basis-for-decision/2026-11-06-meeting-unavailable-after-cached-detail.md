# 받아 둔 회의 상세 뒤 403·404 — 볼 수 없는 회의로 바꾸기 (#405)

- 기록일: 2026-11-06
- 관련 마일스톤: 마일스톤 밖 이슈 작업(#405). 회의 화면은 M5, 대시보드 최근 반영은 M7의 화면이다. 결과는 [#405 결과](../work-items/405-meeting-unavailable/result.md)에 있다.

## 문제와 제약

- 회의 화면이 상세(`GET /meetings/{id}`)를 받은 뒤 다시 받을 때 403·404가 오면, TanStack Query는 실패해도 이전 `data`를 남긴다. 화면이 그릴 상세를 고르는 `viewableMeeting`은 다른 공간 응답(`WORKSPACE_MISMATCH`, #349)만 걸러 냈다. 그래서 처리 화면, 화자 지정 화면, 회의록 본문, 대시보드가 받아 둔 회의를 계속 그렸다.
- 처리 추적기(`trackerOutcome`)는 같은 상황을 이미 `lost`로 보고 polling을 멈춘다. 처리 화면만 마지막 「정리하고 있어요」를 안내 없이 계속 보였다. 고치기 전 코드에서 테스트로 재현했다(결과 문서의 재현 절).
- 처리 화면에는 일시적 실패 정책(U4-8)이 있다. 받아 둔 상태가 있는데 다시 받기가 실패하면 마지막 상태를 두고 다음 polling·연결 복귀를 기다린다. 네트워크 오류일 때는 연결이 불안정하다는 안내도 보인다. 이 정책은 그대로 두어야 한다.
- 레이어 방향은 `app → pages → widgets → features → entities → shared`다. `viewableMeeting`은 `entities/meeting`에, 403·404 판정 `isAccessLost`·`isMeetingUnavailable`은 `features/meeting-processing`에 있었다. 엔티티가 feature를 가져올 수 없다.
- 대시보드 최근 반영의 동작은 제품 결정이었다. 사용자 결정(2026-11-05, 관리 세션 기록 1절)을 따른다.

## 실제 검토한 선택지

1. 판정 위치
   - `isAccessLost`·`isMeetingUnavailable`을 `entities/meeting`으로 옮기고 feature와 화면이 엔티티에서 가져온다.
   - 화면마다 `viewableMeeting` 결과에 feature 판정을 덧붙인다. 화면 다섯 곳이 같은 조건을 따로 가지게 된다.
2. 403·404와 U4-8의 경계
   - 403·404는 「다시 물어도 같은 답」이라 일시적 실패가 아니다. 받아 둔 상태를 버린다.
   - 403·404도 받아 둔 상태를 두고 다음 polling을 기다린다. 추적기는 이미 멈춰 다음 polling이 없다.
3. 대시보드 최근 반영(사용자 결정)
   - 404면 회의 목록을 다시 받아 그다음 완료 회의를 보이고, 403이면 다른 공간 응답과 같은 오류 카드를 보인다(고름).
   - 403·404 모두 오류 카드로 통일한다(버림). 지워진 회의면 화면을 다시 열 때까지 카드가 오류로 남는다.
   - 카드를 숨긴다(버림). 왜 사라졌는지 알 수 없다.

## 선택과 이유

- 판정은 [meetingQueries.ts](../../../../src/entities/meeting/api/meetingQueries.ts)에 둔다. `isAccessLost`(403·404), `isMeetingUnavailable`(403·404 + 다른 공간), `isMeetingGone`(404)을 엔티티가 내보내고, `viewableMeeting`이 `isMeetingUnavailable`로 거른다. 처리 추적기와 화면은 엔티티에서 가져온다. feature의 같은 이름 내보내기는 지웠다. 판정이 한 곳이라 화면 다섯 곳이 같은 규칙을 따른다.
- 하위 조회도 같은 규칙이다. 회의록 본문(`minutesQueryOptions`)과 화자 목록(`speakerViewQueryOptions`)이 403·404를 받으면 받아 둔 값을 쓰지 않고 「이 회의를 볼 수 없어요」를 보인다. 처음부터 403·404인 경우의 문구와 같다.
- 경계는 이렇다. 403·404·다른 공간 응답은 볼 수 없는 회의로 바꾼다. `viewableMeeting`이 먼저 걸러 내므로 처리 화면의 정리 중 그리기까지 오지 않는다. 그 밖의 재조회 실패(네트워크 오류, 재시도 대상인 408·5xx, 그 밖의 HTTP 오류)에는 받아 둔 상태를 그대로 둔다. 연결 불안정 안내(`stale`)는 네트워크 오류(`kind: 'network'`)일 때만 보인다. 이 경계를 [MeetingProcessingPage.tsx](../../../../src/pages/meeting-processing/ui/MeetingProcessingPage.tsx)의 주석에 적었다. 재시도 판정은 [queryClient.ts](../../../../src/shared/api/queryClient.ts)의 `isRetryableError`, 추적기 판정은 [trackerOutcome.ts](../../../../src/features/meeting-processing/model/trackerOutcome.ts)다.
- 대시보드는 404 받은 회의 ID를 기억하고 최신 완료 회의를 고를 때 뺀다(`latestDoneMeeting`의 `excluded`). 그리고 회의 목록을 무효화해 다시 받는다. 다시 받은 목록에 그 회의가 남아 있어도 화면이 떠 있는 동안 같은 상세를 다시 묻지 않는다. 처음부터 404인 경우도 같은 규칙이다.
- 빼는 것은 화면이 뜬 뒤 그 화면이 받은 404뿐이다(TanStack Query `isFetchedAfterMount`). 캐시에 남은 지난 404는 쓰지 않고 다시 물어 확인하며, 그동안 최근 반영은 불러오는 중이다. 처음에는 404를 렌더 중에 바로 뺐는데, 정상 상세와 404가 함께 캐시에 남은 회의가 26개 이상이고 목록 갱신도 실패한 채 다시 들어오면 한 렌더에서 잇달아 빼다 React 렌더 한도(`Too many re-renders`)를 넘었다(독립 리뷰 지적, `dashboard.test.tsx`의 `#405 리뷰` 테스트로 재현). 지금은 한 번 빼는 데 그 화면의 요청 한 번이 들어 한 렌더에서 잇달아 빠지지 않는다. 같은 까닭으로 지난 방문에 404였다가 회복된 회의는 다시 들어오면 다시 보인다. 제목 아래 안내(`MeetingLead`)도 같은 선택(`recent.meeting`)을 쓴다. 완료 회의가 모두 404면 「아직 정리한 회의가 없어요」다. 403은 `isMeetingUnavailable`로 오류 카드가 된다.

## 장단점과 감수한 제약

- 404 받은 회의 ID는 대시보드 화면이 떠 있는 동안 기억한다. 같은 ID의 회의가 다시 생기는 경우는 없다고 보고 지우지 않는다. 화면을 다시 열면 비워지고, 캐시에 남은 404는 한 번씩 다시 묻는다. 그래서 다시 들어올 때 지워진 회의 수만큼 상세 요청이 차례로 나간다.
- 403은 보통 공간에서 빠진 경우라 태스크·팀원·회의 목록도 함께 403이 된다. 최근 반영만 다르게 다루지 않는다.
- 회의록 본문의 404는 회의가 지워진 경우와 같이 본다. 이미 처음부터 404일 때 같은 문구였다.

## 영향 범위와 재검토 조건

- 처리 화면, 화자 지정 화면, 회의록 본문·선택, 대시보드 최근 반영이 함께 따른다. 처리 추적기의 판정은 그대로다.
- 서버가 403·404 외의 코드로 「볼 수 없음」을 알리게 되거나, 404가 일시적인 상태(예: 복제 지연)를 뜻하게 되면 다시 본다.

## 근거와 관련 문서

- 이슈 [#405](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/405), 앞선 작업 PR [#402](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/402)(#349).
- [처리 추적기 결정](2026-10-03-processing-tracker.md)의 일시적 오류(U4-8).
- 테스트: `src/app/meetingProcessing.test.tsx`, `meetingMinutes.test.tsx`, `meetingSpeakers.test.tsx`, `dashboard.test.tsx`의 `#405` 묶음.
