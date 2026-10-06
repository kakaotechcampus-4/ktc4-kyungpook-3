# 기본 버튼 hover는 차콜이다

- 날짜: 2026-09-16
- 상태: 결정

## 고민

스펙 제안은 default hover 면 `#E8E8E8` 이다. 기본 면 `#EDEDED` 와 5 단위 차이라 거의 안 바뀐다.
주 버튼 hover는 이미 보조 `#5A5A5A` 다. 시안에 주 버튼 hover는 없다.

## 고른 길

default hover는 `bg-line-strong` (`#C9C9C9`), 글자는 `text-ink` 유지.
컨트롤 면 `#EDEDED` 가 같은 회색 축에서 한 단 진해진 값이다.
차콜(`#666` / `#5A5A5A`) + 흰 글자는 면이 바뀌는 느낌이 나서 버렸다.

primary hover는 먹 면 위라 `bg-dim` 을 유지한다.
outline hover 면은 ghost 와 같은 `bg-control`.

## 다시 고민할 때

시안 `#E8E8E8` 로 되돌릴지는 M4 육안.
