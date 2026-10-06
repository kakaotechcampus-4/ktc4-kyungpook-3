# 체크박스·세그먼트는 눌러도 면이 바뀌지 않는다

- 날짜: 2026-09-23
- 상태: 결정

## 고민

M2 는 두 컴포넌트에 눌림(`:active`) 면 변화를 넣었다.

| 컴포넌트 | 대상 | 눌린 동안 |
|---|---|---|
| Checkbox | 체크·중간 상태 | 먹 면 `#171717` → `#5A5A5A` (`active:bg-sub`) |
| Segmented | 미선택 항목 | 투명(트랙 `#EDEDED`) → `#FAFAFA` (`active:bg-surface-sunken`) |

둘 다 캔버스 실측이 아니라 **제안**이다. 캔버스에 `:active` 는 0건이다
(`m2-design-tokens.md` §7-5 · §7-7 의 pressed 행, §11 미결 7번).

이슈 #73 (포커스) 작업 중에 갤러리를 브라우저로 본 사용자가, 누르는 순간 면이 번쩍이는 효과가 필요 없다고 판단했다.
포커스 범위 밖이지만 이 PR 에 넣기로 했다.

## 고른 길

**두 클래스를 뺀다.** 누르는 동안에도 면은 누르기 전 그대로다.

```
Checkbox  BOX_SURFACE  − data-[state=checked]:active:bg-sub
                       − data-[state=indeterminate]:active:bg-sub
Segmented ITEM_TONE    − data-[state=off]:active:bg-surface-sunken
```

남긴 것:

- 미체크 체크박스의 테두리 눌림 `data-[state=unchecked]:active:border-ink` 와 hover `data-[state=unchecked]:hover:border-ink`.
  면이 아니라 입력 경계가 먹으로 진해지는 효과라 이번 판단과 상관없다.
- 세그먼트 미선택 항목의 hover `data-[state=off]:hover:text-ink`. 글자만 바뀐다.
- 포커스 클래스 전부 (`2026-09-23-focus-outline-over-border.md`). Button 등 다른 컴포넌트의 pressed.

## 왜

- **사용자 판단이다.** 짧게 누를 때 면이 회색·흰색으로 한 번 번쩍이는 것이 피드백이라기보다 깜빡임으로 보였다.
  체크박스는 누르면 바로 체크 표식이 바뀌고, 세그먼트는 손잡이가 옮겨 간다 — 결과 자체가 피드백이다.
- **원래 값에 근거가 없다.** 둘 다 "`:active` 실측 0건"을 적고 넣은 제안이라, 빼도 시안과 어긋나지 않는다.

## 다시 고민할 때

pressed 가 그려진 아트보드가 생기면 그 값을 따른다.
§11 미결 7번(모든 컴포넌트의 pressed)은 Button·SelectCard 가 남아 있어 닫지 않았다. 그쪽을 정할 때 이 결정과 맞춘다.
