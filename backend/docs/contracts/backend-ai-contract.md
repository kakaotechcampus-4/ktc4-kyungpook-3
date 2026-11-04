# 백엔드 ↔ AI(녹음 봇) 계약

디스코드 녹음 봇이 회의를 백엔드에 넘길 때 쓰는 API를 현재 코드 기준으로 정리한다. 웹 화면이 쓰는 API는 [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md)에 있고 여기서 다시 적지 않는다.

- 제공자: Backend (`backend/app/api/`)
- 소비자: AI 녹음 봇 (`ai/capture/handoff.py`의 `BeClient`·`Handoff`, 판단 파이프라인 `ai/judge/pipeline.py`). [웹 업로드 가져가기](#웹-업로드-가져가기)의 소비자는 AI 쪽 업로드 처리 워커이며 아직 없다
- 기준: 2026-10-08 develop 코드 대조. 봇 회의 쓰기 경로의 서비스 토큰은 2026-10-09 #179 변경 코드로, 추출 등록의 auto 판단 키는 2026-10-16 #232 변경 코드로 다시 대조했다. 웹 업로드 가져가기는 2026-10-14 #219 브랜치 코드로, 화자 지정 경로(speakers·assigned·resume)는 2026-11-02 #266 브랜치 코드로 대조했다
- 합의 근거: 인계 방식은 [AI 결정 0009](../../../ai/decision_log/0009-bot-hands-off-to-be-api.md), 발화 저장은 [AI 결정 0017](../../../ai/decision_log/0017-transcript-sources-stage.md)에 AI 쪽 기록이 있다. 이 문서는 그 이후의 필드·오류 세부를 코드에서 읽은 것이며, 별도 합의 문서가 없는 항목은 구현 사실로만 적는다.

## 공통

- 경로 prefix는 `/api/v1`이고 응답은 백엔드 공통 봉투 `{data, error}`다 ([Backend README 응답 형식](../../README.md#응답-형식)).
- 봇은 `error.code`로 분기한다. 봉투가 아닌 응답이나 4xx·5xx는 `HTTP_<status>`로 다룬다 (`BeClient._call`).
- 봇의 연결 설정은 `ai/.env`의 `BE_BASE_URL`과 서비스 토큰(`BE_SERVICE_TOKEN`)이다. 둘 중 하나라도 없으면 인계 단계를 건너뛴다 (`handoff.from_env`). 워크스페이스는 설정하지 않는다. #199 전의 봇은 `BE_WORKSPACE_ID`까지 있어야 인계를 켰다.
- 봇은 회의마다 디스코드 서버로 워크스페이스를 찾아([워크스페이스 찾기](#워크스페이스-찾기-get-integrationsdiscordguildsguild_idworkspace--200)) 매니페스트의 `workspace_id`에 고정하고, 회의 생성·추출 등록·유사 검색에 쓴다 (AI #199).

## 호출 순서

| 시점 | 요청 | 회의 상태 | 인증 |
|---|---|---|---|
| `/record` 직후 | `POST /meetings` | `created` | `X-Service-Token` |
| 트랙을 닫은 뒤 | `PATCH /meetings/{meeting_id}/end` | `processing` | `X-Service-Token` |
| 전사가 닫힌 뒤 | `POST /meetings/{meeting_id}/sources` | 변화 없음 | `X-Service-Token` |
| 추출 도중 (항목마다) | `POST /workspaces/{workspace_id}/tasks/similar` | 변화 없음 | `X-Service-Token` |
| 추출이 끝난 뒤 | `POST /extractions` | `done` | `X-Service-Token` |
| 어느 단계든 실패 | `PATCH /meetings/{meeting_id}/fail` | `failed` | `X-Service-Token` |

봇은 회의 상세 `GET /meetings/{meeting_id}`를 부르지 않는다.

## 인증

- `X-Service-Token`: 봇이 부르는 경로 전부(회의 생성·종료·실패, 발화 저장, 유사 task 검색, 추출 등록, 서버로 워크스페이스 찾기, 전사 힌트 조회, 리마인드 DM 다섯 경로)와 웹 업로드 가져가기 여섯 경로에 건다 (`deps.require_service_token`). 헤더 값을 서버의 `SERVICE_TOKEN`과 비교하고, 없거나 다르면 401 `UNAUTHENTICATED`다. 서버에 `SERVICE_TOKEN`이 비어 있으면 모든 요청을 거절한다. 사용자 세션은 서비스 토큰을 대신하지 못한다.
- 합의 근거: 이슈 #179(BE)와 #193(AI). 회의 생성·종료·실패와 추출 등록이 리버스 프록시 설정에만 기대던 것을 서비스 토큰으로 막는다.
- 현재 구현
  - BE(#179): 회의 생성·종료·실패와 추출 등록에 `require_service_token`을 건다. #179 전에는 발화 저장, 유사 검색, 서버로 워크스페이스 찾기에만 걸었다.
  - AI(#193): `BeClient._call`이 모든 요청에 헤더를 싣는다. #193 전의 봇은 발화 저장과 유사 검색에만 싣는다.
- 배포 순서: 봇(#193)을 먼저 배포하고 BE(#179)를 배포한다. #179 전의 BE는 네 경로의 헤더를 무시하므로 봇이 먼저 나가도 안전하다. 반대 순서면 기존 봇의 회의 생성·종료·실패·추출 등록이 모두 401로 멈춘다. 배포 전에 운영 `ai/.env`의 `BE_SERVICE_TOKEN`이 BE의 `SERVICE_TOKEN`과 같은지 확인한다.

## 회의

### `POST /meetings` → 201

```jsonc
// 요청
{ "workspace_id": "…", "title": "…" | null, "source": "discord" }   // source: discord | manual_upload, 기본 discord
// data
{ "meeting_id": "…", "workspace_id": "…", "status": "created", "started_at": "…" }
```

봇은 `meeting_id`를 매니페스트 `be.meeting_id`에 남기고 이후 모든 단계의 재시도 키로 쓴다.

### `PATCH /meetings/{meeting_id}/end` → 202

- `data`: `{meeting_id, status: "processing", ended_at}`
- 이미 `processing`·`awaiting_speakers`·`done`·`failed`면 409 `MEETING_ALREADY_ENDED`, `details.status`에 지금 상태. 봇은 이 값을 지금 상태로 받아들이고 계속한다. `awaiting_speakers`는 웹 업로드 회의가 PM의 화자 지정을 기다리는 상태다(#266). `POST /uploads/{meeting_id}/speakers`가 이 상태로 바꾼다. PM이 지정하는 API는 아직 없다. 디스코드 회의는 이 상태가 되지 않는다.
- 없는 회의는 404 `MEETING_NOT_FOUND`.

### `PATCH /meetings/{meeting_id}/fail` → 200

- 요청: `{ "failed_stage": "stt" | "extract" | "handoff" … }` (서버는 문자열만 확인)
- BE 도 같은 상태 전이로 멈춘 업로드 회의를 스스로 failed 로 바꾼다(sweeper, 아래 "웹 업로드 가져가기"). 이때 `failed_stage`는 `diarize`(처리 중에 멈춤) 또는 `speaker_assignment_expired`(화자 지정 기한 지남)다.
- `data`: 회의 상세 모양 `{meeting_id, workspace_id, title, status: "failed", started_at, ended_at, extraction_id: null, failed_stage, progress}`
- `done`·`failed`가 아닌 회의만 조건부 UPDATE로 `failed`가 된다. 이미 끝났으면 409 `MEETING_ALREADY_ENDED`이고, 봇은 이를 "이미 처리됨"으로 넘어간다. 추출 등록이 먼저 `done`으로 바꾼 회의를 늦은 실패 요청이 덮지 않는다.

## 발화 저장 `POST /meetings/{meeting_id}/sources` → 201

AI `Transcript.to_dict()` 모양에 화자 이름을 더해 보낸다. 한 회의의 전사를 나눠 보내도 된다.

```jsonc
// 요청
{
  "source": "meeting",                       // meeting만 받는다
  "segments": [
    { "speaker": "<Discord uid>" | null, "speaker_member_id": "<멤버 ID>" | null,   // speaker_member_id: 선택
      "start": 0.0, "end": 3.2, "text": "…", "seq": 0 }
  ],
  "speaker_names": { "<Discord uid>": "<표시 이름>" } | null
}
// data
{ "meeting_id": "…", "inserted": 1, "skipped": 0, "duration_ms": 3200 | null }
```

| 항목 | 동작 |
|---|---|
| 시각 | 초 단위, 0 이상 24시간 이하, `end >= start` |
| `seq` | 0 이상 int4 범위. 한 요청 안에서 겹치면 400. 사이가 비어도 된다 |
| 재전송 | `(meeting_id, seq)`가 이미 있으면 덮어쓰지 않고 건너뛴다 (`skipped`). 같은 seq의 `speaker_names`도 다시 반영하지 않으므로 처음 보낼 때 같이 보낸다 |
| 화자 | 빈 문자열은 null. `speaker_member_id`가 없는 세그먼트만 uid로 그 워크스페이스 팀원을 찾아 `member_id`를 채운다. 이름이 uid와 같으면 이름을 버린다 |
| `speaker_member_id` | 선택. 있으면 uid 조회보다 먼저 써서 그 값을 `member_id`로 저장한다(`speaker`와 둘 다 있으면 멤버 ID가 이긴다). 이 세그먼트의 uid로는 팀원을 찾지 않는다. 이 워크스페이스의 탈퇴하지 않은 팀원이 아닌 ID(없는 ID·다른 워크스페이스·탈퇴한 팀원)가 요청에 하나라도 있으면 요청 전체가 400 `INVALID_REQUEST`이고 `details.member_ids`에 틀린 ID를 요청에 처음 나온 순서로 담는다(중복 제거). 정상 세그먼트가 섞여 있어도 하나도 저장하지 않고 `duration_ms`도 바뀌지 않는다. 이미 저장된 seq를 다시 보낸 세그먼트의 ID도 검사한다. 재전송은 덮어쓰지 않고 건너뛰므로 멤버 ID는 처음 보낼 때 같이 보낸다. 첫 요청이 저장된 뒤 응답을 잃고 그사이 팀원이 탈퇴해 재시도가 이 400을 받으면, AI는 `details.member_ids`의 ID를 null로 바꿔 다시 보낸다(이미 저장된 seq는 건너뛰므로 저장된 `member_id`는 그대로다). 참석자로 제한하지 않는다. 응답 모양은 그대로다 |
| `duration_ms` | 저장된 발화 전체의 `end_ms` 최댓값 |
| 상태 | `done` 회의도 받는다. `failed` 회의는 409 `MEETING_FAILED` (`MEETING_ALREADY_ENDED`와 다르다. 저장되지 않았으니 새 회의로 다시 올려야 한다) |

## 유사 task 검색 `POST /workspaces/{workspace_id}/tasks/similar` → 200

```jsonc
// 요청
{ "text": "…", "k": 3, "min_similarity": 0.4 }      // k 1~20, min_similarity 0.0~1.0. 봇은 text만 보내 기본값을 쓴다
// data
{ "items": [
  { "task_id": "…", "notion_page_id": "…" | null, "title": "…", "content_snippet": "",
    "assignee_member_id": "…" | null, "due_date": "YYYY-MM-DD" | null, "status": "…",
    "similarity": 0.83, "updated_at": "…" }
] }
```

- 항목 필드는 AI `NotionCandidate`(`ai/shared/schemas.py`)와 이름을 맞춘다. `content_snippet`은 지금 항상 빈 문자열이다.
- 같은 워크스페이스에서 임베딩이 있는 task만 유사도 순으로 돌려준다.
- 없는 워크스페이스는 404 `WORKSPACE_NOT_FOUND`. 임베딩 호출 실패는 빈 목록이 아니라 502 `EMBEDDING_UNAVAILABLE`이다. 봇도 실패를 빈 목록으로 바꾸지 않는다.

## 추출 등록 `POST /extractions` → 201

```jsonc
// 요청
{
  "meeting_id": "…", "workspace_id": "…",
  "transcript_path": "…" | null, "model_name": "…" | null,
  "items": [ {
    "action": "create" | "update",            // 기본 create
    "target_task_id": "…" | null,             // update일 때 수정할 task
    "task_title": "…" | null,                 // create면 필수
    "task_confidence": 0.0 | null,            // legacy만 보낸다. 보내지 않으면 null(측정 안 함)
    "assignee_raw": "…" | null, "assignee_type": "first" | "second" | "thirdname" | "group" | "none" | null,
    "due_date": "YYYY-MM-DD" | null, "due_raw": "…" | null, "due_confidence": 0.0 | null,
    "evidence_quote": "…" | null, "evidence_speaker": "<Discord uid>" | null, "evidence_at_ms": 0 | null,
    "evidence_speaker_member_id": "<멤버 ID>" | null,   // 선택. 근거 문장을 말한 팀원의 멤버 ID
    "evidence_seqs": [12, 13, 15] | null,     // 근거 발화의 seq(발화 저장 API의 seq). 0 ~ 2^31-1. 모르면 [] 또는 생략
    "category": "schedule" | "assignee" | "scope" | "decision" | null,
    "status": "todo" | "in_progress" | "blocked" | "done" | null,   // 새 항목: auto 로 바로 만들면 이 값을 쓰고, 승인으로 만들면 쓰지 않고 항상 todo
    "doc_text": "…" | null,
    "task_status": "certain" | "inferred" | "missing" | null,   // judge 새 항목만. 할 일 근거 상태
    "due_status": "certain" | "inferred" | "missing" | null,    // judge 새 항목만. 마감이 없으면 missing
    "similar_count": 0 | null,                // judge 새 항목만. 판단할 때 유사 검색이 돌려준 기존 task 수
    "top_similarity": 0.0 | null,             // 그중 가장 높은 유사도. 결과가 없으면 null. 기록용
    "target_snapshot": { "updated_at": "…", "due_date": "…", "status": "…", "assignee_member_id": "…", "title": "…" } | null
  } ]
}
// data
{ "extraction_id": "…", "meeting_id": "…", "item_count": 2 }
```

| 항목 | 동작 |
|---|---|
| 선점 | `processing` → `done`을 조건부 UPDATE로 한 번만 처리한다 |
| 멱등 | 이미 `done`이고 추출이 있으면 기존 `extraction_id`와 항목 수를 그대로 돌려준다. 봇의 복구 재전송이 중복을 만들지 않는다 |
| 상태 오류 | `processing`이 아니면 409 `MEETING_NOT_PROCESSING`. 회의가 없으면 404 `MEETING_NOT_FOUND`, 워크스페이스가 다르면 400 `WORKSPACE_MISMATCH` |
| 담당자 | `assignee_type`이 `first`면 화자로 팀원을 찾고, 그 외에는 `assignee_raw`를 별칭으로 매칭한다. 1인칭 화자는 아래 순서로 정한다. ① `evidence_speaker_member_id`가 있으면 그 팀원이다. 이 워크스페이스의 탈퇴하지 않은 팀원이 아니면 uid를 못 찾은 것과 같게 처리하고(`not_found`, `assignee_hint`는 그 ID) ②③으로 넘어가지 않는다. ② `evidence_speaker`(Discord uid)가 있으면 그 uid로 `Member.discord_user_id`를 찾는다. ③ 둘 다 없고 대표 근거 발화(아래 근거 행)가 `evidence_seqs` 중 가장 큰 seq(결론 발화)일 때만 쓴다. 그 발화의 `member_id`가 이 워크스페이스의 탈퇴하지 않은 팀원이면 그 팀원이고, 아니면 그 발화의 `speaker_discord_user_id`로 찾는다. 결론 발화를 찾지 못했으면 쓰지 않는다. ④ 그래도 없으면 화자가 없는 1인칭 항목이다. 화자가 없는 1인칭 항목은 `assignee_raw`를 별칭으로 찾지 않고 담당자를 언급했는데 찾지 못한 것으로 본다(게이트는 아래 create 게이트 행). 틀린 `evidence_speaker_member_id`는 그 항목만 화자를 못 찾은 1인칭으로 처리하고 다른 항목은 그대로 처리한다. 예외로 36자를 넘거나 문자열이 아닌 값은 요청 검증에서 막혀 그 항목만이 아니라 요청 전체가 400 `INVALID_REQUEST`다. AI는 BE가 준 멤버 ID만 보내므로 생기지 않는 경우로 본다. `assignee_hint`가 그 ID 문자열이라 담당자 확신도 0.0이 항목 확신도에 들어가므로, 새 항목은 judge·legacy·경로 불명 어느 쪽이든 `hold`이고 update 항목은 항상 `review`다. 화자도 `assignee_raw`도 없는 1인칭(④)은 새 항목이 judge·경로 불명이면 `hold`이지만 legacy는 확신도로 정해서 `review`가 될 수 있다. `evidence_speaker_member_id`와 `evidence_speaker`는 AI가 결론을 말한 사람으로 직접 보낸 값이라 먼저 쓴다. 대표 근거 발화는 가장 큰 seq가 빠지면 더 앞 발화(보통 일을 요청한 사람)가 되어 다른 사람을 가리킬 수 있다 |
| 근거 | `evidence_seqs`의 seq마다 이 회의의 발화(`source`)를 찾아 `evidence`(type=`task`) 한 줄씩 저장한다. 순서는 자유이고 같은 seq는 한 번만 저장한다. 이 회의에 없는 seq는 그 seq만 건너뛰고(항목마다 빠진 seq를 모아 경고 로그 한 줄) 요청은 그대로 받는다. seq가 0 ~ 2^31-1(발화 저장 API의 seq 범위) 밖이거나 항목 하나의 seq가 100개를 넘으면 400 `INVALID_REQUEST`다. 찾은 발화 중 seq가 가장 큰 것(결론을 말한 마지막 발화)이 대표 근거 발화다. 승인 요청 payload의 `evidence_quote`·`evidence_speaker`·`evidence_at_ms`·`evidence_speaker_member_id`, 별칭 판정 로그의 `source_id`, 추출 조회의 `evidence`에 쓰고, 멤버 ID·`evidence_speaker`가 없고 결론 발화(가장 큰 seq)를 찾았을 때 1인칭 담당자에도 쓴다. 하나도 못 찾으면 evidence 행을 저장하지 않고(추출 조회의 `evidence` 객체는 모든 필드가 null이다) 승인 요청 payload에 요청의 `evidence_quote`·`evidence_speaker`·`evidence_at_ms`를 쓴다. `evidence_speaker_member_id`도 이 워크스페이스의 탈퇴하지 않은 팀원으로 확인된 값이면 payload에 쓴다. 그래서 AI는 `evidence_seqs`와 세 필드(화자의 멤버 ID를 보내면 그것도)를 항상 함께 보낸다 |
| 근거 화자의 멤버 ID | 같은 근거 화자의 멤버 ID가 두 곳에 다른 이름으로 실린다. 승인 요청 payload는 `evidence_speaker_member_id`이고 추출 조회 `evidence`는 `speaker_member_id`다(`EvidenceInfo`). 값은 대표 근거 발화를 찾았으면 그 발화에 저장된 `member_id` 그대로(탈퇴한 팀원이어도, 비어 있으면 null)다. 못 찾았을 때 요청의 `evidence_speaker_member_id`를 쓰는 것은 승인 요청 payload뿐이고, 이 워크스페이스의 탈퇴하지 않은 팀원으로 확인된 값만 싣고 아니면 null이다. 근거 발화를 못 찾으면 저장된 근거(evidence 행)가 없어 추출 조회의 `evidence` 객체는 있지만 `quote`·`speaker`·`at_ms`·`speaker_member_id` 모두 null이다. 그래서 이때는 요청에 활성 팀원의 멤버 ID가 있으면 payload에는 그 값이 실리고 조회 값은 null이라 두 값이 다를 수 있다. 근거 발화를 찾았을 때는 두 값이 같다. 두 출처를 섞지 않는다. 승인 요청은 새 항목·update 항목·auto 되돌리기 세 경로가 같은 규칙이고, 되돌릴 때 근거가 없으면 null이다 |
| 잘못된 항목 | update의 대상이 없거나 다른 워크스페이스 task, create의 제목이 비어 있으면 그 항목만 건너뛴다. `item_count`는 저장된 항목 수 |
| update 처리 | 게이트·승인 생성 규칙과 `target_snapshot`의 충돌 기준값은 [Backend README 유사 task 검색과 AI 판단 접수](../../README.md#유사-task-검색과-ai-판단-접수)를 따른다 |
| `target_snapshot.title` | 유사 검색 응답의 `title`을 그대로 보낸다. 제목을 바꾸는 값이 아니라 승인 때 대상 task가 그대로인지 확인하는 기준이다. 없거나 null이면 등록 시점의 제목을 쓴다. 필드 모양은 #185에서 AI·BE가 정했다 |
| 확신도 | `task_confidence`·`due_confidence`를 보내지 않으면 null(측정 안 함)로 저장하고 0.0(측정했는데 낮음)과 구분한다. 할 일 확신도가 null이면 항목 확신도도 null이다 |
| 추출 경로 | AI가 경로를 따로 보내지 않으므로 BE가 항목이 보낸 키로 가린다. `action`·`category`·`doc_text` 중 하나라도 보냈으면 judge, 아니고 `task_confidence`·`due_confidence`를 보냈으면 legacy, 둘 다 아니면 판별 불가다. 모든 항목이 같은 경로일 때만 추출의 `extraction_path`에 기록하고, 항목이 없거나 섞였거나 판별 불가 항목이 있으면 null이다(#201) |
| create 게이트 | 담당자를 언급했는데 BE가 한 명으로 찾지 못했으면 `hold`다. 이름으로 풀지 못해 `assignee_raw` 없이 `second`·`thirdpronoun`·`thirdrole`만 보낸 항목과 화자가 없는 1인칭 항목(틀린 `evidence_speaker_member_id` 포함)도 언급했는데 찾지 못한 것으로 본다. 단 화자도 `assignee_raw`도 없는 legacy 1인칭은 `hint`가 없어 확신도 계산에서 담당자가 빠지므로 아래 legacy 기준(확신도)대로 `hold`가 아니라 `review`가 될 수 있다. 멤버 ID로 정한 화자는 확신도 1.0이라 다른 조건을 만족하면 `auto`가 될 수 있다. judge 항목은 그다음 아래 auto 조건을 모두 만족하면 `auto`, 아니면 `review`다. 경로를 가릴 수 없고 확신도도 없는 항목은 `review`, legacy는 확신도로 정한다(0.8 이상이고 담당자 확인 불필요면 `auto`, 0.5 이상 `review`, 그 아래 `hold`). update는 지금처럼 항상 `review`다 |
| judge auto 조건 | `task_status`가 certain, 담당자를 언급했으면 BE가 한 명으로 확정(검증된 별칭·화자, 확신도 0.8 이상), `assignee_type`이 `second`·`thirdpronoun`·`thirdrole`이 아님, `due_status`가 certain이거나 missing이고 `due_date` 유무와 맞음(missing인데 날짜가 있거나 certain인데 날짜가 없으면 탈락), `similar_count`가 0이고 워크스페이스에 임베딩이 없는 활성 task가 없음(그런 task는 유사 검색에 잡히지 않는다. 같은 요청에서 앞 항목이 auto로 만든 task와 임베딩 API가 제목을 거절한 task도 해당). `task_status`·`due_status`·`similar_count` 중 하나라도 null이면 `review`라, 이 키를 보내지 않는 AI에서는 지금 동작이 그대로다. 상태 값이 셋 중 하나가 아니면 400 `INVALID_REQUEST`, `similar_count`가 음수거나 `top_similarity`가 0~1 밖이어도 400이다(#232) |
| 근거 상태·유사 검색 값 | `similar_count`는 그 finding을 판단할 때 유사 검색 응답의 후보 수다(BE가 이미 `min_similarity` 미만을 뺀 결과). 같은 회의 앞부분 카드(pending)는 세지 않는다. update 항목은 보내지 않아도 되고 보내도 게이트에 쓰지 않는다. 값은 추출 항목에 저장되고 추출 조회에 실린다 |

- 경로 판별의 전제: judge 항목(`ai/judge/pipeline.py`의 `to_item`)은 `action`·`category`·`doc_text`를 값이 null이어도 키째 보내고 확신도를 보내지 않는다. legacy 항목(`ai/capture/handoff.py`의 `to_extraction_items`)은 확신도 둘을 항상 보내고 judge의 키는 보내지 않는다. 판단 경로는 확신도를 만들지 않고 인계기에 임의 고정값을 넣지 않는다는 AI 쪽 기록(`ai/docs/plan/전체 계획.md`의 확신도 항목)을 따랐다.
- auto 조건과 새 키 이름(`task_status`·`due_status`·`similar_count`·`top_similarity`)은 #232 이슈에서 AI·BE 공동 작업으로 정했고, 조건 구성은 멘토 피드백으로 확인했다. AI가 값을 만드는 방법은 아래 "근거 상태의 뜻"에 적는다. 새 키는 judge만 보내므로 경로 판별은 바뀌지 않는다.
- 근거 상태의 뜻 (현재 구현, `ai/judge/evidence.py`): `certain`은 **원문에 명시됐다고 확인됐다**는 뜻이지 정답일 통계적 확률이 아니다. 값을 만든 LLM이 스스로 매기지 않고, 새 항목마다 판정 API Jev(Elice MLAPI `typesafe/jev-latest`)에 근거 원문을 주고 다시 묻는다(#232의 B안). 항목당 호출 1회로 할 일과 마감을 함께 묻는다.
  - `task_status`: "근거 원문에서 누군가 이 할 일을 하겠다고 약속했거나 하기로 결정·지시했다고 명시했는가"에 yes 확률이 0.8 이상이면 certain, 아니면 inferred다. 조건부·질문·제안·부정은 no 또는 unclear가 되도록 기준을 준다.
  - `due_status`: 마감이 없으면 묻지 않고 missing이다. 마감이 있으면 회의 날짜, 마감 날짜와 그 요일, Luna가 낸 마감 원문 표현(`due_raw`)을 함께 주고 "원문의 마감 표현이 이 일의 마감이고 계산하면 이 날짜 하나로 정해지는가"에 yes 확률이 0.8 이상이면 certain, 아니면 inferred다. "다음 주쯤"·"이번 주 안에" 같은 근사·기간 표현, 다른 업무의 날짜, 번복된 날짜는 inferred가 되도록 기준을 준다.
  - Jev 키가 없거나 호출이 실패하면 확인하지 못한 것으로 보고 inferred다(마감이 없으면 missing 그대로). 그래서 AI에 `JEV_API_KEY`가 없으면 judge 새 항목은 auto가 되지 않는다.
  - 검증: `ai/judge/eval_evidence.py`(실제 호출, pytest 밖)의 정답 붙인 대사 19개를 2회씩 돌린 결과(2026-11-03) 잘못된 certain 0건, 할 일 37/38·마감 22/24 정답이었다. 놓친 3건은 yes 확률 0.78~0.79로 기준 바로 아래였다. 표본이 작아 운영의 상태별 PM 반려·수정 비율로 계속 확인해야 한다.
  - 같은 회의의 새 항목 카드에 뒤 발화를 합치면 `task_status`는 둘 중 낮은 쪽(certain > inferred > missing), `due_status`·`due_raw`는 마감을 정한 뒤 발화 기준이며 마감을 없애면 missing, `similar_count`·`top_similarity`는 큰 쪽이다.
  - BE 확인 필요: `backend/app/services/matching.py`의 auto 게이트 주석은 "할 일 근거 상태는 LLM의 자기 표시라 거의 certain"이라고 전제한다. 지금은 별도 판정 API로 다시 묻는 방식이라 이 전제가 맞지 않는다.
- `evidence_seqs`의 모양과 규칙(배열, 순서 자유, 없는 seq 건너뛰기, 가장 큰 seq가 대표, 세 필드를 함께 보내고 빼지 않음, type은 모두 `task`)은 #229 이슈에서 AI·BE가 정했다. 1인칭 화자만 이슈의 "seq로 찾으면 seq 우선"과 달리 요청의 화자를 먼저 쓴다(#229 당시에는 `evidence_speaker`였고, #265 뒤의 순서는 담당자 행의 ①~④다). BE가 리뷰 중에 바꿨고, AI에는 PR로 알린다. BE는 받을 준비가 됐고, AI는 아직 이 키를 보내지 않는다(판단 경로의 `JudgeFinding.indices`, 기본 경로의 `locate_sentence` 결과를 seq로 바꾸는 작업이 남음). 보내기 전까지는 세 필드로 지금처럼 동작하고 `evidence`는 저장되지 않는다.
- 화자를 멤버 ID로 받는 키(발화 저장의 `speaker_member_id`, 추출 등록의 `evidence_speaker_member_id`)는 이슈 #265에서 BE가 구현했다. 상태는 합의됨(#254, 2026-11-02)이고 BE가 구현했다. AI는 아직 이 키를 보내지 않는다. 키를 보내기 전까지는 기존 필드(`speaker`·`evidence_speaker`)로 지금처럼 동작한다. 새 필드는 모두 선택이고 기존 필드의 뜻은 그대로다. 변경은 요청의 선택 필드 둘과 발화 저장의 새 400 조건이다. 응답은 추출 조회 `evidence`의 `speaker_member_id`와 승인 요청 payload의 `evidence_speaker_member_id`가 늘 뿐이다(승인 목록은 payload를 저장된 그대로 내려준다). 두 요청 필드는 빈 문자열이나 공백뿐이면 null로 보고(`speaker`와 같다), 36자를 넘거나 문자열이 아니면 400 `INVALID_REQUEST`다. 배포는 BE를 먼저 한다. 모르는 키는 오류 없이 무시되므로 BE보다 AI가 먼저 나가면 멤버 ID가 조용히 버려지고 uid 경로로만 동작한다.
- 합의 여부 확인 필요: 위 키 모양을 판별 기준으로 쓰는 것은 #201에서 BE가 정했다. AI 코드는 바꾸지 않았다. 항목 모양이 바뀌면 판별이 틀어지므로 AI가 이 키를 바꿀 때 알려야 하고, AI가 경로를 직접 보내게 되면 그 값을 먼저 쓰도록 바꾼다.

## 워크스페이스 찾기 `GET /integrations/discord/guilds/{guild_id}/workspace` → 200

봇이 녹음하는 디스코드 서버(길드)에 연결된 워크스페이스를 찾는다. 서버 연결은 웹 온보딩의 Discord 연결이 `Integration(provider="discord")`의 `provider_channel_id`에 저장한다.

```jsonc
// 응답 data
{ "guild_id": "900000000000000001", "workspace_id": "ws_..." }
```

| 항목 | 동작 |
|---|---|
| 인증 | `X-Service-Token`. 없거나 틀리면 401 `UNAUTHENTICATED`. 워크스페이스 멤버의 세션은 토큰을 대신하지 못한다 |
| 결과 | 한 서버는 한 워크스페이스에만 연결되므로(`uq_integration_discord_guild`) 하나다 |
| 미연결 | 연결이 없거나 해제됐으면 409 `INTEGRATION_NOT_CONNECTED`, `details`는 `{provider: "discord", guild_id}` |

- 합의 근거: BE가 이슈 #180의 흐름을 제안했고 AI 담당이 동의하며 아래를 덧붙였다(2026-10-09, 저장소 밖 대화). AI 쪽 구현 이슈 #199에 같은 내용을 적었다.
  - 봇은 `/record` 때 이 조회로 받은 워크스페이스를 매니페스트의 `workspace_id`에 고정하고, 회의 생성·추출 등록·유사 검색에 `.env` 값 대신 쓴다.
  - 미연결(`INTEGRATION_NOT_CONNECTED`)이면 녹음은 하고 BE 인계만 멈추며, 채널에 웹에서 서버를 연결하라고 안내한다.
  - 조회가 일시적으로 실패하면 `/record`를 막지 않고 처리할 때 다시 조회한다.
  - 이미 `.env` 워크스페이스로 들어간 옛 회의는 그대로 둔다.
- 현재 구현: BE는 이 조회를 제공하고, 봇은 `/record` 때와 처리할 때 `workspace_id`가 비어 있으면 부른다 (`capture/handoff.py`의 `Handoff.workspace`, AI #199).
  - 한 번 정한 값은 바꾸지 않는다. BE 회의를 만든 뒤 바뀌면 추출 등록이 `WORKSPACE_MISMATCH`가 된다.
  - 미연결이면 `/record`가 녹음을 시작하지 않고, PM이 웹 온보딩에서 서버를 연결한 뒤 다시 하라고 답한다. 합의는 "녹음은 하고 BE 인계만 멈춤"이었는데, main PR #175 리뷰가 미연결 서버의 녹음 거절을 권해 바꿨다. BE가 받는 요청은 어느 쪽이든 조회뿐이다.
  - 조회가 일시적으로 실패하면(연결 실패·5xx) 녹음은 하고 처리할 때 다시 조회한다. 그 실패는 발화 저장 단계의 실패로 세어 재시도하고, 401은 설정 문제로 BE 단계를 건너뛴다. 처리할 때 미연결이면 발화 저장·추출·인계를 멈추고, 워커가 그 채널에 한 번 알린 뒤 연결될 때까지 전사하지 않고 1분에 한 번 다시 묻는다.

## 웹 업로드 가져가기

웹에서 PM이 올린 녹음(`POST /workspaces/{id}/meetings/upload`, [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md))을 AI가 가져가 처리하는 경로다.

- 합의 상태: **합의됨(#255).** 가져가기(#219)와 화자 지정 경로(#266)를 BE가 만들었고 AI·BE 계약 부분은 #255에서 합의했다. AI는 아직 구현하지 않았다(표의 "AI 미구현").
- 업로드 회의는 `source=manual_upload`이고 **업로드하자마자 `processing`**이다. 프론트가 Discord 회의처럼 정리 중으로 추적하고, 끝날 때까지 그 워크스페이스의 다음 업로드는 409다(프론트 D-088·D-089). 다만 `awaiting_speakers`(PM 지정 대기)는 막지 않는다. AI가 가져갔는지는 회의 상태가 아니라 `meeting_upload.claimed_at`으로 가린다.
- 결과 보고는 Discord 회의와 같은 [발화 저장](#발화-저장-post-meetingsmeeting_idsources--201)·[추출 등록](#추출-등록-post-extractions--201)·[실패](#patch-meetingsmeeting_idfail--200)를 쓴다.
- 녹음은 원본 그대로 서버 디스크(`UPLOAD_DIR/{meeting_id}/audio.<확장자>`)에 있고, 참석자·파일 정보는 DB `meeting_upload` 에 있다. 받는 형식은 wav·mp3·m4a·ogg·webm이고, BE는 확장자와 파일 첫 바이트만 확인한다. 실제로 디코딩되는지와 녹음 길이는 확인하지 않는다.

| 순서 | 요청 | 회의 상태 |
|---|---|---|
| 1 | `GET /uploads/pending` | `processing` (변화 없음) |
| 2 | `PATCH /uploads/{meeting_id}/claim` | `processing` (가져간 시각만 기록) |
| 3 | `GET /uploads/{meeting_id}/file` | 변화 없음 |
| 4 | `POST /meetings/{meeting_id}/sources` | 변화 없음 |
| 5 | `POST /extractions` | `done` |
| 실패 | `PATCH /meetings/{meeting_id}/fail` | `failed` |

화자 지정을 거치는 흐름은 2번(claim)과 3번(file) 뒤에 이어진다. 4번(발화 저장)과 5번(추출 등록)은 지정이 끝나고 다시 가져간 뒤에 한다.

| 순서 | 요청 | 회의 상태 |
|---|---|---|
| 화자 1 | `POST /uploads/{meeting_id}/speakers` (AI가 화자 라벨 전달) | `processing` → `awaiting_speakers` |
| 화자 2 | PM이 웹에서 라벨을 멤버에 지정 (AI는 기다린다). PM 지정 API는 `PUT /meetings/{meeting_id}/speakers`(#266 PR-3) | `awaiting_speakers` → `processing` (지정 시각 기록) |
| 화자 3 | `GET /uploads/assigned` (지정이 끝난 회의 조회) | 변화 없음 |
| 화자 4 | `PATCH /uploads/{meeting_id}/resume` (다시 가져가기) | `processing` (가져간 시각만 기록) |

- 대기 중(`awaiting_speakers`)에는 추출 등록을 받지 않는다(409 `MEETING_NOT_PROCESSING`). 지정 제출 뒤 `processing`으로 돌아오면 받는다.
- 지정이 멈추면 BE sweeper가 라벨 보고 뒤 7일이 지난 `awaiting_speakers` 회의를 `failed`(`failed_stage=speaker_assignment_expired`)로 바꾸고 녹음 폴더를 지운다. 그 전에 풀려면 `PATCH /meetings/{meeting_id}/fail`을 쓴다.

### `GET /uploads/pending` → 200

아직 아무도 가져가지 않은 업로드 회의를 업로드 시각 순으로 준다. `processing`이고 `claimed_at`이 비어 있는 업로드 회의(`meeting_upload` 행이 있는 회의)만 나온다. DB 만 읽고 디스크는 보지 않는다. 페이지는 나누지 않는다.

```jsonc
// data
{ "items": [ {
  "meeting_id": "…", "workspace_id": "…", "title": "…" | null, "started_at": "…",
  "attendees": [ { "member_id": "…", "display_name": "…" } ],   // 업로드 때 PM이 고른 참석자. 1명 이상
  "original_filename": "…" | null, "stored_filename": "audio.wav",
  "size_bytes": 1234, "content_type": "audio/wav" | null,       // content_type은 브라우저가 보낸 값 그대로다
  "uploaded_at": "…"
} ] }
```

- `started_at`은 항상 UTC 시각이고 `"2026-10-13T01:00:00Z"`처럼 끝에 `Z`가 붙는다. 업로드 API가 시간대 없는 `started_at`을 400으로 거절하고, 받은 값은 UTC로 바꿔 저장한다(#290). PM이 시각을 비우면 업로드 시각이 들어간다.

### `PATCH /uploads/{meeting_id}/claim` → 200

- `data`: `{meeting_id, status: "processing"}`
- `claimed_at`이 비어 있고 회의가 `processing`일 때만 조건부 UPDATE로 `claimed_at`을 채운다. 동시에 여러 번 불러도 한 번만 성공한다.
- 409 `MEETING_PROCESSING_IN_PROGRESS`(`details.meeting_id`는 그 회의): 이미 누가 가져갔다. 다음 회의로 넘어간다.
- **claim 을 다시 보낼 때 주의:** BE 는 누가 가져갔는지 기록하지 않는다. 응답을 못 받아(시간 초과 등) 같은 회의를 다시 claim 해서 409 를 받았다면, 앞선 요청이 이미 성공했을 수 있다. 처리 워커가 하나라면 건너뛰지 말고 그 회의를 이어서 처리한다. 건너뛰면 그 회의는 `processing`에 남고 그 워크스페이스의 업로드도 막힌다.
- `done`·`failed`면 409 `MEETING_ALREADY_ENDED`(`details.status`). 다음 회의로 넘어간다.
- 없는 회의나 업로드 회의가 아니면(업로드 API 를 거치지 않아 `meeting_upload` 행이 없는 회의 포함) 404 `MEETING_NOT_FOUND`.

### `GET /uploads/{meeting_id}/file` → 200

- 녹음 원본을 그대로 스트리밍한다. Content-Type은 업로드 때 받은 값(없으면 `application/octet-stream`), 파일명은 `stored_filename`이다.
- 상태는 보지 않는다. claim 전후 모두 받을 수 있고, 다시 받아도 된다.
- 업로드 정보가 없거나 녹음 파일이 없으면 404 `MEETING_NOT_FOUND`. 녹음이 없으면 처리할 수 없으니 실패 보고를 한다.

### `POST /uploads/{meeting_id}/speakers` → 200

AI가 화자 분리로 얻은 라벨을 보낸다. 회의가 `awaiting_speakers`(PM 지정 대기)가 된다.

```jsonc
// 요청
{ "speakers": [ {
  "label": "SPEAKER_00",                     // 1~64자, 공백만은 불가, 요청 안에서 중복 불가
  "total_sec": 120.5,                        // 0 이상
  "samples": [ { "start": 1.0, "end": 6.5 } ] // 초. start 0 이상, end 는 start 보다 크다. 빈 배열 가능
} ] }                                        // speakers 는 1개 이상
// 응답 data
{ "meeting_id": "…", "status": "awaiting_speakers" }
```

- `processing`이고 `claimed_at`이 있으며 라벨을 아직 받지 않았을 때만 회의 상태를 바꾸는 조건부 UPDATE 한 문장으로 판정한다. 이긴 요청만 라벨(`meeting_upload.speakers`)과 보고 시각을 같은 트랜잭션에서 저장한다. 실패 응답은 상태를 바꾸지 않는다.
- 같은 내용을 다시 보내면(라벨·샘플 순서가 달라도, 숫자 표기가 `1`과 `1.0`이어도) 200이고 `status`는 현재 상태다. 응답을 못 받은 재시도를 위한 것이다.
- 400 `INVALID_REQUEST`: 위 검증에 걸린 경우. 숫자는 유한해야 하며 `NaN`·`Infinity`도 400이다.
- 404 `MEETING_NOT_FOUND`: 없는 회의, 업로드 회의가 아님, `meeting_upload` 행 없음.
- 409 `MEETING_ALREADY_ENDED`(`details.status`): `done`·`failed`.
- 409 `UPLOAD_NOT_CLAIMED`(`details.status`): 아직 claim 하지 않았다.
- 409 `SPEAKERS_ALREADY_REPORTED`(`details.status`, `details.labels`): 이미 다른 내용의 라벨을 받았다. 지정이 제출돼 `processing`으로 돌아온 뒤에도 같다. `details.labels`는 저장된 라벨 이름을 이름 순으로 담는다. AI가 분리를 다시 돌려 라벨이 달라졌는지 이것으로 알 수 있다.

### `GET /uploads/assigned` → 200

PM이 지정을 끝냈고(`speakers_assigned_at` 있음) 아직 다시 가져가지 않았으며(`resumed_at` 없음) `processing`인 업로드 회의를 지정 시각 오름차순으로 준다. DB 만 읽는다. 페이지는 나누지 않는다.

```jsonc
// data
{ "items": [ {
  "meeting_id": "…", "workspace_id": "…", "title": "…" | null, "started_at": "…",
  "mapping": { "SPEAKER_00": "member_id" | null },  // 라벨 → 멤버. null 은 외부 참석자(멤버 아님)로 지정함. 모든 라벨이 키로 온다
  "assigned_at": "…"
} ] }
```

### `PATCH /uploads/{meeting_id}/resume` → 200

지정 결과를 가져가고 이어서 처리하겠다는 표시다(`resumed_at` 기록). `resumed_at`은 처음 한 번만 기록하고, 이미 가져갔어도 회의가 `processing`이면 같은 `mapping`으로 200을 다시 준다. 응답을 잃은 재시도도 `mapping`을 받아 이어서 처리할 수 있게 하려는 것이다(#269 리뷰).

- `data`: `{meeting_id, status: "processing", mapping}`. `mapping`은 `GET /uploads/assigned`와 같은 모양이다.
- `resumed_at`이 비어 있고 지정이 끝났고 회의가 `processing`일 때만 조건부 UPDATE로 기록한다. 회의 행을 잠그지 않으므로 동시에 온 실패 보고와 겹치면 이 응답은 200인데 회의가 이미 `failed`일 수 있다. 이어지는 발화 저장·추출 등록이 409로 막아 데이터는 깨지지 않는다.
- 404 `MEETING_NOT_FOUND`: 없는 회의, 업로드 회의가 아님.
- 409 `MEETING_ALREADY_ENDED`(`details.status`): `done`·`failed`.
- 409 `SPEAKERS_NOT_ASSIGNED`(`details.status`): 아직 PM이 지정하지 않았다(`awaiting_speakers`이거나 지정 시각이 없다).

### 처리할 때 주의할 점

- **녹음은 결과 보고 전에 받는다.** 추출 등록으로 `done`이 되거나 실패 보고로 `failed`가 되면 BE가 그 회의의 녹음 폴더를 바로 지운다.
- 업로드 녹음에는 Discord uid가 없다. 화자 분리 없이 전사하면 발화의 `speaker`는 null이고, 회의록 참석자는 발화에서 만들므로 비어 보인다. 업로드 참석자는 지금 `meeting_upload.attendees` 에만 있고 회의록은 이를 읽지 않는다.
- AI 가 없거나 처리 도중 멈추면 업로드 회의가 `processing`에 남아 그 워크스페이스의 업로드가 409 로 막힌다. AI가 가져간 회의는 BE sweeper가 정리한다(5분마다, `UPLOAD_SWEEP_INTERVAL_SECONDS`).
  - `processing`이고 가져간 업로드: 가져간 시각·지정 시각·다시 가져간 시각·마지막 발화 저장 시각 중 가장 늦은 것에서 3시간이 지나면 `failed`(`failed_stage=diarize`). 지정 뒤에 멈춰도 같은 값이다. AI가 발화를 나눠 보내면 그때마다 3시간이 다시 시작된다.
  - `awaiting_speakers`: 라벨 보고 뒤 7일이 지나면 `failed`(`failed_stage=speaker_assignment_expired`). 3시간 규칙은 쓰지 않는다.
  - 정리하면 녹음 폴더를 지우고 그 워크스페이스의 업로드 막힘이 풀린다. pending으로 되돌리지 않는다(#288).
  - 정리된 뒤 AI는 `/fail`·라벨 보고·claim·resume에서 409 `MEETING_ALREADY_ENDED`(`details.status=failed`), 발화 저장에서 409 `MEETING_FAILED`, 원본 받기에서 404를 받는다. 다시 보내지 않고 로컬 파일을 지우고 끝낸다(#288).
  - 아직 아무도 가져가지 않은 업로드는 정리하지 않는다. AI가 꺼져 있으면 그 공간의 업로드는 계속 409이고, `PATCH /meetings/{meeting_id}/fail`(서비스 토큰)로 풀 수 있다.
  - 회의마다 조건부 UPDATE 한 번이라 AI 보고·PM 지정과 겹쳐도 한쪽만 이긴다. 다만 3시간 경계에서는 resume 200이나 발화 저장 201 직후 회의가 failed일 수 있다. resume은 회의 행을 잠그지 않고, 발화 저장 뒤 sweeper가 그 발화를 보지 못한 채 판정할 수 있어서다(resume 항목의 경합과 같다). 이어지는 발화 저장·추출 등록이 409로 막아 데이터는 깨지지 않는다.

## 전사 힌트 조회

봇이 전사(STT)에 이름 힌트를 걸 때 쓰는 읽기 경로다. 팀원 이름만 돌려주고 회의 발화나 추출 내용은 돌려주지 않는다.

| 항목 | 동작 |
|---|---|
| 인증 | `X-Service-Token`. 없거나 틀리면 401 `UNAUTHENTICATED`. 워크스페이스 멤버의 세션은 토큰을 대신하지 못한다 |
| 없는 워크스페이스 | 404 `WORKSPACE_NOT_FOUND`, `details`는 `{workspace_id}` |

### 팀원 이름 `GET /workspaces/{workspace_id}/members/names` → 200

```jsonc
// 응답 data
{ "items": [
  { "member_id": "…", "name": "김동우", "discord_user_id": "…" | null, "aliases": ["동우", "…"] }
] }
```

| 항목 | 동작 |
|---|---|
| `name` | PM이 온보딩에서 정한 `Member.display_name`. 디스코드 표시 이름이 아니다 |
| 대상·순서 | 탈퇴(`is_deleted`)하지 않은 팀원. 만든 순서(`created_at`, 같으면 `member_id`) |
| `aliases` | 그 팀원의 `MemberAlias.alias_text` 전부. 종류(`alias_type`)와 확인 여부를 가리지 않고 넣고, 확인한(`verified`) 별칭부터 만든 순서다. 한 팀원 안의 같은 별칭은 DB가 막는다(`uq_alias_per_member`). 없으면 빈 목록 |

- 합의 근거: AI 담당이 STT 이름 힌트용으로 제안했다(2026-10-13). #273 에서 AI·BE가 합의했고 #278 리뷰로 확인했다. 목록 키는 다른 BE 목록 응답처럼 `items`다. task 제목도 용어 힌트로 재 봤지만 전사가 나아지지 않아 경로를 만들지 않는다([AI 결정 기록 0025](../../../ai/docs/basis_for_decision/member/2026-10-13-0025-title-hint-not-now.md)).
- 현재 구현: BE에 이 경로가 있다. 봇은 아직 부르지 않는다. 봇이 디스코드 표시 이름 대신 이 값을 힌트로 쓰는 작업은 AI 후속이다.

## 리마인드 DM

PM 이 웹에서 승인한 리마인드를 봇이 팀원에게 디스코드 DM 으로 보내고, 팀원이 봇에게 보낸 DM 을 백엔드에 넘기는 경로다. 리마인드 문구 초안을 AI 가 써 넣는 경로도 여기 있다. 웹 쪽 조작(만들기·고치기·승인·취소, 대화 조회, 웹 답장)은 [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md) §5.7 에 있다.

- 합의 상태: **BE 구현, 봇·초안 워커 미구현.** #310 에서 BE 와 AI 쪽 초안 모듈(`ai/draft/reminder_draft.py`)을 만들었다. 봇의 DM 발송·수신과 BE 를 불러 초안을 채우는 워커는 아직 없다.
- 결정 근거: [결정 0034](../../../ai/docs/basis_for_decision/ai/2026-11-04-0034-reminder-and-thread-message.md), FE 메시지 정책(D-174)
- 리마인드 하나는 태스크 하나 × 받는 사람 한 명이다. 같은 받는 사람·같은 발송 시각의 리마인드는 "보낼 메시지"(묶음) 하나로 모이고, PM 은 묶음 문구를 보고 승인한다. 봇이 보내는 것은 승인된 묶음 문구 그대로다.
- 봇이 BE 를 주기적으로 불러 보낼 메시지를 가져간다. 봇이 꺼져 있는 동안 발송 시각이 된 메시지는 사라지지 않고 다음 가져가기에서 나온다. 받는 DM 은 디스코드 이벤트를 받는 즉시 넘긴다.
- 보내는 사람은 웹과 디스코드 모두 봇이다. 봇 DM 창에 팀원이 쓴 글은 리마인드에 대한 답인지와 상관없이 모두 그 팀원의 대화에 저장되고 PM 이 본다.

| 시점 | 요청 | 인증 |
|---|---|---|
| 주기적으로(초안 워커) | `POST /bot/drafts/claim` | `X-Service-Token` |
| 초안을 쓴 뒤 | `POST /bot/drafts/{bundle_id}` | `X-Service-Token` |
| 주기적으로(봇) | `POST /bot/messages/claim` | `X-Service-Token` |
| DM 을 보낸 뒤(성공·실패) | `POST /bot/messages/{message_id}/result` | `X-Service-Token` |
| 팀원이 봇에게 DM 을 보냈을 때 | `POST /bot/replies` | `X-Service-Token` |

### `POST /bot/drafts/claim` → 200

AI 가 문구를 써야 하는 묶음을 준다. 요청 본문은 없다. 승인되지 않은 예정 묶음 중 초안이 필요한 것이 나온다. 가져간 뒤 10분 안에 써 넣지 않으면 다시 나온다(초안은 다시 써도 안전하다). 발송 시각이 지났거나 탈퇴한 팀원의 묶음은 나오지 않는다.

```jsonc
// data
{ "items": [ {
  "bundle_id": "…", "draft_version": 3, "workspace_id": "…",
  "recipient_name": "재환",          // 팀원 표시 이름
  "scheduled_at": "…",               // UTC
  "tasks": [ { "task_id": "…", "title": "API 명세서", "due_date": "2026-11-14" | null,
               "status": "in_progress", "note": "…" | null } ],   // note 는 PM 이 그 태스크에 적은 말
  "style_examples": [ "…" ],         // 이 워크스페이스에서 PM 이 쓰거나 고쳐 승인한 최근 문구, 최신순 5개까지. 없으면 []
  "fallback_body": "…"               // BE 가 만든 규칙 문구. AI 가 못 쓰면 이 글이 나간다
} ], "total": 1 }
```

- 초안이 필요한 묶음은 PM 이 직접 쓴 문구가 아닌 묶음이다. 리마인드가 하나뿐이고 PM 메모(`note`)가 있는 묶음은 메모가 그대로 문구가 되므로 나오지 않는다. 리마인드가 여럿이면 메모가 있어도 한 통으로 다시 써야 하므로 나온다.
- 말투는 `style_examples` 가 있으면 그 말투를, 없으면 기본 페르소나(같은 팀 동료인 PM 이 가볍게 묻는 존댓말, 짧게, 재촉하거나 탓하지 않음)를 따른다. 초안 모듈이 이 규칙으로 프롬프트를 만든다.

### `POST /bot/drafts/{bundle_id}` → 200

```jsonc
{ "draft_version": 3, "body": "재환님, …" }   // 못 썼으면 "body": null
```

- `body` 가 null 이면 규칙 문구를 그대로 두고 초안 대기를 끝낸다.
- `body` 는 앞뒤 공백을 지우고 저장한다. 비었거나 2,000자를 넘으면 400.
- 초안이 들어가면 문구가 바뀌므로 `draft_version` 이 하나 오른다. PM 이 그 전 판을 보고 승인하면 웹 승인이 `BUNDLE_CHANGED` 로 거절되어 PM 이 새 문구를 다시 본다.
- 409 `DRAFT_STALE`: 가져간 뒤 묶음 구성이 바뀌었거나 다른 초안이 먼저 들어왔거나(`draft_version` 이 다름), PM 이 문구를 직접 고쳤거나, 이미 승인됐거나, 예정 상태가 아니다. 들어간 초안을 다시 보내도 이 오류다. 버리고 넘어간다.
- 404 `REMINDER_BUNDLE_NOT_FOUND`: 없는 묶음.

### `POST /bot/messages/claim` → 200

발송 시각이 된 승인된 묶음을 대화 메시지로 만든 뒤, 아직 봇이 가져가지 않은 메시지를 준다. 요청 본문은 없다.

```jsonc
// data
{ "items": [ {
  "message_id": "…", "workspace_id": "…", "member_id": "…",
  "discord_user_id": "…",          // 이 계정에 DM 을 보낸다
  "body": "…",                     // PM 이 승인한 묶음 문구 그대로
  "scheduled_at": "…"              // UTC
} ], "total": 1 }
```

- **한 메시지는 한 번만 준다.** 가져간 메시지는 다시 나오지 않는다. 동시에 두 번 불러도 같은 메시지가 두 곳에 가지 않는다.
- 가져간 뒤 10분 안에 결과 보고가 없으면 BE 가 못 보냄(`unknown`)으로 닫고 다시 주지 않는다. 같은 DM 이 두 번 가는 것을 막으려는 것이다. 봇이 재시작하면 가져갔지만 보고하지 못한 메시지는 보내지 말고, 보냈다면 결과를 보고한다(늦은 보고는 받는다).
- 디스코드가 연결되지 않은 팀원(`discord_user_id` 없음)의 메시지는 봇에 주지 않는다. BE 가 만드는 순간 `discord_not_linked` 로 표시한다.
- 디스코드 DM 은 한 통에 2,000자까지다. BE 는 길이를 자르지 않으므로 넘으면 봇이 나눠 보낸다.

### `POST /bot/messages/{message_id}/result` → 200

```jsonc
// 요청
{ "status": "delivered", "discord_message_ids": ["…"] }
{ "status": "failed", "failure_reason": "dm_blocked", "discord_message_ids": [] }   // 사유는 "unknown" 도 된다
```

- `discord_message_ids` 는 실제로 나간 DM 의 디스코드 메시지 id 다. 나눠 보냈으면 여럿이다. BE 는 이 id 로 팀원 답장이 어느 워크스페이스의 DM 에 대한 것인지 찾는다. `delivered` 에는 하나 이상 있어야 한다(없으면 400). 나눠 보내다 실패했으면 나간 것만 싣는다.
- `dm_blocked`: 팀원이 서버 DM 을 막아 디스코드가 거절했다. 그 밖의 실패는 `unknown`. `discord_not_linked` 는 BE 만 쓰므로 봇이 보내면 400 이다. `failed` 에 사유가 없어도 400 이다.
- 응답 `data` 는 null 이다. 같은 결과를 다시 보내면 200 이다.
- 409 `MESSAGE_RESULT_CONFLICT`: 가져가지 않은 메시지, 이미 다른 결과(다른 id 포함)를 보고한 메시지, 다른 메시지에 이미 기록된 디스코드 id. 시간 초과로 닫힌 메시지의 첫 보고는 받아서 실제 결과로 고친다.
- 404 `MESSAGE_NOT_FOUND`: 없는 메시지이거나 봇 메시지가 아니다.

### `POST /bot/replies` → 201 · 200

팀원이 봇 DM 창에 쓴 글을 대화에 넣는다.

```jsonc
// 요청
{ "discord_user_id": "…", "discord_message_id": "…", "body": "…", "sent_at": "2026-11-04T09:00:00+09:00",
  "reply_to_discord_message_id": "…" | null }   // 디스코드 답장 기능을 썼을 때 그 대상 메시지 id (discord.py Message.reference.message_id)
// data
{ "message_id": "…", "thread_id": "…", "workspace_id": "…", "member_id": "…" }
```

- `sent_at` 은 시간대가 있어야 한다. 없으면 400.
- `body` 는 받은 그대로 저장한다. 첨부만 있는 DM 처럼 빈 글도 받는다.
- 같은 `discord_message_id` 는 한 번만 저장한다. 처음이면 201, 다시 보내면 200 과 같은 메시지다. 재시도해도 안전하다.
- DM 에는 디스코드 서버 정보가 없다. 같은 디스코드 계정이 여러 워크스페이스의 팀원이면 BE 가 아래 순서로 대화를 고른다.
  1. `reply_to_discord_message_id` 가 봇이 보낸 DM 이면 그 DM 의 워크스페이스
  2. 그 DM 창에서 이 글 바로 앞에 나간 봇 DM 의 워크스페이스. 두 글의 시각은 보고 받은 시각이 아니라 디스코드 메시지 id(snowflake)에 든 보낸 시각으로 비교한다. 결과 보고는 답장보다 늦게 올 수 있으므로, 봇이 가져갔지만 아직 보고하지 않은 메시지(10분 시간 초과로 닫힌 것 포함)는 가져간 시각에 나간 것으로 본다. 이 글의 id 가 숫자가 아니면 `sent_at` 을 쓴다
  3. 봇이 가장 최근에 DM 을 보낸 워크스페이스, 그것도 없으면 가장 나중에 등록된 팀원
- 404 `MEMBER_NOT_FOUND`: 어느 워크스페이스에도 그 디스코드 계정의 팀원이 없다. 버리고 넘어간다.
- 답장이 어느 태스크에 대한 것인지는 판단하지 않는다. 답장 판단 작업이 붙일 몫이다.

## 오류 코드 요약

| 코드 | HTTP | 나오는 경로 | 봇 처리 |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | 봇 경로 전부 | 실패 |
| `MEETING_NOT_FOUND` | 404 | end, fail, sources, extractions, uploads claim·file·speakers·resume | 실패 |
| `WORKSPACE_NOT_FOUND` | 404 | tasks/similar, members/names | 실패 |
| `WORKSPACE_MISMATCH` | 400 | extractions | 실패 |
| `MEETING_ALREADY_ENDED` | 409 | end, fail, uploads claim·speakers·resume | 지금 상태로 보고 계속 (claim이면 다음 회의로) |
| `MEETING_PROCESSING_IN_PROGRESS` | 409 | uploads claim | 이미 가져갔으니 다음 회의로. 내 재시도라면 이어서 처리 (AI 미구현) |
| `UPLOAD_NOT_CLAIMED` | 409 | uploads speakers | 먼저 claim 한다 (AI 미구현) |
| `SPEAKERS_ALREADY_REPORTED` | 409 | uploads speakers | 다른 내용의 라벨이 이미 저장됨. 재전송하지 않고 지정 결과 조회로 넘어감. `details.labels`가 내 라벨과 다르면 어긋난 것 (AI 미구현) |
| `SPEAKERS_NOT_ASSIGNED` | 409 | uploads resume | 아직 지정 전. 다음 조회 때 다시 (AI 미구현) |
| `MEETING_FAILED` | 409 | sources | 실패 |
| `MEETING_NOT_PROCESSING` | 409 | extractions | 실패 |
| `EMBEDDING_UNAVAILABLE` | 502 | tasks/similar | 실패 (빈 목록으로 바꾸지 않음) |
| `MEMBER_NOT_FOUND` | 404 | bot/replies | 그 DM 은 버린다 |
| `MESSAGE_NOT_FOUND` | 404 | bot/messages result | 실패 |
| `MESSAGE_RESULT_CONFLICT` | 409 | bot/messages result | 이미 정해진 결과로 보고 넘어간다 |
| `REMINDER_BUNDLE_NOT_FOUND` | 404 | bot/drafts | 버리고 넘어간다 |
| `DRAFT_STALE` | 409 | bot/drafts | 버리고 넘어간다 |
| `INTEGRATION_NOT_CONNECTED` | 409 | guilds/{guild_id}/workspace | `/record`는 녹음을 시작하지 않고 연결 안내. 처리할 때는 BE 단계를 멈춤 |
| `INVALID_REQUEST` | 400 | 요청 검증 실패 전부(speakers 포함) | 실패 |

## 코드 근거

- Backend: `app/api/meetings.py`, `app/api/sources.py`, `app/api/similar_tasks.py`, `app/api/extractions.py`, `app/api/integrations.py`의 `get_discord_guild_workspace`, `app/api/bot_lookups.py`, `app/api/uploads.py`, `app/services/speaker_assignment.py`, `app/api/deps.py`의 `require_service_token`, `app/schemas/meeting.py`, `app/schemas/source.py`, `app/schemas/task.py`, `app/schemas/workspace.py`, `app/schemas/upload.py`, `app/services/upload_storage.py`, `app/api/bot_messages.py`, `app/services/messages.py`, `app/schemas/message.py`
- AI: `ai/capture/handoff.py`의 `BeClient`, `Handoff`, `from_env`, `ai/draft/reminder_draft.py`의 `draft_reminder`
