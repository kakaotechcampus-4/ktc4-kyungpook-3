# M8-C 구현 결과 — 메시지

- 기록일: 2026-10-31 (2026-11-01 디자인 캔버스 기준 재작업과 검증 VR-C 발견 수정, 2026-11-02 Discord DM 카드 잘림 수정, 발송 시점 카드 hover·저장 중 버튼 깜빡임 수정, 대화 미리 받기 반영, 2026-11-04 실제 메시지 API 연결, 2026-11-05 합친 묶음으로 선택 옮기기, 재촉 직접 만들기와 태스크 빼기·메모 고치기, 2026-11-06 PM 자기 대화 답장, 리마인드 답장 판단 결과 연결, 2026-11-07 PM 자기 리마인드 대화 구역, 2026-11-08 담당자를 찾지 못한 답장 카드의 담당자 고르기)
- 이슈: #245, 후속 #315(실제 API 연결), #368(묶음 합치기), #370(재촉 만들기·태스크 빼기), #367(PM 자기 대화 답장), #344(리마인드 답장 판단 결과, 2026-11-08 담당자 고르기), #417(PM 자기 리마인드 대화 구역)
- 대상: [M8 계획](plan.md) C 절의 구현 순서 1~6(결정 전)과 최종 게이트, 2026-11-01 사용자 결정(결정 4의 UI 범위 = 디자인 캔버스 기준, MSW 목)에 따른 재작업
- 상태 (2026-11-08, #344): **담당자를 찾지 못한 답장 카드에서 PM 이 담당자(미정 포함)를 골라야 승인할 수 있고, 고른 값이 `task_overrides.assignee_member_id` 로 나간다.** BE #460(PR #503) 판별과 공용 `Select` 를 따른다. MSW 기준으로 확인했고 실제 서버 연동은 미검증이다(아래 2026-11-08 절).
- 상태 (2026-11-07, #417): **PM 의 자기 리마인드 대화가 메시지 목록 맨 위 `내 리마인드` 구역에 따로 있고, 팀원 화면 규칙으로 그려진다.** `대화` 와 `답장 기다리는 중 N` 에서 빠지고 기기 알림 띠가 보인다. MSW 기준으로 확인했고 실제 서버 연동은 미검증이다(아래 2026-11-07 #417 절).
- 상태 (2026-11-06, #344): **AI 가 태스크를 정하지 못한 답장을 PM 이 대화에서 고르고, 태스크 기록이 답장과 그 답장이 바꾼 값을 한 칸으로 보이며, PM 이 자동 반영을 되돌린다.** 답장에서 온 승인은 답장을 근거로 보이고 알림 두 종류에 제목이 생겼다. MSW 기준으로 게이트·E2E 를 돌렸고 실제 서버 연동은 미검증이다(아래 2026-11-06 #344 절).
- 상태 (2026-11-06, #367): **팀원 행에도 연결된 PM 이 자기 대화에서 웹 답장을 쓴다.** 남의 대화와 워크스페이스 응답에 `member_id` 가 없거나 `null` 인 경우는 지금처럼 안내 바다. MSW 기준으로 게이트·E2E·브라우저 확인을 했고 실제 서버 연동은 미검증이다(아래 2026-11-06 #367 절).
- 상태 (2026-11-05, #370): **PM 이 태스크 상세와 메시지 화면에서 재촉을 직접 만들고, 보내기 전 확인에서 묶은 태스크를 빼거나 메모를 고친다.** MSW 기준으로 게이트·E2E·브라우저 확인을 했고 실제 서버 연동은 미검증이다(아래 2026-11-05 #370 절).
- 상태 (2026-11-04, #315): **화면을 계약 §5.7 의 실제 메시지 API 로 옮기고 production 을 포함한 모든 모드에서 연다.** 준비 중 안내와 MSW 모드 분기는 지웠다. 서버에 경로·값이 없는 시안 항목(답장 판정, `지금 바로`, 채널, 재촉 이유 등)은 뺐다. typecheck·lint·format·build·전체 테스트와 브라우저 확인은 MSW 기준으로 통과했고, 실제 서버 연동은 미검증이다(아래 2026-11-04 절). 아래 2026-11-02 까지의 상태 문장은 그때 기록이다.
- 상태 (2026-11-02 까지): **AC-01~AC-07 충족(프론트·MSW 기준, UI/UX만), 목록·보내기 전 확인·대화·빈 상태가 디자인 캔버스의 항목·문구·상태와 일치(차이표, 남은 차이 4개는 아래).** 메시지 API가 없어 화면은 MSW 모드에서만 보이고, 실 API 모드와 production은 기존 「메시지는 준비 중이에요」 안내를 그대로 둔다. 보내기 전 확인의 행동(발송·보내지 않음·고쳐 쓰기·발송 시점, 대화의 승인·반려)은 MSW 목으로 서버 성공 뒤 반영한다. 권한 분기·상태 동기화(polling)·메시지 E2E는 하지 않았다. 전체 `test:e2e`는 실행하지 않았다. 실제 메시지 API 연동과 Discord 발송은 범위 밖이며 검증하지 않았다.

## 2026-11-08 담당자를 찾지 못한 답장 카드의 담당자 고르기 (#344)

### 근거와 요약

#344 의 둘째 PR 이다. 첫 PR #479 는 병합됐다. 근거는 2026-11-06 사용자 결정(#460 본문 「FE 쪽」), BE #460 의 마지막 댓글(구현 명세, PR #503 으로 2026-11-07 병합), 코디네이터 작업 지시다. 계획 [plan.md](plan.md)에 이 작업의 완료조건이 없어 새 AC 를 만들지 않았다. 2026-11-07 에 #460 합의 전으로 만든 커밋(`3b8c0f7a`·`2b5835a6`·`78dc4088`) 위에 develop 을 합치고(`bffe908d`) BE 명세에 맞췄다.

| 커밋 | 요지 |
|---|---|
| `3b8c0f7a` | 을/를 고르기를 `shared/lib/korean` 으로 옮긴다 |
| `2b5835a6` | 담당자 고르기 첫 구현(분류로 판별, 기본 `select`) |
| `bffe908d` | develop 합치기. 승인 상세는 develop 구조를 따르고 Storybook 스토리 변경은 버렸다(#482) |
| `2156c10a` | MSW 가 BE 처럼 담당자 줄이 있는 답장 카드만 담당자를 받는다. 미정 승인의 타임라인 값 |
| `59cb0a30` | BE 판별, 공용 `Select` 조립, 팀원 ID 를 승인 계획에 넘김, 처리된 카드 표시 |
| `835a2f99` | 계약(보완값 표·`task_overrides` 서버 동작 표·§5.7), 이 결과 |
| `489f0a2b` | 독립 리뷰 반영. MSW 타임라인 결과를 BE `_result` 와 같은 조건으로 |
| 이 커밋 | 리뷰 반영의 결과 기록 |

### 바꾼 데이터 모양

- `TaskUpdateApproval.assigneePick: { raw: string } | null`. payload 에 `reply_message_id` 가 있고, `assignee_member_id` 키가 없고, `assignee_raw` 가 비지 않은 문자열이면 채운다. `category` 는 보지 않는다. 상태와 담당자가 섞인 카드는 `category` 가 첫 줄을 따르기 때문이다(#460).
- 고른 값은 기존 `TaskUpdateEdits.assigneeMemberId` 다. `undefined` 는 아직 고르지 않음, `null` 은 미정이다. `useTaskUpdateOverrides` 가 `assigneePick`·`assignee`·`setAssignee` 를 함께 낸다.
- 처리된 승인의 `payload.task_overrides.assignee_member_id` 를 읽어 `반영한 값` 에 보인다.

### 화면

- 승인 상세의 변경 입력 칸 위에 안내 「답장에서 말한 담당자 ‹이름›을/를 팀원에서 찾지 못했어요. 담당자를 골라 주세요.」와 담당자 칸이 있다. 칸은 승인 확인(E-6)과 같은 `Label`+`Select`+`assigneeOptions`+`ASSIGNEE_NONE_OPTION` 조립이다. 고르기 전에는 `담당자 고르기` 와 레드 R2 이고, 칸은 안내 문장을 설명으로 잇는다. 생성 승인 화면은 바꾸지 않았다.
- 고르기 전과 팀원 목록을 받기 전에는 승인이 막힌다(`담당자를 골라 주세요.`·`팀원 목록을 불러온 뒤 승인할 수 있어요.`). 반려는 늘 된다. 상태와 섞인 카드도 같다. #460 의 확인할 것 1번에 코디네이터가 이렇게 답했다(2026-11-08).
- 고르기 전에는 바꿀 값이 없어 비교표를 그리지 않는다. 고르면 `담당자` 줄이 생긴다. 처리된 카드에서 원래 제안이 비어 있으면 그 절을 그리지 않는다.
- 400·404 응답이면 공통 오류 문구가 보이고 카드는 대기로 남아 다시 고를 수 있다.
- 담당자를 찾은 카드에서 다른 사람으로 고치기는 범위 밖이다(BE 는 받는다).

### MSW

- `assignee_member_id` 는 답장 판단 기록에 담당자 줄이 있는 `task_update` 만 받는다. 그 밖의 `task_update` 는 400 `INVALID_REQUEST` 다. 문자열이 아니면 400, 빈 문자열·없는 팀원은 404 `MEMBER_NOT_FOUND`, 다른 공간 팀원은 400 `WORKSPACE_MISMATCH` 다. 충돌은 값 검증보다 먼저 본다. 모두 기존 경로를 그대로 쓰고 픽스처와 모의 DB 버전은 바꾸지 않았다.
- 미정을 골라 승인하면 타임라인 줄의 `new_value` 가 답장 속 이름이 아니라 이력의 `null` 이다. 전에는 `??` 로 이름이 보였다.
- 타임라인 결과의 `noted` 는 BE `_result` 처럼 이력이 없고 원래 payload 에 `assignee_member_id` 키가 없을 때만이다. Codex 독립 리뷰가 찾은 낮음 1건으로, 전에는 담당자를 찾은 카드를 지금 담당자로 덮어써도 `noted` 였다(`489f0a2b`).

### 검증

2026-11-08, Node v24.11.0, `59cb0a30` 코드 기준이다. 리뷰 반영(`489f0a2b`) 뒤 다시 돌린 전체 테스트는 3,397개 중 무관한 3파일(`meetingProcessing`·`meetingUpload`·`tasks`) 4개가 시간 초과로 실패했고, 그 3파일만 다시 돌려 117개가 통과했다. 바꾼 곳 3파일 29개는 통과했다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 1 | git 이 제외하는 `.verify/` 파일 10개만 걸렸다. 추적하는 파일은 통과다 |
| `npm run build` | 0 | |
| `npm run test -- --maxWorkers=1` | 0 | 271파일 3,396개 통과 |

- 화면: [replyApprovals](../../../src/app/replyApprovals.test.tsx). 고르기 전 막힘·반려 가능·안내 설명 연결, 팀원을 고르면 `{assignee_member_id:'mb_02'}` 를 보내고 태스크 담당자와 처리된 카드의 `반영한 값` 이 바뀜, 미정이면 `null`, 찾은 카드·상태만 카드에는 칸이 없음, 섞인 카드도 막힘, 400·404 뒤 카드가 남고 문구가 보임.
- MSW: [replyTimeline](../../../src/shared/mock/replyTimeline.test.ts). 미정 승인 `approved`·`null`, 못 찾은 카드에서 지금 담당자를 고르면 `noted`, 찾은 카드도 받고 지금 담당자로 덮어쓰면 `approved`, 받지 않는 카드·문자열 아님 400, 빈 문자열·없는 팀원 404, 다른 공간 400, 충돌이 404 보다 먼저.
- 모델: [mapper](../../../src/entities/approval/model/mapper.test.ts) 판별(분류 무관, 이름 없음·키 있음·답장 아님은 null), 저장된 보완값.
- 브라우저: MSW 모드 개발 서버의 Chromium 에서 1280·390 폭으로 `reply-judgment` 시나리오의 `ap_32` 를 열어 고르기 전 막힘, 박민수를 골라 승인, 요청 본문, 태스크 상세의 담당자·기록 `승인함` 을 확인했다. 390 폭에서 미정을 골라 `null` 이 나가는 것도 확인했다. 가로 넘침은 없었다. 증거는 `frontend/.verify/e2e-344/`(git 제외).

### 남은 문제

- 실제 서버에 붙여 보지 않았다. MSW 기준이다.
- 승인 처리 요청은 세션이 끝나도 취소 신호(`signal`)를 받지 않는다. 응답 뒷처리는 `captureSession` 으로 버린다. 이번에 새 쓰기 경로를 만들지 않아 그대로 두었다.
- 404 `MEMBER_NOT_FOUND` 뒤 팀원 목록을 다시 받지 않는다. 탈퇴한 팀원이 목록에 남아 있으면 PM 이 다른 사람을 다시 골라야 한다.
- 팀원 목록을 받는 동안의 막힘은 화면 테스트가 없다.

## 2026-11-07 PM 자기 리마인드 대화 구역 (#417)

### 근거와 요약

이슈 #417 의 할 일과 사용자 결정 둘(2026-11-06 PM 자기 대화 표시, 2026-11-07 구역 이름 `내 리마인드`)과 코디네이터 작업 지시에 따랐다. 계획 [plan.md](plan.md)에 이 작업의 완료조건이 없어 새 AC 를 만들지 않았다. 기준은 `5307760d`(#479 병합 직후)다.

#367 뒤에도 메시지 화면의 표시 규칙은 보는 사람의 역할 하나로 정해졌다. 그래서 PM 이 자기 대화를 열면 봇 말풍선이 오른쪽에 오고, 자기 답장을 기다리는 표시가 붙고, 기기 알림 띠가 없었다. 이제 규칙을 (역할, 대화 주인)으로 고른다.

| 커밋 | 요지 |
|---|---|
| `5a97ddcb` | `VIEWER_POLICY`·`canReply` 를 `threadPolicy` 하나로 바꾸고, 목록 맨 위에 `내 리마인드` 구역을 둔다. 단위 테스트, 스토리 `PM_내_대화` |
| `417b4115` | 화면·MSW 테스트(구역 순서·상세 규칙·기다림 개수·알림 클릭·알림 띠·`member_id` 없음) |
| `345e496d` | `messages-reply.e2e.ts` 에 구역 여정 |
| 이 커밋 | 계약 §4.2.1·§5.7, 이 결과, 파트 README |

### 바꾼 데이터 모양

- `ThreadPolicy` 는 대화 하나를 그리는 규칙이다. 칸은 `ownSender`·`awaiting`·`pushPrompt`·`pickTask`·`reply`·`section` 이다. 표 `THREAD_POLICY` 의 세 줄(`pm` 남의 대화, `pmSelf` 자기 대화, `member`)을 `threadPolicy(viewer, threadMemberId)` 가 고른다. PM 은 `viewer.memberId` 가 대화의 `memberId` 와 같을 때만 `pmSelf` 다. `memberId` 가 `null` 이면 같을 수 없어 옛 백엔드에서는 구역이 생기지 않는다.
- 답장 칸 판정 `canReply` 는 표의 `reply` 칸이 되었다. 목록 행, 구역 나누기, 기다림 개수, 상세, 대화 빌더가 모두 이 함수 하나를 쓴다.
- `compose`(새 재촉)는 대화마다가 아니라 화면 하나의 권한이라 표에서 빼고 `viewer.role === 'pm'` 으로 둔다.
- `buildConversation` 은 `replyable` 인자를 받지 않고 `policy.reply` 를 읽는다.

### 화면

- PM 의 목록은 `내 리마인드` → `보내기 전 확인` → `대화` 순서다. 자기 대화가 없으면 구역을 그리지 않는다. 구역은 기존 대화 행 모양을 그대로 쓰고 행 제목은 팀원 화면처럼 `{봇 이름} 봇` 이다.
- `대화` 와 `답장 기다리는 중 N` 에는 남의 대화만 든다. 남의 대화가 없으면 `대화` 에 `아직 주고받은 대화가 없어요.` 를 보인다.
- 자기 대화의 상세는 팀원 화면 규칙이다. 봇이 왼쪽, 자기 답장이 오른쪽이고, 머리 배지·목록 점·`여기서부터 답장이 없습니다` 가 없으며, #411 기기 알림 띠가 보인다(다시 띄우지 않는 조건은 그대로).
- PM 권한 기능은 그대로다. 그 대화의 예정 묶음은 왼쪽 점선 말풍선과 `확인하기` 로 남고, `보내기 전 확인` 에도 있다. 답장의 태스크 고르기도 PM 이라 남는다.
- 알림을 눌러 `/messages/threads/{자기 대화}` 로 오면 선택은 지금처럼 주소가 정하고, 그 행이 `내 리마인드` 구역에 있어 거기서 골라진다. `selection.ts` 는 바꾸지 않았다.

### 검증

2026-11-07, Node v24 기준이다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 1 | git 이 제외하는 `.verify/reports/decisions-417.md` 만 걸렸다. 추적하는 파일은 통과다 |
| `npm run build` | 0 | |
| `npm run test -- --maxWorkers=1` | 중단 | 메모리 부족으로 시스템이 중간에 멈췄다. 그때까지 167파일 2,548개가 통과했고 실패한 단언은 없었다. 나머지 74파일은 워커가 시작하지 못해(종료 코드 3221225794) 돌지 않았다. 전체 묶음은 CI 에 맡긴다 |
| `npx vitest run` 바꾼 테스트 4파일 `--maxWorkers=1` | 0 | 74개 통과(`viewer`·`conversation`·`messagesMsw`·`browserPushPrompt`) |
| `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run messages` | 0 | Chromium 14개 통과(새 #417 여정 포함). 증거는 저장소 루트 `.verify/managers-manager/2026-11-06T16-09-11-046Z-messages-1112be91/` (git 제외), `cleanup.json` 의 `portOpen: false` |

- [viewer](../../../src/widgets/message-inbox/model/viewer.test.ts): 팀원, 팀원 행이 없는 팀원, PM 의 남의 대화, PM 의 자기 대화, 팀원 행이 없는 PM.
- [conversation](../../../src/widgets/message-inbox/model/conversation.test.ts): PM 자기 대화에서 봇은 왼쪽, 자기 답장은 오른쪽, 예정 묶음은 왼쪽, 제목은 봇 이름, 기다림 줄 없음.
- [messagesMsw](../../../src/app/messagesMsw.test.tsx): 구역 순서와 행 위치, `답장 기다리는 중 2`(자기 대화를 넣으면 3), 상세의 배지·기다림 줄 없음과 말풍선 자리·답장 칸·`확인하기`, `reminder_sent` 알림을 누르면 `내 리마인드` 의 행이 골라짐, 기본 PM 시나리오에는 구역 없음, `member_id` 가 없거나 `null` 이면 구역 없음.
- [browserPushPrompt](../../../src/app/browserPushPrompt.test.tsx): PM 자기 대화에 알림 띠가 보이고, PM 이 보는 남의 대화에는 없다.
- 깨 보기: 구현 위임이 `threadPolicy` 가 늘 `pm` 을 돌려주게 바꾸면 74개 중 21개가 실패했다. `memberId` 가 `null` 일 때도 자기 대화로 보게 하면 `member_id` 없음 2개가, 모든 PM 대화를 자기 대화로 보게 하면 기본 시나리오 1개가 실패했다. 모두 되돌렸다.
- 브라우저 화면(새 여정의 마지막 장면)에서 목록 맨 위 `내 리마인드`, 봇 왼쪽·자기 답장 오른쪽, 기다림 배지 없음, 답장 칸, 왼쪽 점선 예정 말풍선과 `확인하기` 를 눈으로 확인했다. 알림 띠는 E2E 의 이 시나리오에 푸시 공개키가 없어 보이지 않는다. 띠는 화면 테스트가 본다.

### 남은 문제

- 실제 서버에 붙여 보지 않았다. MSW 기준이다.
- Storybook play 는 실행하지 않았다(CI 가 돈다).
- MSW 시나리오 `messages-pm-self` 의 설명 주석은 응답 데이터 기준(th_06 이 남의 대화들 사이에 온다)이라 고치지 않았다.

## 2026-11-06 리마인드 답장 판단 결과 연결 (#344)

### 근거와 요약

이슈 #344 본문(BE 의 FE 요청)과 BE #345 의 코드(`api/messages.py`·`api/tasks.py`·`services/replies.py`·`schemas/reply.py`), 계약 §5.7 「리마인드 답장 판단」을 따랐다. 계획 [plan.md](plan.md)에 이 작업의 완료조건이 없어 새 AC 를 만들지 않았다. 기준은 `d98a754a`(#345 병합 직후)다. D-179 는 사용자 결정으로 확정했다([결정](../../decision/frontend-decisions.md)).

| 커밋 | 요지 |
|---|---|
| `22c208a1` | 응답 타입 `reply.ts`, 오류 코드 3개, MSW 판단 기록 `reply-state.ts`, 시나리오 `reply-judgment`·`reply-judgment-member`, 모의 DB 버전 14 |
| `fcaeed38` | 알림 `reply_judged`·`reply_unjudged` 제목과 메시지 알림 분류. 모르는 종류 예시 픽스처를 다른 종류로 바꿨다 |
| `58b41965` | 답장에서 온 `task_update` 승인의 `replyMessageId`, 승인 상세의 `팀원 답장` 근거 |
| `0197947e` | D-179 확정, D-058·D-059 와의 관계 |
| `aca20295` | 태스크 고르기(`attributions` 쿼리, 쓰기 행동 `attribute`, `AttributionPicker` 복원), MSW 두 경로 |
| `f564dcd7` | 태스크 기록(`/history`+`/timeline`), 되돌리기 훅, MSW 두 경로와 승인 이력 잇기 |
| `41a745bd` | E2E `reply-judgment.e2e.ts`, 검증 스킬 `messages` 여정 |
| `23b56387` | 계약 §5.7, 이 결과, README |
| `627da256` | 독립 리뷰 1. 알림 종류마다 다시 받을 캐시 표, 판단 알림에 태스크·승인 다시 받기 |
| `818479bc` | 독립 리뷰 2. 되돌리기 404 면 볼 수 없는 태스크로 바꾸기 |
| 이 커밋 | 리뷰 반영의 계약·결과 |

### 바꾼 데이터 모양

- `ReplyAttribution = {kind:'needsPick', candidates} | {kind:'picked', task|null}`(메시지 엔티티). 고르기는 기존 메시지 쓰기 표(`ROUTE`)의 한 줄이라 세션 범위·중복 막기·실패 표시를 그대로 쓴다.
- `TaskTimelineItem = {kind:'reply', …, changes: ReplyChangeLine[]} | {kind:'history', entry: TaskHistoryEntry}`(태스크 엔티티). 이력 칸은 `/history` 의 같은 행으로 채워 변경자·되돌림을 잃지 않는다. 두 응답을 기존 이력 키 하나에 두었다. 상태 변경·승인이 그 키를 `exact` 로 무효화해, 따로 키를 두면 상태를 바꾼 뒤 기록이 갱신되지 않았다(기존 `tasks.test.tsx` 2개가 잡았다).
- 결과 표시·바뀐 값 문구는 `Record` 표(`widgets/task-detail/lib/history.ts`)다.
- MSW 는 판단 결과만 기록하고 판단은 하지 않는다. 이력과 답장 줄의 연결은 `historyLinks`(history_id → change_id)로 두어 `/history` 응답 모양을 건드리지 않는다.

### 검증 (2026-11-06, Node v24.11.0)

`fb0b6eb8`(리뷰 반영 전)에서 `npm run test -- --maxWorkers=1` 은 240파일 2,899개 중 1개(서버 코드 개수 단언 51 → 54)가 실패해 고쳤다. typecheck·lint·build 는 통과했다. format:check 는 git 이 제외하는 `.verify/` 파일만 걸렸다.

- 화면 테스트: [messagesAttributionMsw](../../../src/app/messagesAttributionMsw.test.tsx)(고르기·해당 없음·중복 누름·5xx 다시 시도·409 다시 받기·고르기 오류에도 대화 보임·늦게 온 고르기의 스크롤·팀원은 요청 없음), [taskReplyTimeline](../../../src/app/taskReplyTimeline.test.tsx)(묶음·되돌리기·팀원 안내), [replyApprovals](../../../src/app/replyApprovals.test.tsx)(답장 근거).
- MSW: [replyTimeline](../../../src/shared/mock/replyTimeline.test.ts)(묶음·숨김·되돌리기·409·403·승인 이력 잇기), [messageScenarios](../../../src/shared/mock/messageScenarios.test.ts)(고르기 403·404·409·400).
- 세션: [useReplyChangeUndo](../../../src/features/reply-change-undo/model/useReplyChangeUndo.test.tsx)는 오프라인으로 멈춘 사이 세션이 바뀌면 요청·토스트가 없다.
- E2E: 검증 스킬 `run messages` 13개 통과(새 3개 포함). 증거는 저장소 루트 `.verify/managers-manager/2026-11-06T12-19-23-963Z-messages-6baeafab/`(git 제외). `restore.e2e.ts`·`tasks-approval.e2e.ts` 22개도 통과했다.

### 독립 리뷰 반영 (2026-11-06)

Codex 독립 리뷰(`d98a754a..fb0b6eb8`, 리베이스 전 해시)가 중간 결함 둘을 찾았다. 둘 다 고치기 전 테스트가 실패하는 것을 확인했다.

- **판단 알림이 태스크·승인을 다시 받지 않았다.** BE 는 태스크를 바꾸고 승인 요청을 만든 뒤 `reply_judged` 를 보내는데, 종은 메시지만 무효화했다. 이제 알림 종류 표가 종류마다 다시 받을 캐시(`messages`·`tasks`·`approvals`)를 정하고, 종이 처음 보는 알림의 합집합을 그 공간에서 무효화한다. `reply_judged` 는 셋 다, `reply_unjudged` 는 메시지·태스크(판단하지 못한 답장도 막힘을 풀 수 있다)다. 같은 이유로 `silence_blocked` 도 태스크를 다시 받는다. 잘려 보이지 않은 알림이 있을 수 있는 경우는 셋 다 다시 받는다. 훅 이름을 `useRefreshOnNotification` 으로 바꾸고 `isMessageNotification` 을 `notificationRefreshes` 로 옮겼다. 회귀 테스트 [replyJudgmentRefresh](../../../src/app/replyJudgmentRefresh.test.tsx) 3개(태스크 상세의 상태·기록, 대시보드 확인 대기 수, 판단 실패 알림의 상태)는 고치기 전 셋 다 알림 뒤 단언에서 실패했다.
- **되돌리기 404 뒤 지운 태스크가 남았다.** 이제 404 `TASK_NOT_FOUND` 면 상세 쿼리를 비우고(`resetQueries`) 다시 받아 기존 「이 태스크를 볼 수 없어요」로 바뀌고, 이력을 지우고 목록을 다시 받는다. [taskReplyTimeline](../../../src/app/taskReplyTimeline.test.tsx)의 새 테스트는 목록을 먼저 받은 뒤 상세에서 지워진 태스크를 되돌린다. 고치기 전에는 볼 수 없음 화면을 찾지 못해 실패했고, 목록 무효화만 빼면 목록에 지운 태스크가 남아 실패한다.

### 남은 문제

- 실제 서버에 붙여 보지 않았다. 봇이 다시 판단한 결과가 화면에 오는 흐름은 MSW 가 흉내 내지 않는다.
- 대화 목록에는 `답장 확인 필요` 표시가 없다(위 계약 FE 연결).
- 한 답장에 되돌릴 줄이 여럿이면 `되돌리기` 버튼 이름이 같다. 지금 데이터에서는 줄마다 하나다.
- 담당자를 찾지 못한 답장 카드의 담당자 고르기는 BE #460 배포 뒤 둘째 PR 로 붙였다(위 2026-11-08 절).

## 2026-11-06 메시지 갱신과 메시지 E2E (#371)

### 근거와 요약

이슈 #371 본문과 댓글(기본 방향), 코디네이터 결정 기록 10절에 따랐다. 계획 [plan.md](plan.md)에 이 작업의 완료조건이 없어 새 AC 를 만들지 않았다. 기준은 `3a52f72c` 다. 결정·근거·버린 대안은 [D-117·D-136](../../decision/frontend-decisions.md)과 [결정 기록](basis-for-decision/2026-11-06-message-sync-and-e2e.md)에 있다.

메시지 화면은 화면 재진입·탭 복귀·행동 성공 때만 다시 받았다. 이제 AI 초안을 기다리는 동안과 메시지 알림이 왔을 때도 다시 받는다. 상시 polling 은 없다.

| 커밋 | 요지 |
|---|---|
| `c2df6083` | 목록·대화 쿼리의 `refetchInterval` 함수(초안 대기 중 10초, 탭이 가려지면 멈춤). 알림 종류 표에 메시지 알림 여부를 더하고, 종이 처음 보는 메시지 알림을 받으면 `messageKeys` 를 무효화한다. 화면 테스트 `messagesSync` |
| `a43dc638` | E2E `messages-approve.e2e.ts`(승인 → 예정, 409, 초안 도착), `messages-reply.e2e.ts` 에 팀원 답장. 검증 스킬 `messages` 여정에 새 파일 |
| 이 커밋 | 결정 D-117·D-136, 계약 §5.7, 결정 기록, 이 결과 |

### 바꾼 데이터 모양

- 새 타입·필드는 없다. 이미 있던 `Bundle.drafting`(`draft_status !== 'done'`)이 다시 받기를 정한다. 목록은 PM 의 `bundles`, 대화는 `upcoming` 을 본다. 팀원 목록에는 묶음이 없어 다시 받지 않는다.
- 알림 종류마다 제목과 메시지 알림 여부를 한 표(`KINDS`)에 둔다. `reminder_sent`·`nudge_suggested`·`nudge_reapprove`·`reminder_auto_cancelled` 가 메시지 알림이고 `silence_blocked`·모르는 종류는 아니다.
- 알림 기준점은 메시지 알림 ID 집합, 지난 목록 전체의 ID 집합, 그때의 세션 세대다(`useRefreshMessagesOnNotification`). 첫 목록과 세션이 바뀐 뒤 첫 목록은 기준이라 무효화하지 않는다. 알림 목록은 `limit=50` 으로 받는다.
- 갱신은 쿼리 단위다. #417 이 PM 자기 대화를 별도 구역으로 떼도 대화 목록 구조에 묶이지 않는다.

### 이미 있던 E2E 와 더한 것

- 이미 있던 것: PM 자기 대화 답장과 남의 대화 안내 바(#367, `messages-reply.e2e.ts`), 재촉 만들기·태스크 빼기·메모 고치기(#370, `messages-reminder.e2e.ts`).
- 더한 것: 승인 → 토스트·`09/23 발송 예정`·대화의 `발송 예정 · 승인함`과 새로고침 뒤 유지, 409 `BUNDLE_CHANGED` 안내 뒤 새 문구로 승인, 일반 팀원(`messages-member`)의 웹 답장, 초안 대기 묶음이 손대지 않아도 끝난 문구로 바뀌기.
- 409 와 초안 도착은 페이지에서 Vite 개발 서버의 모의 DB 모듈(`/src/shared/mock/db.ts`)을 가져와 묶음을 바꾼다. MSW handler 와 응답 모양은 바꾸지 않았다. 409 는 바꾸기와 누르기를 한 작업 안에서 해 그 사이에 polling 응답이 끼지 않는다.

### 검증 (2026-11-06, Node v24.11.0)

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 1 | git 이 제외하는 `.verify/decisions-2026-11-05.md` 만 걸렸다. 바꾼 파일의 `prettier --check` 는 통과다 |
| `npm run build` | 0 | |
| `npm run test -- --maxWorkers=1` | 0 | 223파일 2,668개 통과. 주석 정리·이름 바꾸기 전 코드로 돌렸고, 그 뒤 바꾼 곳 8파일 52개를 다시 돌려 통과했다 |
| `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run messages` | 0 | Chromium 9개 통과(새 4개 포함). 증거는 저장소 루트 `.verify/managers-manager/2026-11-06T02-33-47-006Z-messages-53f9b2d0/` (git 제외) |

- [messagesSync](../../../src/app/messagesSync.test.tsx) 8개: 초안 대기 중 10초에 한 번 받아 새 문구를 보이고 끝나면 멈춤, 대기 없으면 안 받음, 탭이 가려지면 안 받음, 대화도 받음, 로그아웃 뒤 안 받음, 첫 알림 목록은 안 받고 자동 취소 알림에 받아 묶음이 빠짐, 태스크 알림에는 안 받음, 세션이 바뀐 뒤 첫 목록은 새 기준.
- 구현 위임이 코드를 일부러 깨 보았다. 늘 받기(6개 실패), 안 받기(2개), 백그라운드에서 받기(1개), 세션 검사 빼기(1개), 모든 종류를 메시지 알림으로(1개), 첫 목록에 무효화(3개)를 모두 잡았다. 로그아웃 테스트는 앱 정리와 TanStack 동작을 보는 것이라 이 깨기로는 실패하지 않는다.
- 초안 도착 E2E 는 `refetchInterval` 을 지운 모듈을 내준 임시 실행에서 15초 뒤에도 옛 문구로 남아 실패했다. 409 E2E 는 `--repeat-each=5` 로 5번 통과했다.

### 남은 문제

- 실제 서버에 붙여 보지 않았다. MSW 기준이다. 실서버 확인은 #366·#357 이 맡는다.
- 팀원 Discord 답장과 DM 전달 결과는 BE 알림이 없어 이번에도 화면 재진입·탭 복귀·행동 성공 때 보인다.
- 10초 간격은 AI 워커 주기에서 정했고 실제 요청 부하는 재지 않았다.
- ~~TanStack 의 간격은 관찰자(observer)가 살아 있는 동안 쿼리가 지워져도 계속 돈다(query-core 소스). 앱은 로그아웃에서 화면을 내려 관찰자가 없어진다. 지우기와 내리기 사이의 짧은 틈은 기존 알림 목록 polling 과 같다.~~ 독립 리뷰 반영으로 고쳤다(아래).
- E2E 의 `Scenario` 이름 목록은 `MockScenario` 를 손으로 베낀 것이다. 이번 범위 밖이다.

### 독립 리뷰 반영 (2026-11-06, `1255bd80`)

Codex 독립 리뷰가 중간 결함 둘을 찾았다.

- **끝난 세션의 화면이 다음 세션으로 다시 받았다.** TanStack 의 간격은 관찰자가 구독 중이면 캐시를 지워도 돈다. 로그아웃 전환 중 남은 이전 화면이 다음 틱에 새 세대의 요청을 보냈다. 이제 메시지 조회 옵션이 만들 때 세션 범위를 잡는다. 요청은 그 세션의 신호(`AbortSignal.any`)로 보내 끝난 세션이면 보내기 전에 취소되고, 그 세션이 끝나면 `refetchInterval` 이 `false` 다.
- **꽉 찬 알림 목록 밖으로 밀린 메시지 알림을 놓쳤다.** 이제 알림 목록을 `limit=50` 으로 받고, 지난 목록 전체의 ID 를 기억한다. 꽉 찬 새 목록이 지난 목록과 겹치지 않으면 한 번 무효화한다. 같은 목록이 다시 오면 무효화하지 않는다.
- 회귀 테스트: [messageQueries](../../../src/entities/message/api/messageQueries.test.ts)의 목록·대화 각 1개는 이전 관찰자를 구독한 채 세대를 올리고 캐시를 취소·제거한 뒤 30초 동안 메시지 요청 0건, 새 세션 구독은 받고 10초 뒤 다시 받는지 본다. [messagesSync](../../../src/app/messagesSync.test.tsx)의 1개는 자동 취소 알림 뒤 더 최신 태스크 알림 50개가 쌓여도 한 번 다시 받아 묶음이 빠지고, 같은 목록이 다시 오면 받지 않는지 본다. 세션 변경 테스트는 이전 세션 화면의 쿼리가 무효화돼도 요청이 나가지 않는 것까지 본다.
- 이전 코드(`09ad58fb` 의 `messageQueries.ts`·`useRefreshMessagesOnNotification.ts`)로 되돌려 돌리면 이 넷이 모두 실패했다. 고친 코드에서는 바꾼 곳 17파일 187개가 통과했다. `npm run typecheck`·`npm run lint` 도 통과했다.

## 2026-11-06 PM 자기 대화 답장 (#367)

### 근거와 요약

이슈 #367 의 BE 구현 완료 댓글(PR #374, develop 병합)과 코디네이터 작업 지시에 따랐다. 계획 [plan.md](plan.md)에 이 작업의 완료조건이 없어 새 AC 를 만들지 않았다. 기준은 `bd44cec6` 이다.

PM 이 리마인드를 받는 팀원이기도 하면 자기 대화가 생긴다. BE 답장 API 는 대화 주인이면 PM 도 받는다. 전에는 화면이 로그인 계정의 팀원 행을 몰라 PM 의 자기 대화에도 답장 칸이 없었다. BE 가 워크스페이스 응답에 `member_id` 를 실어(계약 §4.2.1) 화면이 이 값을 대화의 `member_id` 와 비교한다.

| 커밋 | 요지 |
|---|---|
| `9d1a8e48` | 워크스페이스 DTO·매퍼에 `member_id` → `memberId`. MSW 워크스페이스 응답에 세션 팀원 ID |
| `0fe0830d` | `MessageViewer` 를 `{ role, memberId }` 로, 답장 칸은 `canReply` 하나가 정한다. 시나리오 `messages-pm-self`, 화면·MSW 테스트, 스토리 |
| `16d1184e` | E2E `messages-reply.e2e.ts` 와 검증 스킬 `messages` 여정 |
| `3fc61b84` | 계약 §4.2.1·§5.7 |
| `1ebe96c5` | 리뷰 R1. MSW 에서 공간을 만든 계정을 새 PM 행과 잇는다. 계정의 `memberIds`, 모의 DB 버전 12 |

### 바꾼 데이터 모양

- `WorkspaceSummaryDto.member_id?: string | null`. 필드가 없는 BE 배포 전 응답을 받으려고 선택 필드로 두었다. `WorkspaceSummary.memberId: string | null` 이고 매퍼는 `dto.member_id ?? null` 이다.
- `MessageViewer` 는 `Role` 에서 `{ role: Role; memberId: string | null }` 이 되었다. `VIEWER_POLICY` 는 역할로 고르고 값(봇 자리·답장 기다림·재촉 만들기)은 그대로다. 정책의 `foot` 을 지우고 `canReply(viewer, threadMemberId)` 를 두었다. (#417 에서 둘 다 `threadPolicy` 하나로 합쳤다.) 팀원은 늘 참이고, PM 은 `memberId` 가 그 대화의 `member_id` 와 같을 때만 참이다. `memberId` 가 `null` 이면 대화의 `member_id` 와 같을 수 없어 거짓이다.

### 화면

- PM 이 자기 대화를 열면 답장 칸이 보이고 머리 부제가 `Discord 개인 메시지 · 웹에서도 답장할 수 있어요` 다. 팀원 화면의 문구를 그대로 쓴다. 남의 대화는 지금처럼 안내 바와 `… 봇으로 보냄` 부제다.
- PM 자기 대화의 다른 표시는 PM 화면 그대로 두었다. 봇 말풍선은 오른쪽, PM 자신의 답장은 왼쪽에 자기 이름으로 그려진다. 답장 기다림 배지·목록 점·`여기서부터 답장이 없습니다`, 예정 묶음과 `확인하기` 도 보인다. 이슈와 작업 지시가 PM 정책을 그대로 두라고 했다. **#417 에서 바뀌었다.** 자기 대화는 목록 맨 위 구역에서 팀원 화면 규칙으로 그린다(위 2026-11-07 #417 절).

### MSW

- 워크스페이스 목록·상세·생성 응답에 `member_id: sessionMemberId(id)` 를 싣는다.
- 계정과 팀원 행의 대응을 `sessions.ts` 의 고정 상수에서 모의 DB 계정의 `memberIds` 로 옮겼다. 공간을 만들면 BE `create_workspace` 처럼 생성자 계정이 새 PM 행과 이어진다. 그래서 새 공간에서도 생성·목록·상세의 `member_id` 가 그 행 ID 이고 그 행 대화의 답장이 201 이다. 독립 리뷰 지적 R1 을 고친 것이다. 같은 대응으로 생성자 PM 행 초대가 BE 처럼 409 `MEMBER_ALREADY_LINKED` 가 되었다. 전에는 `PM_MEMBER_NOT_INVITABLE` 이었다. 모의 DB 버전이 12 가 되었다.
- 답장 핸들러는 이미 BE `post_reply` 처럼 대화 주인만 201, 아니면 403 이었다. 고치지 않았다.
- 시나리오 `messages-pm-self` 는 `messages-default`(PM `mb_01`)에 `mb_01` 의 대화 `th_06` 과 보낼 메시지 `bd_05` 를 더한다.

### 검증 (2026-11-06, Node v24.11.0, `0fe0830d` 코드 기준)

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 1 | git 이 제외하는 `.verify/` 의 로컬 파일 2개(`brief.md`, 증거 JSON)만 걸렸다. git 이 추적하는 파일만 `prettier --check --ignore-unknown` 으로 본 결과는 통과다 |
| `npm run build` | 0 | |
| `npm run test -- --maxWorkers=1` | 0 | 222파일 2,641개 통과 |
| `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run messages` | 0 | 5개 통과(새 `messages-reply.e2e.ts` 2개 포함). 증거는 저장소 루트 `.verify/managers-manager/2026-11-05T15-28-12-185Z-messages-16aaba50/` (git 제외) |

새 테스트:

- [messagesMsw](../../../src/app/messagesMsw.test.tsx): PM 자기 대화의 답장 칸·부제와 보낸 답장, PM 남의 대화의 안내 바, 워크스페이스 응답에 `member_id` 가 없을 때와 `null` 일 때 답장 칸 없음.
- [messageScenarios](../../../src/shared/mock/messageScenarios.test.ts): `messages-pm-self` 에서 워크스페이스 목록·상세의 `member_id` 가 `mb_01`, `th_06` 답장 201, `th_01` 답장 403 과 db 그대로.
- [mapper](../../../src/entities/workspace/model/mapper.test.ts): `member_id` 있음·`null`·없음.
- [messages-reply.e2e.ts](../../../e2e/messages-reply.e2e.ts): Chromium 에서 PM 자기 대화 답장을 보내고 새로고침 뒤에도 남는지, 남의 대화에는 폼이 없고 안내 바가 있는지.
- 스토리 `PM_내_대화`. Storybook play 는 실행하지 않았다(CI 가 돈다).
- 리뷰 R1 수정 뒤(`1ebe96c5`) 바꾼 곳의 테스트 36파일 604개가 통과했다. 세션·초대·저장·가입·워크스페이스를 쓰는 테스트, `messageScenarios`, `messagesMsw` 다. `typecheck` 와 바꾼 파일의 `eslint`·`prettier` 도 통과했다. Chromium 에서 `restore.e2e.ts` 4개와 `messages-reply.e2e.ts` 2개가 통과했다.
- [messageScenarios](../../../src/shared/mock/messageScenarios.test.ts)에 새 공간 테스트를 더했다. 공간을 만들면 생성·목록·상세의 `member_id` 가 생성자 PM 행이다. 그 행의 대화 답장은 201 이고, 같은 공간의 다른 계정이 답장하면 403 이며 db 는 그대로다. 생성 핸들러에서 대응을 기록하는 줄을 빼면 이 테스트가 실패한다.
- 구현 위임이 `canReply` 를 모든 PM 에게 참으로 바꿔 보았을 때 새 화면 테스트 4개 중 3개가 실패했다. 원래대로 돌려 두었다.

### 남은 문제

- 실제 서버에 붙여 PM 자기 대화 답장을 보내 보지 않았다. MSW 기준 확인이다.
- ~~PM 자기 대화의 말풍선 자리, 답장 기다림 표시, 예정 묶음 표시는 PM 화면 그대로다. 바꾸려면 화면 정책을 따로 정해야 한다.~~ 사용자가 정책을 정했고(2026-11-06) #417 에서 바꿨다. 예정 묶음 표시는 PM 권한 기능이라 그대로다.

## 2026-11-05 재촉 직접 만들기와 묶음에서 태스크 빼기·메모 고치기 (#370)

### 근거와 요약

이슈 #370 과 코디네이터 작업 지시(2026-11-05)에 따랐다. 진입점(태스크 상세와 메시지 화면 둘 다)과 보낼 시각 규칙(`SendTimingPicker` 재사용)은 같은 날 사용자가 정했다. 계획 [plan.md](plan.md)는 읽기만 했고, 계획에 이 작업의 완료조건이 없어 새 AC 를 만들지 않았다. 기준 브랜치는 #340(PR #407)의 `2244262c` 다. 코디네이터 허락으로 그 위에 한 번 다시 쌓았고 충돌은 없었다.

BE 의 `POST /messages/reminders`, `PATCH /messages/reminders/{id}`, `POST /messages/reminders/{id}/cancel`(#310)은 있었지만 화면이 부르지 않았다. 이제 PM 이 재촉을 직접 만들고, 보내기 전 확인에서 묶은 태스크 하나를 빼거나 메모를 고친다. 서버가 막지 않는 경우(담당자 없음·완료 태스크·Discord 미연결)를 화면이 다루는 방식은 [결정 기록](basis-for-decision/2026-11-05-reminder-create-entry-rules.md)에 있다.

| 커밋 | 요지 |
|---|---|
| `e562fb47` | 보낼 시각 고르기를 묶음에서 떼어 `entities/message-settings/ui` 로 옮긴다. `LockedButton`·`useShownAfter`·날짜 입력 변환은 `shared` 로 |
| `d621049c` | 행동 `removeTask`·`editNote`, 결과 `closed`, 행동 표의 응답 읽기, `createReminder` 요청 |
| `ed62497b` | MSW 세 경로를 BE 규칙과 오류 순서로. 모의 DB 버전 11 |
| `ead72a22` | 보내기 전 확인의 행마다 `메모 고치기`·`빼기`, 열린 것 하나를 담는 `ReviewDraft` |
| `dff59fea` | 태스크 상세 `재촉` 영역, 메시지 화면 `새 재촉`(`?new=reminder`), 재촉 만들기 폼 |
| `a8f89d2b` | M6 시나리오 테스트의 모의 DB 버전 단언 |
| `941abcf2` | E2E 두 개 더하기와 검증 스킬 `messages` 여정 |
| `270b1d9c` | 만든 뒤 알림을 돌려받은 묶음의 승인 상태로 고른다 |
| `be334dee` | 재촉 만들기 스토리 play 선택자 |
| 문서 커밋 | 계약 §5.7, [MSW 안내](../../msw-guide.md), 결정 기록, 이 결과 |

### 바꾼 데이터 모양

- `MessageAction` 에 `{ kind: 'removeTask'; bundleId; reminderId }` 와 `{ kind: 'editNote'; bundleId; reminderId; note: string | null }` 을 더했다. 결과 `MessageActionOutcome` 에 `{ kind: 'closed' }`(마지막 태스크를 빼 묶음이 `cancelled`)를 더했다.
- 행동 표(`ROUTE`)가 경로마다 응답 읽기(`read`)를 갖는다. 시각 옮기기는 합쳐졌는지, 빼기는 닫혔는지를 읽는다. 전에는 `schedule` 만 분기로 읽었다.
- 재촉 만들기는 대상 묶음이 아직 없어 행동이 아니다. `createReminder(workspaceId, { memberId, taskId, scheduledAt, note })` 가 `{ reminderId, bundle }` 을 돌려준다. 돌려받은 묶음이 예정이 아니면 계약 위반으로 던진다.
- 보내기 전 확인의 두 boolean(문구 고치기·시각 고르기)을 `ReviewDraft`(`none`·`body`·`time`·`note`·`remove`) 하나로 바꿨다. 잠금 이유는 종류별 표다.

### 화면

- 보내기 전 확인 `묶은 태스크` 행마다 `메모 고치기`·`빼기`. 빼기는 그 행 안에서 확인을 받는다. 마지막 태스크면 `마지막 태스크예요. 빼면 {이름}님에게 이 메시지를 보내지 않아요.` 와 `빼고 보내지 않기`, 성공하면 보내지 않음처럼 그 항목을 떠난다. 나머지는 `빼면 남은 태스크로 문구를 다시 만들어요.` 이고, 승인한 묶음이면 `승인이 풀려 다시 승인해야 해요.` 를 붙인다.
- 메모 칸은 지금 메모로 채워 열린다. 바뀐 값만 저장할 수 있고 비우면 지운다(`null`). 안내는 `메모를 바꾸면 문구를 다시 만들고 승인이 풀려요. 비우고 저장하면 메모를 지워요.` 다.
- 태스크 상세 `재촉`(PM 만): 담당자에게 만드는 폼을 그 자리에 펼친다. 만들면 결과와 `메시지 화면에서 확인하기` 링크를 `role=status` 로 알린다. 담당자가 없거나 완료한 태스크는 이유만 보인다.
- 메시지 화면 `새 재촉`(PM 만, 목록 머리와 빈 화면): 팀원과 그 팀원이 맡은 끝나지 않은 태스크를 고른다. 만들면 그 묶음의 보내기 전 확인으로 주소를 바꿔 끼운다. 팀원 화면에는 진입점이 없고 `?new=reminder` 도 무시한다.
- Discord 가 연결되지 않은 팀원은 막지 않고 팀 화면 연결 링크와 함께 알린다.
- 시안이 없는 화면이다. 승인 보완 폼의 select, 문구 고쳐 쓰기의 칸, 보낼 시각 카드를 그대로 썼다.

### MSW

세 경로가 BE 와 같은 순서로 403 → 400 → 404 → 409 를 낸다. 만들기는 대화가 없으면 만들고 같은 시각의 예정 묶음에 넣으며, 같은 태스크가 이미 있으면 그 리마인드를 그대로 돌려준다. 빼기·메모·더하기는 문구를 다시 만들고 판을 올리고 승인을 푼다. 리마인드에 `cancelled_at` 을 두어 닫힌 묶음의 응답에 마지막에 함께 뺀 리마인드만 싣는다. 모의 DB 버전이 11 이 되었다.

### 검증 (2026-11-05, Node v24.11.0, `2244262c` 위로 다시 쌓은 뒤)

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 1 | git 이 제외하는 로컬 작업 지시 파일 `.verify/brief.md` 하나만 걸렸다. `.verify/` 를 빼고 `.prettierignore` 를 그대로 쓴 `prettier --check .` 는 통과했다. CI 에는 이 파일이 없다 |
| `npm run build` | 0 | |
| `npm run test -- --maxWorkers=1` | 0 | 219파일 2,613개 통과 |
| `npm run test:storybook` | 1 → 0 | 처음에는 166개 중 재촉 만들기 스토리 2개가 실패했다(브라우저 접근 이름의 공백, 팀원 목록이 오기 전 고르기). `be334dee` 로 고친 뒤 다시 빌드해 166개 통과 |
| `npx playwright test` | 0 | 124개 통과(새 `messages-reminder.e2e.ts` 3개 포함) |
| `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run messages` | 0 | 3개 통과. 증거는 저장소 루트 `.verify/managers-manager/2026-11-05T12-30-34-456Z-messages-37dbc5c3/` (git 제외) |

새 테스트:

- [messagesReviewTasksMsw](../../../src/app/messagesReviewTasksMsw.test.tsx): 확인 뒤에만 빼기, 승인한 묶음의 경고와 취소 뒤 포커스, 마지막 태스크를 빼면 닫히고 떠남(REPLACE), 실패와 다시 시도, 메모 저장 본문(`{note}`)·빈 메모 `null`·없어진 리마인드.
- [reminderCreateMsw](../../../src/app/reminderCreateMsw.test.tsx): 고르기와 마감 기준 시각, 같은 시각 묶음에 합치기, 맡은 태스크 없음, 마감 지난 태스크, 지난 시각 409, 취소, 빈 화면 진입, 태스크 상세 만들기·취소, 담당자 없음·완료 태스크, 일반 팀원에게 진입점 없음.
- [messages-reminder.e2e.ts](../../../e2e/messages-reminder.e2e.ts): `새 재촉` 으로 만들고 새로고침, 태스크 빼기와 메모 고치기 뒤 새로고침, 태스크 상세에서 만들고 링크로 이동. 구현 위임이 쓴 첫 테스트는 실행하지 않은 상태였고, 브라우저 접근 이름(`마감 하루 전 09/21 09:00`, 사이 공백)과 알림 두 곳 중복 때문에 선택자를 고쳐 통과시켰다.
- 단위: `messageQueries`(경로·본문·응답 읽기), `mapper`, `message-state`·`messageScenarios`(BE 규칙), `reviewDraft`, `sendTiming`, `createMessages`, `selection`, `routes`.

### 남은 문제

- 실제 서버에서 세 경로를 불러 보지 않았다. MSW 기준 확인이다.
- 완료 태스크 차단은 FE 기본값이다. 서버는 막지 않는다.
- 목의 시각은 고정이라 연달아 뺀 리마인드의 `cancelled_at` 이 같다. 그래서 MSW 에서는 닫힌 묶음 응답에 앞서 뺀 리마인드까지 들어갈 수 있다. 화면은 닫힌 묶음의 리마인드를 그리지 않아 영향이 없다.
- 메시지 픽스처의 태스크 ID 와 태스크 픽스처 제목이 다른 문제(#368 절)가 남아 있다. 빼기·메모 뒤 남은 행의 제목이 바뀌어 보인다(`bd_02` 의 퍼블리싱 → 배포 스크립트).
- 같은 시각 묶음에 넣은 알림은 합치기 전 승인 여부를 모른다. 그래서 `승인이 풀렸으니` 대신 `함께 보낼 태스크와 문구를 확인하고 승인해 주세요` 로 쓴다.

## 2026-11-05 합친 묶음으로 선택 옮기기 (#368)

### 근거와 요약

2026-11-04 절 「남은 문제」의 **묶음 합치기** 후속이다. 이슈 #368 과 코디네이터 작업 지시(2026-11-05)에 따랐다. 계획 [plan.md](plan.md)는 읽기만 했고, 계획에 이 작업의 완료조건이 없어 새 AC 를 만들지 않았다.

PM 이 묶음 A 를 연 채(`?review=A`) 보낼 시각을 같은 팀원의 예정 묶음 B 의 시각으로 옮기면, BE 는 A 를 B 에 합치고 B 를 돌려준다. 합치면 두 묶음 모두 문구를 다시 만들고 승인을 푼다(`backend/app/services/messages.py` 의 `edit_bundle`·`_rebuild`). 화면은 응답을 버리고 다시 받은 목록에서 A 를 찾지 못해 「골라 주세요」로 바뀌었다. 이제 화면이 B 로 옮겨 가고 다시 승인하라고 알린다.

| 커밋 | 요지 |
|---|---|
| `77073998` | 시각 변경 결과 모양, 합친 묶음으로 주소 바꿔 끼우기와 알림, MSW 합치기와 시나리오 `messages-merge`, 테스트 |
| 문서 커밋(이 기록) | 계약 §5.7 MSW 동작, [MSW 안내](../../msw-guide.md) 메시지 절, 이 결과 |

### 바꾼 데이터 모양

- **쓰기 결과** — [messageQueries.ts](../../../src/entities/message/api/messageQueries.ts)의 `requestMessageAction` 이 `MessageActionOutcome = { kind: 'done' } | { kind: 'merged'; into: Bundle }` 를 돌려준다. 응답 본문은 `schedule` 만 읽고 기존 매퍼 `toBundle` 로 바꾼다. 응답 ID 가 요청한 ID 와 다르면 `merged` 다. 다른 행동은 지금처럼 본문을 읽지 않고 `done` 이다.
- **알림** — [actionMessages.ts](../../../src/features/message-action/lib/actionMessages.ts)의 `mergeNotice` 가 합친 묶음의 단계로 문구를 고른다. 승인 전이면 `같은 시각의 메시지와 합쳤어요. 내용이 바뀌어 승인이 풀렸으니 다시 확인하고 승인해 주세요.` 이고, 승인됨이면 `같은 시각의 메시지와 합쳤어요.` 다. BE 는 합치면 늘 승인을 풀므로 지금은 앞 문구만 나온다. 다른 행동 알림과 같은 토스트 key(`message-review-action`)다.

### 화면

[ReviewDetail](../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)에서 시각 저장 결과가 `merged` 면 상세 영역에 포커스를 두고 주소를 `?review=<B>` 로 바꿔 끼운다(replace). A 는 없어졌으므로 뒤로 가기로 돌아가지 않게 한다. 합쳐지지 않으면 지금과 같다(주소 그대로, 직접 정하기 칸을 닫고 그 카드로 포커스). [SendTimingPicker](../../../src/widgets/message-inbox/ui/SendTimingPicker.tsx)는 바꾸지 않았다. 문구를 고치는 동안 시각 카드가 잠기므로 시각과 문구가 한 요청에 섞이지 않는다.

### MSW

[상태](../../../src/shared/mock/message-state.ts)의 `editBundle` 이 BE `edit_bundle` 순서대로 판단한다. 지금과 같은 시각은 보내지 않은 것으로 보고, 지난 시각이면 409 다. 같은 대화의 예정 묶음과 같은 시각이면서 문구도 보내면 400 `INVALID_REQUEST` 다. 그 밖에 같은 시각의 묶음이 있으면 리마인드를 옮기고 두 묶음을 `rebuildBundle`(BE `_rebuild`)로 다시 만든다. 판이 오르고 승인이 풀리며, 리마인드가 남지 않은 A 는 `cancelled` 다. 문구는 BE 의 규칙 문구와 틀(`rule_line`·`framed_body`)을 따른다. BE 처럼 태스크의 지금 제목·마감(`db.tasks`)으로 만들고, 다시 만든 묶음의 리마인드도 그 값과 만든 순서(`created_at`, `reminder_id`)로 응답한다. 틀의 PM 은 그 공간에 가장 먼저 등록된 PM 이다. 픽스처 리마인드에 만든 사람이 없기 때문이다. 시나리오 [`messages-merge`](../../../src/shared/mock/scenarios.ts)는 승인한 `bd_01`(09/23 09:00)과 승인 전 `bd_07`(09/21 18:00, 마감 9/24)을 둔다. 모의 DB 모양은 바꾸지 않아 저장 버전을 올리지 않았다.

### 검증 (2026-11-05)

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm.cmd run typecheck` | 0 | |
| `npm.cmd run lint` | 0 | |
| `npm.cmd run format:check` | 0 | |
| `npm.cmd run build` | 0 | |
| `npx vitest run --maxWorkers=1` message-state·messagesActionsMsw·messageScenarios·scenarios 테스트와 `entities/message`·`features/message-action`·`widgets/message-inbox` | 0 | 8파일 106개 통과(Codex 리뷰 반영 뒤 다시 실행) |
| 변이 확인: `ReviewDetail.tsx` 만 이전으로 되돌리고 `messagesActionsMsw` 의 합치기 테스트 | 1 | `expected '?review=bd_07' to be '?review=bd_01'` 로 실패. 되돌린 파일은 복구했다 |

새 테스트:

- [messagesActionsMsw](../../../src/app/messagesActionsMsw.test.tsx):
  - 합쳐지면 주소가 `?review=bd_01`(REPLACE)이고, 승인 전 제목과 `묶은 태스크 2`, 알림이 보이고, 목록이 한 줄 줄고, 포커스가 상세 영역에 있다.
  - 합쳐지지 않는 시각이면 주소와 승인이 그대로이고 알림이 없다.
  - 고치는 동안 시각 카드가 잠기고, 두 요청의 본문은 각각 `body` 와 `scheduled_at` 하나다.
- [message-state](../../../src/shared/mock/message-state.test.ts)·[messageScenarios](../../../src/shared/mock/messageScenarios.test.ts): 합치기 규칙, 문구 동시 수정 400, 지난 시각 우선, 다른 대화는 합치지 않음, 시나리오 복원.

브라우저 확인(Vite MSW 모드, Playwright, 로컬 검증 여정 `messages-merge`):

- `bd_07` 에서 `마감 하루 전` 카드를 누르면 주소가 `?review=bd_01` 로 바뀐다.
- 위 알림 토스트가 보이고, 합친 문구(두 태스크의 규칙 문구)와 `묶은 태스크 2` 가 보인다.
- `PATCH …/bundles/bd_07` 은 200 이고 본문은 `scheduled_at` 하나다. 콘솔 오류는 없었다.

전체 테스트와 E2E 는 이 작업에서 돌리지 않았다.

### 남은 문제

- 실제 서버에서 합치기를 해 보지 않았다. MSW 기준 확인이다.
- 합치기 전 두 묶음이 모두 승인 전이었어도 알림은 「승인이 풀렸으니」라고 쓴다. 응답만으로는 합치기 전 승인 여부를 알 수 없다.
- 메시지 픽스처의 태스크 ID 가 태스크 픽스처와 겹친다. 메시지의 `tk_01` 은 'API 명세서'(9/24)인데 태스크 픽스처의 `tk_01` 은 '로그인 API 연동'(9/20)이다. 그래서 브라우저에서 `messages-merge` 로 합치면 `bd_01` 의 문구와 묶은 태스크가 '로그인 API 연동'(9/20)으로 바뀌고, 마감 하루 전이 09/19 09:00 이 되어 `직접 정하기` 카드가 골라진다. 목 데이터 문제이고 화면 동작과는 상관없다.
- MSW 는 같은 시각인지를 밀리초까지만 비교한다. BE 는 마이크로초까지 구분한다. 화면은 분 단위 시각만 보내므로 영향이 없어 그대로 두었다.

## 2026-11-04 실제 메시지 API 연결 (#315)

### 근거와 요약

배포 서버에 백엔드 메시지 API(#310·#314)가 올라갔고 봇 DM 발송(#324)·스케줄러(#329)가 병합돼, 이슈 #315 본문의 「production 은 계속 준비 중」 조건이 풀렸다. 이슈의 작업 계획 댓글(2026-11-04)과 코디네이터 작업 지시에 따라 화면을 [계약 §5.7](../../contracts/frontend-api-contract.md)의 실제 경로·모양으로 옮기고 모든 모드에서 연다. 계획 [plan.md](plan.md)는 읽기만 했다. 계획 C-8(실제 API 가 생기면 함께 바꿀 것)과 C-10(화면 노출)의 후속이며, 계획에 이 작업의 완료조건은 없어 새 AC 를 만들지 않았다.

| 커밋 | 요지 |
|---|---|
| `c3eb1ab0` | 응답 타입·매퍼·요청을 §5.7 로, 오류 코드 표, 화면(묶음·DM 실패·초안 대기·팀원 안내), MSW handler·픽스처·상태, 준비 중 게이트 제거, 테스트·스토리 |
| 문서 커밋(이 기록) | 계약 §5.7, [MSW 안내](../../msw-guide.md) 메시지 절, 이 결과와 [결정 기록](basis-for-decision/2026-11-04-messages-real-api-drop-unbacked-ui.md) |

### 바꾼 데이터 모양

- **응답 타입** [message.ts](../../../src/shared/types/api/message.ts) — `schemas/message.py` 의 `ReminderResponse`·`BundleResponse`·`MessageResponse`·`LastMessage`·`ThreadSummary`·`InboxResponse`·`ThreadDetailResponse` 와 요청 3개를 칸 그대로 옮겼다. 값이 정해진 칸은 `app/models` 의 StrEnum 값이다.
- **목록** — `{viewer: 'pm', bundles, threads}` 와 `{viewer: 'member', threads}` 의 판별 유니온이다. `bundles === null` 은 매퍼에서만 본다.
- **묶음(`Bundle`)** — `stage` 는 `awaitingApproval`(예정·미승인)·`approved`(예정·승인, `approvedAt` 포함) 둘이고 `drafting`(`draft_status` 가 `needed`·`claimed`)을 따로 둔다. 매퍼가 한 번 정하고 화면은 원문 칸 조합을 다시 보지 않는다. 예정이 아닌 묶음은 매퍼가 버린다. 리마인드는 `tasks`(제목·마감·메모)다.
- **대화 메시지** — `sender` 로 갈린다. 봇은 `dm`(`pending`·`claimed`·`delivered`, 또는 `failed`+이유), 팀원은 `replyChannel`.
- **대화 줄** — 메시지와 (PM 에게만) 예정 묶음을 나갈 시각 순으로 섞고 서울 날짜로 묶는다. `여기서부터 답장이 없습니다` 는 마지막 메시지 바로 뒤에 둔다. 예전의 「아직 나가지 않은 메시지」 별도 목록은 없앴다.
- **행동** — `approve(draftVersion)`·`cancel`·`edit(body)`·`schedule(scheduledAt)`·`reply`. 보낼 시각은 서버에 시각만 보내고, 카드 선택은 저장된 시각이 `마감 하루 전` 시각과 같은지로 화면이 정한다.

### 오류 처리

코드 → (문구, 다음 동작)을 [actionMessages.ts](../../../src/features/message-action/lib/actionMessages.ts)의 `KNOWN_FAILURES` 표 하나에 두고 [행동 훅](../../../src/features/message-action/model/useMessageAction.ts)·[ActionFailure](../../../src/features/message-action/ui/ActionFailure.tsx)가 그 표만 읽는다.

| 코드 | 화면 | 다음 |
|---|---|---|
| 409 `BUNDLE_CHANGED` | 그 자리에 `보낼 메시지가 바뀌었어요. 다시 확인해 주세요.` | 메시지 캐시를 다시 받아 새 문구를 보인다 |
| 409 `REMINDER_SCHEDULED_AT_PASSED` | 승인이면 `예정 시각이 지났어요` 와 잠금(기존 `TIME_PASSED_LOCK`·`useTimePassedLocks`) | 그 묶음의 시각 저장이 성공해야 풀린다 |
| 409 `REMINDER_NOT_EDITABLE`, 404 `REMINDER_BUNDLE_NOT_FOUND` | 토스트 `이미 처리된 메시지예요. 목록을 다시 불러올게요.` | 메시지 캐시를 다시 받는다. 사라질 항목이라 그 자리에 알리지 않는다 |

대화 조회의 403(남의 대화)은 404 처럼 `대화를 찾을 수 없어요` 다. 예전의 `목록 새로 받기` 버튼과 `MESSAGE_SCHEDULE_PASSED` 처리는 지웠다.

### 화면

- 보내기 전 확인: 미리보기 본문 줄바꿈 그대로, `문구 다듬는 중`, 밑단의 문구 출처(`직접 고친 문구`·`AI 초안`·`기본 문구`), `묶은 태스크 N`(제목·마감·메모), `언제 보낼까요?` 두 카드, `보내지 않음`·`이대로 발송`. 승인한 묶음은 `보낼 예정인 메시지예요` 와 「승인한 뒤에도 문구와 시각을 고칠 수 있어요…」(BE 는 문구를 고쳐도 승인을 유지한다).
- 대화: 봇 메시지 `DM 못 보냄 · {이유}`, 팀원 웹 답장 `· 웹에서 답장`, 예정 묶음 점선 말풍선(`발송 예정`·`· 지남`·`· 승인함`, `문구 다듬는 중`, `확인하기`). 목록 행에 `DM 못 보냄`.
- 팀원: 자기 대화, 웹 답장, 답장 칸 아래 `봇 DM 창에 쓴 글은 모두 PM 대화에 보여요.` PM 은 답장 칸 대신 안내 바다.
- 지운 것: 답장 태스크 판정(`AttributionPicker`·`답장 확인 필요`), `지금 바로`, 채널 대화, 팀 역할, `Discord에서 열기`, 재촉 이유·근거 링크·요약, 취소·만료 줄, `자동 발송`·`○○ 승인`. 이유는 [결정 기록](basis-for-decision/2026-11-04-messages-real-api-drop-unbacked-ui.md).
- [MessagesPage](../../../src/pages/messages/ui/MessagesPage.tsx)의 `import.meta.env.DEV && config.mswEnabled` 게이트와 `MessagesComingSoon` 을 지웠다. [2026-10-31 결정](basis-for-decision/2026-10-31-messages-screen-msw-mode-only.md)의 재검토 조건이 충족됐다.

### MSW

[handler](../../../src/shared/mock/handlers/message.ts)·[픽스처](../../../src/shared/mock/fixtures/message.ts)·[상태](../../../src/shared/mock/message-state.ts)를 BE 경로·모양·오류 코드로 옮겼다. 승인의 `draft_version` 비교, 지난 시각 409, 예정 아닌 묶음 409, 팀원 `bundles: null`, 남의 대화 조회·답장 403(PM 포함), 시간대 없는 시각 400, UTC 응답을 흉내 낸다. 묶음 합치기·스케줄러·AI 초안 도착·리마인드 경로는 흉내 내지 않는다. 모의 DB 모양이 바뀌어 저장 버전을 6→7 로 올리고 [restore.e2e.ts](../../../e2e/restore.e2e.ts)의 기대값을 맞췄다.

### 바꾼 기존 단언과 이유

| 위치 | 이전 | 지금 | 이유 |
|---|---|---|---|
| [routes.test.tsx](../../../src/app/router/routes.test.tsx), [appShell.test.tsx](../../../src/app/appShell.test.tsx), [lateAsyncRaces](../../../src/app/lateAsyncRaces.test.tsx), [meetingMinutesRaces](../../../src/app/meetingMinutesRaces.test.tsx) | 제목 `메시지는 준비 중이에요` | 목록 제목 `메시지` | 준비 중 안내 제거 |
| [guards.test.tsx](../../../src/app/router/guards.test.tsx) | 메시지는 준비 중이고 API 를 부르지 않는다 | 메시지 목록과 그 대화만 부른다 | 화면이 실제 API 를 부른다 |
| [meetingProcessing.test.tsx](../../../src/app/meetingProcessing.test.tsx) 「업무 요청은 추적기 두 모양뿐」 | 시작 화면(메시지)의 업무 요청 0 | 메시지 조회를 뺀 업무 요청 0 | 같은 이유. 추적기 요청 단언은 그대로 |
| [messagesMsw](../../../src/app/messagesMsw.test.tsx)·[messagesActionsMsw](../../../src/app/messagesActionsMsw.test.tsx) | MSW 모드 흉내(`vi.mock` 설정), 검토 항목·지금 바로·사유·채널·답장 판정·취소/만료 줄 | 설정 흉내 없음, 묶음·태스크·두 카드·DM 실패·초안 대기·`BUNDLE_CHANGED`·이미 처리됨 | 계약 모양과 화면 범위 변경 |
| mapper·conversation·selection·format·message-state·messageScenarios 단위 테스트 | 임시 모양 | §5.7 모양 | 같은 이유 |
| [MessageInbox.stories.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.stories.tsx) | `답장_확인_필요`·`대화_취소_만료` | `초안_대기`·`DM_못_보냄`·`발송_시점_고를_수_없음` | 같은 이유 |

### 검증 (2026-11-04)

Node v24.11.0. 계획 [plan.md](plan.md)는 읽기만 했다. 다른 워크트리의 테스트가 함께 도는 기계라 vitest 는 `--maxWorkers=2` 로 돌렸다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | 처음 실행에서 4건(렌더 중 `Date.now()` 2건, 쓰지 않는 변수, 불필요한 타입 단언)이 나와 고쳤다. 고친 뒤 바꾼 파일 전체 0건 |
| `npm run format:check` | 0 | 바꾼 파일 15개를 prettier 로 맞췄다. 남은 경고는 저장소에 올리지 않는 로컬 보고서(`.verify/`) 하나다 |
| `npx vitest run --maxWorkers=2` (전체) | 1 | 185파일 중 181, 2221개 중 2207개 통과. 실패 14개 중 9개는 `taskScenarios` 의 저장 버전 기대값 6(이번에 7로 올림)이라 고쳤다. 나머지 5개(`appShell` 2·`meetingUpload` 2·`meetingMinutesSelection` 1)는 시간 초과·찾기 실패였다 |
| `npx vitest run --maxWorkers=1` 위 실패 파일 4개 + `messageScenarios` | 0 | 5파일 126개 통과. 남은 5개 실패는 부하 탓이었다 |
| `npm run build` | 0 | CSS 경고 1건은 기존 `[color:var(...)]`([M2 기록](../m2/basis-for-decision/2026-09-16-docs-prose-makes-the-build-warn.md)). `dist/assets/*.js` 에 `메시지는 준비 중이에요` 0건 |
| `npm run test:storybook` (CI, PR #363 첫 실행) | 1 | 158개 중 4개 실패(`기본`·`대화`·`발송_시점_hover`·`발송_시점_저장_중`). 화면은 실제 시계로, 목은 `MOCK_NOW`(2026-09)로 지난 시각을 판단해 `마감 하루 전` 이 모두 지난 것으로 나왔다. `기본` 은 `09/24 마감` 이 목록과 묶은 태스크에 두 번 보여 찾기가 실패했다 |
| `storybook build` 후 `playwright test -c playwright.storybook.config.ts` | 0 | 브라우저 MSW 에서 화면 시계를 `MOCK_NOW` 에 고정하고(`fixClock`) `기본` 의 단언을 목록 링크로 좁힌 뒤 158개 통과 |
| `npx vitest run --maxWorkers=2` 메시지 화면·위젯·엔티티·mock·date | 0 | 11파일 154개 통과 |

브라우저 확인(Vite MSW 모드, Playwright, 2026-11-05):

- PM(`messages-default`): 메시지 탭이 열리고 `보내기 전 확인 2`(묶은 태스크·`AI 초안` 표시·보낼 시각 두 카드), 대화 목록의 `DM 못 보냄` 이 보인다. `이대로 발송` 은 `POST …/bundles/bd_01/approve` 200 뒤 목록을 다시 받아 `09/23 발송 예정` 으로 바뀐다. 남의 대화(`th_04`)에는 답장 칸이 없고 말풍선에 `DM 못 보냄 · 서버 DM이 막혀 있어요` 가 붙는다.
- 팀원(`messages-member`): 자기 대화 하나만 보이고 `웹에서 답장`, `DM 못 보냄 · Discord 계정이 연결되지 않았어요`, 답장 칸 아래 안내가 보인다. 답장은 `POST …/threads/th_06/replies` 201 뒤 목록·대화를 다시 받는다.
- 콘솔 오류는 `favicon.ico` 404 하나다.

### 남은 문제

- **실제 서버 확인 없음** — 모든 확인은 MSW 기준이다. 배포 BE 에 붙여 PM·팀원 계정으로 목록·승인·답장을 해 보지 않았다. 대신 [message.ts](../../../src/shared/types/api/message.ts)의 칸 이름이 모두 백엔드 `schemas/message.py` 응답·요청 모델에 있는지 대조했다.
- **오늘 기준 상대 표기** — 브라우저 MSW(개발 서버·Storybook)에서 보낼 시각이 지났는지는 목과 같은 고정 시각 `MOCK_NOW` 로 판단한다([clock.ts](../../../src/shared/lib/date/clock.ts)). `답장 N일째 없음` 같은 오늘 기준 표기는 여전히 실제 날짜라, 개발 서버에서는 숫자가 크게 나온다.
- **PM 자신의 대화** — 화면은 로그인 계정의 `member_id` 를 받지 않아, PM 이 리마인드를 받는 팀원이기도 하면 자기 대화에서도 답장 칸이 없다. 대화 주인 판정에 쓸 값(예: 워크스페이스 응답의 내 `member_id`)이 필요하다.
- **묶음 합치기** — 시각을 다른 예정 묶음과 같은 시각으로 옮기면 BE 가 합친 묶음을 돌려주지만, 화면은 주소의 묶음 ID 를 그대로 들고 있다가 다시 받은 목록에 없어 「골라 주세요」로 바뀐다. MSW 는 합치기를 흉내 내지 않아 테스트가 없다.
- **`문구 다듬는 중` 갱신** — polling(D-136)이 없어 AI 초안이 와도 다시 받기 전에는 보이지 않는다. 승인하면 `BUNDLE_CHANGED` 로 새 문구를 받는다.
- 메시지 E2E(D-117), 재촉 만들기·태스크 하나 빼기 화면, 알림·푸시(#330), 알림 설정(#339)은 하지 않았다.

## 2026-11-01 재작업 — 디자인 캔버스 기준

### 근거와 요약

사용자가 메시지 화면을 디자인 캔버스([Messages](../../design/canvas/Messages.dc.html)·[MessagesThread](../../design/canvas/MessagesThread.dc.html)·[EmptyMessages](../../design/canvas/EmptyMessages.dc.html), 보조 [디자인 시스템](../../design/design-system.md))와 비교해 상세 영역이 많이 비어 있다고 보고 디자인대로 재작업하라고 했다(코디네이터 지시, 2026-11-01). 서버가 지켜야 할 정책이 아닌 UI는 MSW 목으로 디자인대로 만들고, 이전에 「결정 4 뒤로 보류」·「의도적으로 뺐다」고 적은 항목도 구현했다. 이것을 결정 4의 UI 범위에 대한 사용자 결정으로 [기록](basis-for-decision/2026-11-01-message-ui-scope-design-canvas-msw.md)했다. 서버 연동·계약 문서는 만들지 않았다.

계획 [plan.md](plan.md)는 여전히 커밋되지 않은 작업 트리 변경이며 이번 작업도 수정하지 않았다(작업 시작·종료 SHA256 `c054a4f6…cd4194` 같음). 계획 C-6의 7(발송 검토 흐름)은 이 사용자 결정으로 화면·MSW 목 수준까지 구현했고, 8(권한 분기)·9(상태 전이와 동기화·polling)·10(메시지 E2E)은 하지 않았다.

| 커밋 | 요지 |
|---|---|
| `13151bf` | 임시 DTO·도메인 타입에 시안 항목(역할, Discord 주소, 답장 대기 시작 시각, 승인 대기, 메시지 상태·발송 방식·승인자, 마감·사유·근거 링크·발송 시점) 추가, 행동 요청 `requestMessageReviewAction`, MSW handler 행동 3개(PATCH·send·dismiss)와 시나리오 `messages-send-fail`, 모의 DB 저장 버전 3→4, `features/message-review`(행동 훅·실패 알림) |
| `c542a0f` | 보내기 전 확인([ReviewDetail](../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)·[ReviewMessageCard](../../../src/widgets/message-inbox/ui/ReviewMessageCard.tsx)·[SendTimingPicker](../../../src/widgets/message-inbox/ui/SendTimingPicker.tsx)), 대화([ThreadDetail](../../../src/widgets/message-inbox/ui/ThreadDetail.tsx)), 목록·기본 선택·빈 상태 액션([MessageInbox](../../../src/widgets/message-inbox/ui/MessageInbox.tsx)), 아이콘 4개(`edit`·`send`·`clock`·`link-out`), 통합 테스트·스토리 |
| `bbccc5f` | 저장 버전 기대값 3→4([taskScenarios.test.ts](../../../src/shared/mock/taskScenarios.test.ts), [restore.e2e.ts](../../../e2e/restore.e2e.ts)) |
| `d058561` | [MSW 안내](../../msw-guide.md)의 메시지 절(행동 경로, `messages-send-fail`, 기본 선택, 상대 표기와 날짜) |
| `ee14e91` | [결정 기록](basis-for-decision/2026-11-01-message-ui-scope-design-canvas-msw.md) |

### 디자인 차이표

시안 날짜(9/11 금, 마감 9/17)는 픽스처 기준 시각 MOCK_NOW(2026-09-18 금 09:00)로 한 주 옮겼다(마감 9/24, 마감 하루 전 9/23 09:00). 이름·봇 이름은 픽스처 값(`이재환`, `카테캠 3팀`)이다.

| 화면 | 시안 항목 | 2026-10-31 구현 | 지금 |
|---|---|---|---|
| 보내기 전 확인 | 카드 머리 Discord 표식 | 없음 | 있음([DiscordGlyph](../../../src/widgets/message-inbox/ui/DiscordGlyph.tsx)) |
| 보내기 전 확인 | 봇 아바타 매스 마스코트 | 먹색 원 + 첫 글자 | 매스 34px(`Mascot`) |
| 보내기 전 확인 | 봇 이름 옆 `09/16 09:00 예정` | 없음 | `09/23 09:00 예정`, 지금 바로면 `바로 발송` |
| 보내기 전 확인 | 카드 밑단 `문구는 그대로 고칠 수 있어요` + `고쳐 쓰기` | 없음 | 있음. 누르면 문구 칸·글자 수·`취소`·`저장`, 저장은 서버 성공 뒤 반영 |
| 보내기 전 확인 | `왜 보내려 하나요` 박스 + `마지막 메시지 보기` | 없음 | 있음. 근거 링크가 없는 항목은 링크를 숨김 |
| 보내기 전 확인 | `언제 보낼까요?` 세 카드(마감 하루 전 · 지금 바로 · 직접 정하기) | 없음 | 있음. 라디오 카드, 고른 카드는 서버 값. 마감이 없으면 `마감 하루 전` 비활성(`마감 없음`), `직접 정하기`는 날짜·시각 입력 후 저장 |
| 보내기 전 확인 | `보내지 않음` · `이대로 발송` | 없음 | 있음. 서버 성공 뒤 목록에서 빠지고 다음 항목이 골라짐 |
| 보내기 전 확인 | `보낸 메시지는 되돌릴 수 없습니다. 이 화면에는 다른 작업을 두지 않았어요.` | 없음 | 있음 |
| 대화 | 머리 부제 `백엔드 · Discord 개인 메시지 · 캡스톤 5조 봇으로 보냄` | `Discord 개인 메시지` | `백엔드 · Discord 개인 메시지 · 카테캠 3팀 봇으로 보냄`(채널은 `Discord 채널 · …`) |
| 대화 | 머리 배지 강조색 면 흰 글자 `답장 3일째 없음` | 회색 `답장 기다리는 중` | 강조색(`bg-accent`) `답장 3일째 없음` |
| 대화 | `Discord에서 열기` + 바깥 링크 아이콘 | 없음 | 있음(새 창, 목 주소) |
| 대화 | 봇 말풍선 시각 줄 `09:02 · 자동 발송`, `18:00 · 지훈 승인` | 시각만 | `09:02 · 자동 발송`, `18:00 · 최진호 승인` |
| 대화 | 답장 없음 칩(시계 아이콘 + `여기서부터 답장이 없습니다 — 오늘로 3일째예요`) | `여기서부터 답장을 기다리고 있어요` | 시안 문구 그대로 |
| 대화 | 오늘 묶음의 점선 `발송 예정` 말풍선 + `반려`·`승인` | 없음 | 있음. 승인하면 `09/23 09:00 발송 예정 · 최진호 승인` 예약 말풍선이 됨 |
| 대화 | 아래 안내 바 `메시지는 항상 … 봇이 보냅니다. 직접 입력하는 대신 승인 대기 중인 1건을 확인해 주세요.` + `확인하기` | 없음 | 있음. 승인 대기가 없으면 `지금 승인을 기다리는 메시지는 없어요.`(시안에 없는 상태) |
| 목록 | 보내기 전 확인 행 오른쪽 `09/17 마감` · `3일 전` | 만든 날짜(`09/17`) | `09/24 마감` · `3일 전`(오늘 기준 상대 표기) |
| 목록 | `/messages` 기본 진입 때 첫 확인 항목 선택 | 안내문만 | 첫 항목 선택(`review` 파라미터가 없을 때) |
| 빈 상태 | `알림 규칙 보기` 버튼 | 없음 | 있음. 알림 규칙 화면이 없어 가장 가까운 팀 설정(`/settings`)으로 감 |
| 공통(유지) | 목록 308px 2단, 말풍선·날짜 구분선, 빈 상태 문구·레이아웃 | 같음 | 같음 |
| 시안 밖(유지) | 미선택 안내문, 영역별 빈 안내, 목록·대화 오류, 빈 대화, 로딩 스켈레톤, 없는 대화 | 있음 | 유지. 시안과 충돌하지 않음 |

#### 디자인과 아직 다른 점

- **헤더 `메시지 2`·`태스크 3` 개수 배지** — 앱 셸(헤더)의 집계라 이번 범위 밖이다(계획 C-2 제외 범위, 집계 API 필요).
- **사유 문장의 날짜·채널 강조** — 시안은 `9/17`·`#개발`을 숫자 글꼴·흐린 색으로 구분한다. 서버가 한 문장으로 주는 값이라 구현은 같은 글자색이다.
- **이름** — 시안은 `재환`·`캡스톤 5조`, 구현은 픽스처의 `이재환`·`카테캠 3팀`. 데이터 값의 차이다.
- **1024px 미만** — 시안이 없고 D-124로 범위 밖이다. 390px에서는 앱 헤더가 651px라 페이지가 가로로 넘치고 목록 308px 옆 상세가 좁아진다(아래 측정).

### 동작 — MSW 목과 그 한계

- **서버 성공 뒤 반영(D-137)** — [행동 훅](../../../src/features/message-action/model/useMessageAction.ts)은 요청이 성공하고 메시지 캐시(목록·대화)를 다시 받은 뒤에야 끝난다. 낙관적 갱신은 없다. 요청 중에는 그 화면의 행동이 모두 잠기고(`aria-busy`), 같은 틱의 두 번째 누름도 `isMutating`으로 막는다.
- **실패** — 그 자리에 role=alert와 `다시 시도`(같은 요청을 다시 보냄)를 둔다([ActionFailure](../../../src/features/message-action/ui/ActionFailure.tsx)). 항목이 이미 처리됐거나 없으면(404) 다시 시도 대신 `목록 새로 받기`를 둔다 — 바로 다시 받으면 항목과 함께 알림 자리도 사라지기 때문이다.
- **성공 알림** — 토스트 `09/23 09:00에 이재환님에게 보낼게요`, `정하늘님에게 메시지를 보냈어요`, `이재환님에게 보낼 메시지를 보내지 않기로 했어요`.
- **MSW 목의 한계(확정 정책 아님)** — 발송 권한은 소속 팀원 누구나(PM 전용 여부 미정), 예약 시각이 지나도 메시지가 스스로 나가지 않음(MOCK_NOW 고정), 「며칠째」는 서버가 준 답장 대기 시작 시각에서 화면이 보낸 날을 1일째로 셈, `Discord에서 열기`·`마지막 메시지 보기`는 실제 대화가 없는 목 Discord 주소, 대화 화면의 `승인`·`반려`와 보내기 전 확인의 `이대로 발송`·`보내지 않음`은 같은 요청이다(어느 쪽이 검토 장소인지는 미정, 계획 C-10). 상태 동기화(polling, D-136)는 없다 — 행동 성공 뒤 무효화만 한다.
- **상대 표기와 날짜** — `3일 전`·`답장 N일째 없음`·`지금 바로`의 `금요일 아침`은 기기의 오늘로 계산한다. 테스트는 시계를 MOCK_NOW로 고정했다. 개발 서버를 실제 날짜로 열면 숫자가 시안과 다르다(Storybook play는 숫자를 단언하지 않는다).

### 바꾼 기존 단언과 이유

2026-11-01 검증 발견 수정(아래 절)에서 바꾼 단언은 그 절의 표에 따로 적었다.

| 위치 | 이전 | 지금 | 이유 |
|---|---|---|---|
| [messagesMsw.test.tsx](../../../src/app/messagesMsw.test.tsx) AC-02 첫 사례 | 고르기 전 상세는 안내문 | 첫 확인 항목이 골라짐 | 시안의 기본 진입 상태. 안내문은 확인 항목이 없을 때의 새 사례로 옮김 |
| 같은 파일 AC-02 검토 선택 | 읽기 전용, 버튼 없음 | 시안 항목·문구·버튼 전부 | 결정 4의 UI 범위 결정 |
| 같은 파일 AC-03 | `9월 8일`·`9월 10일`, 시각만, `답장 기다리는 중`, 자동 발송·승인·예정·Discord 링크 없음 | `9월 15일`·`9월 16일`·`오늘`, 시각 줄, `답장 3일째 없음`, 칩, 승인 대기, 안내 바 | 시안 항목 구현, 「3일째」가 되도록 픽스처 날짜를 옮김 |
| 같은 파일 AC-04 빈 상태 | `알림 규칙 보기` 없음 | 팀 설정 링크 | 시안 버튼 구현 |
| 같은 파일 AC-07 Tab 사례 | 이재환 검토 행으로 이동해 선택 | 정하늘 검토 행 | 이재환 항목이 기본 선택이라 눌러도 주소가 바뀌지 않음 |
| [mapper.test.ts](../../../src/entities/message/model/mapper.test.ts) | 화면이 마지막 메시지로 답장 대기를 계산 | 서버가 준 시작 시각을 그대로 옮김 | 답장 대기 판정을 handler로 옮김(며칠째 계산의 기준 시각이 필요) |
| [messageScenarios.test.ts](../../../src/shared/mock/messageScenarios.test.ts) | 조회만 | 행동·검증·실패 시나리오 추가 | 행동 handler 추가 |
| 저장 버전 3 기대값 2곳 | 3 | 4 | MockDb 모양 변경(파일 규칙) |
| [MessageInbox.stories.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.stories.tsx) `검토_항목` | 버튼 없음 | 버튼·시점·사유 있음 | 같은 이유. 스토리 `고쳐_쓰기`·`발송_실패`·`대화_승인` 추가(모두 `M8 메시지/화면`) |

### 검증 (2026-11-01)

Node v24.11.0, 기준 커밋 `ee14e91`. 무거운 명령은 직렬화 wrapper로 하나씩 돌렸다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | frontend 전체 |
| 메시지 대상 테스트 5파일 | 0 | 단위 3파일 38개, `messagesMsw`·`messagesActionsMsw` 47개 통과 |
| `npm run test -- --maxWorkers=2` | 1 | 164파일 중 163, 1884개 중 1883 통과. 실패 1개는 메시지와 무관한 `meetingProcessing.test.tsx` 「StrictMode 에서도 재렌더·탭 이동이 목록·상세 요청을 늘리지 않는다」의 5000ms 시간 초과(전체 2489초 실행 중 부하) |
| `npm run build` | 0 | |
| `STORYBOOK_E2E_PORT=6213 npm run test:storybook` | 결과 없음 | 정적 빌드 뒤 실행 도중 시스템 메모리 부족으로 Claude Code가 백그라운드 셸을 강제 종료했다. M8 블록(`M8 메시지/화면` 11개 스토리 play)을 포함해 끝까지 돌지 못했다 |

남은 확인: `test:storybook` 전체와 `meetingProcessing.test.tsx` 단일 재실행은 메모리 여유가 있을 때 다시 돌려야 한다. 하네스가 메모리 부족 뒤 임의 재시작을 막아 코디네이터에게 물었으나 30분 안에 답이 없어 이 상태로 기록했다.

#### 디자인과 나란히 비교 (Playwright)

이미 떠 있는 `VITE_ENABLE_MSW=true` 개발 서버(포트 5223)를 저장소 밖 임시 스크립트로 열었다(Chromium headless, `ko-KR`, `Asia/Seoul`, 높이 1000, 시계 MOCK_NOW 고정). 상태는 ① `messages-default` 기본 진입(첫 항목 선택) ② `th_01` 대화 ③ `messages-empty` ④ `?review=rv_02`이고, 캔버스 HTML 세 장을 같은 폭으로 찍어 나란히 봤다.

| 너비 | 네 상태의 문서 `scrollWidth / clientWidth` | `scrollHeight / clientHeight` | pageerror |
|---:|---|---|---|
| 1024 | 모두 1024 / 1024 | 모두 1000 / 1000 | 0 |
| 1360 | 모두 1360 / 1360 | 모두 1000 / 1000 | 0 |
| 390 | 모두 651 / 390 | ① 1065 / 1000, 나머지 1000 / 1000 | 0 |

1024·1360px 스크린샷에서 위 차이표의 「지금」 항목이 시안과 같은 자리·문구로 보이는 것을 직접 확인했다(카드 머리·매스·예정 시각·고쳐 쓰기·사유 박스·세 카드·행동 줄·안내, 대화 머리·배지·Discord 링크·시각 줄·칩·점선 말풍선·`반려`/`승인`·안내 바, 빈 상태 버튼). 390px은 범위 밖(D-124)이며 앱 헤더 때문에 가로로 넘친다. 비교 뒤 `마감 없음` 카드가 고를 수 있는 카드와 같아 보이는 것을 발견해 눌린 면·흐린 글자로 구분했다(`c542a0f`에 포함).

## 2026-11-01 검증 발견 수정 (VR-C R2)

### 근거와 처리

검증 에이전트 VR-C가 HEAD `2ad7836`을 검증해 FAIL(major 1 · minor 8)을 남겼다(보고서는 저장소 밖 작업 폴더). 코디네이터 지시로 발견마다 코드에서 재현한 뒤 회귀 테스트를 먼저 더하고 고쳤다. 새 사례와 바꾼 사례 10건은 수정 전 코드에서 실패했다(VR-01~04). 반박하거나 보류한 발견은 없다.

| 발견 | 내용 | 처리 | 커밋 | 회귀 테스트 |
|---|---|---|---|---|
| VR-01 major | `직접 정하기`를 연 채(시각 미저장) `이대로 발송`이 즉시 발송으로 나감 | 시각 칸이 열린 상태를 [ReviewDetail](../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)로 올려(`choosingTime`) 열린 동안 `이대로 발송`·`보내지 않음`·`고쳐 쓰기`를 잠그고, 안내 `정한 시각을 저장하거나 취소한 뒤에 보낼 수 있어요.`를 `aria-describedby`로 잇는다 | `804eac2` | [messagesActionsMsw](../../../src/app/messagesActionsMsw.test.tsx) 「직접 정하기를 연 동안에는 … 잠기고, 취소하면 풀린다」(누름이 요청 0건) |
| VR-02 minor | 저장한 `직접 정하기` 시각을 다시 열 수 없음(checked 라디오는 change 없음) | `직접 정하기` 라디오의 누름(click, Space 포함)으로도 시각 칸을 연다. 저장된 시각이 채워진다 | `804eac2` | 「저장한 직접 정하기 시각은 그 카드를 다시 눌러 고칠 수 있다 — 마우스와 Space 모두」 |
| VR-03 minor | 화살표 키 이동만으로 발송 시점이 저장되고, 저장 중 포커스가 BODY로 떨어짐 | 화살표는 카드 사이로 포커스만 옮기고(끝에서 처음으로, `마감 없음` 건너뜀) Space·누름으로만 고른다. 요청 중 잠금은 `fieldset disabled` 대신 라디오의 `aria-disabled` + 조기 반환. [기록](basis-for-decision/2026-11-01-send-timing-arrow-keys-move-focus-only.md) | `804eac2` | 「화살표 키는 카드 사이를 옮겨 다닐 뿐 저장하지 않는다」, 「… 고를 수 없는 카드(마감 없음)를 건너뛴다」, 「지금 바로를 누르면 …」에 포커스·`aria-disabled` 단언 |
| VR-04 minor | 행동 뒤 포커스가 BODY로 사라짐 | 문구 칸을 열면 그 칸, 닫으면(취소·저장 성공) `고쳐 쓰기`, 시각 칸을 닫으면 `직접 정하기` 카드로 포커스. 요청 중인 버튼은 [LockedButton](../../../src/widgets/message-inbox/ui/LockedButton.tsx)(`aria-disabled` + 누름 버림)으로 포커스를 남기고 실패해도 그 버튼에 있다. 발송·보내지 않음 성공 뒤에는 상세 칸(`메시지 내용`, `tabIndex=-1`)이 포커스를 받는다 — 대화의 승인·반려 성공 뒤 `대화 내용`으로 옮기는 것과 같은 방식 | `804eac2` | 발송·보내지 않음·고쳐 쓰기·발송 시점·대화 승인/반려 사례의 `document.activeElement` 단언, 스토리 `고쳐_쓰기` play의 문구 칸 포커스 |
| VR-05 minor | 발송 시점 카드 포커스 선 offset +4px | 테두리 위 `-1`, 고른 먹 면 카드는 안쪽 흰 선 `-3`(디자인 시스템 §3-3) | `9add5ac` | [messagesMsw](../../../src/app/messagesMsw.test.tsx) 「… 포커스 선은 테두리 위(-1) …」 |
| VR-06 minor | 목록 영역 라벨 700(시안 400) | `font-normal` | `9add5ac` | 「목록 영역 라벨은 400 이다」 |
| VR-07 minor | `보내지 않음` 좌우 22px(시안 18), `이대로 발송` 아이콘 간격 6px(시안 8) — `className` 덮어쓰기가 생성 CSS 순서에 져서 적용되지 않음 | 공용 [Button](../../../src/shared/ui/button/Button.tsx) 크기 표에 `message-dismiss`(44 · 좌우 18 · 14px)·`message-send`(44 · 좌우 24 · 간격 8 · 14.5px)를 더하고 `className` 덮어쓰기를 지웠다. 간격(gap)은 BASE에서 빼 크기마다 하나만 고른다([클래스 병합을 쓰지 않는 결정](../m2/basis-for-decision/2026-09-16-no-cn-clsx-tailwind-merge.md)의 「시각은 size가 API」) | `9add5ac` | 「보내기 전 확인의 버튼은 캔버스 크기 …」, [Button.test](../../../src/shared/ui/button/Button.test.tsx) 새 크기 사례와 「크기마다 간격 하나」 |
| VR-08 minor | 대화 `반려`·`승인` 14px(시안 13), `반려` 좌우 20(시안 16) | `message-thread-dismiss`(36 · 좌우 16 · 13px)·`message-thread-approve`(36 · 좌우 20 · 13px) | `9add5ac` | 「대화의 반려·승인은 13px …」 |
| VR-09 minor | `고쳐 쓰기`·`취소`·`저장`·`이 시각으로 정하기`·시각 칸 `취소`가 32px | `고쳐 쓰기`는 `message-edit`(36 · 좌우 11 · 12px), 나머지 넷은 제품 기본 `md`(36) | `9add5ac` | 「보내기 전 확인의 버튼은 … 모두 36px 이상이다」 |

VR-08을 재현하다 공용 문제를 하나 찾았다. `text-control`(토큰 13px)은 같은 이름의 색 토큰 `--color-control`이 있어 Tailwind가 **색**(`color: var(--color-control)`)으로 생성한다. 그래서 `sm`·`md` 등 `text-control`을 쓰는 버튼은 글자 크기를 받지 못하고 body의 14px로 그려진다(브라우저 생성 CSS에서 확인). 메시지 크기 5개는 13px를 `text-(length:--text-control)`로 적어 피했다. 앱 전체 버튼(29곳 이상이 `text-control`을 씀)을 바꾸는 일은 이번 범위 밖이라 그대로 두었다 — 아래 「남은 작업」.

### 브라우저 확인 (2026-11-01)

수정 뒤 `VITE_ENABLE_MSW=true` 개발 서버(포트 5213)를 Playwright(Chromium, 1360×1000)로 열어 계산 값과 포커스를 쟀다. 서버·브라우저는 측정 뒤 닫았다.

| 대상 | 수정 전 | 수정 뒤 | 캔버스 |
|---|---|---|---|
| `보내지 않음` | 44 · 좌우 22 · 14px | 44 · 좌우 18 · 14px | 44 · 18 · 14px |
| `이대로 발송` | 간격 6 | 간격 8 · 좌우 24 · 14.5px | 8 · 24 · 14.5px |
| `고쳐 쓰기` | 32 · 좌우 12 · 12px | 36 · 좌우 11 · 12px | 36 · 11 · 12px |
| 목록 라벨 `보내기 전 확인 N` | 700 | 400 | 400 |
| 대화 `반려` / `승인` | 14px · 좌우 20 / 14px · 20 | 13px · 16 / 13px · 20 | 13px · 16 / 13px · 20 |
| `저장`·`이 시각으로 정하기` | 32 | 36 | (시안 없음, 제품 최소 36) |
| 발송 시점 카드 포커스 선 | 먹 선, offset +4 | 고르지 않은 카드 먹 선 음수 offset, 고른 먹 면 카드 흰 선 음수 offset | 디자인 시스템 §3-3 |

동작: `마감 하루 전`에서 ArrowRight·ArrowLeft 뒤 PATCH 0건이고 `마감 하루 전`이 그대로 골라져 있었다. `직접 정하기`를 연 채 `이대로 발송`은 `aria-disabled="true"`이고 강제로 눌러도 발송 요청 0건이었다. `document.activeElement`는 문구 칸 열기 → TEXTAREA, 취소 → `고쳐 쓰기`, 시각 칸 취소 → `직접 정하기` 라디오, 발송 응답 대기 중 → `이대로 발송`, 성공 뒤 → `메시지 내용` 칸이었다.

### 바꾼 기존 단언과 이유

| 위치 | 이전 | 지금 | 이유 |
|---|---|---|---|
| [messagesActionsMsw.test.tsx](../../../src/app/messagesActionsMsw.test.tsx) 요청 중·고치는 중 잠금 10곳(`이대로 발송`·`보내지 않음`·`고쳐 쓰기`·`지금 바로` 라디오·`반려`) | `toBeDisabled()` | `aria-disabled="true"` | 잠금을 포커스를 남기는 `aria-disabled`로 바꿨다(VR-03·VR-04). `toBeDisabled`는 네이티브 `disabled`만 본다 |
| 같은 파일 실패·저장 뒤 풀림 3곳 | `toBeEnabled()` | `aria-disabled` 없음 | 같은 이유 — `toBeEnabled`는 `aria-disabled`가 있어도 통과해 잠금 해제를 가리지 못한다 |
| [MessageInbox.stories.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.stories.tsx) `고쳐_쓰기` | `이대로 발송` `toBeDisabled()` | `aria-disabled="true"`, 문구 칸 포커스 | 같은 이유, VR-04 회귀 |
| [Button.tsx](../../../src/shared/ui/button/Button.tsx) BASE | `gap-6` | 크기 표마다 `gap-6`(메시지 발송만 `gap-8`) | 기존 크기 사례는 그대로 통과한다. 그 밖의 렌더 결과는 같다 |

jsdom은 `disabled`가 된 요소에서 포커스를 빼지 않는다. 그래서 `document.activeElement` 단언만으로는 예전 결함이 잡히지 않고(대화 `반려` 실패 사례는 수정 전에도 통과했다), 잠금이 `aria-disabled`인지 함께 단언한다.

### 검증

Node v24.11.0, 수정 커밋 `804eac2`·`9add5ac`·`fe86a28`(주석) 뒤 작업 트리. 무거운 명령은 직렬화 wrapper로 하나씩 돌렸다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| 수정 전 `npx vitest run src/app/messagesActionsMsw.test.tsx` | 1 | 재현 — 새·바뀐 사례 10건 실패, 9건 통과 |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | |
| 메시지·버튼 대상 4파일(`messagesMsw`·`messagesActionsMsw`·`widgets/message-inbox`·`shared/ui/button`) | 0 | 116개 통과 |
| `npm run test -- --maxWorkers=2` | 0 | 164파일 · 1911개 모두 통과, 573초. 이번에는 시간 초과가 없었다 |
| `npm run build` | 0 | 생성 CSS 경고 1건은 기존 `[color:var(...)]`([M2 기록](../m2/basis-for-decision/2026-09-16-docs-prose-makes-the-build-warn.md)). `dist/assets/*.js`에 `보내기 전 확인`·`이 메시지, 보낼까요` 0건 |
| `STORYBOOK_E2E_PORT=6213 npm run test:storybook` | 0 | 116개 모두 통과(M8 블록 12개: index 확인 + `M8 메시지/화면` 스토리 11개 play) |

메시지 E2E는 더하지 않았다(D-117). 전체 `test:e2e`는 실행하지 않았다.

## 2026-11-02 Discord DM 카드 잘림 수정

### 재현 조건

사용자가 「디스코드 개인메시지 카드 UI의 내부 내용이 잘린다」고 보고했다(코디네이터 지시, 2026-11-02). `VITE_ENABLE_MSW=true` 개발 서버(포트 5223, `messages-default`)를 Playwright Chromium 한 탭으로 열고, 화면 안 모든 요소의 `scrollWidth`/`scrollHeight`를 `clientWidth`/`clientHeight`와 비교했다. 긴 문구는 `고쳐 쓰기`로 14줄 본문 + 줄바꿈 기회가 없는 160자 주소를 저장해 만들었다. 스크린샷과 측정 JSON은 저장소 밖 작업 폴더에 있다.

| 화면(너비×높이) | 미리보기 카드 높이 / 내용 높이 | 가로 |
|---|---|---|
| 기본 1024×768, 1360×768 | **90 / 220** — 본문이 통째로 안 보이고 이름 줄 아래가 잘림 | 넘침 없음 |
| 기본 1280×800 | **122 / 220** | 넘침 없음 |
| 기본 1920×1080 | 220 / 220 | 넘침 없음 |
| 긴 문구 1024~1360 | **91~123 / 900** | 카드 **+794px**(주소가 카드 밖에서 잘림) |
| 긴 문구 1920×1080 | **402 / 900** | 카드 +794px |
| 긴 문구 대화(모든 너비) | — | `대화 내용` 칸이 **+835px** 가로 스크롤(말풍선이 최대 폭을 넘음) |

### 원인

1. **카드가 세로로 줄어 잘림.** 상세 칸([ReviewDetail](../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)의 PAGE)은 가로 flex이고 그 안의 열(`article`)이 기본 `align-items: stretch`로 칸 높이에 맞춰졌다. 세로 flex인 열은 내용이 칸보다 길면 자식을 줄이는데, 미리보기 카드는 `overflow-hidden`이라 flex 최소 높이(`min-height: auto`)가 0으로 풀려 혼자 줄어들었다. 다른 블록은 overflow가 visible이라 줄지 않아, 화면 높이가 낮을수록 카드만 잘렸다.
2. **긴 문자열이 줄을 바꾸지 못함.** 전역 `word-break: keep-all`([global.css](../../../src/app/styles/global.css))에서 띄어 쓰지 않은 긴 글자(주소, 긴 한글 이름)는 끊을 자리가 없다. 본문·이름에 `overflow-wrap` 대체가 없어 카드에서는 잘리고, 말풍선·목록에서는 칸이 가로로 넘쳤다.

### 수정

| 커밋 | 수정 | 회귀 스토리(브라우저 실측 play) |
|---|---|---|
| `228eabb` | 열에 `self-start` — 열이 내용 높이를 따르고 넘치면 PAGE가 세로 스크롤한다. 카드 본문·봇 이름·머리 글자, 제목의 받는 사람, `왜 보내려 하나요` 사유에 `wrap-anywhere` | `긴_문구_미리보기` — 카드 `scrollHeight ≤ clientHeight`·`scrollWidth ≤ clientWidth`, 본문·상세 칸 가로 넘침 없음 |
| `c2b5fac` | 대화 말풍선(봇·상대·예약·승인 대기), 대화 아래 안내 바, 목록의 검토 이름·요약·대화 이름에 `wrap-anywhere` | `긴_문구_대화` — 주소가 든 말풍선 2개·`대화 내용` 칸·안내 바·목록 가로 넘침 없음 |

두 스토리는 rv_01·th_01을 긴 본문(12줄 + 줄바꿈 기회가 없는 161자 주소), 띄어 쓰지 않은 22자 이름, 긴 공간 이름으로 바꾼다. 수정 전 코드로 Storybook을 빌드해 두 스토리만 돌려 둘 다 실패함을 확인했다(`expected 1277 to be less than or equal to 602`, `expected 1185 to be less than or equal to 408`). 세로 잘림은 Storybook 회귀 뷰포트(1280×900)에서도 긴 본문이면 재현된다(위 표의 1920×1080 긴 문구가 402/900).

수정 뒤 같은 개발 서버 측정에서 네 너비 모두 카드가 내용 높이와 같았고(기본 220/220, 긴 문구 950/950) 가로 넘침은 0이었다. 남은 넘침은 의도한 세로 스크롤 칸(상세 칸·`대화 내용`)과 아래의 말줄임뿐이다. 시안 값(폭·패딩·글자 크기)과 카드의 `overflow-hidden`(캔버스 그대로, 라운드 안쪽 자르기)은 바꾸지 않았다. `wrap-anywhere`는 끊을 자리가 없을 때만 작동해 `keep-all`의 한글 줄바꿈은 그대로다.

### 의도된 말줄임 — 그대로 둔 것

| 위치 | 근거 |
|---|---|
| 목록 대화 행의 한 줄 미리보기(`나: …`) | 캔버스 Messages·MessagesThread가 `max-width: 176px; text-overflow: ellipsis; white-space: nowrap`으로 말줄임을 정했다 |
| 대화 머리의 이름·부제(`truncate`) | 머리는 높이 76의 한 줄(캔버스 MessagesThread 머리)이라 줄을 바꾸면 시안 배치가 깨진다. 같은 이름이 목록 행에서는 줄을 바꿔 전부 보이고, 스크린 리더는 잘리지 않은 글자를 읽는다. 반박이 아닌 보류로 남긴다 — 머리 이름까지 전부 보여야 하면 별도 결정이 필요하다 |

### 바꾼 기존 단언

없다. 기존 스토리·테스트 단언은 그대로이고 스토리 2개를 더했다. Storybook 회귀 블록(`stories.sb.ts`의 M8 블록)은 건드리지 않았다 — 새 스토리는 그 블록이 `m8-` 접두로 자동 수집한다.

### 검증 (2026-11-02)

Node v24.11.0, 커밋 `228eabb`·`c2b5fac` 뒤 작업 트리. 무거운 명령은 직렬화 wrapper로 하나씩 돌렸다. 계획 [plan.md](plan.md)는 이번에도 읽기만 했다(SHA256 `c054a4f6…cd4194` 그대로).

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| 수정 전 `storybook build` + 새 스토리 2개만 `playwright test -g "긴-문구"` | 1 | 재현 — 2개 모두 실패(위 수치) |
| 개발 서버 측정(수정 전·뒤, 기본·긴 문구 × 4너비) | 0 | 위 표와 수정 뒤 문단 |
| `npm run typecheck`·`lint`·`format:check` | 0 | |
| 메시지 3파일(`messagesMsw`·`messagesActionsMsw`·`widgets/message-inbox`) | 1 → 0 | 첫 실행 66개 중 1개 실패(출력을 남기지 못해 이름 미상), 같은 명령 재실행 66개 모두 통과 |
| `npm run test -- --maxWorkers=2` | 1 | 162파일 · 1869개 중 3개 실패, 2481초. `logout.test.tsx` 2개(5초 시간 초과)·`meetingMinutesRaces.test.tsx` 1개(제목 대기) — 메시지 위젯을 쓰지 않는 테스트다 |
| 위 두 파일 단독 `--maxWorkers=1` | 0 | 9개 모두 통과 — 부하성으로 본다 |
| `STORYBOOK_E2E_PORT=6223 npm run test:storybook` | 1 | 118개 중 117개 통과. 실패 1개는 M6 `태스크 목록/빈 목록` play의 글자 대기. M8 메시지 13개(새 스토리 2개 포함) 통과 |
| 같은 빌드로 M6 `빈 목록` + M8 메시지 스토리만 재실행 | 0 | 14개 모두 통과 — 부하성으로 본다 |

전체 Vitest와 `test:storybook`은 이번에 한 번에 exit 0을 얻지 못했다. 실패한 항목을 단독으로 다시 돌려 통과한 것을 전체 통과로 보지 않는다. 다른 워크트리의 전체 Vitest가 약 75분간 잠금을 잡은 뒤에 돌았고, 같은 시간대에 다른 워커 둘이 함께 돌았다. `build`는 클래스만 바꾼 수정이라 돌리지 않았다(같은 컴포넌트를 Storybook build가 컴파일했다). 메시지 E2E는 더하지 않았다(D-117).

## 2026-11-02 발송 시점 카드 hover와 저장 중 버튼 깜빡임 수정

### 지적과 재현

사용자 지적(코디네이터 지시, 2026-11-02, 직전 커밋 `0e45a43` 후속) 두 가지를 재현했다.

1. **시점 카드에 hover 효과가 없음(결함).** [SendTimingPicker](../../../src/widgets/message-inbox/ui/SendTimingPicker.tsx)의 카드 클래스에 hover 지정이 없었다. [디자인 시스템](../../design/design-system.md) §7-12는 「선택 카드: hover 면은 아웃라인 버튼과 같은 `#EDEDED`, 테두리는 hover에서 바꾸지 않는다」다.
2. **시점 카드를 누르면 `이대로 발송`이 깜빡임.** 카드를 누르면 바로 발송 시점을 저장하고(PATCH), 그동안 [ReviewDetail](../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)의 행동 잠금으로 `이대로 발송`·`보내지 않음`·`고쳐 쓰기`가 공용 [Button](../../../src/shared/ui/button/Button.tsx)의 `aria-disabled` 모양이 된다. 코디네이터 실측(포트 5223, `messages-default`, `지금 바로`): 20ms에 `aria-disabled=true`·면 `rgb(240, 240, 240)`, 111ms에 풀려 `rgb(23, 23, 23)` — 약 90ms 깜빡임.

### 수정

| 지적 | 수정 | 회귀 테스트 |
|---|---|---|
| 1 hover 없음 | 카드에 `hover:bg-control`(아웃라인 버튼 hover와 같은 컨트롤 토큰 `#EDEDED`). 고른 먹 면·고를 수 없는(`disabled`, `마감 하루 전` 비활성)·잠긴(`aria-disabled`) 카드는 `not-has-[…]`로 뺀다. 테두리는 그대로 | 스토리 `발송_시점_hover` — 고를 수 있는 카드만 hover 면 `rgb(237, 237, 237)`, 고른 카드·고를 수 없는 카드는 hover 규칙이 걸리지 않음. `발송_시점_저장_중` — 잠긴 카드도 걸리지 않음 |
| 2 깜빡임(사용자 결정 방식 A) | 시점 저장만으로 잠긴 동안 [LockedButton](../../../src/widgets/message-inbox/ui/LockedButton.tsx)의 새 옵션 `keepLook`이 버튼 모양을 유지한다. 잠금은 그대로 `aria-disabled="true"`이고 누름을 버린다. 시점 묶음(`fieldset`)에는 `aria-busy`. 시각 칸이 열림(lockHint)·문구 고치는 중·발송/보내지 않음 요청 중은 지금처럼 잠긴 모양이다. 공용 Button은 바꾸지 않았다 | 스토리 `발송_시점_저장_중` — PATCH를 붙잡고 `이대로 발송`이 `aria-disabled`이면서 면·글자 색이 잠금 전과 같음, `보내지 않음` 글자 색 같음, 그때 누른 발송 요청 0건. lockHint·고치는 중 잠금은 기존 단언([messagesActionsMsw](../../../src/app/messagesActionsMsw.test.tsx) 「직접 정하기를 연 동안에는 …」, 스토리 `고쳐_쓰기`) 그대로 |
| 2 누름이 무시된 이유 | 저장이 400ms를 넘으면 저장 중인 카드 오른쪽 위에 `저장 중`을 작게 얹는다([useShownAfter](../../../src/widgets/message-inbox/lib/useShownAfter.ts)). 카드의 테두리·면·글자 색과 높이는 바꾸지 않고, 저장이 끝나면 바로 사라진다 | [messagesActionsMsw](../../../src/app/messagesActionsMsw.test.tsx) 「저장이 늦을 때만 그 카드에 저장 중이 보인다 …」(누른 직후 없음 → 잠시 뒤 그 카드에만 → 저장 뒤 사라짐, `aria-busy`), 스토리 `발송_시점_저장_중` |

고른 방식과 이유 — 접근성 의미(버튼 `aria-disabled` + 묶음 `aria-busy`), 모양 유지를 위젯 전용 `LockedButton`에 둔 것, 저장 중 표시를 지연만 두고 최소 표시 시간을 두지 않은 것 — 는 [결정 기록](basis-for-decision/2026-11-02-schedule-save-lock-keeps-button-look.md)에 남겼다. 같은 이유로 깜빡이던 `고쳐 쓰기`(default 변형)도 함께 유지했다 — 지시가 이름 붙인 두 버튼 밖이지만 같은 잠금·같은 결함이라 포함했다.

hover는 play에서 진짜 포인터로 켤 수 없어, 스토리가 불러온 CSS의 `:hover` 규칙에서 가상 클래스만 뗀 선택자가 카드에 맞는지 브라우저에 묻고 그 면 색을 계산한다. 처음 쓴 도우미는 클래스 이름 안의 이스케이프된 `\:hover`까지 지워 선택자가 깨졌다(수정 뒤 첫 `test:storybook`에서 hover 스토리 실패) — 가상 클래스만 떼도록 고쳤다.

### 브라우저 확인 (2026-11-02, Playwright 한 탭, 포트 5223)

| 확인 | 수정 전(코디네이터 실측) | 수정 뒤 |
|---|---|---|
| `지금 바로` 누름 — `이대로 발송` | 20ms `aria-disabled`·`rgb(240, 240, 240)` → 111ms 해제·`rgb(23, 23, 23)` | 62ms `aria-disabled`·`aria-busy` → 79ms 해제. 면 `rgb(23, 23, 23)`·글자 흰색 그대로, `보내지 않음` 글자·`고쳐 쓰기` 면·글자 그대로, `저장 중` 표시 없음 |
| 진짜 마우스 hover(rv_02) | 변화 없음 | `직접 정하기` 흰 면 → `rgb(237, 237, 237)`, 테두리 `rgb(232, 232, 232)` 그대로. 고른 `지금 바로`(먹 면)·고를 수 없는 `마감 하루 전`(`rgb(250, 250, 250)`) 그대로 |
| 시각 칸을 연 동안(lockHint) | `aria-disabled`·`rgb(240, 240, 240)` | 같음(`data-lock` 없음) |

### 바꾼 기존 단언

없다. 스토리 2개(`발송_시점_hover`·`발송_시점_저장_중`)와 통합 사례 1개를 더했다. Storybook 회귀 블록(`stories.sb.ts`의 M8 블록)은 건드리지 않았다.

### 검증 (2026-11-02)

Node v24.11.0. 무거운 명령은 직렬화 wrapper로 하나씩 돌렸다. 계획 [plan.md](plan.md)는 읽기만 했다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| 수정 전 `npx vitest run src/app/messagesActionsMsw.test.tsx -t "저장이 늦을 때만"` | 1 | 재현 — `aria-busy` 없음 |
| 수정 전 `test:storybook -- -g "발송-시점"` | 1 | 재현 — `expected null to be 'rgb(237, 237, 237)'`, `expected 'rgb(240, 240, 240)' to be 'rgb(23, 23, 23)'` |
| `npm run typecheck`·`lint`·`format:check` | 0 | |
| 메시지 3파일(`messagesMsw`·`messagesActionsMsw`·`widgets/message-inbox`) | 0 | 67개 통과 |
| `STORYBOOK_E2E_PORT=6223 npm run test:storybook`(수정 뒤 1차) | 1 | 120개 중 119개 통과 — `발송_시점_hover` 실패(위 도우미 결함) |
| 같은 명령(도우미 수정 뒤 2차) | 0 | 120개 모두 통과(M8 블록: index 확인 + `M8 메시지/화면` 스토리 15개 play 포함) |

공용 Button은 바꾸지 않아 `shared/ui/button` 테스트와 전체 Vitest는 돌리지 않았다(지시 범위). `build`도 돌리지 않았다(Storybook build가 같은 컴포넌트를 컴파일했다).

## 2026-11-02 대화 목록 가리키기·포커스 미리 받기

### 근거와 범위

사용자 요청(코디네이터 지시, 2026-11-02, 직전 커밋 `38faeac` 후속). 왼쪽 목록의 대화는 이름·한 줄 미리보기만 목록 응답에 있고, 말풍선은 [ThreadDetail](../../../src/widgets/message-inbox/ui/ThreadDetail.tsx)이 대화를 열 때 따로 받는다. 그래서 처음 여는 대화는 스켈레톤을 거쳤다.

- **대화만 미리 받는다.** 보내기 전 확인 항목은 목록 응답(`messageInboxQueryOptions`)의 `reviews`에 상세가 다 들어 있어 골라도 요청이 없다. 미리 받을 것이 없어 범위에서 뺐다.
- **방식은 회의록 목록과 같다**([MeetingMinutes](../../../src/widgets/meeting-minutes/ui/MeetingMinutes.tsx)의 `onPointerEnter`·`onFocus` → `prefetchMinutes`). 대화는 조회가 하나라 `lib/prefetchThread.ts`를 따로 만들지 않고 [MessageInbox](../../../src/widgets/message-inbox/ui/MessageInbox.tsx)의 대화 행에서 `queryClient.prefetchQuery(messageThreadQueryOptions(workspaceId, threadId))`를 바로 부른다. ThreadDetail과 같은 Query라 캐시에 쓰는 길도 그 하나다.
- **staleTime은 앱 기본값**(`STALE_TIME.default`, [queryClient](../../../src/shared/api/queryClient.ts)에서 30초 확인)을 그대로 쓴다. 그 안에는 같은 행을 다시 가리켜도 요청하지 않는다.
- **열린 대화(`aria-current`)는 건너뛴다.** ThreadDetail이 이미 받고 있고, staleTime이 지난 뒤 가리키기만으로 열린 대화를 다시 받지 않게 한다.
- **실패는 조용히 버린다.** `prefetchQuery`는 거부하지 않는 promise를 돌려준다(오류를 삼킴). 고르면 ThreadDetail이 같은 Query로 다시 묻고 기존 오류 처리(다시 시도·찾을 수 없음)를 한다.
- **무효화와 충돌하지 않는다.** 행동 성공 때의 `messageKeys` 무효화는 미리 받아 둔 대화도 무효로 표시한다(보이지 않는 대화라 바로 다시 받지는 않는다). 다시 가리키면 staleTime 안이어도 새로 받는다.

### 회귀 테스트

[messagesMsw](../../../src/app/messagesMsw.test.tsx) 「대화 행을 가리키거나 포커스하면 그 대화를 미리 받는다」 6개, [messagesActionsMsw](../../../src/app/messagesActionsMsw.test.tsx) 1개를 더했다.

| 사례 | 수정 전 |
|---|---|
| 가리키면 그 대화를 한 번 받고, 고르면 스켈레톤 없이 바로 그리며 다시 묻지 않는다 | 실패(가리켜도 요청 없음) |
| 같은 행을 다시 가리켜도 30초 안에는 다시 받지 않고, 지나면 다시 받는다 | 실패 |
| 키보드로 포커스해도 미리 받는다 | 실패 |
| 미리 받기가 실패해도 화면에 알리지 않고, 고르면 대화 칸이 그 오류를 알린다 | 수정 뒤 추가 |
| 이미 열린 대화 행은 가리켜도 다시 받지 않는다 | 통과(지킴 단언) |
| 보내기 전 확인 항목은 가리켜도·포커스해도 요청이 없다 | 통과(지킴 단언) |
| 미리 받아 둔 대화도 발송 뒤에는 무효화돼 다시 가리키면 새로 받고, 고르면 보낸 메시지가 보인다 | 실패(가리켜도 요청 없음) |

「스켈레톤 없이」 단언은 지운 뒤에도 남는 기록(MutationObserver)으로 본다. 가리키기 없이 누르면(`fireEvent.click`) 이 감시가 스켈레톤을 잡는 것을 임시 사례로 확인하고 지웠다. 바꾼 기존 단언은 없다.

### 브라우저 확인 (2026-11-02, Playwright 한 탭, 포트 5223, `messages-default`)

목록을 받은 뒤 요청 0 → `박민수` 행 가리키기 `threads/th_02` 1건 → 떠났다 다시 가리키기·보내기 전 확인 `정하늘` 가리키기 추가 0건 → `박민수` 클릭 직후 스켈레톤 0개·제목 `박민수`, 추가 요청 0건 → 대화 `정하늘` 행에 키보드 포커스 `threads/th_03` 1건.

### 검증 (2026-11-02)

Node v24.11.0. 계획 [plan.md](plan.md)는 읽기만 했다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| 수정 전 `npx vitest run src/app/messagesMsw.test.tsx src/app/messagesActionsMsw.test.tsx -t "미리 받"` | 1 | 4개 실패·2개 통과(위 표) |
| 수정 뒤 같은 명령(실패 사례 추가 뒤 `messagesMsw`만) | 0 | 6개 통과 |
| `npm run typecheck`·`lint`·`format:check` | 0 | |
| 메시지 3파일(`messagesMsw`·`messagesActionsMsw`·`widgets/message-inbox`) | 0 | 74개 통과(기존 67 + 새 7), 미처리 거부 경고 없음 |

변경이 위젯 한 곳이라 전체 Vitest·`test:storybook`·`build`는 돌리지 않았다(지시 범위).

## 작업 근거와 요약 (2026-10-31 결정 전 부분)


코디네이터 지시에 따라 계획 C-6의 결정 전 단계 1~6을 구현했다. 브랜치 `feature/245-m8-messages`, 기준 `develop`(`ff9467e`) 위 커밋 8개다. push·PR은 하지 않았다.

계획 파일 [plan.md](plan.md)는 이 브랜치에서 **커밋되지 않은 작업 트리 변경**으로만 있다(커밋된 파일은 0바이트). 구현·검증·이 문서 작업 모두 계획 파일을 수정하지 않았다. 최종 게이트 검증의 시작·종료 SHA256은 `c054a4f6…cd4194`로 같았고, 이 문서 작업의 시작 시점 값도 같다.

| 커밋 | 단계 | 요지 |
|---|---|---|
| `277f09f` | 1 | `MessagesPage` 모드 분기(`import.meta.env.DEV && config.mswEnabled`), `messages/*` 아래 하위 경로(index · `threads/:threadId` · `*`), 경로 함수 `paths.messageReview`·`paths.messageThread`와 `MESSAGE_PARAMS`(임시·계약 아님 주석) |
| `7c97fa1` | 2 | 임시 DTO, `entities/message`(타입·매퍼·Query, key에 `workspaceId`), 픽스처·조회 handler 2개·메모리 DB 칸 3개·시나리오 4개, 모의 DB 저장 버전 2→3, MSW 안내 문장 갱신 |
| `e8f99f6` | 3 | `widgets/message-inbox`: 2단 레이아웃, 목록 두 영역(`보내기 전 확인 N`, `대화`·`답장 기다리는 중 N`, 채널), 검토 항목 읽기 전용 미리보기, URL 선택 |
| `16676c1` | 4 | 대화: 날짜 구분선(오늘 표시), 봇·상대 말풍선, 시각, 답장 대기 배지·안내 |
| `8c5b665` | 5 | 빈 상태(`EmptyMessages`), 목록·대화·검토 스켈레톤, 목록 오류와 대화 오류 분리, 없는 대화·잘못된 경로 안내 |
| `351a70e` | 6 | 목록·대화 각자 스크롤, 대화 칸 키보드 Tab 자리, AC-07 테스트, Storybook 스토리 8개 |
| `765e37a` | 회귀 | `e2e/restore.e2e.ts`의 저장 버전 기대값 2→3 |
| `58237a8` | 리뷰 수정 | 첫 메시지 시각을 읽을 수 없으면 날짜 구분선 없이 묶는다(V2-01) |

## 실제 구현 및 관련 코드

- **모드 분기** — [MessagesPage](../../../src/pages/messages/ui/MessagesPage.tsx)는 개발 서버 + MSW일 때만 새 화면을, 그 밖에는 기존 준비 중 안내를 그린다. `DEV`를 먼저 봐서 번들러가 새 화면 코드를 production 번들에서 지우게 했다. [기록](basis-for-decision/2026-10-31-messages-screen-msw-mode-only.md).
- **URL 선택** — 사람별 대화는 경로 `messages/threads/:threadId`, 보내기 전 확인 항목은 검색 파라미터 `messages?review=<id>`로 고른다([경로 함수](../../../src/shared/config/routes.ts)). URL 값은 페이지 경계에서 `parseRouteId`로 한 번 검증한다(D-132). 목록에 없는 id·모양이 틀린 id는 선택 없음으로 처리한다. [기록](basis-for-decision/2026-10-31-message-review-selection-search-param.md).
- **임시 엔티티** — [entities/message](../../../src/entities/message): 도메인 타입, DTO→도메인 [매퍼](../../../src/entities/message/model/mapper.ts), 조회 [Query](../../../src/entities/message/api/messageQueries.ts)(key에 `workspaceId`, AbortSignal 전달)와 2026-11-01에 더한 행동 요청 `requestMessageReviewAction`. 답장 대기는 handler가 「상대의 마지막 답 뒤에 처음 나간 봇 메시지의 시각」으로 주고, 화면이 보낸 날을 1일째로 며칠째를 센다(2026-11-01 이전에는 화면이 마지막 메시지로 대기 여부만 정했다). DTO는 [shared/types/api/message.ts](../../../src/shared/types/api/message.ts)에 있고 화면 계층은 DTO를 import하지 않는다.
- **MSW** — [handler](../../../src/shared/mock/handlers/message.ts)는 조회 `GET /api/v1/workspaces/:workspaceId/messages`, `GET /api/v1/workspaces/:workspaceId/messages/threads/:threadId`와 2026-11-01에 더한 행동 `PATCH …/messages/reviews/:reviewId`, `POST …/reviews/:reviewId/send`, `POST …/reviews/:reviewId/dismiss`다. 공간 ID로 걸러 다른 공간의 대화는 404다. 없는 대화의 오류 코드 `MESSAGE_THREAD_NOT_FOUND`도 임시이며 화면은 상태 404만 본다. [픽스처](../../../src/shared/mock/fixtures/message.ts), [메모리 DB](../../../src/shared/mock/db.ts)의 `messageReviews`·`messageThreads`·`messageFailures`, 시나리오 `messages-default`·`messages-empty`·`messages-list-error`·`messages-thread-error`와 2026-11-01의 `messages-send-fail`([scenarios.ts](../../../src/shared/mock/scenarios.ts)). MockDb 모양이 바뀌어 [persistence.ts](../../../src/shared/mock/persistence.ts)의 `MOCK_DB_VERSION`을 2→3으로, 2026-11-01에 다시 4로 올렸다(파일 규칙 「MockDb 모양을 바꾸면 버전을 올린다」).
- **화면** — [widgets/message-inbox](../../../src/widgets/message-inbox): [MessageInbox](../../../src/widgets/message-inbox/ui/MessageInbox.tsx)(2단·목록·빈 상태·목록 오류), [ThreadDetail](../../../src/widgets/message-inbox/ui/ThreadDetail.tsx)(대화·대화 오류·404·승인 대기·안내 바), 보내기 전 확인 [ReviewDetail](../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)(2026-10-31의 읽기 전용 `ReviewPreview`를 대신함), [MessageSkeletons](../../../src/widgets/message-inbox/ui/MessageSkeletons.tsx), 날짜·시각 [format.ts](../../../src/widgets/message-inbox/lib/format.ts). 목록 Query와 대화 Query는 서로 기다리지 않는다.
- **스크롤 칸** — 목록과 대화가 각자 세로로 스크롤한다. 구현 중 첫 측정에서 문서 높이가 5955px로 늘어 페이지가 세로로 스크롤되는 것을 발견했다. 말풍선·행의 `sr-only`(absolute) 글자가 스크롤 칸 밖으로 새어 나간 것이라 스크롤 칸을 `relative`로 고쳤다(`351a70e`).
- **스토리** — [MessageInbox.stories.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.stories.tsx)(`M8 메시지/화면`): 기본, 검토 항목, 고쳐 쓰기, 발송 실패, 대화, 대화 승인, 빈 상태, 로딩, 목록 오류, 대화 오류, 긴 대화(11개, 고쳐 쓰기·발송 실패·대화 승인은 2026-11-01 추가).
- **테스트** — MSW 모드 통합 테스트 [messagesMsw.test.tsx](../../../src/app/messagesMsw.test.tsx)(테스트 파일 안에서만 `config.mswEnabled`를 바꾼다), handler [messageScenarios.test.ts](../../../src/shared/mock/messageScenarios.test.ts), [mapper.test.ts](../../../src/entities/message/model/mapper.test.ts), [format.test.ts](../../../src/widgets/message-inbox/lib/format.test.ts), 2026-11-01에 더한 행동 통합 테스트 [messagesActionsMsw.test.tsx](../../../src/app/messagesActionsMsw.test.tsx)와 두 파일이 함께 쓰는 [messageScreen.ts](../../../src/app/test/messageScreen.ts). 로딩과 「응답 전에는 그대로」는 시나리오가 아니라 응답을 붙잡아(deferred) 재현한다.

임시 도메인 타입, DTO, MSW 경로, 오류 코드, 화면 하위 경로와 `review` 파라미터는 **계약이 아니다.** 코드의 각 파일 머리말에 임시라고 적었고 [대표 계약](../../contracts/frontend-api-contract.md) §5.7(「1차에서 화면을 만들지 않는다(D-171)」)은 고치지 않았다.

## 완료조건 확인

| 계획의 ID | 상태 | 근거 |
|---|---|---|
| AC-01 | 충족 | 기존 [라우트](../../../src/app/router/routes.test.tsx)·[가드](../../../src/app/router/guards.test.tsx)(`messages/threads/1`에서 준비 중 문구와 업무 요청 0건)·[앱 셸](../../../src/app/appShell.test.tsx) 테스트는 수정 없이 V3 전체 Vitest에서 통과했다. 새 build의 `dist/assets/*.js` 57개에서 메시지 표식 17종(`rv_01`, `th_01`, `mg_01`, `messageReviews`, `messageThreads`, `messageFailures`, `이재환`, `API 명세서 진행 상황`, `messages-default`, `MESSAGE_THREAD_NOT_FOUND`, `보낼 메시지가 없어요`, `이 메시지, 보낼까요`, `답장 기다리는 중`, `여기서부터 답장을 기다리고 있어요`, `대화를 찾을 수 없어요`, `mockServiceWorker`, `setupWorker`)을 `rg`로 검색해 모두 0건이고, `메시지는 준비 중이에요`는 1개 청크에 남았다. 계획의 「`msw` 0건」은 글자 그대로는 맞지 않는다 — `msw` 부분 문자열 8곳(4개 청크)이 있으나 모두 기존 승인 전송 리터럴 `'msw'`와 설정 필드 `mswEnabled`이고 대응 소스의 develop 대비 변경은 0이다. MSW 런타임 표식은 0건이다. `/messages/threads` 1건은 공용 경로 함수 `paths.messageThread` 문자열이다. production 브라우저 확인은 하지 않았다 |
| AC-02 | 충족 (MSW) | 통합 테스트 AC-02 묶음: 목록 두 영역 순서, 검토 고르기 → `?review=rv_01`·`aria-current`·미리보기, 주소로 바로 진입, 없는 id `rv_99`·틀린 id `a/b`는 선택 없음(alert 없음), 대화 고르면 검토 현재 표시 해제. 스토리 기본·검토 항목·대화. 뒤로가기(POP) 자체를 실행하는 전용 테스트는 없다 — 선택은 URL에서 바로 파생하고 따로 저장하는 상태가 없다(V2) |
| AC-03 | 충족 (MSW) | 통합 테스트 AC-03 묶음(봇이 마지막인 DM의 답장 대기, 답한 DM·채널은 대기 없음, 오늘 구분선), [format.test.ts](../../../src/widgets/message-inbox/lib/format.test.ts)(서울 시간 날짜 묶기, 첫 메시지 시각 불명 — `58237a8`), [mapper.test.ts](../../../src/entities/message/model/mapper.test.ts)(대기 규칙). 스토리 대화·긴 대화 |
| AC-04 | 충족 (MSW) | 통합 테스트 AC-04 묶음: 빈 상태·한 영역만 빔, 목록·검토·대화 로딩(응답 붙잡기), 목록 오류 중 대화 표시와 다시 시도 성공, 대화 오류 중 목록 선택, 없는 대화·다른 공간 대화·틀린 ID·없는 하위 경로. [messageScenarios.test.ts](../../../src/shared/mock/messageScenarios.test.ts). 스토리 빈 상태·로딩·목록 오류·대화 오류 |
| AC-05 | 충족 (MSW) | 통합 테스트 AC-05 묶음: `ws_02` 응답을 붙잡은 전환 구간에 이전 공간 행이 없고 새 공간 1건만 보임, 이전 공간 대화 ID는 새 공간에서 404 |
| AC-06 | 충족 (MSW 개발 서버, 임시 스크립트) | 아래 「AC-06 세 너비 측정」. 1024/1440/1920px의 12개 상태 모두 가로 넘침 0px, 목록·대화가 각자 스크롤하고 페이지는 움직이지 않음 |
| AC-07 | 충족 (MSW) | 통합 테스트 AC-07 묶음(영역 이름·제목, Tab→Enter로 검토·대화 선택 후 `aria-current`, 대화 칸 Tab 도달, 답장 대기 글자 표현). 세 너비 실제 키보드 확인은 아래 「AC-07 키보드 확인」 |

### AC-06 세 너비 측정

최종 게이트 검증(V3)이 Chromium headless(locale `ko-KR`, timezone `Asia/Seoul`, 높이 900px)로 `VITE_ENABLE_MSW=true` Vite 개발 서버에서 측정했다. 저장소에 남기지 않은 임시 Playwright 스크립트(`frontend/test-results/v3-visual.mjs`, 실행 뒤 삭제)다. 상태는 ① `messages-default` 목록 ② `?review=rv_01` ③ `/messages/threads/th_01` ④ 긴 대화(`th_02`)다. ④는 그 브라우저 컨텍스트의 `sessionStorage`에만 메시지 30개를 더하고 검토·대화를 각각 30개 복제해(검토 32, 대화 35) 목록도 넘치게 했다. 저장소의 픽스처·handler는 바꾸지 않았다.

| 너비 | 네 상태의 문서 `scrollWidth / clientWidth` | 네 상태의 문서 `scrollHeight / clientHeight` |
|---:|---|---|
| 1024 | 모두 1024 / 1024 | 모두 900 / 900 |
| 1440 | 모두 1440 / 1440 | 모두 900 / 900 |
| 1920 | 모두 1920 / 1920 | 모두 900 / 900 |

독립 스크롤(세 너비 같은 값):

| 대상 | scrollHeight | clientHeight | 조작과 결과 |
|---|---:|---:|---|
| 목록 aside | 5043 | 824 | scrollTop `0 → 120`, 대화는 `2974` 유지 |
| 대화 section | 3722 | 748 | scrollTop `2974 → 0`, 목록은 `120` 유지 |
| 페이지 | 900 | 900 | 위 조작 전후 `window.scrollY` `0` 유지 |

긴 대화를 열면 대화는 최신 메시지 위치(scrollTop 2974)로 간다. 검증자는 세 너비 × 네 상태 스크린샷 12장을 직접 열어 겹침·가로 잘림이 없고 목록의 긴 미리보기가 의도한 말줄임으로 보임을 확인했다. 구현 중에도 같은 방식의 임시 스크립트로 세 너비를 측정해 통과했다(목록 22행·대화 42건).

### AC-07 키보드 확인

같은 V3 실행에서 세 너비 모두 실제 `Tab`·`Enter`로 검토 링크 선택(`?review=rv_01`) → 대화 링크 선택(`/messages/threads/th_01`) → `aria-label="대화 내용"` section 포커스를 확인했다.

- 두 선택 모두 현재 항목의 `aria-current="page"`가 있고 목록 안의 현재 항목은 매번 1개였다.
- 검토 링크·대화 링크·대화 section 모두 `:focus-visible`이 true이고 outline은 `solid 2px rgb(23, 23, 23)`이었다. 스크린샷에서 포커스 선이 보임을 직접 확인했다.
- 긴 대화에서 PageDown 뒤 대화 scrollTop의 첫 양수 관측값은 1024px 22, 1440px 49, 1920px 20이고 목록은 120을 유지했다(최종 이동량이 아닌 첫 관측값).
- 이름 있는 목록·상세 영역, 날짜, 봇·상대 구분 글자, `답장 기다리는 중`과 대화 안 답장 대기 문장을 확인했다. pageerror 0건.

## 검증 내역

### 최종 게이트 (V3, 2026-10-31, Node v24.11.0) — 이전 HEAD 기록

HEAD `58237a8`, `frontend/`에서 순차 실행했다. 무거운 명령은 다른 워크트리와 겹치지 않게 직렬화 래퍼(Git Bash) 안에서 돌렸다. 기존 `node_modules`가 있어 `npm ci`는 생략했다.

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | |
| `npm run test -- --maxWorkers=2` | 0 | 163 files / 1849 tests 통과, 831.28s |
| `npm run build` | 0 | 새 JS 57개, 번들 검색은 AC-01 |
| `npm run test:storybook` (`STORYBOOK_E2E_PORT=6213`) | 0 | Storybook build 후 104 통과 |
| `node test-results/v3-visual.mjs` (`E2E_PORT=5213`, 임시) | 0 | AC-06·AC-07 측정·단언 통과 |
| `git diff --check develop...HEAD` | 0 | 출력 없음 |

### 전체 Vitest를 기본 설정으로는 한 번에 통과하지 못한 사실

이 기계에서 기본 설정(`npm run test`, 테스트 한도 5초, 기본 워커 수)의 전체 Vitest는 병렬 부하로 메시지와 무관한 테스트가 타임아웃해 한 번에 통과하지 못했다. 시간 한도·단언·설정은 바꾸지 않았고, 워커 수만 줄인 `npm run test -- --maxWorkers=2`로 위 exit 0을 얻었다. **기본 설정의 전체 실행이 통과한 기록은 없다.** 실패한 파일을 단독으로 다시 돌려 통과한 것을 전체 통과로 보지 않는다.

| 실행 | 설정 | 결과 |
|---|---|---|
| 구현 1차 전체 | `npm run test` | exit 1, 127 실패 / 1848(90건 5초 타임아웃, Button·Popover 등 무관한 스위트 포함) |
| 구현 2차 전체 | `npm run test` | exit 1, 58 실패 / 1848, 26개 파일 |
| 구현 3차 전체 | `npm run test`, 직렬화 래퍼 | exit 1, 17 실패 / 1848, 10개 파일 → 그 10개 파일만 `--maxWorkers=2`로 재실행 204건 통과 |
| V1 전체 (HEAD `765e37a`) | `npm run test`, 직렬화 래퍼 | exit 1, 24 실패 / 1848, 12개 파일(시간 초과 20, 요소 대기 3, 경로 기록 단언 1) → 12개 파일을 각각 `--maxWorkers=1`로 단독 실행해 244건 모두 통과 |
| V3 전체 (HEAD `58237a8`) | `npm run test -- --maxWorkers=2`, 직렬화 래퍼 | **exit 0**, 1849 통과 |

- 구현 중 `meetingUpload.test.tsx`는 기준 커밋 `ff9467e`에서도 단독 실행 2회 중 1회 3건 실패했다. 기준 커밋에서도 부하 때 흔들리는 테스트다.
- 실패 원인을 메모리 부족 등으로 계측해 확정하지는 않았다. V1은 「병렬 실행 조건에 민감한 실패」로 분류했고 단독 재실행에서 재현된 코드 결함은 없었다.
- 당시 기계 상황(구현 보고): 다른 워크트리 동시 실행, node 프로세스 약 86개, 여유 메모리 6~8GB.
- V1과 V3의 테스트 수 차이(1848 → 1849)는 `58237a8`이 더한 날짜 묶기 사례 1건이다.

### E2E

- 새 E2E 파일은 없다(D-117, 결정 4 이후 고정).
- 구현 중 관련 파일만 돌렸다: `restore.e2e.ts`(저장 버전), `layout.e2e.ts`·`select-switch.e2e.ts`(헤더 `메시지` 탭·공간 전환). 1차 병렬에서 `restore` 2건이 실제 회귀(기대값이 버전 2로 하드코딩)라 `765e37a`로 고쳤다. 2차 병렬에서는 `restore` 2건이 30초 테스트 타임아웃, `layout` 1024px 대시보드 제목 5초 대기가 실패했다. 3차 `restore`+`layout`을 `--workers=1`로 돌려 25 통과 exit 0이었다. `select-switch`는 2차까지 실패 없이 통과했다.
- **전체 `npm run test:e2e`는 실행하지 않았다.** 계획 최종 게이트의 「기존 E2E 회귀」는 위 관련 파일 실행으로만 확인했다.

### Storybook

- `test:storybook` 104건이 통과했고 메시지 스토리 8개가 `storybook-static/index.json`에 등록됐다.
- V3 확인 결과 104건의 play 수집 범위는 기존 M5~M7이다. **메시지 스토리 8개의 play 함수는 이 명령에서 실행되지 않았다.** 구현 보고의 「104 passed, 새 스토리 8개 포함」은 등록을 뜻하며 play 실행 근거가 아니다. 메시지 화면은 전체 Vitest와 위 브라우저 측정으로 확인했다.
- build 중 생성 CSS의 `color: var(...)` 경고 1건은 [M2 기록](../m2/basis-for-decision/2026-09-16-docs-prose-makes-the-build-warn.md)과 같은 기존 경고다.

### 리뷰

- V1(정적·단위 게이트, HEAD `765e37a`): typecheck·lint·format:check·build·AC-01 번들 검사 통과, 기존 테스트 변경의 적절성 확인. 전체 `npm run test` exit 0을 얻지 못해 major 1건으로 FAIL — 위 V3 실행으로 해소.
- V2(읽기 전용 코드 리뷰, HEAD `765e37a`): blocking·major 0건, minor 1건(V2-01)으로 PASS. 범위 위반(7~10단계, polling, 발송, 계약 문서) 없음.
- V3(최종 게이트, HEAD `58237a8`): blocking·major·minor 0건으로 PASS. V2-01 수정 확인.

### 수행하지 않은 검증

- 실제 메시지 API 호출 — API가 없다.
- 실제 Discord 발송과 그 상태 — 범위 밖.
- production 빌드를 브라우저로 띄운 확인 — 번들 문자열 검색으로만 확인했다.
- 메시지 스토리 play 함수 실행, 전체 `test:e2e`.

## 계획 대비 변경

- **검토 항목 선택 표현:** 계획 1단계는 검토 항목의 경로를 결정 4 이후로 미뤘다. 3단계의 「선택은 URL로」를 지키려고 검색 파라미터 `messages?review=<id>`로 임시 표현했다. 구현 워커가 코디네이터에게 물어 승인받은 선택이며 사용자 결정이 아니다. [기록](basis-for-decision/2026-10-31-message-review-selection-search-param.md).
- **모의 DB 저장 버전과 기존 테스트:** 계획에 없던 변경이다. MockDb에 메시지 칸 3개를 더해 `MOCK_DB_VERSION`을 2→3으로 올렸고, 같은 숫자를 기대하던 [taskScenarios.test.ts](../../../src/shared/mock/taskScenarios.test.ts)와 E2E [restore.e2e.ts](../../../e2e/restore.e2e.ts)의 기대값을 3으로 맞췄다. 저장·복원·손상값 폐기 단언은 그대로다(V1 확인).
- **시나리오 독립성 테스트 한도 30초:** [scenarios.test.ts](../../../src/shared/mock/scenarios.test.ts)의 시나리오 간 독립성 검사는 시나리오 수의 제곱만큼 적용·비교한다. 기준 커밋에서도 당시 부하로 5.2초(한도 5초)가 걸려 실패했고, 시나리오 4개와 메시지 데이터가 비교에 더해지면 약 7.5초다. 이 테스트 하나에만 30초 한도를 주었다. 반복·기대값·단언은 그대로이며 다른 테스트의 타임아웃을 가리지 않는다. 실행 시간 한도를 5초에서 30초로 완화한 것은 사실이다(V1 확인).
- **첫 메시지 시각 불명 방어(`58237a8`):** V2 리뷰가 V2-01(minor)로 「첫 메시지의 시각을 읽을 수 없으면 `date: ''` 묶음이 생기고 `dayLabel('')`이 `RangeError: Invalid time value`를 던진다」를 찾았다. 정상 MSW 픽스처에서는 생기지 않는 방어 코드 결함이다. 날짜 없는 묶음을 `null`로 두고 그 묶음은 날짜 구분선을 그리지 않게 고쳤으며 회귀 사례를 더했다. V3가 직전 커밋 함수와 현재 함수를 같은 입력으로 돌려 이전은 `''`·`RangeError`, 현재는 `null`로 새 사례가 실제로 변별함을 확인했다. 미상 날짜에 별도 문구를 쓰지 않은 선택은 [기록](basis-for-decision/2026-10-31-message-unknown-date-no-divider.md).
- **스토리 수:** 계획의 6개(기본, 빈 상태, 로딩, 목록 오류, 대화 오류, 긴 대화)에 검토 항목·대화를 더해 8개다.
- **2026-10-31의 결정 4 전 임시 표현 → 2026-11-01 현재:** 사용자 결정(결정 4의 UI 범위 = 디자인 캔버스 기준, MSW 목)으로 아래를 시안대로 바꿨다. 자세한 대응은 위 「디자인 차이표」.
  - 답장 대기: 회색 `답장 기다리는 중`·`여기서부터 답장을 기다리고 있어요` → 강조색 `답장 N일째 없음`과 `여기서부터 답장이 없습니다 — 오늘로 N일째예요`(서버가 준 시작 시각, 보낸 날이 1일째). 목록 행의 점과 숨긴 글자 `답장 기다리는 중`, 목록 머리 `답장 기다리는 중 N`은 시안 그대로 유지.
  - 검토 행 날짜: 만든 날 → 마감이 있으면 `MM/DD 마감`, 없으면 오늘 기준 `N일 전`.
  - 그대로인 것: 목록은 사람별 대화 최근순·채널은 뒤, 미리보기의 봇 이름은 공간 이름, 없는 대화(404)·잘못된 하위 경로는 「대화를 찾을 수 없어요」(다시 시도 없음)·5xx는 다시 시도.
- **2026-10-31에 만들지 않았다가 2026-11-01에 만든 것:** 발송 검토 흐름(7단계의 화면·MSW 목), `알림 규칙 보기`(팀 설정으로), `Discord에서 열기`, 발송 시점·`고쳐 쓰기`·`이대로 발송`·`보내지 않음`·승인·반려, 대화 하단 「봇이 보냅니다 · 확인하기」 안내, 봇 메시지의 `자동 발송`·`○○ 승인` 줄.
- **지금도 만들지 않은 것:** 권한 분기(8단계), 상태 전이 동기화·polling(9단계), 메시지 E2E(10단계, D-117), 대표 계약 메시지 절, 헤더 개수 배지(집계 API).
- **MSW 안내:** 계획 2단계 대상대로 구현 커밋 `7c97fa1`이 [MSW 안내](../../msw-guide.md)의 「메시지 API는 M1 mock 범위 밖」 문장을 임시 조회 경로 안내로 바꿨다. 2026-10-31 문서 작업에서 메시지 시나리오 4개와 여는 방법을, 2026-11-01(`d058561`)에 행동 경로·`messages-send-fail`·기본 선택·상대 표기 주의를 더했다.

## 남은 작업과 제한 사항

- **결정 4의 나머지** — UI 범위는 2026-11-01 사용자 결정으로 디자인 캔버스 기준·MSW 목이 됐다. 정책(검토 단위, 발송 권한, 재발송, 자동 발송 유무, 예약 메시지의 실제 발송)은 여전히 열려 있다.
  - 8 권한 분기, 9 상태 전이와 동기화(D-136, polling 여부), 10 메시지 E2E 고정(D-117)은 하지 않았다.
  - 7단계의 화면·MSW 목 동작은 위 「동작 — MSW 목과 그 한계」 기준이다. 계획 C-9의 「결정 후 완료조건은 AC-08부터」는 계획에 아직 정의되지 않아 이 문서에서 새 AC를 만들지 않았다 — 이번 재작업은 코디네이터 지시의 완료 조건(차이표·스크린샷 근거·게이트·커밋)으로 기록했다.
- **실제 API 연동** — 메시지 API가 생기면 별도 연동 과제다. 계획 C-8대로 `entities/message`의 경로·DTO·매퍼, MSW handler·픽스처, `MessagesPage` 모드 분기와 준비 중 문구에 기대는 테스트 6개, 대표 계약 §5.7을 함께 바꾼다. 실제 서버 응답·Discord 발송은 MSW 결과로 대체할 수 없어 미검증으로 남는다.
- **발송 요청의 멱등성 키** — 메시지 API가 아직 없어 MSW 목 범위다. 화면은 요청 중 잠금과 `useMessageReviewAction`의 진행 중 확인으로 한 화면 안의 중복 제출만 막는다. 실제 API 연동 때 발송(`send`) 요청에 멱등성 키가 필요하다 — 응답을 잃은 뒤의 다시 시도·다른 탭에서 같은 항목을 보낼 때 Discord에 두 번 나가지 않게 서버가 같은 키를 한 번만 처리해야 한다. 이번에는 구현하지 않았다(계약 §5.7과 함께 정한다).
- **화면 노출** — production은 계속 준비 중을 보인다. 2026-11-20까지의 시연에서 메시지 화면을 보여야 하는지는 확인이 필요하다(계획 C-10).
- **D-171 개정** — 이번 구현은 2026-10-30 사용자 답변에 따라 엔티티·MSW 픽스처를 만들었다. [D-171](../../decision/frontend-decisions.md)의 「엔티티도 MSW 픽스처도 만들지 않는다」를 결정 기록에서 개정할지는 확인이 필요하다.
- **전체 Vitest 환경** — 이 기계의 기본 설정 전체 실행은 병렬 부하로 무관한 테스트가 타임아웃한다. 게이트 통과는 `--maxWorkers=2` 실행 기준이다. 기본 설정에서 한 번에 통과하게 하는 일(실행 환경·동시성 조정, 부하에 민감한 테스트 정리)은 남아 있다.
- 메시지 스토리 play 함수는 `057e80a`부터 Storybook 회귀(M8 블록)에서 수집된다. 전체 `test:e2e`는 이번에도 실행하지 않았다.
- **공용 버튼의 `text-control`** — 같은 이름의 색 토큰 때문에 글자 크기가 아니라 색으로 생성돼, `text-control`을 쓰는 버튼·라벨이 13px가 아니라 상속 크기(대개 14px)로 그려진다(2026-11-01 VR-08 재현 중 발견). 메시지 크기는 길이로 적어 피했고, 앱 전체 수정(토큰 이름 또는 `text-(length:--text-control)`)은 다른 화면의 크기가 바뀌므로 별도 과제다.
- **발송·보내지 않음 뒤 목록이 모두 비는 경우** — EmptyMessages 한 장으로 바뀌며 상세 칸이 사라져 포커스가 BODY로 간다. 정상 픽스처에서는 대화가 남아 생기지 않는다.
- 확인 필요: 답장 대기 「며칠째」의 서버 계산 방식(지금은 MSW 목과 화면 계산), `알림 규칙 보기`의 실제 목적지(지금은 팀 설정), `Discord에서 열기`·`마지막 메시지 보기`의 실제 주소(지금은 목 주소), 발송 권한.
- 계획 C-11의 「AC-01~AC-07을 이슈에 옮기는 일」은 이 기록 범위 밖이다.

## 관련 기록

- [검토 항목 선택을 검색 파라미터로 임시 표현한 선택](basis-for-decision/2026-10-31-message-review-selection-search-param.md)
- [새 메시지 화면을 MSW 모드에서만 보이는 선택](basis-for-decision/2026-10-31-messages-screen-msw-mode-only.md)
- [시각을 읽을 수 없는 첫 묶음은 날짜 구분선만 생략한 선택](basis-for-decision/2026-10-31-message-unknown-date-no-divider.md)
- [결정 4의 UI 범위를 디자인 캔버스 기준·MSW 목으로 정한 사용자 결정](basis-for-decision/2026-11-01-message-ui-scope-design-canvas-msw.md)
- [발송 시점 카드의 화살표 키는 포커스만 옮기고 잠금은 aria-disabled로 한 선택](basis-for-decision/2026-11-01-send-timing-arrow-keys-move-focus-only.md)
- [발송 시점 저장 중의 발송 잠금은 모양을 바꾸지 않고, 저장 중 표시는 늦을 때만 보이는 선택](basis-for-decision/2026-11-02-schedule-save-lock-keeps-button-look.md)
- [실제 메시지 API 연결 때 서버에 경로·값이 없는 화면 요소를 뺀 선택](basis-for-decision/2026-11-04-messages-real-api-drop-unbacked-ui.md)
- [MSW 안내](../../msw-guide.md)의 메시지 절

검증 보고서(구현 보고, V1·V2·V3)와 스크린샷(2026-10-31, 2026-11-01 디자인 비교 포함)은 저장소 밖 작업 폴더에 있어 링크하지 않는다.

## 마일스톤 안내에 넣을 문장 제안

[마일스톤 안내](../README.md)와 [Frontend README](../../../README.md)는 A(#243)·B(#244)·C(#245) 세 브랜치가 병합된 뒤 한 번에 갱신한다. C 부분의 제안 문장은 다음과 같다. 링크는 넣을 문서 기준 경로를 괄호에 적었다.

- 마일스톤 안내 M8 행의 상태 칸: 「C 메시지(#245): MSW 모드에서만 디자인 캔버스대로 구현(목록·보내기 전 확인·대화·빈 상태, 행동은 MSW 목), AC-01~AC-07 프론트·MSW 기준 충족(결과 `m8/result-c.md`). 권한 분기·상태 동기화·메시지 E2E는 결정 4 대기. 완료 판정 없음」
- Frontend README 상태 문단: 「M8-C 메시지는 계획(`docs/plan/m8/plan.md`) C 절의 결정 전 부분과, 2026-11-01 사용자 결정(결정 4의 UI 범위 = 디자인 캔버스 기준, MSW 목)에 따른 발송 검토 화면을 구현했고 결과(`docs/plan/m8/result-c.md`)에 AC-01~AC-07의 프론트·MSW 기준 충족과 디자인 차이표를 기록했다. 메시지 API가 없어 화면은 MSW 모드에서만 보이고 실 API·production은 준비 중 안내를 유지한다. 전체 Vitest는 `--maxWorkers=2`로 통과했으며 기본 설정 전체 실행은 병렬 부하로 통과하지 못했다. 권한·상태 동기화·메시지 E2E는 결정 4 대기, 실제 API 연동은 미검증 과제다.」
