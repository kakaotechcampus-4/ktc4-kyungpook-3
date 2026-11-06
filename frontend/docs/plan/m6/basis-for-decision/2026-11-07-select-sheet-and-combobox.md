# 휴대폰 시트와 찾기 칸 선택 상자는 목록 부품 하나를 함께 쓴다

- 기록일: 2026-11-07 (관리 세션 결정 2026-11-07)
- 관련 마일스톤: M6 후속, 이슈 #477 (#471 후속)

## 문제와 제약

#471 의 공용 선택 상자(`shared/ui/select`, Radix Select)를 나머지 다섯 자리에 쓰면서 두 가지가 더 필요했다. 시안은 `select-design.html` 3·5절이다(작업 워크트리의 Git 제외 경로 `frontend/.verify/reports/`).

- 폭 560px 아래에서는 아래에서 올라오는 시트로 고른다. 손잡이, 칸 이름 제목, 줄 높이 52px, 바깥 누르기·아래로 끌기로 닫는다.
- 재촉 만들기의 태스크가 8개를 넘으면 목록 위에 찾기 칸을 둔다.

제약은 다음과 같다.

- Radix Select 는 목록 안에 입력을 둘 수 없고, 목록을 시트 모양으로 바꿀 수도 없다.
- develop 과 휴대폰 화면 작업(#478)에 공용 시트가 없다.
- 키보드(↑ ↓ Enter Esc, 글자 이동)·역할(listbox/option, 고른 줄 체크)은 넓은 화면 선택 상자와 같아야 한다.

## 실제 검토한 선택지

| 선택지 | 판단 |
|---|---|
| 시트·찾기 칸마다 따로 목록을 만든다 | 키보드·역할 규칙이 두 벌이 된다 |
| 넓은 화면도 직접 만든 목록으로 바꾼다 | #471 에서 Radix 로 정한 동작(포커스 복귀, 스크롤, 글자 검색)을 다시 만든다. 변경이 커진다 |
| 넓은 화면 Select 는 Radix 그대로, 목록 부품 하나를 시트 Select 와 찾기 칸 선택 상자가 함께 쓴다 | 채택 |

## 선택과 이유

- **폭 판정은 한 곳.** `shared/lib/narrow-viewport` 의 `NARROW_QUERY = '(max-width: 559.98px)'` 와 `useNarrowViewport()`(matchMedia change 구독, matchMedia 가 없으면 넓은 화면). 폭이 경계를 넘으면 다시 그린다.
- **목록 부품 `OptionList`(`shared/ui/select`).** `role="listbox"`/`option`, 짚은 줄은 `aria-activedescendant`, ↑↓ 는 고를 수 없는 줄을 건너뛰고 끝에서 멈춘다, Home·End, Enter·Space 고르기, 1초 안 글자 이어 찾기. 고른 줄은 굵게 + 체크 + `aria-selected`. 줄 이름은 글자만이고 둘째 줄은 `aria-describedby` 다. Radix 줄과 같은 이름으로 읽힌다.
- **모양은 한 벌.** 직접 만든 목록도 Radix 와 같은 `data-highlighted`·`data-state=checked`·`data-disabled` 를 달아 `selectStyles.ts` 의 같은 클래스로 그린다. 트리거도 같은 클래스에서 나온다(`FieldTrigger`, 역할 combobox).
- **시트 `shared/ui/sheet`.** Radix Dialog 위에 모양만 입힌다. 포커스 가둠, Esc, 바깥 누르기, 스크롤 잠금, 트리거로 포커스 복귀는 Radix 가 한다. 아래로 끌어 닫기는 손잡이·제목 자리의 포인터 이벤트로 한다. 80px 넘게 끌면 닫고, 그보다 짧으면 제자리로 돌린다. 줄 하나(52px)보다 길게 잡아 손잡이를 짚다 밀린 것은 닫지 않는다.
- **Select 는 폭에 따라 둘 중 하나를 그린다.** 넓으면 Radix Select, 좁으면 같은 모양의 트리거 + 시트 + `OptionList`. 시트 제목이 필요해서 칸 이름 `label` 을 필수 prop 으로 더했다. 제목 없는 시트가 생기지 않는다.
- **찾기 칸 선택 상자 `Combobox<V>`.** 태스크를 모르는 일반 부품이다. Select 와 같은 값 props 에 찾기 칸 이름과 빈 결과 문구를 받는다. 넓으면 Radix Popover, 좁으면 시트 안에 찾기 칸(`role="combobox"`, `aria-controls`·`aria-activedescendant`·`aria-autocomplete="list"`)과 `OptionList` 를 둔다. 찾기는 줄 글자에 칸 글자가 들어 있는지로 거른다. 몇 줄부터 쓸지는 호출부가 정한다(재촉 만들기는 목록 줄이 8개를 넘을 때).
- **열면 고른 줄이 가운데.** prop 없이 늘 그렇다. 짧은 목록은 스크롤이 없어 차이가 없고, 시각(24줄)처럼 긴 목록은 고른 값 앞뒤가 함께 보인다. Radix 목록은 처음 포커스를 받을 때 한 번만 가운데로 굴린다.

## 장단점과 감수한 제약

- 휴대폰 폭 Select 의 키보드 동작은 직접 만든 코드다. Radix 를 올려도 따라 바뀌지 않는다. 단위 테스트(`Select.test.tsx` 의 휴대폰 폭 절)가 지킨다.
- 시트의 끌어 닫기는 속도를 보지 않고 거리만 본다.
- 열린 Select 가 폭 560 경계를 넘으면(기기 회전) 닫힌 채 새 모양으로 그리고, 포커스만 새 트리거로 돌린다. 열린 상태·짚은 줄까지 넘기지는 않는다. 회전은 드물고, 넘기려면 두 모양의 열림 상태를 바깥으로 꺼내야 한다.
- 휴대폰 폭에서 찾기 칸 선택 상자를 열면 찾기 칸에 포커스가 가서 화면 키보드가 올라온다.
- 휴대폰 폭에서는 Radix 의 숨은 `<select>` 가 없어 `name` 이 폼 전송에 실리지 않는다. 지금 쓰는 곳은 모두 React 상태나 React Hook Form 으로 값을 받는다.

## 영향 범위와 재검토 조건

- 쓰는 곳: 승인 확인(E-6)·승인 카드 담당자, 태스크 상세(E-5) 담당자, 수정 제안 상태, 재촉 만들기 받는 사람·태스크, 설정 재촉 며칠 전·보낼 시각.
- #478 이 공용 시트 규칙을 따로 정하면 `shared/ui/sheet` 를 그 규칙에 맞춘다.
- 다른 화면에 찾기 칸이 필요하면 `Combobox` 를 쓰고 기준 줄 수는 그 화면이 정한다.

## 근거와 관련 문서

- 이슈 #477 본문, 관리 세션 브리프(2026-11-07)
- [선택 상자를 Radix Select 위에 만든 결정](2026-11-07-shared-select-on-radix.md)
- 코드: `src/shared/ui/select/`, `src/shared/ui/sheet/Sheet.tsx`, `src/shared/lib/narrow-viewport/`
