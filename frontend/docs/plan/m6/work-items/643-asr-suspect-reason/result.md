# #643 확인 카드에 전사 오인식 의심 사유 표시

2026-11-10 [#643](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/643)의 「4. 확인 카드에 사유 표시 (frontend)」만 구현했다. 1·2·3·5(AI 목업 회의·시드·E2E·운영 설정)는 AI·BE 몫으로 남는다. 마일스톤 계획 밖 이슈 작업이며 전체 계획은 수정하지 않았다. MSW 로만 확인했다.

## 배경

BE 는 판단 경로 AI 가 제목의 의심 단어를 보내면 auto 를 막고, 생성 승인 payload 에 `asr_suspects` 를 싣는다([extractions.py](../../../../../../backend/app/api/extractions.py), 항목 모양은 [meeting 스키마](../../../../../../backend/app/schemas/meeting.py) `AsrSuspect`). FE 는 이 값을 읽지 않아 PM 은 「확인 필요」만 보고 이유를 몰랐다.

## 변경

- **경계.** 승인 응답 스키마(`shared/types/api/approval.ts`)가 `payload.asr_suspects` 를 읽는다. 항목은 `word`·`source`·`candidates` 이고, 모양이 틀린 항목은 null, 배열이 아닌 값은 null 로 둔다. `candidates` 가 글자 목록이 아니면 그 항목을 버린다(줄이 빠진다). 빈 후보로 읽으면 「다시 확인해 주세요」로 말이 바뀌기 때문이다. 키가 없으면 후보 없음이다. 이 키 때문에 응답이 `INVALID_RESPONSE` 가 되는 일은 없다.
- **도메인.** `AsrSuspect = { kind: 'misheard'; word; candidates } | { kind: 'check_failed' }`, 생성 승인의 `asrSuspects: AsrSuspect[]`. mapper 는 `source` → 읽기 함수 표로 바꾼다. `evidence`·`title` 은 교정 후보, `check_failed` 는 검사 실패다. 모르는 `source`·빈 `word`·null 항목은 버리고(개발 모드 경고), 검사 실패는 여럿이어도 하나다. `null`·`[]`·키 없음은 모두 빈 목록이다.
- **문구.** `asrSuspectLine`(`entities/approval/lib/asrSuspect.ts`)이 한 줄을 만든다. 조사 `은/는` 은 `shared/lib/korean.ts` 의 `topicParticle` 이다. `objectParticle` 과 받침 판정을 함께 쓴다.

| 경우 | 문구 |
|---|---|
| 후보 하나 | '애포'는 '배포'일 수 있어요 |
| 후보 여럿 | '애포'는 '배포', '애플' 중 하나일 수 있어요 |
| 후보 없음 | '애포'를 다시 확인해 주세요 |
| 검사 실패 | 전사 확인을 하지 못했어요(상세의 `전사` 라벨 뒤에서는 확인하지 못했어요) |

- **화면.**
  - 태스크 목록 확인 필요 탭의 생성 승인 카드: 사유 줄 아래 「전사 확인」 목록(마이크 아이콘, 작은 글씨). 확인 필요·보류 카드 모두.
  - 승인 상세: 「확인이 필요한 이유」 절(`GapReasons` → `ConfirmReasons`)이 빠진 값이 없어도 의심이 있으면 열리고, 담당자·마감 줄 뒤에 굵은 `전사` 줄을 둔다. 대기 중 생성 승인만이다.
  - 대시보드 확인 필요 행: 빠진 값·보류가 없을 때 마지막 기본 문구 「내용을 확인해야 해요」 대신 첫 의심 문구다.
  - 세 곳 모두 공백 없는 긴 단어·후보(BE 는 각 100자)를 칸 폭에서 끊는다(`wrap-anywhere`, 카드 줄은 글자 칸 `min-w-0`·아이콘 `shrink-0`). 전역 `word-break: keep-all` 때문에 그대로 두면 390 폭에서 카드 밖으로 나갔다(Codex 리뷰).
- **MSW.** 기본 승인 픽스처는 `asr_suspects: []`(검사했고 없음). 시나리오 `approval-asr-suspects` 는 ap_01 교정 후보(애포 → 배포), ap_02 검사 실패, ap_03 `null` 이다. `approval-asr-suspects-long` 은 공백 없는 긴 단어·후보다(ap_02 는 빠진 값이 없어 대시보드에도 보인다). 회의 올리기 흐름이 만드는 승인 payload 는 키가 없어 표시가 없다. 모의 저장 버전은 그대로다(키가 없으면 빈 목록이다).
- **문서.** [계약](../../../../contracts/frontend-api-contract.md) `ApprovalResponse` 줄과 §2.5 payload 에 필드·표시 규칙·FE 구현을 더했다. [D-184](../../../../decision/frontend-decisions.md) 표에 「표시용 덧붙임 목록」 줄을 더했다. 새 결정 번호는 쓰지 않았다.

## 설계에서 정한 것

- **틀린 항목만 버린다(D-184 예외).** D-184 는 목록 한 건이 깨지면 응답 전체를 실패로 본다. `asr_suspects` 는 사유 한 줄일 뿐이라 버려도 화면이 사실과 다르게 말하지 않는다. 승인 카드 전체를 막으면 PM 이 승인·반려를 못 한다. 그래서 D-184 표에 예외 줄을 더했다.
- **`null` 과 `[]` 를 도메인에서 구별하지 않는다.** 둘 다 표시가 없고, 구별을 쓰는 화면이 없다.
- **모르는 `source` 는 `알 수 없는 ○○` 로 보이지 않고 버린다.** 이슈 본문의 규칙이다. 무엇을 의심했는지 모르는 줄은 PM 이 할 일이 없다.
- **문구.** 이슈의 「'애포'는 '배포'일 수 있어요」와 따옴표를 그대로 쓴다. 후보 여럿은 쉼표로 잇고 「중 하나」로 묶었다. 후보 없음은 「다시 확인해 주세요」로 PM 이 할 일을 말한다. 후보는 BE 상한(5개)까지 다 보인다.
- **보이는 자리.** 승인·반려를 하는 두 곳(목록 카드, 상세)에 모두 보인다. 대시보드는 한 줄 요약이라 빠진 값이 있으면 그 사유가 먼저다(할 일이 더 분명하다).
- **라벨이 있는 자리는 라벨을 되풀이하지 않는다.** 상세의 `전사` 줄은 검사 실패를 「확인하지 못했어요」로 줄인다. 그대로 두면 눈과 화면 낭독기 모두 「전사 전사 확인을 하지 못했어요」였다. 라벨 없는 목록 카드·대시보드는 「전사 확인을 하지 못했어요」 그대로다. 문구는 `asrSuspectLine(suspect, { labeled })` 한곳에서 정한다(관리 세션 리뷰 반영).

## 검증

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npx prettier --check . '!.verify/**'` | 통과 |
| `npm run build` | 통과 |
| 바꾼 곳 테스트 `--maxWorkers=1` | `app/approvalAsrSuspects`·`app/approvalsMsw`·`entities/approval/**`·`types/api/approval`·`lib/korean`·`dashboard/lib/dashboard`·`mock/taskScenarios`·`mock/scenarios`·`app/tasks`·`app/dashboard`, 18 파일 406 건 통과. 전체 `npm run test` 는 CI 가 돈다 |

- 새 화면 테스트(`app/approvalAsrSuspects.test.tsx`, 10 건): 교정 후보·검사 실패 문구, `null`·`[]` 표시 없음, 모르는 `source` 무시(옆의 정상 항목은 보임), 모양이 틀린 `asr_suspects`(문자열, 숫자 `word`)에도 카드 제목·승인 버튼이 남음, 목록 이름 `전사 확인`·절 이름 `확인이 필요한 이유`, 빠진 값 없이 의심만 있어도 절이 열림.
- mapper 가 늘 빈 목록을 돌려주게 일부러 망가뜨리면 표시를 확인하는 6 건이 실패한다(표시 없음을 보는 4 건은 통과). 되돌린 뒤 통과.
- E2E `e2e/approval-asr-suspects.e2e.ts`(390 폭, `approval-asr-suspects-long`): 목록 카드·상세 ap_01·ap_02·대시보드 행에서 의심 줄이 칸 안에서 끝나고 옆으로 넘치지 않는다. 줄바꿈 수정을 뺀 코드에서는 카드 줄이 199px 넘쳐 실패하는 것을 확인했다.
- 브라우저(MSW, `approval-asr-suspects`): 1280·390 에서 목록 카드 두 장에 각 한 줄, 상세 ap_01·ap_02 에 `전사` 줄, ap_03 에는 없음을 확인했다. 증거는 커밋하지 않는 `frontend/.verify/643/shots/` 에 있다.

## 확인하지 않은 것

- 실서버 왕복. BE 코드(`extractions.py`, `AsrSuspect`, `ai/judge/asr_check.py`)를 읽어 맞췄다.
- 대시보드의 의심 문구는 MSW 시나리오 카드가 모두 빠진 값이 있어 브라우저에서는 보이지 않았다. 단위 테스트로만 확인했다.
- 회의록 화면의 추출 항목에는 표시하지 않았다(이슈 범위 밖). BE 추출 응답의 `asr_suspect_count`·`asr_check_failed` 로 같은 사유를 보일 수 있다.
