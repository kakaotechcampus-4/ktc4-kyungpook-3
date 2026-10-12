# 필드 오류 문구를 `role="alert"` 로 알릴 것인가, 입력의 설명으로만 읽힐 것인가

- 날짜: 2026-09-29
- 상태: 결정

## 고민

M2 의 `ErrorText` 는 `<p role="alert" id={errorId}>` 였고, `TextField` 는 입력에 `aria-invalid` + `aria-describedby={errorId}` 를 잇는다.
둘을 같이 쓰면 오류가 나타나거나 바뀔 때 alert 로 한 번, 포커스가 입력에 있으면 설명으로 또 한 번 읽힐 수 있다.
`onTouched` + `reValidateMode: 'onChange'`(D-142)라 입력하는 동안 문구가 자주 바뀌어 더 잦다. 둘 중 하나만 남긴다.

## 고른 길

**`aria-describedby` 만 남기고 `ErrorText` 에서 `role="alert"` 를 뺀다.**

- 제출하면 첫 오류 칸으로 포커스가 간다(`shouldFocusError`, D-142). 스크린 리더는 라벨 · 값 · "잘못됨"(`aria-invalid`) · 설명(오류 문구)을 한 번 읽는다.
- 칸을 떠나며 난 오류는 그 칸으로 돌아오면 읽힌다.
- 비필드 서버 오류(`FormErrorPanel`)와 조회 실패(`QueryErrorState`)는 `role="alert"` 그대로다 — 가리키는 입력이 없어서 달리 알릴 길이 없다.

## 왜

- 필드 오류는 입력의 속성이다. ARIA APG 와 GOV.UK 오류 패턴이 권하는 형태가 `aria-invalid` + `aria-describedby` 에
  "제출 시 첫 오류로 포커스" 다. alert 를 겹치면 같은 문구가 두 번 읽힌다.
- 반대로 alert 만 남기면 입력에서 설명이 끊겨, 포커스를 옮겨 다니는 사용자는 어느 칸의 오류인지 다시 들을 수 없다.
- 비밀번호 칸처럼 설명(`8자 이상, 숫자 포함`)과 오류가 함께 있을 때도 `aria-describedby` 가 둘을 순서대로 읽는다.

## 다시 고민할 때

- 입력하는 동안(onChange 재검증) 바뀐 문구를 바로 들려줘야 한다는 요구가 생기면, 필드마다가 아니라 폼에 `aria-live="polite"`
  요약 영역 하나를 두는 쪽을 먼저 본다.
