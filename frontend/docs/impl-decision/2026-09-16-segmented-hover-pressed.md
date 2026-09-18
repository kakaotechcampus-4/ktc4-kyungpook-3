# 세그먼트 hover / pressed — 선택된 손잡이까지 덮을 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

`m2-design-tokens.md` §7-7 은 hover 를 글자 `#171717`, pressed 를 면 `#FAFAFA` 로 **제안**한다.
캔버스에 `:active` 는 0건이고 세그먼트 hover 도 없다.

그대로 옮기면 두 가지가 걸린다.

1. **pressed 면이 선택 손잡이를 덮는다.** 선택 항목은 면이 `#FFFFFF` 다. 여기에 `active:bg-surface-sunken` 을 걸면
   선택된 항목을 누르는 동안 손잡이가 `#FAFAFA` 로 어두워진다. 트랙이 `#EDEDED` 라 "선택이 풀렸나"로 읽힌다.
2. **어느 클래스가 이기는지 모른다.** `data-[state=on]:bg-surface` 와 `active:bg-surface-sunken` 은 둘 다 변형이다.
   생성 CSS 순서가 승자를 정하는데, 그 순서를 코드만 보고 알 수 없다
   (docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md).

## 고른 길

**hover / pressed 를 미선택 항목에만 건다.**

```
data-[state=off]:hover:text-ink
data-[state=off]:active:bg-surface-sunken
```

비활성 항목은 아예 다른 묶음을 쓴다 — `pointer-events-none text-line-strong`.
hover / pressed 변형이 목록에 없으므로 겹칠 것도 없다.

## 왜

세그먼트는 **항상 하나가 선택돼 있는** 컨트롤이다. 선택된 항목을 누르는 동작에는 결과가 없다
(빈 문자열을 무시한다 — §7-7). 결과가 없는 동작에 눌린 피드백을 그리면 "눌렀는데 아무 일도 안 일어난다"가 된다.
미선택 항목에만 걸면 피드백과 결과가 1:1로 맞는다.

`data-[state=off]:` 를 앞에 붙이면 승자를 CSS 순서에 맡기지 않아도 된다.
선택 항목의 class 목록에는 `active:` 규칙이 **아예 적용되지 않는다** — 셀렉터가 매칭되지 않기 때문이다.

## 딸린 것 — 포커스 링은 그대로 둔다

§6-4 가 적어 둔 대로 트랙 `gap` 이 3px 이라 전역 `outline-offset: 4px` 가 이웃 항목을 덮는다.
M2 에서는 **건드리지 않는다.** M4 에서 태스크 화면에 실제로 배치하고 눈으로 보고 정한다.

## 다시 고민할 때

hover / pressed 가 그려진 아트보드가 생기면 그 값으로 바꾼다.
선택 항목에도 눌린 피드백이 필요하다는 말이 나오면, 면이 아니라 글자 한 단(`text-sub`)으로 낸다 — 손잡이 면은 건드리지 않는다.
