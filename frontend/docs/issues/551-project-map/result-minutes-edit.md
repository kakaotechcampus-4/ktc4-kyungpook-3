# #551 회의록 제목·전사 줄 고치기 결과

## 작업 근거와 요약

- 근거: [이슈 #551](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/551) 2026-11-09 댓글의 3번(전사 제목과 본문 고치기)과 2026-11-10 댓글의 화면 팁. 경로와 응답은 BE PR #669(브랜치 `feature/605-record-edits`, 병합 전)의 계약 §4.4.3 이다. 마일스톤 계획 밖 이슈 작업이라 이 결과에만 기록한다. 같은 이슈의 다른 묶음(요약 칸 승인 대기, 주제·결정 고치기)과 겹치지 않게 이 파일을 따로 둔다.
- 팀원 누구나 회의록 화면에서 제목을 고치고, 전사문의 발화를 눌러 글을 고친다. 고친 제목과 줄에는 `고침` 이 붙고, 펼치면 처음 제목이나 원문과 되돌리기가 있다. 화면 배치와 캐시 판단은 [D-192](../../decision/frontend-decisions.md)다.
- MSW 로 만들었다. 실 API 로는 확인하지 않았다. BE #669 병합 뒤 병합한다.

## 실제 구현 및 관련 코드

- **응답 읽기.** [회의록 스키마](../../../src/shared/types/api/minutes.ts)에 `title_edited`·`title_original`, 줄의 `seq`·`edited`·`original_text` 를 더했다. 모두 표시용이라 모양이 틀리면 그 표시만 버린다(D-184). `seq` 가 없거나 틀리면 그 줄은 글만 보이고 고칠 수 없다. 고치기 응답 스키마는 캐시에 넣는 `meeting_id`·`title`, `seq`·`text` 가 틀리면 `INVALID_RESPONSE` 다.
- **요청.** [고치기 요청](../../../src/entities/minutes/api/minutesEdits.ts) `editMeetingTitle`·`editTranscriptLine`. `null` 은 되돌리기다.
- **쓰기 훅.** [features/minutes-edit](../../../src/features/minutes-edit/model/useMinutesEdits.ts)의 `useTitleEdit`·`useLineEdit`. #594 쓰기 세션 규칙대로 누를 때 세션을 잡고, `mutationFn` 첫 줄에서 `isCurrent` 를 보고, 세션 `signal` 로 보내며, 세션이 끝난 뒤의 결과는 캐시·문구·알림에 남기지 않는다. 같은 종류의 고치기가 끝나기 전 두 번째 누름은 보내지 않는다.
- **캐시(§4.4.3).** 제목은 그 회의록 캐시의 제목 칸을 응답으로 바꾸고 `workspaceKey(ws,'meetings')`·`(ws,'minutes')`·`(ws,'project-map')` 을 무효화한다. 발화는 그 회의록의 그 줄만 응답으로 바꾸고 다시 받지 않는다. 그 전에 진행 중인 회의록 조회를 멈춰 고치기 전 값이 덮지 않게 한다.
- **`staleTime`.** 완료 회의록을 5분(`STALE_TIME.long`) 동안 최신으로 보던 것을 기본 30초로 바꿨다(D-136 → D-192). 다른 팀원이 고친 것이 창 포커스·다시 열기에서 보인다.
- **오류 문구.** [문구](../../../src/features/minutes-edit/lib/editMessages.ts).
  - 410: 토스트 `삭제된 회의라 고칠 수 없어요.` 와 함께 회의 상세·회의록을 다시 받아 `삭제된 회의예요` 로 바뀐다.
  - 404 `TRANSCRIPT_LINE_NOT_FOUND`: 그 칸 아래 `발화를 찾을 수 없어요. 회의록을 다시 불러왔어요.` 를 보이고 회의록을 다시 받는다.
  - 400: `제목은 1~200자로 적어 주세요.` 나 `발화는 1~10,000자로 적어 주세요.` 다. 보내기 전에도 같은 규칙으로 막는다. 공백만인 발화는 `발화를 비워 둘 수 없어요. 고치지 않으려면 취소를 눌러 주세요.` 다.
  - 응답을 읽지 못하면: `변경 결과를 확인하지 못했어요` 토스트와 새로고침을 보이고, 고치던 글은 남긴다.
  - 그 밖: 공용 문구. 오류 코드 `TRANSCRIPT_LINE_NOT_FOUND` 를 [오류 목록](../../../src/shared/api/errors.ts)과 [공용 문구](../../../src/shared/api/errorMessages.ts)에 더했다.
- **화면.** [MinutesEditing](../../../src/widgets/meeting-minutes/ui/MinutesEditing.tsx).
  - 제목 줄 옆 연필 단추 `제목 고치기` 가 같은 자리를 입력 칸·`취소`·`저장` 으로 바꾼다. Enter 는 저장, Esc 는 닫기이고, 닫히면 포커스가 연필 단추로 돌아간다.
  - 전사문 위에 `발화를 누르면 잘못 적힌 이름이나 용어를 고칠 수 있어요.` 가 있다. 각 줄의 글이 단추이고 이 안내를 설명으로 읽는다. 누르면 그 줄 안에 입력 칸이 열린다. Ctrl/⌘+Enter 는 저장, Esc 는 닫기이고, 닫히면 그 줄로 포커스가 돌아간다.
  - `고침` 은 펼침 단추(`aria-expanded`)다. 이름은 `고친 제목 — 처음 제목 보기`, `고친 발화 — 원문 보기` 다.
  - 긴 줄은 `whitespace-pre-wrap`·`wrap-anywhere` 로 폭 안에서 접는다. 휴대폰 폭의 입력 글자는 16px 이다(iOS 확대 방지).
- **별칭 안내.** 고친 이름은 별칭이 되지 않는다는 BE 규칙에 맞춰, 발화 고치기 칸 아래에 `원문은 남아요. 이름을 고쳐도 팀원 별칭은 바뀌지 않아요.` 를 둔다. 제목 칸 아래는 `고친 제목은 회의 목록과 프로젝트 맵에도 보여요.` 다.
- **저장하지 않은 글(D-138).** 고치는 칸에 바뀐 글이 있으면 다른 회의·화면으로 옮길 때 이탈 확인이 뜬다. 탭을 바꾸거나 다른 줄을 열 때도 `guardLeave` 로 같은 확인을 거친다.
- **고치기 상태(리뷰 #672 반영).** 어느 줄을 고치는지와 그 초안은 [useLineSession](../../../src/widgets/meeting-minutes/model/useLineSession.ts) 한 곳이 쥔다. 열 때마다 번호가 바뀌고, 저장·취소는 그 번호의 고치기가 아직 열려 있을 때만 닫는다. 앞 줄의 늦은 저장이 새로 연 줄의 초안과 포커스를 건드리지 않는다. 고치는 칸을 연 채 원문으로 되돌리면 칸을 먼저 닫고, 바꾼 초안이 있으면 묻는다.
- **저장 중인 줄 잠금(리뷰 #672 재리뷰 반영).** 저장·되돌리기 응답을 기다리는 줄은 그 줄 단추가 `aria-disabled`·`aria-busy` 이고 눌러도 열리지 않는다. 그 사이 다시 열면 초안이 요청 전 문장으로 심어지고, 그대로 저장하면 방금 저장하거나 되돌린 문장을 덮는다. 고친 방법으로 잠금을 골랐다. 응답이 오면 그 줄의 초안을 바꿔 넣는 방법도 있었지만, 손대지 않은 초안인지 판정하는 상태가 더 필요하다. 한 줄 응답은 짧고 쓰기는 한 번에 하나뿐(같은 종류 두 번째 누름은 보내지 않는다)이라 잠금의 대가가 작다. 응답이 오면 잠금이 풀리고, 그때 열면 응답 문장이 초안이다. 잠금은 화면 지역 상태가 아니라 쓰기 요청 자체(mutation 캐시의 회의별 진행 중 요청, `useMutationState`)에서 읽어, 전사문 탭을 갔다 와 패널이 다시 마운트돼도 남는다(리뷰 #672 세 번째 반영). 잠긴 줄은 「이 발화를 저장하고 있어요.」로 읽히고, 저장 중에는 Esc 로 고치는 칸이 닫히지 않는다. 실패 문구도 같은 곳(그 회의·종류의 가장 최근 요청 결과)에서 읽어, 탭을 떠난 사이 실패해도 돌아오면 그 줄 아래에 남는다. 세션이 바뀐 요청·취소·토스트로 알린 실패는 남기지 않고, 그 줄을 다시 열거나 새로 저장하면 지난 실패를 캐시에서 지운다(리뷰 #672 마지막 반영). 이 고치기 mutation 은 `gcTime: Infinity` 라 탭을 5분 넘게 떠나도 실패 문구가 수거되지 않는다. 지우기는 끝난 시도(실패·성공)를 모두 빼서, 회의·종류마다 끝난 시도는 많아야 하나다. 세션이 끝나면(로그인·가입·로그아웃·만료) mutation 캐시를 통째로 비운다(#681, 아래). 접힌 줄·제목의 실패 문구는 그 줄 단추·`제목 고치기` 단추의 설명(`aria-describedby`)이고 alert 는 하나다.
- **세션 끝의 mutation 캐시(#681).** 앞 사용자가 고치던 발화·제목 글이 mutation 변수로 다음 사용자의 메모리에 남지 않게, 세션을 끝내는 두 곳(로그인·가입·로그아웃의 `clearUserScope`, 401 만료의 `expireSession`)이 함께 쓰는 [`clearUserCache`](../../../src/entities/user/api/userCache.ts) 에서 세션 query 를 뺀 쿼리와 mutation 캐시 전체를 비운다. 범위를 고치기 mutation 에서 전체로 넓혔다. 근거는 다음과 같다.
  - 다른 쓰기 mutation 의 변수(태스크 글, 메시지 문구, 팀원 이름 등)도 앞 사용자의 글이다. 기본 5분 동안 남는 것도 같은 문제다.
  - 세대를 먼저 올리므로 진행 중이던 쓰기의 뒷처리는 이미 무효다(`isCurrent`). 요청 자체는 세션 signal 로 끊긴다.
  - 쓰기 key 는 모두 공간·대상 범위라, 비워도 다음 사용자의 두 번째 누름 막기(`isMutating`)가 잘못 풀리지 않는다.
  - 두 곳에 같은 쿼리 정리가 따로 있던 것을 한 함수로 모았다.
- **머리 제목(리뷰 #672 반영).** 회의록을 받은 뒤에는 회의록 제목만 쓴다(비었으면 `제목 없는 회의`). 제목 저장은 다른 쿼리의 재조회를 기다리지 않고 알림·포커스를 바로 준다.
- **공백(리뷰 #672 반영).** 보내기 전 검사는 Python `strip` 과 같은 공백을 뺀다([pythonStrip](../../../src/shared/lib/validation/pythonStrip.ts), MSW 도 같은 것을 쓴다).
- **MSW.** [고치기 핸들러](../../../src/shared/mock/handlers/minutesEdits.ts)가 BE `services/transcript.py`·`schemas/record_edit.py` 를 따른다.
  - 순서는 인증 → 본문 검사(400) → 삭제 410 → 없음 404 → 비소속 403 → 없는 줄 404 다.
  - 제목은 앞뒤 공백을 빼고 1~200자다. 발화는 1~10,000자이고 공백만이면 안 된다. NUL·짝 없는 서로게이트는 400 이다. 같은 원문이나 `null` 은 되돌리기다.
  - 제목은 회의·목록 요약·회의록 세 곳을 함께 바꾼다. 처음 제목은 BE 처럼 회의 단위(`db.titleEdits`)에 두어, 회의록 행이 없는 회의도 처음 제목을 지키고 회의를 지우면 함께 지운다(리뷰 #672).
  - 픽스처의 줄에 `seq` 를 붙였다. 예전 sessionStorage 저장본은 버전을 올리지 않고 복원할 때 고친 적 없는 회의록으로 채운다([persistence](../../../src/shared/mock/persistence.ts)).
- **계약.** [계약 §4.4.2 뒤 FE 사용 블록](../../contracts/frontend-api-contract.md)에 FE 처리와 합의 필요(`seq` 모양 오류를 그 줄만 고칠 수 없게 둔 것)를 적었다.

## 요청 조건 확인

| 할 일 | 상태 | 근거 |
|---|---|---|
| 팀원 누구나 제목 고치기, 발화 줄 눌러 고치기 | 구현 | `app/meetingMinutesEdit.test.tsx`(PM·팀원), E2E `minutes-edit.e2e.ts` |
| 「고침」 표시, 원문 보기, 되돌리기(null) | 구현 | 같은 테스트, `shared/mock/minutesEdits.test.ts` |
| 응답의 새 필드를 zod 에(표시용) | 구현 | `entities/minutes/api/minutesQuery.test.ts`(이전 서버·모양 오류) |
| 5분 캐시를 고치기에 맞게, 고친 뒤 캐시 §4.4.3 | 구현 | `features/minutes-edit/model/useMinutesEdits.test.tsx`(줄만 바뀌고 재조회 없음, 제목은 세 키 무효화) |
| 별칭을 만들지 않는다는 규칙과 안내 일치 | 구현 | 고치기 칸 안내 문구, 화면 테스트의 설명 단언 |
| 오류 문구(410·404·400), 이탈 확인 | 구현 | 화면 테스트 |
| 키보드·화면 낭독기, 긴 줄, 390 폭 | 구현 | 화면 테스트(포커스·설명), E2E(1280·390 가로 넘침 없음, 키보드) |
| MSW 를 BE 와 같게 | 구현 | `shared/mock/minutesEdits.test.ts` |
| 계약 FE 사용, 결정 기록, 결과 문서 | 작성 | 계약, D-192, 이 문서 |

## 검증 내역

- `npm run typecheck`, `npm run lint`, `npx prettier --check . '!.verify/**'`, `npm run build` 통과.
- 바꾼 곳 테스트(`--maxWorkers=1`). 대상은 `src/app/meeting*`, `widgets/meeting-minutes`, `entities/minutes`, `features/minutes-edit`, `shared/mock`, `shared/api`, `shared/types/api/minutes.test.ts`, `app/projectMap.test.tsx` 다. 결과는 보고서에 적는다. 전체 `npm run test` 는 CI 가 돌린다.
- 줄 캐시 갱신을 일부러 깨면 화면 테스트와 훅 테스트가 실패하는 것을 확인했다.
- Playwright `e2e/minutes-edit.e2e.ts` 3건을 로컬에서 통과했다. 1280·390 폭에서 고치고, 새로고침 뒤 남고, 원문을 보고 되돌린다. 키보드만으로 연다. 캡처는 git 에서 제외된 `frontend/.verify/551c/` 에 있다.
- 확인하지 못한 것: 실 BE(#669) 연결, 실제 화면 낭독기 소리, iOS 실기기 확대.
