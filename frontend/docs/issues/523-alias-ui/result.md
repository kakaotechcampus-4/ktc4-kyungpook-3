# 결과 — 승인 때 별칭 등록 안내와 팀원별 별칭 관리 화면 (#523)

- 기록일: 2026-11-08
- 대상: [#523](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/523)(메인 이슈 #459, BE #463·#464)
- 기준: develop `7b5a6721` 에서 시작해 #344 둘째(PR #545) 병합 뒤 develop `2ba38e96` 을 merge 했다. PR은 아직 만들지 않았다.
- 상태: **반영했다.** 단위·RTL 과 MSW 개발 서버(Chromium) 브라우저로 확인했다. 실서버는 확인하지 않았다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #523 과 사용자 결정(2026-11-08, 이슈의 FE 답 댓글)이다.

BE 는 담당자를 못 찾은 이름 지목을 PM 이 승인할 때 그 이름을 고른 담당자의 별칭으로 배운다(`save_alias`). 이름·디스코드 닉네임도 별칭으로 자동으로 넣는다. 화면이 필요한 일이 둘이었다. 생성 승인에서 「별칭에도 등록」을 묻는 것과, 잘못 배운 별칭을 지울 수 있는 팀원별 별칭 화면이다. 별칭을 고치는 API 가 없어 지우기가 유일한 바로잡기다.

## 실제 구현 및 관련 코드

- 승인 안내
  - [AliasSaveField](../../../src/features/approval-resolve/ui/AliasSaveField.tsx): 「'{alias_text}'을(를) {담당자 이름}의 별칭에도 등록」 체크박스, 기본 켜짐. 승인 상세([TaskCreateOverrideFields](../../../src/features/approval-resolve/ui/TaskCreateOverrideFields.tsx))와 태스크 목록 카드([ApprovalCard](../../../src/widgets/task-board/ui/ApprovalCard.tsx))의 담당자 고르기 바로 아래에 있다. 미정을 골라 숨겨도 PM 이 고른 값을 기억한다.
  - [resolution.ts](../../../src/entities/approval/model/resolution.ts) `aliasToLearn`: 담당자가 있으면 배울 글자, 미정이면 null. 승인 계획이 이 값과 체크로 `save_alias: true` 를 싣고, 화면이 같은 값으로 체크박스를 보인다.
  - [승인 mapper](../../../src/entities/approval/model/mapper.ts): `alias_candidate`·`alias_text` 를 `aliasCandidate: string | null` 한 필드로 읽는다.
  - [useApprovalResolve](../../../src/features/approval-resolve/model/useApprovalResolve.ts): 승인 뒤 별칭 목록 캐시도 다시 받는다(기본 30초 신선이라 팀 화면이 낡은 목록을 보일 수 있었다).
- 별칭 관리
  - 자리: 설정 화면에는 팀원 목록이 없고 목차의 「팀원」이 팀 화면으로 간다. 팀 화면의 팀원 줄 머리에 「별칭 N」 단추를 두고 펼친다([MemberList](../../../src/widgets/team/ui/MemberList.tsx), [TeamOverview](../../../src/widgets/team/ui/TeamOverview.tsx)). 접으면 칸을 그리지 않는다.
  - [MemberAliasPanel](../../../src/features/member-alias/ui/MemberAliasPanel.tsx): 칩마다 출처 꼬리표, 미확인이면 「· 미확인」. PM 만 추가 칸과 지우기 단추를 본다. 일반 팀원은 읽기만 한다(팀 화면의 기존 규칙: 데이터는 모두, PM 조작은 PM 만).
  - [useMemberAliasActions](../../../src/features/member-alias/model/useMemberAliasActions.ts): 누를 때 세션 범위를 잡고(`captureSessionScope`), 보내기 직전 `isCurrent` 를 묻고 `signal` 을 넘긴다. 같은 틱 두 번 누름을 막는다.
  - [aliasMessages](../../../src/features/member-alias/lib/aliasMessages.ts): 출처 꼬리표 표와 BE 오류 코드별 문구.
  - [memberAliases.ts](../../../src/entities/member/api/memberAliases.ts): 공간 별칭 조회·추가·삭제. `AliasSource` 에 `display_name` 을 더했다(모르는 값 처리는 #348).
- MSW
  - 승인·추출 응답의 후보를 BE 처럼 응답마다 다시 계산한다. `save_alias` 로 승인하면 최종 담당자에게 `learned` 별칭을 더한다([승인 handler](../../../src/shared/mock/handlers/approval.ts)). 픽스처 ap_03('지훈')은 후보, ap_01('민수', 박민수의 이름 별칭)은 후보가 아니다.
  - 별칭 추가·삭제에 PM 검사, 공백 정리, 길이·`display_name` 400, 자동 별칭 올리기를 넣었다([팀원 handler](../../../src/shared/mock/handlers/member.ts)). ws_01 픽스처에 출처 넷이 다 있다.
  - 모의 DB 판 16 → 17.
- 을/를: features 는 `widgets/dashboard` 의 `objectParticle` 을 가져올 수 없다. #344 둘째(PR #545)가 옮기는 `shared/lib/korean.ts`(테스트 포함)를 그 브랜치와 바이트가 같게 더했다. 병합 때 같은 추가라 겹치지 않는다.
- 계약: [계약](../../contracts/frontend-api-contract.md) §2.2(출처 `display_name`, 추가·삭제 규칙, 미매칭 판정), §2.4 표, §2.5 「승인 때 별칭 학습」, §4.0-②-15, §5.8, 「M6 태스크·승인 처리 경계」의 `PATCH` 본문.
- 결정 기록: [승인 때 별칭 학습 화면](../../plan/m8/basis-for-decision/2026-11-08-alias-learning-ui.md).
- 건드리지 않은 것: 답장 카드(`TaskUpdateReview`), 공용 담당자 고르기 조립, `widgets/dashboard`, 미매칭 이름 MSW 판정(이슈의 「필수 아님」).

## 완료조건 확인

| #523 요청·사용자 결정 | 상태 | 근거 |
|---|---|---|
| 생성 승인 담당자 고르기 아래 체크박스, 기본 켜짐, 문구 | 충족 | RTL·브라우저 |
| `alias_candidate` 이고 팀원을 골랐을 때만 보임, 미정이면 숨김 | 충족 | RTL·브라우저 |
| 켜져 있으면 `save_alias: true`, 꺼지면 키 없음 | 충족 | RTL(본문), 브라우저(PATCH 본문) |
| 담당자 선택지에 별칭 없음 | 충족 | RTL·브라우저(선택지 글자) |
| 팀원 행을 펼쳐 별칭 칩·추가·삭제, PM 만 고침 | 충족 | RTL·브라우저 |
| 출처 꼬리표 넷 | 충족 | RTL·브라우저 |
| DTO·타입(`alias_candidate`·`alias_text`·`save_alias`, `display_name`) | 충족 | typecheck, mapper 테스트 |
| MSW 새 필드·`save_alias` 저장·출처 넷 픽스처 | 충족 | MSW 테스트 |
| 계약 ①~④ | 충족 | 위 계약 절 |

## 검증

- 바꾼 곳 RTL·단위·MSW(모두 `--maxWorkers=1`)
  - 승인: `src/app/approvalsMsw.test.tsx`(ap_03 체크 켬·끔, 미정 숨김·기억, 선택지, ap_01, 목록 카드), `entities/approval/model/{mapper,resolution}.test.ts`, `shared/mock/taskApprovalFlow.test.ts`(후보 다시 계산, 저장 경로, 400). 위임자 실행 24 파일 365 통과.
  - 별칭: `src/app/teamAliases.test.tsx`(펼침·꼬리표, 추가·Enter, 중복, 101자, 삭제, 이미 지워짐, 일반 팀원), `features/member-alias/model/useMemberAliasActions.test.tsx`(세션이 끝나면 보내지 않음, 두 번 누름), `entities/member/member.integration.test.ts`(PM 403, 공백, 400, 올리기).
- 전체 검사(한 번)
  - `npm run typecheck`·`npm run build` 통과.
  - `npm run lint`·`npm run format:check` 은 git 에서 빠진 로컬 검증 스크립트(`frontend/.verify/*.ts`) 때문에만 실패했다. 그 폴더를 뺀 `npx eslint . --ignore-pattern '.verify/**'`, `npx prettier --check src docs e2e` 는 통과.
  - `npm run test -- --maxWorkers=1`: 273 파일 중 7 파일 18 실패, 3399 통과. 따로 돌려도 같은 실패라 부하가 아니었다. 원인: 접힌 별칭 칸을 `hidden` 으로 DOM 에 남겨 이름 별칭 칩(「김서연」)이 팀원 이름과 같은 글자로 하나 더 있었고, 팀 화면을 거치는 테스트의 `findByText('김서연')` 이 둘을 찾았다. 접으면 칸을 그리지 않게 고친 뒤 실패한 7 파일과 팀 테스트 11 파일 114 통과.
- 브라우저(MSW 개발 서버, Chromium, 1280·390): 로컬 스크립트 `frontend/.verify/alias-523.verify.ts` 3 통과. 증거는 `frontend/.verify/alias-523-results/`(스크린샷·trace).
  - 팀 화면을 연 뒤 승인 화면으로 옮겨(같은 탭) ap_03 에서 미정일 때 체크 없음 → 박민수 고르면 켜진 체크 → 390 폭 가로 넘침 없음 → 승인 PATCH 본문 `save_alias: true` → 팀 화면으로 돌아오면 박민수에게 「지훈 · 회의에서 배움」.
  - PM 이 정하늘에 「  하늘   님 」 추가 → 「하늘 님 · 직접 추가」, 칸 비움 → 「하늘」 다시 추가는 「이미 있는 별칭이에요.」(서버 규칙대로 이름 별칭이 직접 추가로 올라간다) → 지우기 토스트 → 새로고침 → 390 폭에서 띄어쓰기 없는 긴 별칭이 칩 안에서 접히고 가로 넘침 없음.
  - 일반 팀원은 칩을 보고 추가 칸·지우기 단추가 없다.
- develop `2ba38e96`(#344 둘째) merge 뒤: 충돌 없음. `shared/lib/korean.ts` 는 한 벌로 합쳐졌다. typecheck 통과, 승인·답장·대시보드·팀·별칭 테스트 38 파일 551 통과, `eslint`(`.verify` 제외)·`prettier --check src docs e2e` 통과, 브라우저 스크립트 3 통과.
- 하지 않은 것: 실서버 호출, Playwright E2E 전체(CI), 스토리(#482 로 더하지 않음).

## 독립 리뷰 반영 (2026-11-08)

Codex 리뷰(중간 3, 낮음 1)를 모두 고쳤다. 건마다 고치기 전에 실패하는 테스트를 먼저 더하고 실패를 확인했다(5 실패). 이유와 버린 길은 [결정 기록](../../plan/m8/basis-for-decision/2026-11-08-alias-learning-ui.md#이후-변경-독립-리뷰-반영-2026-11-08)에 있다.

| 건 | 고친 것 | 먼저 더한 테스트 |
|---|---|---|
| 중간 1 추가 중 새 입력이 성공 응답으로 지워짐 | 보내는 동안 입력을 읽기 전용으로 둔다(포커스는 남는다) | `teamAliases.test.tsx` 「보내는 동안 칸은 읽기 전용…」 |
| 중간 2 MSW 가 별칭을 지운 뒤 후보를 다시 구하지 않음 | [aliasLearning](../../../src/shared/mock/aliasLearning.ts) 이 추출 원문·유형(모의에만 저장)과 지금 별칭으로 응답·승인 때마다 구한다. 끝 조사·님 떼기와 1인칭 제외도 BE 를 옮겼다 | `taskApprovalFlow.test.ts` 「막던 별칭을 지우면 원문 이름이 다시 후보가 되고…」, 원문 다듬기 4건 |
| 중간 3 길이를 UTF-16 으로 셈 | FE 입력 검사와 MSW 가 문자(코드 포인트)로 센다 | `teamAliases.test.tsx` 이모지 51개, `member.integration.test.ts` 이모지 100·101개 |
| 낮음 4 삭제 뒤 포커스를 잃음 | 같은 자리(없으면 앞) 지우기 단추로, 남은 별칭이 없으면 새 별칭 칸으로 | `teamAliases.test.tsx` 「지우면 포커스가 옆 지우기 단추로…」 |

- 바꾼 곳 테스트: 23 파일 303 통과(`--maxWorkers=1`).

## 남은 것

- #512(카드 합치기)가 배포되면 두 필드가 어느 항목 기준인지 BE 가 다시 알린다.
- 다른 팀원과 같은 별칭을 넣어도 경고하지 않는다. 그 이름은 애매해져 확인 필요로 간다.
- MSW 는 팀원을 만들거나 이름을 바꿀 때 이름 별칭을 만들지 않고, 찾기 후보(님·조사를 뗀 여러 꼴)로 막기·한 글자·탈퇴 규칙과 새 미매칭 판정을 흉내 내지 않는다.
- 별칭 목록은 팀 화면 미리 받기에 넣지 않아 「별칭 N」 개수가 팀원 줄보다 조금 늦게 보일 수 있다.
