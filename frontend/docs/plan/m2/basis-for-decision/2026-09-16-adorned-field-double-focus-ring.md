# 장식이 붙은 입력은 포커스 링이 두 겹으로 그려진다

- 날짜: 2026-09-16
- 상태: 결정 — outline 포커스를 제거했다

## 무엇

래퍼 `focus-within` outline + 안쪽 input 전역 outline 이 겹쳤다.

## 고른 길

전역 `:focus` / `:focus-visible` 은 `outline: none`.
TextField 래퍼의 `focus-within:outline-*` 도 뺐다.
포커스 표시는 기존 테두리만 남긴다.

## 그 뒤 (2026-09-23)

래퍼가 `has-[input:focus-visible]` 로 outline 을 그리고, 안쪽 input 은 `focus-visible:outline-none` 으로 끈다.
`focus-within` 이 아니라 input 한정이라 장식 안 버튼의 포커스와 겹치지 않는다 — `2026-09-23-focus-outline-over-border.md`.
