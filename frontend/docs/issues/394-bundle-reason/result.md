# 결과 — 메시지 묶음의 재촉 이유·근거·목록 요약 되살리기 (#394)

- 기록일: 2026-11-08
- 대상: [#394](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/394)의 FE 몫. BE 몫은 PR #418 로 병합·배포됐다.
- 기준: develop `7b5a6721`. PR은 아직 만들지 않았다.
- 상태: **재촉 이유 문장·근거 링크·목록 요약을 되살렸다.** 단위·화면(RTL)·MSW 와 MSW 개발 서버 브라우저(Chromium 1280·390)로 확인했다. 배포 BE 에 붙인 확인은 하지 않았다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #394 의 사용자 결정 두 개와 BE 명세다.

- 2026-11-05 결정(이슈 첫 댓글): 되살리는 것은 재촉 이유 문장, 근거 링크, 목록 요약 셋뿐이다. 「지금 바로」·채널 대화·취소/만료 줄·승인자 이름은 붙이지 않고 디자인 차이로 남긴다.
- 2026-11-08 결정: 태스크가 여러 개인 묶음에서 이유는 태스크 행마다 보인다. 근거 링크는 앱 안 링크다. `reason` 이 `null` 이면 이유 줄이 없고, `evidence` 가 `null` 이면 문장만 보인다. 목록 행은 `summary` 를 쓰고, 없는 옛 응답이면 태스크 제목으로 대신한다.
- BE 명세: #394 댓글 「BE 구현 (PR #418)」(2026-11-06)과 [reminder_reason.py](../../../../backend/app/services/reminder_reason.py).

| 커밋 | 요지 |
|---|---|
| `13d4759d` | DTO·도메인 타입·매퍼에 `summary`·`reason`·`evidence`. 목록 행이 `summary` 를 쓰고 위젯의 `bundleSummary` 를 지웠다 |
| `471a7fdc` | MSW 가 묶음이 나가는 모든 응답에 BE 와 같은 계산으로 요약·이유·근거를 싣는다 |
| `6f076466` | 보내기 전 확인의 태스크 행마다 이유와 근거 링크. 대화 주소의 `?message=` 로 그 메시지를 보이며 연다 |
| 문서 커밋(이 기록) | 계약 §5.7, [2026-11-04 결정 기록](../../plan/m8/basis-for-decision/2026-11-04-messages-real-api-drop-unbacked-ui.md)의 재검토 조건, [M8-C 결과](../../plan/m8/result-c.md)의 디자인 차이 |

## 바꾼 데이터 모양

- **DTO** [message.ts](../../../src/shared/types/api/message.ts): `ReminderEvidenceDto {kind: 'reply'|'task_change', at, message_id}`, `ReminderDto.reason`·`evidence`, `BundleDto.summary`. #418 이전 서버는 보내지 않아 선택 칸으로 두었다.
- **도메인** [types.ts](../../../src/entities/message/model/types.ts): `ReminderEvidence` 는 `{kind: 'reply', at, messageId}` 와 `{kind: 'taskChange', at}` 의 판별 유니온이다. 메시지 ID 없는 답장 근거는 만들 수 없다. `BundleTask.reason: string | null`, `BundleTask.evidence: ReminderEvidence | null`, `Bundle.summary: string`.
- **매퍼** [mapper.ts](../../../src/entities/message/model/mapper.ts): `summary` 가 없으면 태스크 제목(`API 명세서`, `퍼블리싱 외 1건`)으로 채운다. 화면은 늘 문자열을 받는다. `reason`·`evidence` 가 없으면 `null` 이다. `message_id` 없는 `reply` 근거는 던지지 않고 근거만 `null` 로 둔다. 곁가지 칸 하나로 목록 전체가 오류가 되지 않게 하는 것으로, DM 실패 이유가 없으면 `unknown` 으로 읽는 기존 선례와 같다.
- **주소** [routes.ts](../../../src/shared/config/routes.ts): `paths.messageThread(ws, thread, messageId?)` 와 `MESSAGE_PARAMS.message`.

## 화면

- [ReviewTasks.tsx](../../../src/widgets/message-inbox/ui/ReviewTasks.tsx): 각 행의 제목·마감·메모와 버튼 줄 아래에 이유 문장(13.5px, 줄 간격 1.75, 먹색)과 근거 링크(12.5px, 흐린 색, 밑줄)를 둔다. 시안 「왜 보내려 하나요」 블록의 글자 값이다.
  - `reply` → `답장 보기`. 묶음의 대화를 `?message={message_id}` 로 연다.
  - `task_change` → `변경 보기`. 태스크 상세를 연다.
  - 접근 이름은 행 버튼과 같이 `'{제목}' 답장 보기` 다. 앱 안 이동이라 바깥 링크 아이콘은 없다. 저장하지 않은 메모가 있으면 다른 링크처럼 `GuardedLink` 가 묻는다.
- [ThreadDetail.tsx](../../../src/widgets/message-inbox/ui/ThreadDetail.tsx): 마운트할 때 주소의 `message` 가 가리키는 말풍선이 있으면 맨 아래 대신 그 말풍선을 가운데로 스크롤한다. 맨 아래에 붙이는 효과들(크기 변화, 늦게 오는 답장 고르기)이 다시 끌어내리지 않게 `atBottom` 을 끈다. 없는 ID 면 전처럼 맨 아래다. 답장 입력 영역은 건드리지 않았다.
- [MessageInbox.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.tsx): 목록의 `보내기 전 확인` 행 아래 줄이 `bundle.summary` 다.

## MSW

[message-state.ts](../../../src/shared/mock/message-state.ts)가 `reminder_reason.py` 를 따라 계산한다.

- 진행 소식은 그 대화의 마지막 팀원 메시지와, 그 태스크의 상태·마감 변경 이력 중 늦은 것이다. 스케줄러·답장 판정이 바꾼 이력은 세지 않는다. 태스크 생성 이전 것은 세지 않고, 변경은 생성 뒤 5초 안의 것도 세지 않는다. 같은 시각이면 답장이 앞선다.
- 문장의 날짜는 KST `M/D(요일)` 이다. PM 이 만든 재촉은 만든 사람(`created_by`)의 이름을 쓴다. 그래서 `MockReminder` 에 `created_by` 를 더했다. 재촉 만들기는 세션의 PM 팀원 ID 를 넣는다.
- 요약은 `bundle_summary` 와 같다. `reason`·`evidence` 는 저장하지 않고 응답할 때마다 계산한다.
- 픽스처: `bd_01` 은 태스크 변경 근거, `bd_02` 의 두 행은 소식 없음과 PM 재촉이다(`rm_03` 을 PM 재촉으로 바꿨다). 답장 근거는 `messages-merge` 의 `bd_07` 이다. 기본 픽스처에 답장 근거를 넣으려면 대화 순서나 태스크 이력을 바꿔야 해 다른 화면 테스트·E2E 가 흔들려서 넣지 않았다.
- 한계: BE 는 태스크의 지금 제목·마감으로 문장을 만들지만, 목은 리마인드에 옮겨 둔 제목·마감을 쓴다. 메시지 픽스처와 태스크 픽스처의 제목이 달라(`tk_01` 이 `로그인 API 연동`·`API 명세서`) 행 제목과 문장을 맞추기 위해서다.

## 완료조건 확인

| 브리프의 할 일 | 상태 | 근거 |
|---|---|---|
| DTO·매퍼에 summary·reason·evidence(at 은 UTC ISO) | 충족 | 매퍼 테스트 |
| 보내기 전 확인의 행마다 이유·근거 링크, 목록 행 summary | 충족 | 화면 테스트, 브라우저 |
| MSW 가 묶음이 나가는 모든 응답에 BE 와 같은 모양 | 충족 | `messageScenarios`·`message-state` 테스트 |
| 계약 §5.7 묶음·리마인드 응답 줄, 결정 기록 재검토 조건, M8-C 디자인 차이 | 충족 | 문서 커밋 |

## 검증

2026-11-08, Node v24.11.0.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | |
| `npm run build` | 0 | |
| `npm run test -- --maxWorkers=1` | 0 | 270파일 3,390개 통과 |

- 매퍼 [mapper.test.ts](../../../src/entities/message/model/mapper.test.ts): `summary` 그대로·없을 때 대체, `reason`·`evidence` 매핑과 `null`·없음, `message_id` 없는 답장 근거.
- MSW [message-state.test.ts](../../../src/shared/mock/message-state.test.ts)·[messageScenarios.test.ts](../../../src/shared/mock/messageScenarios.test.ts): 답장·태스크 변경·소식 없음·PM 재촉·마감 없음·지운 태스크의 문장과 근거, 같은 시각이면 답장, 스케줄러·답장 판정 이력 제외, 핸들러 응답의 모양.
- 화면 [messagesReviewTasksMsw.test.tsx](../../../src/app/messagesReviewTasksMsw.test.tsx) 「재촉 이유와 근거」 4개:
  - 태스크 1건·여러 건 묶음에서 행마다 이유가 보인다.
  - `reason` 이 `null` 인 행에는 이유 줄이 없다. `evidence` 가 `null` 인 행은 문장만 있다.
  - `변경 보기` 는 태스크 상세로 간다.
  - `답장 보기` 는 그 대화로 가고 그 메시지 말풍선이 스크롤된다. 스크롤 호출을 빼면 이 테스트가 실패한다(구현 위임이 깨 보고 되돌림).
  - 목록 행의 요약은 [messagesMsw.test.tsx](../../../src/app/messagesMsw.test.tsx)가 본다.
- 브라우저(Vite MSW 모드, Chromium, `frontend/.verify/394/shots.mjs`, 증거는 같은 폴더, git 제외): 1280·390 폭 각각 9개 확인을 통과했다.
  - 목록 행이 `… 진행 상황 확인` 이다.
  - `bd_02` 의 두 행에 PM 재촉·소식 없음 문장이 있고 링크가 없다.
  - `bd_01` 의 `변경 보기` 는 `/workspaces/ws_01/tasks/tk_01` 로 간다.
  - `bd_07`(`messages-merge`)의 `답장 보기` 는 `/workspaces/ws_01/messages/threads/th_01?message=mg_02` 로 간다. `mg_02` 말풍선이 대화 칸 안에 보이고 맨 아래가 아니다. 페이지 스크롤은 0이다.
  - 콘솔 오류는 없다.

## 남은 문제

- 배포 BE 에 붙인 확인은 하지 않았다. 칸 이름은 `schemas/message.py` 의 `ReminderEvidence`·`ReminderResponse`·`BundleResponse` 와 대조했다.
- 휴대폰에서 `?message=` 가 붙은 대화를 연 뒤 목록으로 돌아가면, 돌아갈 행을 주소로 찾는 포커스 복귀가 맞지 않아 목록 제목에 포커스가 갈 수 있다. 코드를 읽고 추정한 것이고 확인하지 않았다.
- 찾아간 메시지 말풍선에 따로 강조 표시는 없다. 가운데로 스크롤만 한다.
- 이유 문장의 날짜는 시안처럼 숫자 글꼴로 구분하지 않는다. 서버가 한 문장으로 준다.
- Playwright E2E 와 Storybook 은 돌리지 않았다(CI 가 돈다). 옛 목록 행 문구를 단언하는 E2E 는 없다.
