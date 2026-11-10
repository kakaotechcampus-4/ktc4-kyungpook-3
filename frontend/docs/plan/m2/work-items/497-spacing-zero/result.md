# 결과 — 간격 토큰의 0 (#497)

- 기록일: 2026-11-07
- 대상: [#497](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/497)
- 상태: **할 일을 모두 반영했다.** MSW 개발 서버(Chromium)로 검증했다.

## 작업 근거와 요약

이슈 #497 의 요청으로 `--spacing-0` 이 없어 `*-0` 유틸이 CSS 를 만들지 않던 문제를 뿌리에서 고쳤다. 마일스톤 계획의 완료조건이 아니라 [모달 결정](../../../m4/basis-for-decision/2026-09-29-modal-inset-zero.md#후속-2026-11-07-497)의 후속이다.

## 실제 변경

- `src/app/styles/tokens.css` 에 `--spacing-0: 0px` 를 더했다. 빌드 CSS 를 전후로 비교하니 새로 생긴 선택자는 `inset-0`·`after:inset-0`·`min-w-0`·`px-0`·`top-0`·`bottom-0`·`gap-0`·`m-0`·`p-0` 아홉 개다. 없어진 선택자는 없다.
- 이 중 화면 요소에 붙은 것은 아래 열한 곳이다. `top-0`·`bottom-0`·`gap-0`·`m-0`·`p-0` 은 주석과 문서 글자에서만 나온다(Tailwind 가 docs 도 훑는다).

| 곳 | 클래스 | 360px·1280px 전후 |
|---|---|---|
| `widgets/meeting-minutes/ui/AttendeeRow.tsx:18` 재는 칸 | `inset-0` | 좋아짐. 참석자 20명에서 페이지 가로 넘침 1380px·784px → 0 (#490) |
| `widgets/dashboard/ui/Dashboard.tsx:65` 요약 숫자 링크 | `after:inset-0` | 좋아짐. 누르는 자리가 0×0 에서 요약 항목 전체로 넓어졌다(주석의 의도) |
| `widgets/meeting-minutes/ui/MinutesBody.tsx:137` 전사문 줄 | `min-w-0` | 상자 너비만 바뀜. 띄어 쓰지 않은 긴 URL 이면 줄 상자가 부모 밖으로 365px 나가던 것이 부모 안에 든다. 글자는 전후 모두 넘쳐 보이는 차이는 없다 |
| `widgets/app-shell/ui/AppHeader.tsx:24` 휴대폰 헤더 | `min-w-0` | 1px 차이(321 → 320). 말줄임은 전후 같다 |
| `features/meeting-processing/ui/ProcessingToastCard.tsx:24·145` | `min-w-0` | 바뀌지 않음. `wrap-anywhere` 가 이미 줄을 바꾼다 |
| `widgets/meeting-minutes/ui/MinutesBody.tsx:204·235` 추출된 일 | `min-w-0` | 바뀌지 않음 |
| `shared/ui/select/FieldTrigger.tsx:8` 선택 상자 트리거의 고른 값 | `min-w-0` | 바뀌지 않음. 같은 span 에 `overflow-hidden` 이 있어 자동 최소 폭이 이미 0 이다. 긴 담당자 이름·태스크 제목으로 휴대폰 폭 트리거의 말줄임이 전후 같다 |
| `shared/ui/select/Combobox.tsx:24` 태스크 찾기 칸 | `min-w-0` | 바뀌지 않음. 칸이 입력의 기본 폭보다 넓다(360px 284px, 1280px 542px) |
| `widgets/dashboard/ui/RecentSection.tsx:76` `전체 로그` | `px-0` | 바뀌지 않음 |

- `FieldTrigger.tsx:8`·`Combobox.tsx:24` 는 develop 의 선택 상자 확대(#477)를 merge 하며 들어왔다. `FieldTrigger.tsx:8` 은 전에 `Select.tsx:158` 에 있던 span 이 옮겨 온 것이다.
- 나빠진 곳은 없어 화면 코드는 고치지 않았다. `Modal`·`Sheet`·`GanttView`·`TextField` 의 `inset-[0px]`·`min-w-[0px]` 는 그대로 두고, 그 값이 필요하다고 적은 주석만 지금 사실로 고쳤다.

## 실제 검증

- `src/app/styles/tokens.test.ts` 가 `index.css` 를 Tailwind `compile` 로 직접 빌드해 `*-0` 여섯 개가 `var(--spacing-0)` 로 생기는지 본다. 토큰 줄을 빼면 6개 모두 실패하고, 넣으면 통과한다.
- MSW 개발 서버에서 대시보드·회의록(참석자 20명)·설정·승인 상세를 360px·1280px 로 전후 찍고 각 자리의 크기·넘침·말줄임을 쟀다. 긴 공간 이름·회의 제목·채널 이름·URL 로도 한 번 더 쟀다. merge 뒤에는 긴 담당자 이름과 태스크 12개(띄어 쓰지 않은 긴 제목 포함)로 새 재촉의 받는 사람·태스크 트리거, 태스크 찾기 칸(넓은 화면 목록, 560px 아래 시트), 승인 상세 담당자를 같은 방법으로 쟀다. 원본은 `frontend/.verify/evidence/497/`(커밋하지 않음)이다.

## 한계

- 띄어 쓰지 않은 아주 긴 이름(40자 이상)에서는 대시보드·회의 목록·설정 채널 이름이 360px 에서 가로로 넘친다. 고치기 전과 같은 값이라 이번 변경과 무관하며 따로 다룬다.
- 넓은 화면의 Radix 선택 상자(`Select`)는 띄어 쓰지 않은 긴 이름을 말줄임하지 못하고 트리거 밖으로 넘친다(1280px 새 재촉 받는 사람 32px, 승인 상세 담당자 414px). 토큰 줄의 있고 없음과 merge 전후 모두 같다. 버튼의 flex 항목이 Radix `Select.Value` 의 span 이라 `TriggerValue` 의 `min-w-0` 이 닿지 않는다. 그 span 에 `min-width: 0` 을 주면 말줄임이 돌아오는 것을 확인했다. 따로 다룬다.
- 전체 E2E 는 CI 가 돌린다.
