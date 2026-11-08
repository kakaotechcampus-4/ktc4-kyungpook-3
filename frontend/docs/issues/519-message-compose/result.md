# 결과: PM·팀원 메시지 입력과 대화 시작, 웹 답장 안내 (#519, #525)

- 기록일: 2026-11-09
- 대상: [#519](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/519)와 [#525](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/525)의 FE 몫이다. BE 몫은 #518(PM·팀원 메시지)과 #524(웹 답장 안내, `web_reply_available`)로 develop 에 병합됐다.
- 기준: develop `fad77196`. PR은 아직 만들지 않았다.
- 상태: **구현했다.** 단위·화면(RTL)·MSW 테스트와 MSW 개발 서버 브라우저(Chromium 1280·390)로 확인했다. 배포 BE 에 붙인 확인과 E2E 실행은 하지 않았다.

## 작업 근거

마일스톤 계획에 없는 작업이다. 근거는 두 이슈의 요청과 FE 안이다.

- #519 본문의 「부탁드려요」와 #519 FE 안(hotpringles, 2026-11-08).
- #525 본문의 요청과 #525 FE 안(같은 날). 사용자가 2026-11-08 #525 마지막 댓글에서 문구와 위치를 그대로 확정했다.
- 명세는 BE 코드([api/messages.py](../../../../backend/app/api/messages.py), [schemas/message.py](../../../../backend/app/schemas/message.py))와 [계약 §5.7](../../contracts/frontend-api-contract.md)의 「PM·팀원 메시지」다.

| 커밋 | 요지 |
|---|---|
| `d85d6402` | DTO·도메인·매퍼에 `pm` 글, 작성자, `web_reply_available`, 대화 열기 `openThread` |
| `62fcb2df` | MSW 가 대화 열기·PM 글·웹 답장 여부를 BE 와 같은 규칙으로 답한다. 시나리오 `messages-pm-thread` |
| `582062e2` | PM 이 모든 대화에 쓴다. 작성자로 내 글을 가르고, 입력 안내 문구와 웹 답장 불가를 보인다 |
| `c3e82ac0` | PM 의 `새 대화`(`?new=thread`)와 빈 화면 시작, 팀원 빈 화면의 `PM에게 메시지 보내기` |
| `65f8a9bd` | `message_received` 알림 제목과 메시지 캐시 다시 받기 |
| `9e67e7ba` | 메시지 라우트 뼈대의 PM 머리에도 `새 대화` 자리를 둔다. 브라우저 확인에서 머리가 흔들리는 것을 찾아 고쳤다 |
| 문서 커밋(이 기록) | 계약 §5.7, D-174, 검증 기능 지도 |
| `097dbe3c` | 리뷰 반영. PM 이 남의 대화에 쓴 글을 보내지 못하면 `메시지를 보내지 못했어요` 로 알린다 |
| `4e35af4a` | 리뷰 반영. MSW 가 PM 글을 대화 주인에게 `message_received` 로 알린다. 받는 사람·본문·링크·5분 중복 제한은 BE `notify_new_message` 와 같다 |

## 바꾼 데이터 모양

- **DTO** [message.ts](../../../src/shared/types/api/message.ts): `sender` 에 `pm`, 메시지와 `last_message` 에 `author_member_id`·`author_name`, 대화 요약에 `web_reply_available?`, 요청 `ThreadOpenRequestDto`. `web_reply_available` 은 #524 이전 응답에 없어 선택 칸이다. `unread_count` 는 이 작업 범위가 아니라 넣지 않았다.
- **도메인** [types.ts](../../../src/entities/message/model/types.ts): `Message` 에 `PmMessage { sender: 'pm', dm, authorMemberId, authorName }` 가지를 더했다. `MessageThreadSummary.webReply` 는 `available`·`unavailable`·`unknown` 셋이다. 칸이 없으면 `unknown` 이라 답장 가능으로도, 불가로도 보이지 않는다.
- **보는 사람 규칙** [viewer.ts](../../../src/widgets/message-inbox/model/viewer.ts): `ownSender`·`reply` 를 지우고 `OWN_SIDE[audience][sender]` 표 하나로 말풍선 자리와 목록 `나:` 를 정한다. `pm` 글은 PM 이 남의 대화를 볼 때만 작성자로 가린다. 봇 재촉과 예정 묶음은 예전 자리 그대로다.
- **고른 칸** [selection.ts](../../../src/widgets/message-inbox/model/selection.ts): 만들기 칸을 `ComposeKind = 'reminder' | 'thread'` 로 나눴다. 불리언을 하나 더 두지 않았다.

## 화면

- PM 은 목록 머리의 `새 대화`, 빈 화면의 `새 대화` 로 오른쪽 칸을 열고 팀원을 한 번 눌러 대화를 연다. 자기 팀원 행은 빠진다. 대화를 연 뒤 메시지 캐시를 다시 받고 그 대화로 주소를 바꿔 끼운다.
- 팀원은 빈 화면의 `PM에게 메시지 보내기` 로 자기 대화를 연다. 워크스페이스 응답에 `member_id` 가 없으면 버튼이 없다.
- PM 이 남의 대화를 열 때 나오던 안내 바를 지웠고 입력칸을 둔다. 입력칸 문구는 #525 확정 문구 그대로다.
- `pm` 글은 내 글이면 오른쪽 `나`, 아니면 왼쪽에 작성자 이름을 붙인다. 팀원 화면에서 PM 글은 왼쪽에 `author_name` 이다. DM 실패 표시는 봇 글과 같다.
- PM 화면에서 `web_reply_available === false` 면 목록 행에 회색 `웹 답장 불가`, 대화 안에 초대 안내와 `팀원 초대하기`(팀 화면) 링크가 보인다. PM 입력칸은 그대로다.
- 기기 알림 띠는 팀원 화면과 PM 자기 대화에서 봇 또는 `pm` 글이 있으면 보인다.

## 검증

- RTL·단위: 바꾼 곳 테스트를 `--maxWorkers=1` 로 돌렸다(위임자 19개 파일 334개 통과, 라우트 뼈대 1개 파일 66개 통과). 전체 결과는 아래 「전체 검사」에 적는다.
- 브라우저: MSW 개발 서버에서 Chromium 1280·390 으로 PM·팀원 여정을 돌렸다. 확인 57개가 모두 통과했다. PM 은 목록의 `웹 답장 불가`·`나:`, 다른 PM 글의 이름·DM 실패, 초대 안내와 링크 이동, PM 입력칸 문구, 보낸 글의 오른쪽 자리와 새로고침 뒤 유지, `새 대화` 로 대화 열기, 빈 화면의 `새 대화` 를 봤다. 팀원은 PM 글의 왼쪽 자리와 이름, 입력칸 문구, 빈 화면 버튼으로 대화를 열고 먼저 쓰기를 봤다. 스크립트와 스크린샷은 git 에서 뺀 `frontend/.verify/519-525/` 에 있다.
- 리뷰 반영: 두 수정 모두 테스트를 먼저 써 실패를 본 뒤 고쳤다. PM 실패 제목은 `messagesMsw`, 알림은 `message-state`·`messageScenarios`·`messagesSync`(받는 계정의 알림 종과 대화 다시 받기)가 본다. 바꾼 4개 파일 182개 테스트, typecheck, lint 가 통과했다.
- 하지 않은 것: 배포 BE·로컬 BE 에 붙인 확인, Playwright E2E(CI 가 돌린다, 바뀐 기대값만 고쳤다), Storybook.

## 남은 것

- MSW 는 팀원 글의 `message_received` 를 만들지 않는다. BE 는 답장 판단을 거쳐 PM 들에게 알린다.
- 모의 데이터에서는 초대를 수락한 팀원만 웹 계정이 이어져, 기본 시나리오의 PM 목록에서 `mb_01` 말고는 모두 `웹 답장 불가` 다. BE 규칙(`member.user_id`)과 같게 둔 결과다.
- 새 대화 칸에 고를 팀원이 없으면 빈 목록이다. 따로 문구를 두지 않았다.
- 새 글을 바로 받는 웹소켓은 #558 에서 잇는다.
