# #613 Discord 연결 전 팀원 추가

## 작업 근거와 요약

#613을 근거로 한 마일스톤 계획 밖 이슈 작업이다. Discord 를 연결하지 않은 팀은 팀원을 한 명도 만들 수 없었다. 팀원을 만드는 화면이 Discord 사용자 옆에 이름을 적는 매칭 폼뿐이어서다. 그래서 초대도 할 수 없고, 수동 업로드의 화자 지정 후보도 PM 한 명뿐이었다.

이 작업으로 온보딩 4단계와 팀 화면 `팀원 연결` 창에서 Discord 없이 이름만으로 팀원을 추가한다. 같은 이름은 두 번 추가하지 못한다. Discord 를 연결한 뒤에는 매칭 폼의 이름 칸이 미리 추가한 팀원을 제안한다. 결정은 [D-187](../../decision/frontend-decisions.md)에 적었다. BE 는 바꾸지 않았다. 전체 계획과 마일스톤 완료 상태도 바꾸지 않았다.

## 실제 구현

| 사용자에게 보이는 것 | 코드 |
|---|---|
| 이름 비교 규칙 하나. 앞뒤 공백을 지우고 대소문자는 그대로다. 매칭 폼의 `reusableMember`·`findMappingIssues`·`planRow` 도 이 함수로 비교한다 | `src/entities/member/lib/memberName.ts`, `src/features/member-mapping/model/memberMapping.ts` |
| 이름 추가 칸과 추가한 팀원 목록. 목록을 받기 전에는 `추가` 가 잠긴다. 같은 이름이면 보내지 않고 `이미 같은 이름의 팀원이 있어요.` 를 보인다 | `src/features/member-add/` |
| 온보딩 4단계 미연결 화면에 추가 칸. `건너뛰기` 는 그대로다 | `src/widgets/onboarding/ui/MembersStep.tsx` |
| 팀원 연결 창 미연결 화면 맨 위에 추가 칸. 안내와 `설정에서 Discord 연결하기` 는 그 아래다. 추가한 팀원은 팀 화면 목록에 나타나고 PM 에게 기존 `초대` 버튼이 보인다 | `src/widgets/team/ui/MemberConnectDialog.tsx` |
| 자유 입력에 제안 목록을 붙이는 공용 칸 | `src/shared/ui/select/Autocomplete.tsx` |
| 매칭 폼 이름 칸이 연결 안 된 일반 팀원 이름을 제안한다. PM 과 다른 줄에 적은 이름은 빠진다 | `src/features/member-mapping/model/memberMapping.ts` `suggestedMemberNames`, `ui/MemberMappingFields.tsx` |
| `createMember` 가 취소 신호를 받는다 | `src/entities/member/api/memberMutations.ts` |

목록 캐시에 팀원 하나를 넣는 함수 `upsertMember` 는 매칭 저장과 이름 추가가 함께 쓰도록 `src/entities/member/lib/upsertMember.ts` 로 옮겼다.

### 같은 이름을 막는 방법

서버는 같은 이름을 막지 않는다. FE 는 다음 경우를 막는다.

- 목록을 받기 전: `추가` 를 잠근다. 비교할 목록이 없다.
- 막 만든 팀원이 아직 목록에 없을 때: 응답을 받자마자 목록 캐시에 넣고, 그 뒤 목록을 다시 받는다.
- 같은 틱의 두 번 누름: mutation key 로 진행 중인 추가를 묻고 두 번째를 버린다. 추가는 한 번에 하나다.
- 응답을 잃은 실패(네트워크·5xx·읽지 못한 응답) 뒤: 목록을 무효로 하고, 다음 추가는 보내기 전에 목록을 다시 받아 같은 이름을 다시 본다.

다른 브라우저에서 같은 순간에 같은 이름을 추가하면 둘 다 만들어질 수 있다. 서버 제약이 없어서다.

### 쓰기 규칙

#594 규칙을 따랐다. 누를 때 세션 범위를 잡고, `mutationFn` 첫 줄에서 세션을 확인하고, 요청에 그 세션의 `signal` 을 싣는다. 끝난 세션의 결과는 캐시·문구에 남기지 않고 취소는 안내하지 않는다. 응답을 읽지 못하면(`INVALID_RESPONSE`) 실패 문구 대신 `변경 결과를 확인하지 못했어요` 토스트를 보이고, `새로고침` 은 팀원 목록을 다시 받는다(D-184). member 응답은 아직 `parseResponse` 로 읽지 않는다. 그 전환은 #348 의 마지막 묶음이 한다. 지금은 공통 `request` 가 JSON 이 아닌 성공 응답을 `INVALID_RESPONSE` 로 던지는 경우에 이 안내가 나온다.

### Autocomplete

