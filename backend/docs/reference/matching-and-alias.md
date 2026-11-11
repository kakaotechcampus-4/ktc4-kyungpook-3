# 유사 검색과 담당자 별칭

[Backend README](../../README.md)로 돌아가기

유사 검색과 AI 판단 접수, 담당자 별칭 찾기·학습, 봇의 이름 힌트 조회를 다룬다.

## 유사 task 검색과 AI 판단 접수

회의에서 나온 말이 기존 task의 수정인데도 새 task가 생기는 것을 막는 흐름이다(#102).

1. AI가 Terra 1단계 결과 문장으로 `POST /api/v1/workspaces/{workspace_id}/tasks/similar`를 부르면, BE가 비슷한 기존 task 후보(AI의 `NotionCandidate` 필드 형식)를 돌려준다.
2. AI가 Terra 2단계에서 새 task인지 기존 task 수정인지 판단한다.
3. AI가 판단 결과를 `POST /api/v1/extractions` 항목의 `action`(create/update/merge)으로 보낸다. merge 는 유사 검색이 돌려준 승인 대기 카드에 합치는 것이다(#141).

update의 `target_task_id`가 없거나 다른 워크스페이스 task인 항목, create·merge의 `task_title`이 빈 항목은 건너뛰고 나머지는 처리한다(응답 `item_count`는 저장된 항목 수).

### 임베딩과 검색

task 제목의 임베딩은 `task.embedding`(pgvector, 1536차원)에 둔다. 생성·제목 변경 때 NULL로 비우고 서버 안의 워커가 `EMBEDDING_SYNC_INTERVAL_SECONDS`마다 채운다. 요청 안에서는 임베딩 API를 부르지 않는다.

워커는 제목이 비었거나 공백뿐인 task를 보내지 않고, 실패하면 아래처럼 한다.

| 실패 | 동작 |
|---|---|
| 입력 오류(400·413·422) | 하나씩 다시 보내 거절된 task만 건너뛴다 |
| 그 외(연결·타임아웃·5xx·429) | 연속 실패할수록 대기 간격을 두 배로 늘린다(최대 5분, `Retry-After`가 있으면 우선). 성공하면 원래 간격 |
| 401·403 | 바로 5분 간격으로 늘리고 error 로그를 남긴다 |

- 검색 대상은 같은 워크스페이스에서 status가 todo·in_progress·blocked·done이고 임베딩이 있는, 지우지 않은 task다. 코사인 유사도 상위 `k`(기본 3)개 중 `min_similarity`(기본 0.4, ai/docs/basis_for_decision/ai/2026-09-22-0010-embedding-similarity-threshold.md) 이상만 돌려준다.
- `include_pending: true`(기본 false, 불리언만)를 보내면 임베딩이 있는 승인 대기 task_create 요청을 최대 2개 더 합친다. task `k`개 뒤에 더해 유사도 내림차순(같으면 task가 앞)이고 `min_similarity`도 같다. AI는 합치기 배포 뒤에 켠다(#141).
- pending 후보는 `task_id`·`status`·`notion_page_id`가 null이고 `approval_id`가 있다. 제목·마감·담당자는 payload에서 읽고(형식이 틀리면 마감·담당자는 null) `updated_at`은 요청 생성 시각이다. task 후보의 `approval_id`는 null이다.
- 봇이 세션 없이 부르므로 `X-Service-Token` 헤더를 `SERVICE_TOKEN`과 비교해, 없거나 다르면 401이다.
- 임베딩 호출이 실패하면 빈 목록 대신 `EMBEDDING_UNAVAILABLE`(502)이다. 빈 목록이면 호출한 쪽이 중복 task를 만들 수 있다.

### 새 항목 게이트

`action`이 없거나 `create`인 항목은 게이트가 auto면 task를 만들고, 아니면 task_create 승인 요청을 만든다. 게이트는 `decide_create_gate`가 정한다.

AI가 경로를 보내지 않으므로 항목이 보낸 키로 가린다(`ExtractionItemCreate.extraction_path`). `action`·`category`·`doc_text`를 보냈으면 judge, 확신도를 보냈으면 legacy다. 모든 항목이 같을 때만 `extraction.extraction_path`에 남기고 아니면 NULL이며, 확신도를 보내지 않으면 0.0이 아니라 NULL(측정 안 함)로 저장한다.

1. 먼저 BE가 계산한 담당자 확신도를 본다. 담당자를 언급했는데 찾지 못했으면(중의적·없음) `hold`다. `assignee_raw` 없이 `second`·`thirdpronoun`·`thirdrole`만 오거나 1인칭인데 화자가 없어도, 사람을 지목했지만 누군지 모르는 것이라 `hold`다(`mentions_assignee`).
2. update 항목은 항상 `review`다(#265).
3. judge 항목은 그다음 아래 auto 조건을 모두 만족하면 `auto`, 아니면 `review`다.
4. 경로를 가릴 수 없고 확신도도 없는 항목은 `review`, legacy는 확신도로 정한다(#201).

1인칭 화자는 `evidence_speaker_member_id`, `evidence_speaker`(uid), 결론 발화의 `member_id`(활성 팀원일 때, 아니면 그 발화의 uid) 순으로 정한다. `evidence_speaker_member_id`가 탈퇴하지 않은 팀원이 아니면 화자를 못 찾은 것이고 다음으로 넘어가지 않으며, 새 항목은 경로와 무관하게 `hold`다. 화자도 `assignee_raw`도 없는 1인칭은 judge·경로 불명이면 `hold`, legacy는 확신도로 정해 `review`가 될 수 있다.

auto가 나와도 경로와 상관없이 `review`로 내리는 경우가 둘 있다.

- `assignee_type`이 `thirdrole`(역할로 지목)인 새 항목. 역할은 맡은 사람이 바뀔 수 있어 PM이 본다(#459).
- 환경변수 `AUTO_CREATE_ENABLED`가 켬 값(`true`·`1`·`on`·`yes`·빈 값)이 아닐 때(기본 켜짐, `hold`는 그대로, 모르는 값은 경고 후 꺼짐). 근거 상태는 그대로 저장해 AI 검증은 계속 돌고 태스크만 PM 확인 뒤에 생긴다. "자동 생성이 꺼져 있어" 로그는 켰으면 auto였을 항목이다(#382 멘토 리뷰).

### judge auto 조건

숫자 점수가 아니라 아래 조건을 모두 만족할 때만 `auto`다(`matching.auto_blockers`, #232). `task_status`·`due_status`·`similar_count` 중 하나라도 보내지 않으면 `review`이고, 못 맞춘 조건은 info 로그(`reasons=`)로 남긴다.

1. 새 항목이다.
2. `task_status`가 certain이다.
3. 담당자를 언급했으면 한 명으로 찾았고(검증된 별칭이나 화자) 확신도가 0.8 이상이다.
4. `assignee_type`이 `second`·`thirdpronoun`·`thirdrole`이 아니다. 대명사는 AI가 문맥으로 푼 이름이고, 역할은 맡은 사람이 바뀔 수 있다.
5. `due_status`가 certain이거나 missing이고 `due_date` 유무와 맞는다.
6. `similar_count`가 0이고, 임베딩이 없는 활성 task(`embedding.has_unsearchable_tasks`)와 임베딩이 없는 승인 대기 task_create 요청(`embedding.has_unsearchable_pending`, `unsearched_pending_exists`)이 워크스페이스에 없다.
7. AI가 보낸 전사 오인식 의심 단어(`asr_suspects`)가 없다.

할 일 근거 상태는 LLM의 자기 표시라 걸러 내는 힘이 약해서, 중복 생성은 임베딩으로 계산한 유사 검색 결과로 막는다. `top_similarity`는 판단에 쓰지 않고 기록만 한다(유사도 기준값을 정할 근거).

- 임베딩이 없는 task는 AI의 유사 검색에 잡히지 않아 0을 믿을 수 없다. 같은 회의에서 앞 항목이 auto로 만든 task도 걸려, 한 회의에서 auto는 보통 첫 항목뿐이다.
- 임베딩 API가 지금 제목을 거절한 task도 포함한다. 워커가 다시 시도하지 않을 뿐 검색에서 빠진 것은 같아서, 제목이 바뀌어 임베딩이 채워지거나 지워질 때까지 auto를 막는다. 지운 task와 제목이 비었거나 공백뿐인 task는 뺀다.
- 임베딩 없는 승인 대기 요청은 유사 검색에 합치는 승인 대기 후보에 잡히지 않아 막는다. 빈 제목으로 건너뛴 요청은 빼고, 이 요청 안에서 앞 항목이 만든 pending은 보지 않는다.
- AI는 새 할 일 제목의 명사 중 워크스페이스 용어 목록(`GET /workspaces/{id}/asr-terms`)에 없는 말을 Jev로 확인해, 맞게 적혔다고 보지 않은 단어를 `asr_suspects`로 보낸다. 의심 단어가 있으면 `asr_suspect`, 검사를 못 했다고 보내면(`source=check_failed`) `asr_check_failed`로 막는다. 빈 목록과 null은 막지 않는다(AI 결정 기록 0051).

### auto 되돌리기와 지운 task

`POST /api/v1/extractions/{extraction_id}/items/{item_id}/revert`(PM)는 auto로 만든 태스크를 지우고(`task.is_deleted`) 같은 내용의 task_create 승인 요청(`gate: review`, 표시용 `reverted_task_id`)을 만들어 항목에 잇는다. 항목은 `task_id`를 비우고 `reverted_at`·`reverted_by`를 남기며, `gate`는 처음 판단대로 `auto`다.

- 승인하면 새 태스크가 생겨 항목에 이어지고, 반려하면 태스크 없이 끝난다. 값 하나가 틀린 것은 태스크를 직접 고치면 되지만 중복·오판은 고칠 값이 없어서 PM이 승인·반려를 다시 고르게 한다.
- 만든 뒤 태스크가 바뀌었거나(`version`이 1이 아님) 그 태스크의 처리 대기 승인 요청이 있으면 409 `AUTO_TASK_NOT_REVERTIBLE`이다. 바뀐 값이 승인 요청에 담기지 않고 사라지기 때문이다.
- 승인 요청의 근거는 저장된 근거 발화(`evidence`, #229) 중 seq가 가장 큰 발화다. AI가 `evidence_seqs`를 보내지 않았거나 하나도 찾지 못했으면 비어 있다.

지금은 auto 되돌리기만 task를 지운다. 행은 남기고(Notion 페이지 보관, 추출 항목·이력 연결 유지) task 목록·조회·수정·이력·유사 검색·임베딩·승인 요청 대상에서 뺀다.

- 지운 task를 가리키는 조회는 404 `TASK_NOT_FOUND`, update 추출 항목은 건너뛰고, 추출 조회는 그 task를 가리키던 항목의 `task_id`를 null로 내린다.
- Notion 재시도(`POST /tasks/{id}/notion-sync/retry`)만 지운 task도 받는다(페이지 보관 재시도).
- task를 바꾸는 경로(`PATCH /tasks/{id}`, 이력 되돌리기, 승인 요청 생성, 추출 update 대상)는 task 행을 커밋까지 잠그고 다시 읽어, 되돌리기와 겹쳐도 지운 task에 쓰지 않는다.

### update 항목

`action: update`는 `target_task_id`의 task_update 승인 요청을 만든다. 신뢰도와 무관하게 항상 PM 승인 대상이다. `task_title`은 없어도 되고, 와도 제목은 바꾸지 않는다.

- 들어온 값 중 지금 task와 다른 `due_date`·`status`·`assignee_member_id`만 담는다(담당자도 같으면 뺀다). `due_cleared`가 true이고 `due_date`가 없으면, 지금 task에 마감이 있을 때만 `due_date: null`과 `base_values.due_date`를 담는다(마감 해제, #624).
- 변경 필드마다 `base_values`를 남겨 승인 때 그 뒤 수정과 충돌하는지 확인한다. 기준값은 AI가 유사 검색에서 본 값(`target_snapshot`의 `due_date`·`status`·`assignee_member_id`)이고, 보내지 않은 필드나 `target_snapshot`이 없는 요청은 등록 시점 값이다. 검색과 등록 사이에 PM이 고친 값을 승인이 덮지 않게 하려는 것이다.
- AI가 task를 고를 때 본 제목(`target_snapshot.title`, 없거나 null이면 등록 시점 제목)을 payload의 `base_title`에 남긴다. 승인 때 지금 제목과 다르면(앞뒤 공백만 다르면 같은 제목) 다른 필드가 그대로여도 `APPROVAL_CONFLICT`의 `title` 항목으로 알리고, 제목은 바꾸지 않는다.
- `base_title`이 없는 요청(이 기능 전에 만든 요청, `base_title`을 보내지 않은 수동 생성)은 제목을 확인하지 않는다. 수동 생성(`POST /approvals`)은 payload를 그대로 저장해서 `base_title`·`base_values`를 넣으면 확인한다(#185).
- 담당자를 하나로 못 찾았거나(중의적이거나 없음) `category: scope`(대응하는 task 필드가 없는 범위 결정)면 다른 변경이 없어도 PM이 보도록 승인 요청을 만든다. 그 밖에 담당자까지 같거나 언급이 없고 다른 변경도 없으면 만들지 않는다(`doc_text`·근거는 ExtractionItem에 남는다).

`category: scope` 인 task_update 를 승인하면 필드 반영 뒤 `changed_field: "scope"` 이력 한 줄을 남긴다. `old_value` 는 null, `new_value` 는 payload `doc_text`(앞뒤 공백을 지우고 비면 null)이고, 출처는 같은 승인의 제안 값 이력과 같다(`change_source` 가 있으면 그 값, 없으면 채팅 회의는 chat, 그 밖은 meeting).

- 범위만 있는 승인은 `version` 을 올리지 않고 Notion 동기화를 요청하지 않는다. 반려·409 `APPROVAL_CONFLICT` 면 남기지 않는다.
- 답장 카드는 이 이력을 답장의 scope 줄에 잇는다. 범위 이력 되돌리기는 400 `INVALID_REQUEST`이고, 근거는 [M6 결정 기록](../plan/m6/basis-for-decision/2026-11-08-scope-change-history.md)이다.

### 추출 조회

`GET /api/v1/extractions/{extraction_id}` 항목의 `task_id`는 연결된 task다. create는 task가 생긴 뒤에 채워지지만 update는 수정 대상이라 승인 전에도 있어서, 반영 여부는 `approval_status`(연결된 승인 요청의 `status`: pending·approved·rejected, 승인 요청이 없으면 null)로 본다.

- approved는 task 반영과 같은 트랜잭션에서 커밋되고, 충돌로 반영하지 못하면 pending으로 남는다.
- 상태는 항목 조회에 승인 요청을 붙여 한 쿼리로 읽는다. 따로 읽으면 그 사이 승인이 커밋되어 `task_id`는 승인 전, `approval_status`는 승인 뒤 값으로 어긋날 수 있다(#211).
- 항목의 `gate`가 `auto`면 승인 없이 만든 항목이다. 되돌렸으면 `reverted_at`이 있고 새 승인 요청이 `approval_id`·`approval_status`로 보인다.
- 판단 근거로 `task.evidence_status`·`due_date.evidence_status`·`similar_count`·`top_similarity`를 함께 싣는다(보내지 않았으면 null).

### merge 항목

`action: merge`는 `target_approval_id`의 승인 대기 task_create 카드(같은 워크스페이스, 팀원이 직접 만든 카드 포함)에 합친다. 새 카드·task는 만들지 않고 항목은 `action=merge`, `approval_id`=그 카드로 남는다. 규칙은 `app/services/pending_merge.py`에 있다.

| 카드 값 | 합치는 규칙 |
|---|---|
| 마감 | 새 값이 있을 때만 덮어쓴다 |
| `status` | 보냈을 때만 덮어쓴다. 표시용이라 승인으로 만드는 task 는 항상 `todo` |
| 담당자·`assignee_raw`·카드 gate·`assignee_item_id`(담당자를 정한 항목) | `category`가 `assignee`일 때만 덮어쓴다 |
| `doc_text` | " / "로 잇는다 |
| 합친 항목의 근거 | `merged_items`에 쌓는다 |
| 제목·대표 근거·`extraction_item_id` | 처음 것 그대로 |

- 카드에 있던 담당자를 지우게 되면(담당자 표현이 없는 none·group 항목) PM 이 알아보도록 카드 gate 를 `hold`로 올린다.
- 그 밖의 merge 항목은 `assignee_type`·`assignee_raw`를 보지 않는다. 별칭을 찾지 않고 판정 로그도 남기지 않으며 항목 gate 는 `review`다.
- 합친 항목은 새 일이 아니라 judge auto 조건을 보지 않고, gate가 `auto`면 `review`로 내린다.
- 대상이 없음·못 찾음·다른 워크스페이스·task_create 아님·승인 대기 아님·payload가 dict 아님(`merged_items`가 리스트 아님 포함)이면 400 없이 create로 처리한다(새 카드). 중복 검사를 거치지 못한 항목이라 gate가 `auto`면 `review`로 내리고, info 로그 `merge_target_unavailable reason=...`를 남긴다.

잠금은 선점 뒤 update 대상 task를 ID 순으로, 이어 merge 대상 task_create 카드를 ID 순으로 한 쿼리에서 `FOR UPDATE`로 건다(`populate_existing`으로 최신 상태를 읽음). 승인은 카드 상태를 조건부 UPDATE 로 바꾸므로, 합치기가 먼저 잡으면 승인은 합친 값으로 task를 만들고 승인이 먼저 잡으면 합치기는 새 카드로 간다. task_update 카드는 잠그지 않는다. 그 승인은 카드 → task 순서로 잠가 이 요청과 순서가 반대다.

- 합친 카드를 승인하면 조건부 UPDATE 뒤 카드를 다시 읽어 최신 payload로 task를 만들고(PM이 고친 칸은 PM 값), 같은 카드에 연결된 모든 추출 항목에 `task_id`를 채운다. 반려하면 연결된 항목 모두 `approval_status`가 rejected다.
- 팀원이 직접 만든 카드는 payload 에 `meeting_id` 가 없어, 회의 항목을 합친 뒤 승인해도 task 는 `meeting_id` 없이 `manual` 출처로 만들어진다(`merged_items` 의 회의는 보지 않는다).
- 승인·반려 요청에 `payload_version`(승인 응답 최상위, task_create 만 값이 있는 카드 내용 지문)을 실으면 다시 읽은 카드 값과 비교해, 다르면 되돌리고 409 `APPROVAL_CHANGED`다. `task_overrides` 검증(400)이 이 비교보다 먼저고, 보내지 않으면 비교하지 않는다(#535).

## 담당자 별칭

담당자는 별칭 표(`member_alias`)로 찾는다(#459). 별칭은 PM이 직접 넣는 것 말고도 자동으로 생긴다.

### 찾기

`resolve_assignee`가 `assignee_raw`에서 "님"·조사를 뗀 후보를 만들어 긴 것부터 찾는다("하은이가" → 하은이가, 하은이, 하은). 처음 걸린 후보에 팀원이 1명이면 매칭, 2명 이상이면 애매함, 아무 후보도 안 걸리면 못 찾음이다. 탈퇴한 팀원의 별칭은 보지 않는다.

한 글자 별칭으로 찾으면 담당자는 채우되 확인 필요로 둬서 auto 가 되지 않는다. 조사를 떼면 "하은" → "하"처럼 한 글자 후보가 생겨, 팀에 없는 사람이 엉뚱한 팀원에게 자동 배정될 수 있기 때문이다.

후보 규칙(`matching.name_candidates`)은 AI 평가 도구 `_name_candidates`(`ai/extract/eval_golden_set.py`)와 같다(#522 에서 AI 가 맞춤, 바꾸면 둘 다 바꾼다). 규칙은 세 가지다.

1. 공백을 한 칸으로 줄이고 후보마다 앞뒤 공백을 지운다(띄어 쓴 님: "환 님이" → 환).
2. 조사를 떼고 "이"로 끝나면 "이"를 한 번 더 뗀 것도 후보다("하은이는" → 하은이는, 하은이, 하은).
3. "님"처럼 "씨"·"분"도 뗀다("민수 씨", "민수씨가" → 민수, "디자이너분이" → 디자이너, "분"은 #607 리뷰). 호칭을 뗀 뒤에도 "이"를 한 번 더 뗀다("하은이님이", "하은이 씨는" → 하은).

미매칭 목록 `GET /members/unresolved-aliases`도 같은 후보 규칙으로 판정한다. 처음 걸린 후보의 별칭이 1개이고 확인된(`verified`) 것이면 해결로 보고 뺀다. 한 글자 별칭은 PM 이 직접 등록한(`manual`·`learned`) 것만 해결로 봐서, 이름에서 자동으로 만든 한 글자 별칭("김환" → "환")은 목록에 남는다. 담당자 찾기는 한 글자면 계속 확인 필요다.

### 자동으로 넣는 별칭

팀원을 만들 때(`POST /members`, 워크스페이스를 만들 때의 PM)와 이름을 바꿀 때 이름과 성 뗀 이름을 `source=display_name` 별칭으로 넣는다(확인됨, 확신도 1.0).

- 한글 2글자 이상만 넣고, 4글자는 앞 두 글자, 그 외는 첫 글자를 성으로 본다("김동우" → 김동우, 동우). 규칙은 AI 전사 힌트 `member_forms`(`ai/stt/backend.py`)와 같다.
- 이름을 바꾸면 옛 이름에서 만든 `display_name` 별칭만 지우고, PM이 넣은 별칭과 닉네임 별칭은 남긴다. 기존 팀원은 마이그레이션 `1032faab5855`가 채웠다.

팀원에 `discord_user_id`를 새로 붙이면 저장하기 전에 봇 토큰으로 Discord `GET /guilds/{guild_id}/members/{user_id}`를 불러 연결한 서버의 멤버인지 확인한다(제한 3초, 호출 동안 DB 트랜잭션을 열지 않는다). 아래 오류면 팀원을 저장하지 않는다.

| 경우 | 응답 |
|---|---|
| 연동이 없음 | 409 `INTEGRATION_NOT_CONNECTED` |
| 서버에 없는 계정 | 409 `DISCORD_USER_NOT_IN_GUILD` |
| 토큰이 없거나 호출 실패 | 502 `DISCORD_API_FAILED` |

- 확인에서 받은 서버 닉네임, 계정 표시 이름(`global_name`) 순서로 한글로만 된 첫 값을 팀원 저장 뒤 `source=discord_profile` 별칭으로 넣는다(미확인, 확신도 0.8). 이 별칭으로 찾으면 담당자는 채워지지만 PM 검토로 간다.
- 별칭 저장이 실패해도 경고 로그만 남기고 응답은 그대로다.
- `discord_user_id`가 바뀌거나 풀리면 그 팀원의 `discord_profile` 별칭을 지우고 새 계정이면 다시 넣는다. 이미 연결돼 있던 팀원의 닉네임은 채우지 않았다.

자동 별칭은 같은 팀원이 이미 같은 글자를 가졌거나, 탈퇴하지 않은 다른 팀원이 PM이 넣은(`manual`·`learned`) 같은 글자를 가졌으면 넣지 않는다. 자동 별칭끼리 겹치면(김민수·이민수 → "민수") 둘 다 넣어 애매함이 된다.

### 직접 등록

별칭 등록 API(`POST /members/{id}/aliases`)는 `alias_text` 의 공백을 후보와 같은 규칙으로 정리해(한 칸으로 줄이고 앞뒤를 지움) 저장하고, 공백뿐이면 400 이다. `display_name` 은 서버만 쓰는 값이라 보내면 400 `INVALID_REQUEST` 다. 같은 글자의 자동 별칭이 이미 있으면 요청의 `source` 가 `manual`·`learned` 일 때만 그 행을 요청 값으로 올린다.

## 승인 때 별칭 학습

추출 때 담당자를 별칭으로 찾지 못한 항목을 PM이 담당자를 골라 승인할 때, 회의에서 부른 말을 그 팀원의 별칭으로 저장한다(#459). 별칭 테이블은 PM이 수동으로 등록하지 않으면 비어 있어서, 승인할 때 채워 다음 회의부터 찾히게 하려는 것이다. 이름 규칙으로 찾지 못하는 이름 표현(STT 오인식 "화은", 애칭, 영어 이름)이 대상이고, 규칙과 함수는 `app/services/alias_learning.py`에 있다.

`POST /extractions` 항목의 `assignee_type`은 `extraction_item.assignee_type`에 저장한다. 알려진 7개(first·second·thirdname·thirdpronoun·thirdrole·group·none)가 아니면 NULL로 저장하고 경고 로그를 남기지만, 요청은 거절하지 않고 게이트 판단에는 보낸 값을 그대로 쓴다. 이 기능 전에 저장된 항목은 NULL이다.

### 저장할 글자

`assignee_raw`를 아래 순서로 다듬은 것이다. 역할(`thirdrole`)도 같은 규칙이고, 비면 저장하지 않는다.

1. 앞뒤 공백 제거
2. 끝 조사 한 번(께서·한테·에게·이가·가·이·는·을·를·께, 긴 것부터, "은"은 떼지 않음)
3. 끝 "님"
4. 연속 공백을 하나로

예: "하은이가" → "하은", "지민님이" → "지민", "환 님이" → "환".

기준은 "찾기는 넓게, 저장은 좁게"다(#607 리뷰, AI 결정 기록 0060). 더 떼면 손상된 글자("화은" → "화")가 확인된 별칭으로 남고, 덜 떼면("팀장은") 다음에 다른 꼴("팀장이")로 왔을 때 PM 이 한 번 더 골라 "팀장"을 배워 메워진다. 종류마다 다르게 다듬으면 AI 분류 오류가 글자 손상이 된다.

### 물어볼 항목 (`alias_candidate`)

아래를 모두 만족하면 `true`이고 `alias_text`에 저장할 글자가 실린다. 아니면 `false`·`null`이다. 응답을 만들 때 계산하고 저장하지 않는다.

1. 새 항목(create, 승인 대기 카드에 합친 merge 포함)이고 카드의 담당 항목(payload `assignee_item_id`, 없으면 `extraction_item_id`)이다.
2. 추출 때 담당자가 비어 있었다(못 찾음·애매함).
3. `assignee_type`이 `thirdname` 또는 `thirdrole`이다([역할](#역할)).
4. 다듬은 글자가 비지 않았다.
5. 연결된 승인 요청이 pending이다.
6. 같은 워크스페이스에서 탈퇴하지 않은 팀원 누구도 저장할 글자와 찾기 후보(`name_candidates(assignee_raw)`)를 별칭으로 갖고 있지 않다.

6번은 후보 중 하나라도 있으면 이미 찾히거나 애매한 표현이라서다. 예: "하은은"은 후보 [하은은, 하은]이고, "하은"을 두 팀원이 가졌을 때 "하은은"을 저장하면 이후 항상 그 팀원으로 확정된다. 탈퇴 팀원의 별칭은 담당자를 찾을 때도 보지 않으므로 세지 않고 지우지도 않는다(PM이 `DELETE /members/aliases/{id}`로 지울 수 있다).

값은 `GET /extractions/{id}`의 항목, `GET /approvals`, `GET /approvals/{id}`, `POST /approvals`, `PATCH /approvals/{id}`(처리 뒤라 항상 `false`)에 싣는다. 수동으로 만든 승인 요청은 추출 항목이 없어 `false`다.

### 저장 (`save_alias`)

`PATCH /approvals/{id}`에 `{"status": "approved", "save_alias": true}`를 보내고 아래를 모두 만족하면 그 팀원에게 `member_alias`(`source=learned`, `verified=true`, `confidence=0.9`, `alias_type=nickname`)를 하나 만든다.

- 카드의 담당 항목이 그 카드에 연결된 항목이다(payload 의 항목 ID 가 다른 카드 것이면 무시).
- 위 1~4·6번을 만족한다.
- 최종 담당자(`task_overrides`로 고른 값 포함)가 있다.

확인된 별칭이라 다음 회의에서 바로 확정 매칭된다. 단 한 글자 별칭("환", "민")은 찾을 때 확정 근거로 쓰지 않아(`matching._is_one_letter`) 담당자만 채우고 PM 확인(`review`)으로 간다. 미매칭 목록에서는 PM이 직접 등록한(`manual`·`learned`) 별칭이라 해결로 보고 뺀다(`resolved_texts`). 띄어 쓴 님("화은 님이")과 연속 공백도 같은 후보 규칙으로 찾는다.

- 이름 끝 글자가 조사와 같으면("민이" → "민", "수가" → "수") 깎여 한 글자가 되고, 저장 글자를 승인에서 고칠 수는 없다. 잘못 저장된 별칭은 `DELETE /members/aliases/{id}`로 지우고 필요하면 다시 등록한다(수정 API 없음).
- 카드를 연 뒤 담당 항목이 바뀌는 합치기는 `payload_version`을 바꾸므로, 그 값을 같이 보내면 PM 이 본 것과 다른 글자가 저장되지 않는다(#535).
- 동시 승인에 대비해 저장 전에 같은 글자가 있는지 보고, 같은 팀원·글자 유니크 제약(`uq_alias_per_member`)에 걸리면 그 저장만 savepoint로 되돌린다. 승인과 태스크 생성은 커밋된다.

아래 경우는 저장하지 않고, 승인은 그대로 성공한다.

- `save_alias`가 없거나 false
- 반려(같이 와도 오류 없이 무시), task_update 승인
- 추출 때 담당자를 찾았던 항목(PM이 다른 사람으로 바꿔도)
- 1·2인칭·대명사·그룹·없음, `assignee_type`이 NULL인 옛 항목
- 담당자를 미정으로 승인
- 다듬은 글자가 1인칭이 주어로 쓰인 꼴(AI가 1인칭을 `thirdname`으로 잘못 분류한 경우)
- 그 글자를 탈퇴하지 않은 누군가가 이미 가짐

### 1인칭 거르기의 범위

1인칭이 할 일의 **주어로 쓰인 꼴**만 막는다. 규칙은 어간(제·저·나·내 / 저희·우리 / 본인) × 복수 "들"(저희·우리·본인에만) × 주어 표지다. 이·가·는·를 같은 격조사는 다듬기가 먼저 떼고, 도·만과 받침 있는 말 뒤의 은("본인은", "저희들은")은 이 규칙이 처리한다.

- 막는 예: 제가·저는·저도·저만·저희들이·저희들은·본인은.
- **막지 않는 것**: 주어 표지가 아닌 부사어·구·끝말(우리끼리·우리까지·저희 모두·제가요), 3인칭 "저들".
- 통째로 일치할 때만 막으므로 "제인"·"나연"·"나은"은 배운다. 조사 "이"를 떼면 "제"·"나"가 되는 "제이"·"나이"는 배우지 않으니 PM이 직접 등록한다.
- 규칙 밖에서 새는 경우는 PM 동의, 한 글자 확인 필요, 별칭 삭제, AI 오분류 개선이 받는다. 새 꼴이 거론되면 "이 규칙이 만드는 조합인가"로 판단해, 안이면 고치고 밖이면 문서에 남긴다.

### 역할

`thirdrole`도 `thirdname`처럼 묻고 배운다(#522). AI가 새 할 일(create·merge) 항목의 `assignee_raw`에 역할 원문("BE 리더가" → 별칭 "BE 리더")을 보내고 추측한 이름은 보내지 않는다. update 카드는 추측한 이름이 있으면 그것, 없으면 원문이지만 update는 학습 대상이 아니다.

- 역할은 맡은 사람이 바뀔 수 있어 `thirdrole` 새 항목은 학습한 별칭으로 확신도가 높아져도 `auto`로 보내지 않는다([새 항목 게이트](#새-항목-게이트)).
- 이 변경 전에 저장된 옛 `thirdrole` 대기 카드는 `assignee_raw`가 추측한 이름일 수 있지만 따로 거르지 않는다(PM이 승인 전에 저장할 글자를 보고, 잘못 저장된 별칭은 지울 수 있다).

## 전사 힌트 조회

녹음 봇이 전사(STT)에 거는 이름 힌트를 받는 API다. 사용자 세션 대신 서비스 토큰(`X-Service-Token`)으로 막고, 팀원 이름만 돌려주며 회의 내용은 돌려주지 않는다.

`GET /api/v1/workspaces/{workspace_id}/members/names` 의 응답 `data`는 `{items: [{member_id, name, discord_user_id, aliases}]}`다.

- `name`은 PM이 온보딩에서 정한 `display_name`이다. 탈퇴한 팀원은 빼고 만든 순서다.
- `aliases`는 별칭 문자열 전부이고 확인한(`verified`) 별칭이 앞이다. 자동으로 넣은 이름·닉네임 별칭([담당자 별칭](#담당자-별칭))도 들어간다.
- 토큰이 없거나 틀리면 401 `UNAUTHENTICATED`, 없는 워크스페이스는 404 `WORKSPACE_NOT_FOUND`다.
- 봇은 아직 부르지 않는다. 디스코드 표시 이름 대신 이 값을 힌트로 쓰는 작업은 AI 후속이다([AI(녹음 봇) 계약](../contracts/backend-ai-contract.md#전사-힌트-조회)).
