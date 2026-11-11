# 결과 — Discord 를 연결한 팀도 서버에 없는 사람을 이름으로 추가한다 (#660)

- 기록일: 2026-11-10
- 대상: [#660](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/660)
- 기준: develop `61805bb0`
- 상태: **반영했다.** 단위(RTL)와 MSW 개발 서버(Chromium) E2E 로 확인했다. 실서버·실제 Discord 서버는 확인하지 않았다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #660 이다.

Discord 를 연결한 팀의 팀원 연결 창과 온보딩 4단계에는 Discord 사용자 옆에 이름을 적는 매칭 폼만 있었다. 서버에 그 사람이 없으면 팀원 자리를 만들 수 없었다. 초대는 팀원 줄에 붙으므로 초대 버튼도 생기지 않았다. #613 의 이름 추가 칸을 연결된 화면에도 둔다. BE 는 바꾸지 않았다.

## 실제 구현 및 관련 코드

- [MemberConnectDialog.tsx](../../../../../src/widgets/team/ui/MemberConnectDialog.tsx): 연결된 창(`MappingForm`)의 매칭 폼 아래에 안내 문구와 `MemberAddForm` 을 둔다. 매칭 폼 밖이라 폼이 겹치지 않는다.
- [MembersStep.tsx](../../../../../src/widgets/onboarding/ui/MembersStep.tsx): 연결된 온보딩 카드(`MembersForm`)의 매칭 줄 아래에 같은 칸을 둔다. 매칭 `<form>` 이 카드 전체를 감싸던 것을 매칭 줄만 감싸도록 줄이고, `확인 완료` 는 `form` 속성으로 그 폼을 가리킨다.
- [MemberAddForm.tsx](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/77321cc830c72cef0ec9af2f1f39292e58ddadb6/frontend/src/features/member-add/ui/MemberAddForm.tsx): `추가한 팀원` 목록을 Discord 계정과 잇지 않은 일반 팀원으로 좁혔다. 연결된 화면에서 이미 이은 팀원은 매칭 줄에 있다. 안내 문구 `NOT_IN_DISCORD_SERVER` 를 여기서 내보낸다. 같은 화면의 매칭 저장 중에는 `disabled` 로 추가를 막는다.
- [useMemberAdd.ts](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/77321cc830c72cef0ec9af2f1f39292e58ddadb6/frontend/src/features/member-add/model/useMemberAdd.ts): `useMemberAdding` 은 이 공간의 이름 추가가 진행 중인지 이름 추가 mutation key 로 답한다. 두 위젯은 추가 중에 `저장`·`확인 완료` 를 잠그고, 제출과 온보딩 나가기 저장도 매칭을 저장하지 않는다.
- 그대로 둔 것: 같은 이름 막기(`checkNewMemberName`), `POST /members` 요청 형식, 매칭 폼 저장 규칙. 매칭 줄은 화면을 연 때 한 번 만들고 팀원 목록은 실시간 쿼리로 읽으므로, 이름을 추가해도 적던 입력이 남고 추가한 이름이 이름 제안에 나온다.
- 모의 시나리오 `settings-discord-empty`: `settings-unmapped` 에서 Discord 서버 사용자를 비우고 초대할 가입자를 더했다.
- 결정 기록: [D-188](../../../../decision/frontend-decisions.md). 계약: [API 계약](../../../../contracts/frontend-api-contract.md)의 `POST /members` FE 사용에 한 줄을 더했다.
- 리뷰에서 고친 것: 독립 리뷰(Codex gpt-6.1-sol)가 이름 추가와 매칭 저장이 겹치면 같은 이름의 팀원이 둘 생긴다고 지적했다. 리뷰어는 실제 `useMemberAdd`·`saveMemberMappings` 코드로 메모리에서 재현했다고 보고했다. 위의 상호 잠금으로 막았다.
- 검증 스킬: `connections` 기능에 새 E2E 를 등록하고 [기능 지도](../../../../../../.cursor/skills/verify-managers-manager/features/connections-team.md)에 절차를 더했다.

## 완료조건 확인

| 이슈 #660 세부 작업 | 상태 | 근거 |
|---|---|---|
| 연결된 팀원 연결 창에 이름 추가 칸 | 충족 | 단위·E2E |
| 연결된 온보딩 팀원 단계에 같은 칸 | 충족 | 단위 |
| 매칭 폼의 저장 전 입력이 이름 추가와 섞이지 않는다 | 충족 | 단위(창·온보딩 모두) |
| 같은 이름 두 번 추가 막기는 #613 규칙 그대로 | 충족 | 단위(창) |
| Discord 회의 발화가 잡히지 않는다는 안내 | 충족 | 위 구현, E2E 화면 |
| (리뷰 반영) 이름 추가와 매칭 저장이 겹쳐 같은 이름이 둘 생기지 않는다 | 충족 | 단위(창 두 방향·온보딩) |
| Discord 사용자 0명에서 이름 추가 → 팀원 줄 `초대`. 온보딩도 같다. 추가한 자리를 매칭 폼에서 같은 이름으로 붙인다 | 충족 | 아래 검증 |

## 검증

- 단위(RTL), 경합: 응답을 붙잡아 두고, 창에서 이름 추가 중 `저장` 잠김·Enter 제출 무시와 매칭 저장 중 `추가` 잠김·Enter 무시, 온보딩에서 추가 중 `확인 완료` 잠김·Enter·`온보딩 나가기` 무시를 본다. 모두 끝난 뒤 `POST /members` 는 하나이고 같은 이름의 팀원은 하나다. 세 테스트는 잠금을 넣기 전 코드에서 실패했다.
- 단위(RTL), 수정 전 실패 확인: 새 테스트 4개는 develop 코드에서 모두 `팀원 이름` 입력을 찾지 못해 실패했고, 수정 뒤 통과했다.
  - [team.test.tsx](../../../../../src/app/team.test.tsx) 「Discord 서버에 없는 사람 (#660)」: Discord 사용자 0명에서 이름 추가, 같은 이름 막기, 창을 닫은 뒤 그 팀원 줄의 `초대`. 매칭 줄에 적던 `최지` 가 이름 추가 뒤에도 남고, `최지훈` 으로 저장하면 추가한 팀원에 `PATCH` 하나로 이어진다(새 팀원 없음).
  - [onboardingMembers.test.tsx](../../../../../src/app/onboardingMembers.test.tsx) 「Discord 서버에 없는 사람을 이름으로 추가 (#660)」: Discord 사용자 0명에서 이름 추가 → `나중에 하기` → 팀 화면 그 팀원 줄의 `초대`. 매칭 줄 입력이 남고 추가한 이름이 이름 제안에 나온다.
- E2E(MSW, Chromium) [member-add-discord.e2e.ts](../../../../../e2e/member-add-discord.e2e.ts): `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run connections` 2 통과(기존 Discord 연결 여정 포함). 이름 추가 → 새로고침 → 그 팀원 줄 `초대` → 아이디 `doyun` 으로 초대 → 새로고침 뒤에도 `대기`. 1280px 과 390px 에서 창을 찍었고 390px 에서 가로 넘침이 없다. 포트 정리 `portOpen: false`.
- 온보딩의 연결된 화면은 브라우저 E2E 로 돌리지 않았다. 단위 테스트가 앱 전체를 그려 확인한다.