`Combobox` 는 목록에서 고른 값만 받아 새 이름을 적는 칸에 쓸 수 없다. 그래서 같은 목록 부품(`OptionList`, `filterOptions`, `stepActive`)으로 자유 입력 칸을 더했다.

- 입력 칸이 `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` 를 갖고 포커스를 늘 가진다.
- 목록은 칸에 Anchor 로 붙인 Radix Popover 다. 너비는 칸 너비다. 휴대폰 폭에서도 시트가 아니라 같은 팝오버다.
- ↓↑ 로 짚고 끝에서 멈춘다. 닫혀 있으면 ↓ 가 연다. Enter 는 짚은 줄이 있을 때만 고르고, 없으면 폼을 제출한다. Esc 는 목록만 닫는다. 창 안에서도 첫 Esc 는 목록만, 다음 Esc 가 창을 닫는다.
- 한글 조합 중(`isComposing`, `keyCode 229`)의 Enter·화살표는 무시한다.
- 줄을 누르면 고르고 포커스는 칸에 남는다. 칸 글자가 유일한 제안과 같거나 맞는 줄이 없으면 닫힌다.

### 문구

| 자리 | 문구 |
|---|---|
| 추가 칸 라벨·placeholder·버튼 | 팀원 이름 · 이름 · 추가 |
| 같은 이름 | 이미 같은 이름의 팀원이 있어요. |
| 온보딩 미연결 안내 | 디스코드를 연결하지 않아 팀원을 불러올 수 없어요. 이름으로 팀원을 추가하거나, 이전 단계에서 연결하거나, 건너뛸 수 있어요. |
| 목록 이름(화면 낭독기) | 추가한 팀원 · 미리 추가한 팀원 |

## 문서

- [제품·기술 결정](../../decision/frontend-decisions.md) D-187 과 확정 목록 한 줄.
- [대표 계약](../../contracts/frontend-api-contract.md) 팀원 절에 FE 가 `discord_user_id` 없이 `POST /members` 를 보내는 사용 사실과 FE 의 같은 이름 검사를 적었다. 요청 형식은 바뀌지 않았다.

## 실제 검증

2026-11-10 Windows, Node 24.11.0, MSW 기준이다.

- 바꾼 곳의 19파일 212개 테스트가 통과했다(`npx vitest run src/entities/member src/features/member-add src/features/member-mapping src/shared/ui/select src/app/onboardingMembers.test.tsx src/app/onboardingFlow.test.tsx src/app/onboardingReview.test.tsx src/app/team.test.tsx src/app/teamInvitations.test.tsx --maxWorkers=1`). 새 테스트는 이슈 「테스트」 절 다섯 줄 전부다. 온보딩 추가 요청 본문에 `discord_user_id` 키가 없다. 팀원 연결 창도 같다. 같은 이름은 앞뒤 공백만 달라도 막고 같은 틱 두 번 제출도 하나만 만든다. 추가한 팀원 줄에 `초대` 가 보인다. 제안에서 고른 팀원에 `PATCH` 만 나간다. 여기에 응답을 읽지 못한 경우와 세션이 끝난 경우, 공용 `Autocomplete` 의 키보드·ARIA·조합·창 안 Esc 를 더했다.
- 구현 쪽 가드를 지우면 해당 테스트가 실패하는 것을 확인했다. 같은 틱 가드를 지우면 POST 두 번, 다시 받기를 지우면 hook 테스트, 조합 가드를 지우면 Autocomplete 조합 테스트가 실패했다.
- 실제 브라우저(Playwright Chromium, Vite + MSW)에서 1280·390 폭으로 두 여정 4개가 통과했다. 온보딩은 Discord·Notion 을 건너뛰고 4단계에서 이름을 추가한 뒤 같은 이름 거절과 새로고침 뒤 목록 유지를 봤다. 팀 화면은 창에서 추가 → 목록의 `초대` → 설정에서 Discord 연결 → 창의 제안에서 고르기 → 저장 시 `PATCH` 하나를 봤다. 두 폭 모두 가로 넘침이 없었고 390 에서 칸과 `추가` 가 한 줄, 제안 목록이 칸 너비였다. 여정과 화면은 Git 제외 경로 `frontend/.verify/613/` 에 있다.
- 전체 검사: 아래 「전체 검사」 절.

### 전체 검사

(전체 테스트 차례를 기다린다.)

## 제한과 남은 검증

- MSW 기준이다. 실서버의 `POST /members` 는 확인하지 않았다.
- 같은 이름 검사는 FE 만 한다. 동시에 두 곳에서 같은 이름을 추가하면 둘 다 생길 수 있다.
- 미리 추가한 팀원을 지우는 기능은 없다. 이름을 추가해도 온보딩 버튼은 `건너뛰기` 다(#613 물어볼 것 1·2, 이번 범위 밖).
- 추가 칸에 적다 만 글자는 이탈 확인 대상이 아니다.
