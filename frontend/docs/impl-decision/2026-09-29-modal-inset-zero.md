# 모달 오버레이의 `inset-0` 이 생성되지 않아 화면을 덮지 못했다 — 무엇으로 바꿀 것인가

- 날짜: 2026-09-29
- 상태: 결정

## 고민

M4 E2E(시나리오 ② 전환 중 이탈 확인)에서 `계속 작성하기` 가 "화면 밖(outside of the viewport)"이라 눌리지 않았다.
브라우저에서 재 보니 오버레이가 `position: fixed` 인데 `top/left/right/bottom` 이 없어 문서 흐름 끝(y=900)에 380×165 로 떠 있었다.

원인은 `tokens.css` 의 `--spacing: initial` 이다. 동적 간격 스케일을 꺼서 이름 있는 `--spacing-N` 만 유틸이 된다.
`inset-0` 은 `--spacing-0` 이 없어 **CSS 에 생성되지 않는다.** `2026-09-16-values-outside-token-scale.md` 가 `p-0`·`min-w-0` 에
대해 경고한 것과 같은 함정이다. 빌드·타입·Vitest 는 모두 통과한다 — jsdom 에는 배치가 없다.

`Modal` 을 쓰는 공통 이탈 확인(D-138)은 M2·M3 부터 실제 브라우저에서 화면을 덮지 못하고 있었다.

## 고른 길

`inset-0` 을 `inset-[0px]` 로 바꾼다 — 오버레이(`fixed`)와 스크림(`absolute`) 둘 다.

```ts
const OVERLAY = 'fixed inset-[0px] z-100 flex items-center justify-center p-24'
const SCRIM = 'absolute inset-[0px] cursor-pointer bg-ink/32'
```

- `Modal.test.tsx` 의 클래스 단언을 `inset-[0px]` 로 바꾸고 `inset-0` 이 없음을 함께 본다.
- E2E `select-switch.e2e.ts` 가 모달이 뷰포트 안에 완전히 들어오는지(`toBeInViewport({ ratio: 1 })`)를 본다.
- 코드 전체에 `inset-0`·`top-0` 같은 `*-0` 위치 유틸이 더 없음을 확인했다.

## 왜

- 토큰에 `--spacing-0` 을 더하면 `gap-0`·`p-0` 등도 생겨 "없는 간격은 쓰지 못한다"는 M2 의 스케일 정책이 흔들린다.
- 임의값 `inset-[0px]` 는 그 자리에만 생기고 이름에 값을 드러낸다 — M2 가 `min-w-[0px]` 로 푼 방식과 같다.

## 다시 고민할 때

- 새 위치 유틸을 쓸 때는 `npm run build` 뒤 산출 CSS 에 그 선택자가 있는지 확인한다(`grep -F '.inset-' dist/assets/*.css`).
  배치가 있는 확인은 jsdom 이 아니라 E2E 가 맡는다.
- `--spacing` 스케일 정책을 바꾸게 되면 이 임의값들을 토큰 유틸로 되돌린다.
