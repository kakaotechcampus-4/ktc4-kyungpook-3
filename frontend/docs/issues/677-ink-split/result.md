# 결과 — 먹색을 글자 `#262626`과 면 `#333333`으로 나눈다 (#677)

- 기록일: 2026-11-10
- 대상: [#677](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/677)
- 기준: develop `b800fab6`
- 상태: **반영했다.** 단위(Vitest)와 MSW 개발 서버(Chromium) E2E로 확인했다. 화면 전후 스크린샷 비교는 하지 않았다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #677과 사용자 결정(2026-11-10)이다.

먹색 `#171717`이 거의 검정이라 먹 면 위 흰 글자가 번져 보였다. 먹색 하나를 밝히면 흰 바탕 위 제목과 보조 글자의 위계가 줄어든다. 그래서 주황(`accent` / `accent-solid`)처럼 자리별로 둘로 나눴다. 이유와 버린 안은 [결정 기록](../../plan/m2/basis-for-decision/2026-11-10-ink-split.md)에 있다.

## 실제 구현 및 관련 코드

### 토큰

[tokens.css](../../../src/app/styles/tokens.css)의 글자 절이다.

| 토큰 | 값 | 자리 |
|---|---|---|
| `--color-ink` | `#262626` | 흰 바탕 위 글자, 선, 테두리, 포커스 선. 클래스는 그대로(`text-ink`·`border-ink`·`outline-ink`) |
| `--color-ink-solid` (새로) | `#333333` | 흰 글자나 주황 점을 얹는 면, 칠하는 자리. `bg-ink-solid` 등 |

### 면으로 옮긴 곳

- `src/` 안의 `bg-ink`와 그 변형(`bg-ink/32`, `data-[state=checked]:bg-ink`, `has-[input:checked]:bg-ink`, `aria-checked:bg-ink`, `group-aria-[current=page]:bg-ink`, `data-[lock=quiet]:aria-disabled:bg-ink`, 테스트의 `span.bg-ink` 선택자)을 모두 `ink-solid`로 옮겼다. 43개 파일이다. 주 버튼([Button.tsx](../../../src/shared/ui/button/Button.tsx)), 체크박스, 선택 카드, 모달·시트 가림막, 보드·캘린더·간트의 칩과 막대, 메시지 말풍선, 처리 토스트, 점·진행 막대가 여기에 든다.
- 면을 칠하는 `var(--color-ink)` 두 곳: [global.css](../../../src/app/styles/global.css)의 `::selection` 배경과 [ProcessingToastCard.tsx](../../../src/features/meeting-processing/ui/ProcessingToastCard.tsx)의 진행 줄무늬. `body`·`a`의 글자색과 `:focus-visible` 선은 `ink` 그대로다.
- 직접 적힌 `#171717`: [Mascot.tsx](../../../src/shared/ui/mascot/Mascot.tsx)의 `INK`를 `#333333`으로, [ApprovalCard.tsx](../../../src/widgets/task-board/ui/ApprovalCard.tsx)의 그림자 `#17171733`을 `#33333333`으로 바꿨다.
- [index.html](../../../index.html)의 정적 스플래시: 마스코트 채움을 `#333333`, 워드마크 글자를 `#262626`으로 맞췄다. 정적 스플래시는 `Mascot`의 사본이라 `staticSplash.test.tsx`가 둘이 같기를 요구한다.
- iOS 시작 이미지: [startup-images.mjs](../../../scripts/startup-images.mjs)의 워드마크 글자를 `#262626`으로 바꾸고 `npm run startup-images`로 `public/splash/` 29장을 다시 만들었다. 이 스크립트는 `Mascot.tsx`를 그대로 그리므로, 다시 만들지 않으면 시작 이미지만 옛 색으로 남는다.

### 판단이 필요했던 곳

- 간트의 오늘 선([GanttView.tsx](../../../src/widgets/task-board/ui/GanttView.tsx), `w-px bg-ink`)은 면이 아니라 1px 선이라 `bg-ink`(`#262626`)로 남겼다. `src/`에 남은 `bg-ink`는 이 하나다.
- `bg-ink` 외에 면을 칠하는 먹 유틸 셋도 옮겼다.
  - 프로젝트 맵의 주제 원([GraphView.tsx](../../../src/widgets/project-map/ui/GraphView.tsx)) `fill-ink` → `fill-ink-solid`. 옆의 이름 글자는 `fill-ink` 그대로다.
  - 동의 체크박스([ConsentFields.tsx](../../../src/entities/consent/ui/ConsentFields.tsx)) `accent-ink` → `accent-ink-solid`. 체크한 칸의 면이 이 색이다.
  - 보내는 시점 카드([SendTimingPicker.tsx](../../../src/entities/message-settings/ui/SendTimingPicker.tsx))를 고르면 테두리가 `border-ink`였다. 면과 같은 `border-ink-solid`로 맞췄다. 그대로 두면 `#333333` 면 둘레에 `#262626` 테두리가 한 겹 보인다.

### 테스트

- 클래스를 단언하는 `Button`·`Checkbox`·`Modal`·`SelectCard` 테스트와 `Mascot` 테스트의 색을 새 값으로 맞췄다.
- [task-views-design.e2e.ts](../../../e2e/task-views-design.e2e.ts)의 포커스 선 기대값 두 곳을 `rgb(23, 23, 23)`에서 `rgb(38, 38, 38)`로 바꿨다.
- [color-contrast.e2e.ts](../../../e2e/color-contrast.e2e.ts)는 원래 먹 면 위 흰 글자를 재지 않았다. 강조색 글자, 강조색 면 위 글자, 흐린 글자만 골랐기 때문이다. 재는 면에 `--color-ink-solid`를 더해 먹 면 위 글자도 4.5:1로 잰다.

### 다시 돌릴 수 있는 일괄 변환

`bg-ink` 옮기기와 직접 적힌 값 교체는 노드 스크립트 하나로 했다. 같은 스크립트를 다시 돌리면 `no changes`가 나오고, `--check`로 남은 `bg-ink`와 `#171717`·`rgb(23, 23, 23)`을 찾는다. 스크립트는 커밋하지 않았다.

## 완료조건 확인

| 이슈 #677 세부 작업 | 상태 | 근거 |
|---|---|---|
| `tokens.css`: `ink` `#262626`, `ink-solid` `#333333` 추가 | 충족 | 위 토큰 |
| 면의 `bg-ink`와 변형을 `bg-ink-solid`로, 면을 칠하는 `var(--color-ink)`도 옮긴다 | 충족 | 아래 검사. 간트 오늘 선은 선이라 남겼다 |
| 직접 적힌 `#171717` 정리(마스코트·승인 카드 그림자) | 충족 | 아래 검사. 정적 스플래시와 시작 이미지도 맞췄다 |
| `text-ink`·`border-ink`·`outline-ink`는 그대로 | 충족 | 보내는 시점 카드의 테두리 하나만 면에 맞춰 옮겼다 |
| 대비 E2E가 먹 면 위 흰 글자를 4.5:1로 본다. 포커스 선 기대값 수정 | 충족 | 아래 E2E |
| 디자인 문서와 결정 기록 | 충족 | [design-system.md](../../design/design-system.md) v0.8, [결정 기록](../../plan/m2/basis-for-decision/2026-11-10-ink-split.md) |

## 검증

- 남은 값 검사: 일괄 변환 스크립트의 `--check`가 `src/`·`e2e/`·`index.html`·`startup-images.mjs`에서 `clean: no unswept bg-ink, no #171717 / rgb(23, 23, 23)`을 냈다. 다시 돌린 변환은 `no changes`였다.
- `npm run typecheck`, `npm run lint` 통과. 바뀐 파일의 `prettier --check` 통과.
- `npx vitest run`: 파일 341개, 테스트 4418개 통과. 처음 돌린 때는 Playwright 실행과 겹쳐 앱 통합 테스트 4개가 시간 초과·요소 없음으로 실패했다(`approvals`·`meetingUpload`·`onboardingMembers`·`tasks`). 네 파일만 다시 돌리면 164개 모두 통과했고, 다른 실행 없이 전체를 다시 돌린 결과가 위 숫자다.
- `npx playwright test e2e/color-contrast.e2e.ts e2e/task-views-design.e2e.ts`: 10개 통과.
- 대비 E2E가 먹 면을 실제로 재는지 확인했다. `--color-ink-solid`를 잠시 `#8a8a8a`(흰 글자 3.45:1)로 바꾸면 대비 E2E 5개가 모두 실패했다. `로그인` 버튼, `확인 필요`·`주의` 칩, 간트의 개수 `4`, `정리 중` 알약을 짚었다. 값은 되돌렸다.
- 시작 이미지: `1170x2532.png`의 픽셀을 셌다. 전에는 `#171717`이 59,666개였고, 다시 만든 이미지는 `#171717` 0개, `#333333` 49,928개(마스코트), `#262626` 9,524개(워드마크)다. 스크립트가 찍은 `<link>` 줄은 `index.html`의 줄과 같다.

## 남은 작업과 제한 사항

- 디자인 캔버스(`docs/design/canvas/`)의 시안 HTML은 `#171717` 그대로다. 이슈에서 고치지 않기로 했다. 디자인 문서 머리말의 "캔버스가 실측 원본" 문구와 먹색 값이 어긋난다.
- 면에 `bg-ink`를 새로 쓰는 것을 막는 린트는 없다. 쓰면 `#262626` 면이 된다.
- 먹 면 위 주황 점은 5.76:1에서 4.06:1로 낮아졌다. 글자가 아닌 표식 기준 3:1은 넘는다.
- 다른 문서(`docs/plan`·`docs/decision`·`docs/mascot` 등)에 적힌 옛 `#171717`은 그 시점의 기록이라 고치지 않았다.

## 관련 기록

- [결정 기록](../../plan/m2/basis-for-decision/2026-11-10-ink-split.md), 이전 [브랜드 주황 기록](../../plan/m2/basis-for-decision/2026-11-10-accent-orange.md)
