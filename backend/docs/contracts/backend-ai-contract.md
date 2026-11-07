# 백엔드 ↔ AI(녹음 봇) 계약

디스코드 녹음 봇이 회의를 백엔드에 넘길 때 쓰는 API를 현재 코드 기준으로 정리한다. 웹 화면이 쓰는 API는 [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md)에 있고 여기서 다시 적지 않는다.

- 제공자: Backend (`backend/app/api/`)
- 소비자: AI 녹음 봇 (`ai/capture/handoff.py`의 `BeClient`·`Handoff`, 판단 파이프라인 `ai/judge/pipeline.py`). [웹 업로드 가져가기](#웹-업로드-가져가기)의 소비자는 AI 쪽 업로드 처리 워커(`ai/capture/worker.py`)다
- 기준: 2026-10-08 develop 코드 대조. 봇 회의 쓰기 경로의 서비스 토큰은 2026-10-09 #179 변경 코드로, 추출 등록의 auto 판단 키는 2026-10-16 #232 변경 코드로 다시 대조했다. 웹 업로드 가져가기는 2026-10-14 #219 브랜치 코드로, 화자 지정 경로(speakers·assigned·resume)는 2026-11-02 #266 브랜치 코드로, 처리 단계 보고(`PATCH /meetings/{meeting_id}/stage`)는 2026-11-05 #381 브랜치 코드로 대조했다. 라벨 보고 재전송과 지정 대기 만료는 2026-11-06 #438 에서 develop 코드로 다시 대조했다
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
| 처리 단계가 시작될 때 (`stt`·`sources`·`extract`·`handoff`) | `PATCH /meetings/{meeting_id}/stage` | 변화 없음 | `X-Service-Token` |
| 전사가 닫힌 뒤 | `POST /meetings/{meeting_id}/sources` | 변화 없음 | `X-Service-Token` |
| 추출 도중 (항목마다) | `POST /workspaces/{workspace_id}/tasks/similar` | 변화 없음 | `X-Service-Token` |
| 추출이 끝난 뒤 | `POST /extractions` | `done` | `X-Service-Token` |
| 어느 단계든 실패 | `PATCH /meetings/{meeting_id}/fail` | `failed` | `X-Service-Token` |

봇은 회의 상세 `GET /meetings/{meeting_id}`를 부르지 않는다.

## 인증

- `X-Service-Token`: 봇이 부르는 경로 전부(회의 생성·종료·단계 보고·실패, 발화 저장, 유사 task 검색, 추출 등록, 서버로 워크스페이스 찾기, 전사 힌트 조회, 채팅 수집 대상 목록, 리마인드 DM 다섯 경로)와 웹 업로드 가져가기 여섯 경로에 건다 (`deps.require_service_token`). 헤더 값을 서버의 `SERVICE_TOKEN`과 비교하고, 없거나 다르면 401 `UNAUTHENTICATED`다. 서버에 `SERVICE_TOKEN`이 비어 있으면 모든 요청을 거절한다. 사용자 세션은 서비스 토큰을 대신하지 못한다.
- 합의 근거: 이슈 #179(BE)와 #193(AI). 회의 생성·종료·실패와 추출 등록이 리버스 프록시 설정에만 기대던 것을 서비스 토큰으로 막는다.
- 현재 구현
  - BE(#179): 회의 생성·종료·실패와 추출 등록에 `require_service_token`을 건다. #179 전에는 발화 저장, 유사 검색, 서버로 워크스페이스 찾기에만 걸었다.
  - AI(#193): `BeClient._call`이 모든 요청에 헤더를 싣는다. #193 전의 봇은 발화 저장과 유사 검색에만 싣는다.
- 배포 순서: 봇(#193)을 먼저 배포하고 BE(#179)를 배포한다. #179 전의 BE는 네 경로의 헤더를 무시하므로 봇이 먼저 나가도 안전하다. 반대 순서면 기존 봇의 회의 생성·종료·실패·추출 등록이 모두 401로 멈춘다. 배포 전에 운영 `ai/.env`의 `BE_SERVICE_TOKEN`이 BE의 `SERVICE_TOKEN`과 같은지 확인한다.

## 회의

### `POST /meetings` → 201

```jsonc
// 요청
{ "workspace_id": "…", "title": "…" | null, "source": "discord", "started_at": "…" | null }
// source: discord | manual_upload | chat, 기본 discord. started_at: 시간대가 있는 시각(없으면 400, UTC 로 저장), 지금보다 늦으면 400, 없으면 지금
// data
{ "meeting_id": "…", "workspace_id": "…", "status": "created", "started_at": "…" }
```

봇은 `meeting_id`를 매니페스트 `be.meeting_id`에 남기고 이후 모든 단계의 재시도 키로 쓴다.

- `source: "chat"`과 `started_at`은 디스코드 채팅 자동 수집용이다(구현됨, #378). `started_at`은 이 회의에 담긴 첫 메시지 시각이고, 채팅 회의의 발화 `start`·`end`(초)는 이 시각에서 잰 값이다.
- 요청 본문 `source: "chat"`(sources)은 `source`가 `chat`인 회의에만 보낼 수 있다. 다른 회의에 보내면 400 `INVALID_REQUEST`다(24시간 상한 우회 방지).
- 채팅 회의가 `processing`으로 남아도 웹 업로드를 막지 않는다. 폴러가 죽어 `/end` 뒤 7시간이 지나도록 `processing`이면 BE sweeper가 `failed`(`failed_stage=chat_stalled`)로 바꾼다. 7시간은 폴러 시간 제한(`ai/deploy/systemd/mm-chat-poll.service`의 `TimeoutStartSec`)보다 길게 잡은 값이라, 제한을 7시간 이상으로 올리면 이 값도 함께 올린다. 업로드 409 검사(`MEETING_PROCESSING_IN_PROGRESS`)는 `source`가 `chat`인 회의를 세지 않는다.
- 합의 상태: 채팅 수집은 AI 담당이 설계를 정했고 #378 에서 BE 리뷰를 거쳐 머지됐다. 정리 기준 7시간은 #431 리뷰에서 BE 가 맡기로 한 값이고, #431 에 알렸고 AI 담당이 #431 에서 확인했다(#449 를 먼저 배포하는 순서, 2026-11-07).

### `GET /workspaces/{workspace_id}/chat-cursor` → 200

봇이 마지막으로 처리한 채팅 위치를 묻는다. `X-Service-Token` 필요. 모르는 워크스페이스는 404.

```jsonc
// data. 끝난 채팅 회의가 없으면 data가 null
{ "meeting_id": "…", "last_message_at": "2026-11-04T01:00:00+00:00" }
```

- `done`인 채팅 회의 중 `started_at`이 가장 늦은 것의 `started_at + duration_ms`다(UTC). `started_at`이 같으면 `duration_ms`가 큰 쪽, 그래도 같으면 `meeting_id`가 큰 쪽이다. 봇은 이 뒤의 메시지부터 모은다.
- 구현됨(#378, `app/api/bot_lookups.py`). AI는 `ai/capture/chat_poll.py` 가 `BeClient.chat_cursor`(`ai/capture/handoff.py`)로 부른다.

### `PATCH /meetings/{meeting_id}/end` → 202

- `data`: `{meeting_id, status: "processing", ended_at}`
- 이미 `processing`·`awaiting_speakers`·`done`·`failed`면 409 `MEETING_ALREADY_ENDED`, `details.status`에 지금 상태. 봇은 이 값을 지금 상태로 받아들이고 계속한다. `awaiting_speakers`는 웹 업로드 회의가 PM의 화자 지정을 기다리는 상태다(#266). `POST /uploads/{meeting_id}/speakers`가 이 상태로 바꾸고, PM 이 웹에서 지정하면(`PUT /meetings/{meeting_id}/speakers`) `processing`으로 돌아간다. 디스코드 회의는 이 상태가 되지 않는다.
- 없는 회의는 404 `MEETING_NOT_FOUND`.

### `PATCH /meetings/{meeting_id}/stage` → 200

봇이 처리 단계를 시작할 때 알린다. 웹 화면의 진행 표시(`progress`)를 데이터가 생기기 전에 앞당기는 데 쓴다. 진행 표시일 뿐이라 처리 결과를 바꾸지 않는다.

- 합의 상태: 구현됨(#381, PR #383). 호출하는 쪽(`ai/capture/handoff.py`, `ai/capture/recorder.py`)도 같은 PR 에서 구현했고 AI 파트 리뷰를 받았다. 보고 여부는 매니페스트의 `be.meeting_id`로만 정한다. 그래서 디스코드 회의와 수동 업로드 회의(#289, #326, #343 으로 develop 에 들어옴)가 같은 `process_session`을 지나며 보고한다. 업로드 회의의 `progress`도 디스코드 회의처럼 앞당겨진다(#383 리뷰 후속에서 정함). 채팅 회의는 보고하지 않는다.
- 요청: `{ "stage": "stt" | "sources" | "extract" | "handoff" }`. 이 네 값은 AI의 `failed_stage` 이름과 같다. 다른 값이나 빠진 값은 400 `INVALID_REQUEST`.
- `data`: `{meeting_id, status, processing_stage, applied}`. `processing_stage`는 이 요청을 처리한 뒤 저장된 값이고 아직 보고가 없으면 `null`이다.
- 순서는 `stt` < `sources` < `extract` < `handoff`이고 단계는 앞으로만 간다. 건너뛰어도 된다(`extract`부터 재개하면 `extract`, `handoff`만 온다).
- 다음은 오류가 아니라 200 `applied=false`이고 저장값을 바꾸지 않는다: 회의가 `processing`이 아닐 때(`created`·`awaiting_speakers`·`done`·`failed`), 같은 단계를 다시 보낼 때, 이미 보고한 단계보다 앞선 단계일 때. 반영할 때만 `applied=true`이고 단계와 갱신 시각을 함께 저장한다. 판정과 쓰기는 조건부 UPDATE 한 문장이라 늦게 도착한 보고가 앞선 단계를 덮지 않는다.
- 없는 회의는 404 `MEETING_NOT_FOUND`. 새 오류 코드는 없다.
- 회의 상세 응답에는 `processing_stage`를 싣지 않는다. 대신 `progress`가 이 값을 반영한다. 보고가 없으면 지금처럼 데이터만으로 판정한다. 아래 단계는 "그 단계가 시작됐다"는 뜻이다.

  | progress 키 | true가 되는 때 |
  |---|---|
  | `audio_merged` | `stt` 이후이거나 발화가 있을 때 |
  | `transcribed` | `sources` 이후이거나 발화가 있을 때 |
  | `extracted` | `handoff` 이후이거나 항목이 있는 추출이 있을 때 |

  회의 상세 `GET /meetings/{meeting_id}`와 `PATCH /meetings/{meeting_id}/fail`의 응답 `progress`가 같은 식을 쓴다. 트랙별 진행률은 보내지 않는다.
- 봇 동작(`Handoff.report_stage`): `be.meeting_id`가 없으면 부르지 않고, 타임아웃 3초(`STAGE_TIMEOUT_S`, requests 에 숫자 하나로 주므로 연결과 읽기에 각각 3초)로 한 번만 보낸다. 오류는 모두 로그만 남기고 삼키며 매니페스트에 쓰지 않는다. 호출은 `process_session`의 단계 시작(`begin`)에서 진행 표시 뒤, AI 쪽 단계 시간 기록(ops) 단계를 열기 전에 하므로 보고 시간은 ops 단계 시간에 들어가지 않는다. BE 장애 때 단계 시작이 늦어질 수 있다. 3초는 연결과 읽기에 각각 걸리는 값이고 합계 상한은 보장하지 않는다(응답이 조금씩 오면 읽기 대기가 이어지고, 주소가 여러 개면 연결도 주소마다 걸리며, DNS 조회 시간은 타임아웃에 들어가지 않는다). 디스코드 회의에서 처리 도중 BE 회의가 새 회의로 바뀌면(BE 가 failed 로 닫은 회의에 `end`를 다시 부를 때 봇이 새 회의를 만들고 옛 ID 를 `be.replaced`에 남기는 경우. 업로드 회의는 `end`가 새 회의를 만들지 않아 바뀌지 않는다) 그 단계 보고는 옛 회의로 가 `applied=false`가 되고 새 회의는 그 단계를 받지 못한다. 이때 `progress`는 데이터 판정으로 돌아가 표시만 조금 늦어진다.
- 배포 순서: BE를 먼저 배포한다. 어느 쪽이 먼저 나가도 깨지지 않는다. BE가 먼저면 봇이 아직 보고하지 않아 `progress`는 지금처럼 데이터로 판정한다. 봇이 먼저면 이 경로가 없는 BE는 오류를 돌려주고 봇은 그 오류를 삼켜 처리를 계속한다. 이때 BE 쪽 진행 표시만 앞당겨지지 않는다.
- DB: `meeting.processing_stage`(문자열 16자)와 `processing_stage_at`(시각)을 nullable로 추가했다(마이그레이션 `a3d7f91c5e28`). 기존 회의는 `null`이다.

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
  "source": "meeting",                       // meeting | chat, 기본 meeting
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
| 시각 | 초 단위, 0 이상, `end >= start`. `source: "meeting"`은 24시간 이하, `"chat"`은 14일 이하(하루치 대화를 며칠 뒤에 올릴 수 있어 회의 시작 기준 오프셋이 더 크다). 구현됨(#378) |
| `seq` | 0 이상 int4 범위. 한 요청 안에서 겹치면 400. 사이가 비어도 된다 |
| 재전송 | `(meeting_id, seq)`가 이미 있으면 덮어쓰지 않고 건너뛴다 (`skipped`). 같은 seq의 `speaker_names`도 다시 반영하지 않으므로 처음 보낼 때 같이 보낸다 |
| 화자 | 빈 문자열은 null. `speaker_member_id`가 없는 세그먼트만 uid로 그 워크스페이스 팀원을 찾아 `member_id`를 채운다. 이름이 uid와 같으면 이름을 버린다 |
| `speaker_member_id` | 선택. 있으면 uid 조회보다 먼저 써서 그 값을 `member_id`로 저장한다(`speaker`와 둘 다 있으면 멤버 ID가 이긴다). 이 세그먼트의 uid로는 팀원을 찾지 않는다. 이 워크스페이스의 탈퇴하지 않은 팀원이 아닌 ID(없는 ID·다른 워크스페이스·탈퇴한 팀원)가 요청에 하나라도 있으면 요청 전체가 400 `INVALID_REQUEST`이고 `details.member_ids`에 틀린 ID를 요청에 처음 나온 순서로 담는다(중복 제거). 정상 세그먼트가 섞여 있어도 하나도 저장하지 않고 `duration_ms`도 바뀌지 않는다. 이미 저장된 seq를 다시 보낸 세그먼트의 ID도 검사한다. 재전송은 덮어쓰지 않고 건너뛰므로 멤버 ID는 처음 보낼 때 같이 보낸다. 첫 요청이 저장된 뒤 응답을 잃고 그사이 팀원이 탈퇴해 재시도가 이 400을 받으면, AI는 `details.member_ids`의 ID를 null로 바꿔 다시 보낸다(이미 저장된 seq는 건너뛰므로 저장된 `member_id`는 그대로다). 참석자로 제한하지 않는다. 응답 모양은 그대로다 |
| `duration_ms` | 저장된 발화 전체의 `end_ms` 최댓값 |
| 상태 | `done` 회의도 받는다. `failed` 회의는 409 `MEETING_FAILED` (`MEETING_ALREADY_ENDED`와 다르다. 저장되지 않았으니 새 회의로 다시 올려야 한다) |

## 채팅 회의의 반영 규칙 (구현됨, #378)

`source`가 `chat`인 회의의 추출 항목은 PM 승인을 거쳐야 task에 반영된다. AI 담당이 설계를 정했고 #378 에서 BE 리뷰를 거쳐 머지됐다.

- 추출 등록(`POST /extractions`)에서 새 항목의 게이트가 `auto`가 되면 `review`로 낮춘다. `hold`는 그대로다. 수정 항목은 원래 항상 `review`다.
- 승인으로 task가 생기거나 바뀌면 `TaskHistory.change_source`가 `chat`이다(그 외 회의는 기존대로 `meeting`·`manual`). 이력 응답의 `is_auto`는 `changed_by`로 계산하므로 승인한 PM이 기록된다.
- 응답 모양은 바뀌지 않는다. AI의 게이트 판단 코드는 그대로 두고 BE가 낮춘다.

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
    "assignee_raw": "…" | null, "assignee_type": "first" | "second" | "thirdname" | "thirdpronoun" | "thirdrole" | "group" | "none" | null,   // BE가 저장한다. 그 밖의 값은 NULL로 저장(요청은 받음)
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
| 담당자 | `assignee_type`이 `first`면 화자로 팀원을 찾고, 그 외에는 `assignee_raw`를 별칭으로 매칭한다. 별칭은 "님"·조사를 뗀 후보를 긴 것부터 찾아 처음 걸린 후보로 판정하므로(#459, AI `_name_candidates`와 같은 규칙) AI는 원문("하은이가", "지민님", "환 님이")을 그대로 보내도 된다. BE는 AI 규칙과 달리 공백을 한 칸으로 줄이고 후보마다 앞뒤 공백을 지우며, 조사를 떼고 "이"로 끝나면 "이"를 한 번 더 뗀 것도 후보로 두고("하은이는" → 하은이는, 하은이, 하은), "님"처럼 "씨"도 떼며("민수 씨" → 민수), 호칭을 뗀 뒤에도 "이"를 한 번 더 뗀다("하은이님이" → 하은). 탈퇴한 팀원의 별칭은 보지 않는다. 한 글자 별칭으로 찾은 담당자는 확인 필요로 두어 auto 가 되지 않는다. 1인칭 화자는 아래 순서로 정한다. ① `evidence_speaker_member_id`가 있으면 그 팀원이다. 이 워크스페이스의 탈퇴하지 않은 팀원이 아니면 uid를 못 찾은 것과 같게 처리하고(`not_found`, `assignee_hint`는 그 ID) ②③으로 넘어가지 않는다. ② `evidence_speaker`(Discord uid)가 있으면 그 uid로 `Member.discord_user_id`를 찾는다. ③ 둘 다 없고 대표 근거 발화(아래 근거 행)가 `evidence_seqs` 중 가장 큰 seq(결론 발화)일 때만 쓴다. 그 발화의 `member_id`가 이 워크스페이스의 탈퇴하지 않은 팀원이면 그 팀원이고, 아니면 그 발화의 `speaker_discord_user_id`로 찾는다. 결론 발화를 찾지 못했으면 쓰지 않는다. ④ 그래도 없으면 화자가 없는 1인칭 항목이다. 화자가 없는 1인칭 항목은 `assignee_raw`를 별칭으로 찾지 않고 담당자를 언급했는데 찾지 못한 것으로 본다(게이트는 아래 create 게이트 행). 틀린 `evidence_speaker_member_id`는 그 항목만 화자를 못 찾은 1인칭으로 처리하고 다른 항목은 그대로 처리한다. 예외로 36자를 넘거나 문자열이 아닌 값은 요청 검증에서 막혀 그 항목만이 아니라 요청 전체가 400 `INVALID_REQUEST`다. AI는 BE가 준 멤버 ID만 보내므로 생기지 않는 경우로 본다. `assignee_hint`가 그 ID 문자열이라 담당자 확신도 0.0이 항목 확신도에 들어가므로, 새 항목은 judge·legacy·경로 불명 어느 쪽이든 `hold`이고 update 항목은 항상 `review`다. 화자도 `assignee_raw`도 없는 1인칭(④)은 새 항목이 judge·경로 불명이면 `hold`이지만 legacy는 확신도로 정해서 `review`가 될 수 있다. `evidence_speaker_member_id`와 `evidence_speaker`는 AI가 결론을 말한 사람으로 직접 보낸 값이라 먼저 쓴다. 대표 근거 발화는 가장 큰 seq가 빠지면 더 앞 발화(보통 일을 요청한 사람)가 되어 다른 사람을 가리킬 수 있다 |
| 근거 | `evidence_seqs`의 seq마다 이 회의의 발화(`source`)를 찾아 `evidence`(type=`task`) 한 줄씩 저장한다. 순서는 자유이고 같은 seq는 한 번만 저장한다. 이 회의에 없는 seq는 그 seq만 건너뛰고(항목마다 빠진 seq를 모아 경고 로그 한 줄) 요청은 그대로 받는다. seq가 0 ~ 2^31-1(발화 저장 API의 seq 범위) 밖이거나 항목 하나의 seq가 100개를 넘으면 400 `INVALID_REQUEST`다. 찾은 발화 중 seq가 가장 큰 것(결론을 말한 마지막 발화)이 대표 근거 발화다. 승인 요청 payload의 `evidence_quote`·`evidence_speaker`·`evidence_at_ms`·`evidence_speaker_member_id`, 별칭 판정 로그의 `source_id`, 추출 조회의 `evidence`에 쓰고, 멤버 ID·`evidence_speaker`가 없고 결론 발화(가장 큰 seq)를 찾았을 때 1인칭 담당자에도 쓴다. 하나도 못 찾으면 evidence 행을 저장하지 않고(추출 조회의 `evidence` 객체는 모든 필드가 null이다) 승인 요청 payload에 요청의 `evidence_quote`·`evidence_speaker`·`evidence_at_ms`를 쓴다. `evidence_speaker_member_id`도 이 워크스페이스의 탈퇴하지 않은 팀원으로 확인된 값이면 payload에 쓴다. 그래서 AI는 `evidence_seqs`와 세 필드(화자의 멤버 ID를 보내면 그것도)를 항상 함께 보낸다 |
| 근거 화자의 멤버 ID | 같은 근거 화자의 멤버 ID가 두 곳에 다른 이름으로 실린다. 승인 요청 payload는 `evidence_speaker_member_id`이고 추출 조회 `evidence`는 `speaker_member_id`다(`EvidenceInfo`). 값은 대표 근거 발화를 찾았으면 그 발화에 저장된 `member_id` 그대로(탈퇴한 팀원이어도, 비어 있으면 null)다. 못 찾았을 때 요청의 `evidence_speaker_member_id`를 쓰는 것은 승인 요청 payload뿐이고, 이 워크스페이스의 탈퇴하지 않은 팀원으로 확인된 값만 싣고 아니면 null이다. 근거 발화를 못 찾으면 저장된 근거(evidence 행)가 없어 추출 조회의 `evidence` 객체는 있지만 `quote`·`speaker`·`at_ms`·`speaker_member_id` 모두 null이다. 그래서 이때는 요청에 활성 팀원의 멤버 ID가 있으면 payload에는 그 값이 실리고 조회 값은 null이라 두 값이 다를 수 있다. 근거 발화를 찾았을 때는 두 값이 같다. 두 출처를 섞지 않는다. 승인 요청은 새 항목·update 항목·auto 되돌리기 세 경로가 같은 규칙이고, 되돌릴 때 근거가 없으면 null이다 |
| 잘못된 항목 | update의 대상이 없거나 다른 워크스페이스 task, create의 제목이 비어 있으면 그 항목만 건너뛴다. `item_count`는 저장된 항목 수 |
| update 처리 | 게이트·승인 생성 규칙과 `target_snapshot`의 충돌 기준값은 [Backend README 유사 task 검색과 AI 판단 접수](../../README.md#유사-task-검색과-ai-판단-접수)를 따른다 |
| `target_snapshot.title` | 유사 검색 응답의 `title`을 그대로 보낸다. 제목을 바꾸는 값이 아니라 승인 때 대상 task가 그대로인지 확인하는 기준이다. 없거나 null이면 등록 시점의 제목을 쓴다. 필드 모양은 #185에서 AI·BE가 정했다 |
| 확신도 | `task_confidence`·`due_confidence`를 보내지 않으면 null(측정 안 함)로 저장하고 0.0(측정했는데 낮음)과 구분한다. 할 일 확신도가 null이면 항목 확신도도 null이다 |
| 추출 경로 | AI가 경로를 따로 보내지 않으므로 BE가 항목이 보낸 키로 가린다. `action`·`category`·`doc_text` 중 하나라도 보냈으면 judge, 아니고 `task_confidence`·`due_confidence`를 보냈으면 legacy, 둘 다 아니면 판별 불가다. 모든 항목이 같은 경로일 때만 추출의 `extraction_path`에 기록하고, 항목이 없거나 섞였거나 판별 불가 항목이 있으면 null이다(#201) |
| create 게이트 | 담당자를 언급했는데 BE가 한 명으로 찾지 못했으면 `hold`다. 이름으로 풀지 못해 `assignee_raw` 없이 `second`·`thirdpronoun`·`thirdrole`만 보낸 항목과 화자가 없는 1인칭 항목(틀린 `evidence_speaker_member_id` 포함)도 언급했는데 찾지 못한 것으로 본다. 단 화자도 `assignee_raw`도 없는 legacy 1인칭은 `hint`가 없어 확신도 계산에서 담당자가 빠지므로 아래 legacy 기준(확신도)대로 `hold`가 아니라 `review`가 될 수 있다. 멤버 ID로 정한 화자는 확신도 1.0이라 다른 조건을 만족하면 `auto`가 될 수 있다. judge 항목은 그다음 아래 auto 조건을 모두 만족하면 `auto`, 아니면 `review`다. 경로를 가릴 수 없고 확신도도 없는 항목은 `review`, legacy는 확신도로 정한다(0.8 이상이고 담당자 확인 불필요면 `auto`, 0.5 이상 `review`, 그 아래 `hold`). 경로와 상관없이 `thirdrole` 새 항목은 `auto`가 나와도 `review`로 내린다(#459, 역할은 맡은 사람이 바뀔 수 있음). update는 지금처럼 항상 `review`다 |
| judge auto 조건 | `task_status`가 certain, 담당자를 언급했으면 BE가 한 명으로 확정(검증된 별칭·화자, 확신도 0.8 이상), `assignee_type`이 `second`·`thirdpronoun`·`thirdrole`이 아님, `due_status`가 certain이거나 missing이고 `due_date` 유무와 맞음(missing인데 날짜가 있거나 certain인데 날짜가 없으면 탈락), `similar_count`가 0이고 워크스페이스에 임베딩이 없는 활성 task가 없음(그런 task는 유사 검색에 잡히지 않는다. 같은 요청에서 앞 항목이 auto로 만든 task와 임베딩 API가 제목을 거절한 task도 해당). `task_status`·`due_status`·`similar_count` 중 하나라도 null이면 `review`라, 이 키를 보내지 않는 AI에서는 지금 동작이 그대로다. 상태 값이 셋 중 하나가 아니면 400 `INVALID_REQUEST`, `similar_count`가 음수거나 `top_similarity`가 0~1 밖이어도 400이다(#232) |
| 근거 상태·유사 검색 값 | `similar_count`는 그 finding을 판단할 때 유사 검색 응답의 후보 수다(BE가 이미 `min_similarity` 미만을 뺀 결과). 같은 회의 앞부분 카드(pending)는 세지 않는다. update 항목은 보내지 않아도 되고 보내도 게이트에 쓰지 않는다. 값은 추출 항목에 저장되고 추출 조회에 실린다 |

- 담당자 종류 저장과 승인 때 별칭 학습(#459, 현재 구현): BE가 `assignee_type`을 저장해, 담당자를 못 찾은 `thirdname` 항목을 PM이 담당자를 골라 승인할 때 `assignee_raw`를 다듬어 그 팀원의 확인된 별칭으로 저장한다. 요청 모양은 바뀌지 않는다. 학습한 별칭은 전사 힌트(`GET .../members/names`의 `aliases`)에도 실린다. AI가 1인칭을 `thirdname`으로 잘못 보내도 그 말이 할 일의 주어로 쓰인 꼴이면(어간 제·저·나·내 / 저희·우리 / 본인 × 복수 들 × 주어 표지, 예: "제가"·"저도"·"저희들은") 학습하지 않는다(#502). 부사어·구("우리끼리")는 막지 않는다. 오분류를 줄이는 것은 AI 몫이다. 규칙은 Backend README의 "1인칭 거르기의 범위"에 있다. `thirdrole`은 지금 학습하지 않는다. AI가 역할 원문을 빼고 문맥으로 추측한 이름을 `assignee_raw`로 보낼 수 있어서다. 역할 원문("BE 리더가")을 보내고 추측 이름은 보내지 않는 것은 AI 쪽 변경이라 합의 필요 변경이고, 그 뒤 BE가 `thirdrole`을 학습 대상에 다시 넣는다. 규칙은 [Backend README 승인 때 별칭 학습](../../README.md#승인-때-별칭-학습)에 있다.
- 경로 판별의 전제: judge 항목(`ai/judge/pipeline.py`의 `to_item`)은 `action`·`category`·`doc_text`를 값이 null이어도 키째 보내고 확신도를 보내지 않는다. legacy 항목(`ai/capture/handoff.py`의 `to_extraction_items`)은 확신도 둘을 항상 보내고 judge의 키는 보내지 않는다. 판단 경로는 확신도를 만들지 않고 인계기에 임의 고정값을 넣지 않는다는 AI 쪽 기록(`ai/docs/plan/전체 계획.md`의 확신도 항목)을 따랐다.
- auto 조건과 새 키 이름(`task_status`·`due_status`·`similar_count`·`top_similarity`)은 #232 이슈에서 AI·BE 공동 작업으로 정했고, 조건 구성은 멘토 피드백으로 확인했다. AI가 값을 만드는 방법은 아래 "근거 상태의 뜻"에 적는다. 새 키는 judge만 보내므로 경로 판별은 바뀌지 않는다.
- 근거 상태의 뜻 (현재 구현, `ai/judge/evidence.py`): `certain`은 **원문에 명시됐다고 확인됐다**는 뜻이지 정답일 통계적 확률이 아니다. 값을 만든 LLM이 스스로 매기지 않고, 새 항목마다 판정 API Jev(Elice MLAPI `typesafe/jev-latest`)에 근거 원문을 주고 다시 묻는다(#232의 B안). 항목당 호출 1회로 할 일과 마감을 함께 묻는다.
  - `task_status`: "근거 원문에서 누군가 이 할 일을 하겠다고 약속했거나 하기로 결정·지시했다고 명시했는가"에 yes 확률이 0.8 이상이면 certain, 아니면 inferred다. 조건부·질문·제안·부정은 no 또는 unclear가 되도록 기준을 준다.
  - `due_status`: 마감이 없으면 묻지 않고 missing이다. 마감이 있으면 회의 날짜, 마감 날짜와 그 요일, Luna가 낸 마감 원문 표현(`due_raw`)을 함께 주고 "원문의 마감 표현이 이 일의 마감이고 계산하면 이 날짜 하나로 정해지는가"에 yes 확률이 0.8 이상이면 certain, 아니면 inferred다. "다음 주쯤"·"이번 주 안에" 같은 근사·기간 표현, 다른 업무의 날짜, 번복된 날짜는 inferred가 되도록 기준을 준다.
  - Jev 키가 없거나 호출이 실패하면 확인하지 못한 것으로 보고 inferred다(마감이 없으면 missing 그대로). 그래서 AI에 `JEV_API_KEY`가 없으면 judge 새 항목은 auto가 되지 않는다.
  - 검증: `ai/judge/eval_evidence.py`(실제 호출, pytest 밖)의 정답 붙인 대사 19개를 2회씩 돌린 결과(2026-11-03) 잘못된 certain 0건, 할 일 37/38·마감 22/24 정답이었다. 놓친 3건은 yes 확률 0.78~0.79로 기준 바로 아래였다. 표본이 작아 운영의 상태별 PM 반려·수정 비율로 계속 확인해야 한다.
  - 같은 회의의 새 항목 카드에 뒤 발화를 합치면 `task_status`는 둘 중 낮은 쪽(certain > inferred > missing), `due_status`·`due_raw`는 마감을 정한 뒤 발화 기준이며 마감을 없애면 missing, `similar_count`·`top_similarity`는 큰 쪽이다.
  - BE 확인 필요: `backend/app/services/matching.py`의 auto 게이트 주석은 "할 일 근거 상태는 LLM의 자기 표시라 거의 certain"이라고 전제한다. 지금은 별도 판정 API로 다시 묻는 방식이라 이 전제가 맞지 않는다.
- `evidence_seqs`의 모양과 규칙(배열, 순서 자유, 없는 seq 건너뛰기, 가장 큰 seq가 대표, 세 필드를 함께 보내고 빼지 않음, type은 모두 `task`)은 #229 이슈에서 AI·BE가 정했다. 1인칭 화자만 이슈의 "seq로 찾으면 seq 우선"과 달리 요청의 화자를 먼저 쓴다(#229 당시에는 `evidence_speaker`였고, #265 뒤의 순서는 담당자 행의 ①~④다). BE가 리뷰 중에 바꿨고, AI에는 PR로 알린다. AI는 판단 경로에서 `JudgeFinding.seqs`(합친 카드는 합친 발화 전부, 항목당 뒤쪽 100개까지), 기본 경로에서 `locate_sentence`가 찾은 발화의 seq를 보낸다. 1인칭 카드는 담당자를 정한 발화까지만 합친다. 업로드 회의의 외부 참석자처럼 인계 때 화자가 비면 BE가 가장 큰 seq의 화자로 찾기 때문에, 뒤 발화를 더하면 그 사람이 담당자가 된다.
- 화자를 멤버 ID로 받는 키(발화 저장의 `speaker_member_id`, 추출 등록의 `evidence_speaker_member_id`)는 이슈 #265에서 BE가 구현했다. 상태는 합의됨(#254, 2026-11-02)이고 BE가 구현했다. AI는 업로드 회의에서만 이 키를 보낸다(발화 저장의 `speaker_member_id`와 추출 등록의 `evidence_speaker_member_id`, 규칙은 [업로드 회의 인계 규칙](#업로드-회의-인계-규칙)). 디스코드 회의는 이 키를 보내지 않고 기존 필드(`speaker`·`evidence_speaker`)로 지금처럼 동작한다. 새 필드는 모두 선택이고 기존 필드의 뜻은 그대로다. 변경은 요청의 선택 필드 둘과 발화 저장의 새 400 조건이다. 응답은 추출 조회 `evidence`의 `speaker_member_id`와 승인 요청 payload의 `evidence_speaker_member_id`가 늘 뿐이다(승인 목록은 payload를 저장된 그대로 내려준다). 두 요청 필드는 빈 문자열이나 공백뿐이면 null로 보고(`speaker`와 같다), 36자를 넘거나 문자열이 아니면 400 `INVALID_REQUEST`다. 배포는 BE를 먼저 한다. 모르는 키는 오류 없이 무시되므로 BE보다 AI가 먼저 나가면 멤버 ID가 조용히 버려지고 uid 경로로만 동작한다.
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

## 채팅 수집 대상 목록 `GET /bot/chat-channels` → 200

봇이 매일 읽을 디스코드 채팅 채널을 묻는다(#428). PM 이 웹에서 서버의 텍스트 채널 하나를 골라 켜 둔 워크스페이스만 나온다. 채널을 켜고 끄는 API는 웹용이라 [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md)에 있고 여기서 다시 적지 않는다. 동작 세부는 [Backend README](../../README.md#채팅-수집-채널)에 있다.

```jsonc
// 요청: 헤더 X-Service-Token, 본문·쿼리 없음
// 응답 data. workspace_id 순
{ "items": [ { "workspace_id": "ws_...", "guild_id": "900000000000000001", "channel_id": "900000000000000002" } ] }
// 켠 워크스페이스가 없으면
{ "items": [] }
```

| 항목 | 동작 |
|---|---|
| 인증 | `X-Service-Token`. 없거나 틀리면 401 `UNAUTHENTICATED`. 워크스페이스 멤버의 세션은 토큰을 대신하지 못한다 |
| 대상 | 디스코드 연결(`provider_channel_id`=서버 ID)과 수집 채널이 모두 있는 워크스페이스만. 연결을 해제하면 사라지고, 다른 서버로 다시 연결하면 PM 이 채널을 새로 켤 때까지 빠진다 |
| 빈 목록 | 켠 워크스페이스가 없으면 200 `{items: []}`다. 오류가 아니다 |
| 변하는 값 | 목록과 실행 사이에 PM 이 채널을 바꾸거나 끄거나 연결을 해제할 수 있다. BE 는 회의 생성에서 채팅 수집 여부를 확인하지 않는다(꺼졌거나 연결이 해제된 워크스페이스도 `POST /meetings`는 201 이다). 봇은 워크스페이스마다 실행 직전에 목록을 다시 받아 목록에 있는 채널만 읽는다. 목록과 실행 사이에 PM 이 끄면 그날 실행분은 회의가 만들어질 수 있다 |

- 합의 상태: **합의됨(#428, 2026-11-06).** 경로와 응답 모양은 AI 제안(#428 본문)을 BE 가 그대로 받아 구현했다(#428). 봇 쪽 전환(이 목록으로 대상 정하기, 음성 봇 토큰으로 바꾸기)은 AI 가 한다.
- 현재 구현: BE 는 `app/api/integrations.py`의 `list_bot_chat_channels`, `app/services/chat_channel.py`의 `list_enabled_for_bot`이다. 구현됨(#428).
- 배포 순서: BE 를 먼저 배포하고, 운영 PM 이 웹(또는 Swagger)에서 지금 봇이 읽는 채널을 켠 뒤, AI 가 이 목록을 쓰도록 전환한다. 켜기 전에 AI 가 먼저 전환하면 PM 이 켜기 전까지 수집이 멈춘다(목록이 비어 있다).
- 영향받는 소비자: 이 경로는 새 경로라 기존 봇 동작은 바뀌지 않는다. `chat-cursor`는 그대로다.

## 웹 업로드 가져가기

웹에서 PM이 올린 녹음(`POST /workspaces/{id}/meetings/upload`, [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md))을 AI가 가져가 처리하는 경로다.

- 합의 상태: **합의됨(#255).** 가져가기(#219)와 화자 지정 경로(#266)를 BE가 만들었고 AI·BE 계약 부분은 #255에서 합의했다. AI는 구현했다(#289 묶음: 가져오기·라벨 보고·지정 받기·전사와 BE 인계). 업로드 회의를 BE로 인계할 때의 규칙은 [업로드 회의 인계 규칙](#업로드-회의-인계-규칙)이다.
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
- 지정이 멈추면 BE sweeper가 라벨 보고 뒤 7일이 지난 `awaiting_speakers` 회의를 `failed`(`failed_stage=speaker_assignment_expired`)로 바꾸고 녹음 폴더를 지운다. 7일은 첫 라벨 보고가 성공한 시각(`speakers_reported_at`)부터 센다. 실제로 `failed`가 되는 때와 sweeper 가 돌지 않는 경우는 [처리할 때 주의할 점](#처리할-때-주의할-점)에 있다. 그 전에 풀려면 `PATCH /meetings/{meeting_id}/fail`을 쓴다.

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
- 같은 내용을 다시 보내면 200이고 `status`는 현재 상태(`awaiting_speakers`, PM 이 지정한 뒤에는 `processing`)다. 이때 BE 는 아무것도 쓰지 않는다. 라벨, 보고 시각(`speakers_reported_at`, 지정 대기 7일 만료의 기준), 회의 상태가 그대로라서 재전송으로 만료 시계가 늘지 않는다. 응답을 못 받은 재시도와, AI 가 지정 대기 만료를 확인하는 데(#325, #438) 쓴다. BE 는 이 동작을 유지한다.
- "같은 내용"은 라벨 이름, `total_sec`, 샘플의 `start`·`end` 값이 모두 같다는 뜻이다. 라벨·샘플 순서와 `1`·`1.0` 같은 표기 차이는 보지 않고, 스키마에 없는 필드는 무시한다.
- 판정 순서: 401 `UNAUTHENTICATED`(토큰) → 400 `INVALID_REQUEST`(본문 검증) → 404 `MEETING_NOT_FOUND` 다음에, `done`·`failed`면 보낸 라벨 내용과 상관없이 409 `MEETING_ALREADY_ENDED`가 먼저다. 그다음 claim 여부(`UPLOAD_NOT_CLAIMED`), 그다음 내용 비교(`SPEAKERS_ALREADY_REPORTED`) 순이다.
- 400 `INVALID_REQUEST`: 위 검증에 걸린 경우. 숫자는 유한해야 하며 `NaN`·`Infinity`도 400이다.
- 404 `MEETING_NOT_FOUND`: 없는 회의, 업로드 회의가 아님, `meeting_upload` 행 없음. 봉투의 `error.code`가 `MEETING_NOT_FOUND`일 때만 회의가 없다는 뜻이다. 없는 경로처럼 다른 이유의 404 는 `INVALID_REQUEST`다. BE 에는 회의나 업로드 행을 지우는 경로가 없다.
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
- AI 가 없거나 처리 도중 멈추면 업로드 회의가 `processing`에 남아 그 워크스페이스의 업로드가 409 로 막힌다. AI가 가져간 회의는 BE sweeper가 정리한다(기본 5분마다, `UPLOAD_SWEEP_INTERVAL_SECONDS`가 0 이하면 sweeper가 돌지 않아 7일이 지나도 `failed`가 되지 않는다).
  - `processing`이고 가져간 업로드: 가져간 시각·지정 시각·다시 가져간 시각·마지막 발화 저장 시각 중 가장 늦은 것에서 3시간이 지나면 `failed`(`failed_stage=diarize`). 지정 뒤에 멈춰도 같은 값이다. AI가 발화를 나눠 보내면 그때마다 3시간이 다시 시작된다.
  - `awaiting_speakers`: 라벨 보고 뒤 7일이 지나면 `failed`(`failed_stage=speaker_assignment_expired`). 3시간 규칙은 쓰지 않는다. 7일은 첫 라벨 보고가 성공한 시각(`speakers_reported_at`)부터 센다. sweeper 가 5분마다 돌아서 실제로 `failed`가 되는 때는 조금 늦을 수 있고, 서버가 멈춰 있었으면 더 늦다. 같은 내용 재전송은 이 시각을 바꾸지 않는다.
  - 정리하면 녹음 폴더를 지우고 그 워크스페이스의 업로드 막힘이 풀린다. pending으로 되돌리지 않는다(#288).
  - 정리된 뒤 AI는 `/fail`·라벨 보고·claim·resume에서 409 `MEETING_ALREADY_ENDED`(`details.status=failed`), 발화 저장에서 409 `MEETING_FAILED`, 원본 받기에서 404를 받는다. 다시 보내지 않고 로컬 파일을 지우고 끝낸다(#288).
  - 아직 아무도 가져가지 않은 업로드는 정리하지 않는다. AI가 꺼져 있으면 그 공간의 업로드는 계속 409이고, `PATCH /meetings/{meeting_id}/fail`(서비스 토큰)로 풀 수 있다.
  - 회의마다 조건부 UPDATE 한 번이라 AI 보고·PM 지정과 겹쳐도 한쪽만 이긴다. 다만 3시간 경계에서는 resume 200이나 발화 저장 201 직후 회의가 failed일 수 있다. resume은 회의 행을 잠그지 않고, 발화 저장 뒤 sweeper가 그 발화를 보지 못한 채 판정할 수 있어서다(resume 항목의 경합과 같다). 이어지는 발화 저장·추출 등록이 409로 막아 데이터는 깨지지 않는다.

### 업로드 회의 인계 규칙

PM 이 라벨을 멤버에 지정한 업로드 회의(`mapping`)를 AI 가 전사한 뒤 BE 로 넘길 때의 규칙이다.

- 합의된 것: 화자를 멤버 ID 로 받는 키의 모양은 #254(위 "화자를 멤버 ID로 받는 키" 단락), 업로드 처리 경로와 상태는 #255, 정리된 회의를 다시 보내지 않고 로컬만 정리하는 것은 #288 에서 합의했다. BE 가 받는 동작은 위 [발화 저장](#발화-저장-post-meetingsmeeting_idsources--201)·[추출 등록](#추출-등록-post-extractions--201) 절을 따른다.
- AI 구현, BE 동작 변경 없음: 아래 표와 그 뒤 항목은 AI 가 합의된 동작 위에서 정한 보내는 쪽 처리다(`capture/handoff.py`, #289 묶음). BE 의 응답과 검증은 바뀌지 않는다.

AI 가 보내는 것(AI 구현):

| 항목 | AI 가 보내는 것 |
|---|---|
| 발화 저장 `speaker` | 모든 발화에서 null. 업로드 녹음에는 Discord uid 가 없다 |
| 발화 저장 `speaker_member_id` | 멤버에 지정된 라벨의 발화에만 그 멤버 ID. 외부 참석자(`mapping` 값이 null)로 지정한 라벨의 발화는 키를 보내지 않는다 |
| 발화 저장 `speaker_names` | 보내지 않는다 |
| 추출 등록 `evidence_speaker` | 모든 항목(judge·legacy)에서 null |
| 추출 등록 `evidence_speaker_member_id` | 근거 화자가 멤버에 지정된 라벨이면 그 멤버 ID. 외부 참석자면 보내지 않는다 |
| 회의 생성·종료 | `POST /meetings`와 `PATCH /meetings/{meeting_id}/end`를 부르지 않는다. 회의는 업로드 때 BE 가 이미 `processing`으로 만들었다 |

AI 구현이 정한 처리(BE 동작은 그대로):

- 외부 참석자의 발화도 전사·발화 저장·추출에는 넣는다. 화자와 멤버 ID 는 모두 비운다(위 지정 결과 조회에서 `mapping` 값 null 의 뜻 그대로다).
- 발화 저장이 400 `INVALID_REQUEST`에 `details.member_ids`를 담아 거절하면, AI 는 그 ID 를 비우고(`speaker_member_id`를 보내지 않는다) 다시 보낸다. 첫 전송이든 재전송이든 같다. 서로 다른 ID 수만큼만 되풀이한다. 비운 ID 는 추출 등록의 `evidence_speaker_member_id`에서도 뺀다. BE 가 알려 준 것은 거절 사유이고 비우고 다시 보내는 것은 AI 의 처리다.
- 외부 참석자의 표기는 위 표대로 키를 보내지 않는 것이다. null 을 보내지 않는다.

합의된 정리 방식(#288):

- 409 `MEETING_FAILED`(발화 저장)·409 `MEETING_NOT_PROCESSING`(추출 등록, `details.status`가 `processing`이 아님)·404 는 BE 가 이미 끝낸 회의다. AI 는 새 회의를 만들지 않고, 실패 횟수도 세지 않고 로컬 파일을 지우고 끝낸다. AI 구현은 이때 `PATCH /meetings/{meeting_id}/fail`도 보내지 않는다.

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
| `aliases` | 그 팀원의 `MemberAlias.alias_text` 전부. BE가 자동으로 넣는 이름 별칭(이름, 성 뗀 이름)과 한글 디스코드 닉네임도 들어간다(#459). 종류(`alias_type`)와 확인 여부를 가리지 않고 넣고, 확인한(`verified`) 별칭부터 만든 순서다. 한 팀원 안의 같은 별칭은 DB가 막는다(`uq_alias_per_member`). 없으면 빈 목록 |

- 합의 근거: AI 담당이 STT 이름 힌트용으로 제안했다(2026-10-13). #273 에서 AI·BE가 합의했고 #278 리뷰로 확인했다. 목록 키는 다른 BE 목록 응답처럼 `items`다. task 제목도 용어 힌트로 재 봤지만 전사가 나아지지 않아 경로를 만들지 않는다([AI 결정 기록 0025](../../../ai/docs/basis_for_decision/member/2026-10-13-0025-title-hint-not-now.md)).
- 현재 구현: BE에 이 경로가 있다. 봇은 아직 부르지 않는다. 봇이 디스코드 표시 이름 대신 이 값을 힌트로 쓰는 작업은 AI 후속이다.

## 리마인드 DM

PM 이 웹에서 승인한 리마인드와 PM 이 웹에서 쓴 글을 봇이 팀원에게 디스코드 DM 으로 보내고, 팀원이 봇에게 보낸 DM 을 백엔드에 넘기는 경로다. 리마인드 문구 초안을 AI 가 써 넣는 경로도 여기 있다. 웹 쪽 조작(만들기·고치기·승인·취소, 대화 조회, 웹 답장)은 [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md) §5.7 에 있다.

- 합의 상태: **BE·봇·초안 워커 구현.** #310 에서 BE 와 AI 쪽 초안 모듈(`ai/draft/reminder_draft.py`)을 만들었고, #317 에서 봇의 DM 발송·수신과 초안 워커(`ai/capture/dm.py`)를 붙였다. #470 에서 BE 가 PM 글을 같은 발송 경로에 태웠다(`ai/` 코드는 그대로다).
- 결정 근거: [결정 0034](../../../ai/docs/basis_for_decision/ai/2026-11-04-0034-reminder-and-thread-message.md), [결정 0035](../../../ai/docs/basis_for_decision/ai/2026-11-04-0035-bot-dm-local-journal-and-backfill.md), FE 메시지 정책(D-174)
- 리마인드 하나는 태스크 하나 × 받는 사람 한 명이다. 같은 받는 사람·같은 발송 시각의 리마인드는 "보낼 메시지"(묶음) 하나로 모이고, PM 은 묶음 문구를 보고 승인한다. 봇이 보내는 것은 승인된 묶음 문구 그대로다.
- PM 이 웹에서 남의 대화에 쓴 글(`sender=pm`)은 묶음 없이 바로 발송 대기로 간다. 예약·승인·문구 틀이 없고 시계와 답장 판단을 만들지 않는다. 봇은 리마인드와 PM 글을 가리지 않고 같은 경로로 보낸다.
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
  "fallback_body": "…"               // BE 가 만든 규칙 문구(틀 포함). AI 가 못 쓰면 이 글이 나간다
} ], "total": 1 }
```

- 초안이 필요한 묶음은 PM 이 직접 쓴 문구가 아닌 묶음이다. 리마인드가 하나뿐이고 PM 메모(`note`)가 있는 묶음은 메모가 그대로 문구가 되므로 나오지 않는다. 리마인드가 여럿이면 메모가 있어도 한 통으로 다시 써야 하므로 나온다.
- 그 대화에 처음 나간 DM 의 `delivered` 보고가 오면, 첫 DM 틀로 만들어 둔 승인 전 묶음을 두 번째 틀로 다시 만들고 판을 올린다. `rule`·`ai` 는 규칙 문구로 돌아가 초안을 다시 받고, 메모에 틀만 씌운 `pm` 묶음은 메모 그대로 틀만 바뀐다. PM 이 고친 글은 그대로다.
- 말투는 `style_examples` 가 있으면 그 말투를, 없으면 기본 페르소나(같은 팀 동료인 PM 이 가볍게 묻는 존댓말, 짧게, 재촉하거나 탓하지 않음)를 따른다. 초안 모듈이 이 규칙으로 프롬프트를 만든다. 인사·받는 사람 이름·PM 소개·맺음 안내는 BE 가 붙이는 틀이므로 초안은 마감을 묻는 가운데만 쓰고, `style_examples` 에 들어 있는 틀 줄은 따라 쓰지 않는다.

### `POST /bot/drafts/{bundle_id}` → 200

```jsonc
{ "draft_version": 3, "body": "'API 명세서' 마감이 11/14(토)이라 …" }   // 못 썼으면 "body": null
```

- `body` 가 null 이면 규칙 문구를 그대로 두고 초안 대기를 끝낸다.
- `body` 는 가운데만이다. BE 가 앞뒤 공백을 지우고 틀을 씌워 저장한다. 그 대화에 나간(`delivered`) 봇 DM 이 없으면 `안녕하세요 {팀원}님, {워크스페이스 이름} {PM}이에요.` 와 이 봇으로 보낸다는 안내, 맺음 `여기로 답장하시면 저한테 바로 전달돼요.` 를, 있으면 `{팀원}님, {PM}이에요.` 만 붙인다. PM 은 묶음의 첫 리마인드를 만든 PM, 없으면 가장 먼저 등록된 PM 이다. 조사는 PM 이름 받침에 맞추고, 마지막 글자가 한글이 아니면 `(이)에요` 다.
- 비었거나 틀을 씌운 전체가 2,000자를 넘으면 400 `INVALID_REQUEST`.
- 초안이 들어가면 문구가 바뀌므로 `draft_version` 이 하나 오른다. PM 이 그 전 판을 보고 승인하면 웹 승인이 `BUNDLE_CHANGED` 로 거절되어 PM 이 새 문구를 다시 본다.
- 409 `DRAFT_STALE`: 가져간 뒤 묶음 구성이 바뀌었거나 다른 초안이 먼저 들어왔거나(`draft_version` 이 다름), PM 이 문구를 직접 고쳤거나, 이미 승인됐거나, 예정 상태가 아니다. 들어간 초안을 다시 보내도 이 오류다. 버리고 넘어간다.
- 404 `REMINDER_BUNDLE_NOT_FOUND`: 없는 묶음.

### `POST /bot/messages/claim` → 200

발송 시각이 된 승인된 묶음을 대화 메시지로 만든 뒤, 아직 봇이 가져가지 않은 메시지(리마인드와 PM 글)를 준다. 응답이 온 리마인드, 태스크가 지워졌거나 담당자가 바뀐 리마인드, 사람이 상태나 마감을 바꾼 리마인드는 그 전에 자동 취소하고, 마감이 지난 리마인드는 만료하므로 나오지 않는다. 탈퇴한 팀원의 묶음은 메시지를 만들지 않고 취소한다. 요청 본문은 없다.

```jsonc
// data
{ "items": [ {
  "message_id": "…", "workspace_id": "…", "member_id": "…",
  "discord_user_id": "…",          // 이 계정에 DM 을 보낸다
  "body": "…",                     // 보낼 글 그대로. 리마인드는 승인한 묶음 문구, PM 글은 "{공간 이름} {PM 이름} PM 이 메시지를 보냈어요.\n대화 링크"
  "scheduled_at": "…" | null       // UTC. PM 글은 null
} ], "total": 1 }
```

- **한 메시지는 한 번만 준다.** 가져간 메시지는 다시 나오지 않는다. 동시에 두 번 불러도 같은 메시지가 두 곳에 가지 않는다.
- 가져간 뒤 10분 안에 결과 보고가 없으면 BE 가 못 보냄(`unknown`)으로 닫고 다시 주지 않는다. 같은 DM 이 두 번 가는 것을 막으려는 것이다. 봇이 재시작하면 가져갔지만 보고하지 못한 메시지는 보내지 말고, 보냈다면 결과를 보고한다(늦은 보고는 받는다).
- 디스코드가 연결되지 않은 팀원(`discord_user_id` 없음)의 메시지는 봇에 주지 않는다. BE 가 만드는 순간 `discord_not_linked` 로 표시한다. 만든 뒤 가져가기 직전에 팀원이 탈퇴했거나 연결을 끊은 경우도 그 메시지만 같은 사유(`failed` / `discord_not_linked`)로 닫고 봇에 주지 않는다. 같은 응답의 다른 메시지는 그대로 준다.
- 디스코드 DM 은 한 통에 2,000자까지다. BE 는 길이를 자르지 않으므로 넘으면 봇이 나눠 보낸다.
- PM 글의 `body` 는 쓴 글이 아니라 안내다. 첫 줄은 `{공간 이름} {PM 이름} PM 이 메시지를 보냈어요.` 이고 `APP_BASE_URL` 이 있으면 다음 줄이 대화 링크다. 답장을 웹 대화로만 받기로 해서(#515) 본문은 DM 으로 나가지 않는다. 안내는 가져갈 때 만들고 저장하지 않는다.

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
- 404 `MESSAGE_NOT_FOUND`: 없는 메시지이거나 봇이 보내는 메시지가 아니다(팀원 글).

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
  1. `reply_to_discord_message_id` 가 봇이 보낸 DM 이면 그 DM 의 워크스페이스. 리마인드와 PM 글 안내를 모두 뜻한다
  2. 답장 기능을 쓰지 않은 글이고 나간 재촉의 시계가 열린 워크스페이스가 하나면 그 워크스페이스
  3. 그 DM 창에서 이 글 바로 앞에 나간 봇 DM 의 워크스페이스. 리마인드와 PM 글 안내를 모두 뜻한다. 두 글의 시각은 보고 받은 시각이 아니라 디스코드 메시지 id(snowflake)에 든 보낸 시각으로 비교한다. 결과 보고는 답장보다 늦게 올 수 있으므로, 봇이 가져갔지만 아직 보고하지 않은 메시지(10분 시간 초과로 닫힌 것 포함)는 가져간 시각에 나간 것으로 본다. 이 글의 id 가 숫자가 아니면 `sent_at` 을 쓴다
  4. 봇이 가장 최근에 DM 을 보낸 워크스페이스(못 보낸 DM 은 뺀다), 그것도 없으면 가장 나중에 등록된 팀원
- 404 `MEMBER_NOT_FOUND`: 어느 워크스페이스에도 그 디스코드 계정의 팀원이 없다. 버리고 넘어간다.
- 응답에는 판단 결과가 없다. 이 경로는 리마인드 후보가 있는 글을 저장과 같은 트랜잭션에서 판단 큐에 넣고, 어느 태스크에 대한 답인지는 아래 「리마인드 답장 판단」 경로가 정한다. 후보가 없는 글은 PM 에게 바로 웹 알림(`message_received`)이 간다.

## 리마인드 답장 판단

팀원 답장을 봇이 맡아 태스크별 변경으로 판단해 돌려주는 경로다. 게이트·반영·승인 요청·기록·PM 알림은 BE 가 결과를 받는 트랜잭션에서 끝낸다.

- 합의 상태: **BE 구현(#331), 합의 여부 확인 필요.** 소비자는 봇의 판단 워커(`ai/capture/dm.py`)다.
- 판단은 답장 저장과 같은 트랜잭션에서 큐에 들어간다. 후보가 없는 글(리마인드와 무관한 글)은 큐에 들어가지 않고 판단하지 않는다.
- 후보는 답장 앞에 나간 마지막 묶음의 태스크와 답장 앞에 열린 72시간 시계의 태스크를 합친 것이다. 지운 태스크, 담당이 대화 주인이 아닌 태스크는 뺀다.
- 답장 한 통에 판단 하나다. 대화마다 가장 오래된 답장부터 한 통씩 맡기므로, 뒤 답장은 앞 답장의 반영 값을 본다.

| 시점 | 요청 | 인증 |
|---|---|---|
| 주기적으로(판단 워커) | `POST /bot/replies/claim` | `X-Service-Token` |
| 판단이 끝난 뒤(실패 포함) | `POST /bot/replies/{message_id}/judgment` | `X-Service-Token` |

### `POST /bot/replies/claim` → 200

맡길 답장 한 통을 준다. 없으면 `item` 이 null 이다. 3분 안에 결과가 없으면 `attempt` 를 올려 다시 맡긴다.

```jsonc
// data
{ "item": {
    "message_id": "…", "attempt": 1, "workspace_id": "…", "member_name": "재환",
    "reply_date": "2026-11-04",                        // 보낸 날, 한국 시간
    "lines": [{ "sender": "pm" | "member", "text": "…" }],  // 시간순, 마지막이 이번 답장, 최대 12줄
    "candidates": [{ "task_id": "…", "title": "…", "status": "in_progress", "due_date": "2026-11-20" | null,
                     "assignee_member_id": "…" | null, "updated_at": "…" }]
} }   // 맡길 것이 없으면 { "item": null }
```

- `lines` 는 후보 태스크들의 마지막 리마인드 중 가장 앞선 것부터 이번 답장까지다. 이번 답장 뒤의 글은 싣지 않는다.
- `candidates[].status` 는 열린 시계가 있는 막힘 태스크면 막기 전 상태다. 게이트도 같은 값과 비교한다.
- PM 이 태스크를 고른 답장은 그 태스크만 후보로 다시 나온다.

### `POST /bot/replies/{message_id}/judgment` → 200

```jsonc
// 요청
{ "attempt": 1, "failure_reason": null, "model_name": "terra+luna+jev",
  "changes": [{
    "task_id": "…" | null,
    "field": "status" | "due_date" | "assignee" | "scope" | "unknown" | "due_clear" | "failed",
    "new_value": "done",
    "evidence_status": "certain" | "inferred" | null,
    "summary": "…", "evidence_quote": "…",
    "assignee_type": null, "assignee_raw": null,
    "base": { "status": "…", "due_date": "…", "assignee_member_id": "…", "title": "…", "updated_at": "…" }
  }] }
// data: null
```

- `failure_reason` 이 있으면 판단 전체 실패다. 예외 종류만 싣고 답장 글을 싣지 않는다. 120자에서 자른다.
- `base` 는 판단이 본 값(`candidates` 그대로)이다. 게이트와 마감·담당자 승인 충돌 확인의 기준이다. 상태의 승인 충돌 기준은 BE 가 맡길 때 저장한 실제 상태다. `candidates[].status` 는 막기 전 상태일 수 있어서다. 답장으로 막힘이 풀리면 대기 중인 답장 카드의 기준도 풀린 상태로 옮긴다.
- `unknown` 줄의 `task_id` 는 쓰지 않는다. `due_clear`·`failed` 줄은 어느 태스크인지 알면 `task_id` 를 싣고 모르면 null 이다. 실린 `task_id` 와 그 밖의 줄의 `task_id` 는 `candidates` 안의 태스크여야 한다.
- `changes` 가 비면 바꿀 것 없는 답장이다. 푸시 없이 답장 기록에만 남는다. PM 이 태스크를 고른 재판단은 예외로 `→ 바꿀 내용을 찾지 못했어요. 직접 확인해 주세요` 를 알린다.

| 줄 | BE 처리 |
|---|---|
| 지금 값과 같음, 지운 태스크 | 기록만 |
| `status`, `certain`, `base.status` 가 지금과 같음, 답장 뒤 사람이 바꾼 상태 이력이 없음, 담당이 대화 주인 | 자동 반영(`change_source: reminder_reply`) |
| 이미 막힌 태스크에 `blocked` 인데 자동 반영이 아님 | 기록만. 상태는 그대로이고 사유는 아래 규칙을 따른다 |
| 그 밖의 `status`, `due_date`, `assignee`, `scope` | PM 승인 요청. 태스크당 한 장. 그 답장의 값이 모두 같은 태스크의 대기 `task_update` 카드(출처 무관)에 이미 있으면 새 카드 없이 줄만 그 카드에 잇고 그 줄은 알리지 않는다. 값이 없는 `scope` 와 못 찾은 담당자는 비교하지 않는다 |
| `unknown` | 답장이 PM 차례가 되고 후보 시계가 멈춘다 |
| `due_clear` | 자동 변경 없이 PM 에게 알린다. `task_id` 가 있으면 그 태스크 시계는 응답으로 친다 |
| `failed` | 된 변경은 반영하고 확인 필요로 센다. `task_id` 가 있으면 그 태스크 시계는 응답으로 친다 |

- `status=blocked` 는 자동 반영이든 기록만이든 사유가 비었거나 무응답 문구일 때만 사유를 쓴다. 사유는 `summary` 이고 비어 있으면 `팀원이 막혔다고 답했어요` 다. 태스크 사유는 모든 팀원에게 보이므로 답장 원문(`evidence_quote`)을 쓰지 않는다. PM 이 쓴 사유는 둔다.
- 같은 `attempt` 재전송은 200 이고 아무것도 다시 하지 않는다. `attempt` 가 다르면 409 다.
- 답장을 받은 뒤(PM 이 고르면 고른 뒤) 10분 안에 결과가 없으면 BE 가 판단을 끝내고 PM 에게 한 번 알린다. 그 뒤 온 결과는 200 으로 받아 기록만 하고 반영·승인·알림은 없다.
- PM 이 태스크를 고른 뒤의 재판단은 `unknown` 을 버린다. 이미 적은 태스크·필드는 다시 반영하지 않는다.
- PM 이 태스크를 고른 재판단은 대기 카드에 이미 있는 값이어도 줄을 알림에 넣는다. 고른 PM 이 결과를 기다린다.
- 재판단은 더 새 답장이 그 태스크를 말한 줄(`applied`·`proposed`·`skipped`·`noted`, 말하지 않은 후보에 붙는 `field=none` 은 제외)을 남겼으면 자동 반영하지 않고 PM 승인 요청으로 보낸다.
- PM 이 태스크를 고르면 고르지 않은 태스크의 시계는 재판단 결과와 상관없이 남은 시간부터 다시 센다. 재판단이 실패하거나 시간이 지나도 응답으로 치는 것은 고른 태스크뿐이다.

| 코드 | HTTP | 봇 처리 |
|---|---|---|
| `REPLY_JUDGMENT_NOT_FOUND` | 404 | 버리고 넘어간다 |
| `REPLY_JUDGMENT_STALE` | 409 | 버리고 넘어간다. 다시 맡긴 판단이나 PM 이 고른 뒤의 결과다 |
| `INVALID_REQUEST` | 400 | 후보 밖 태스크, 값이 잘못된 줄. 아무것도 반영하지 않는다. 봇은 같은 attempt 로 `failure_reason: "INVALID_REQUEST"` 를 한 번 보내 PM 에게 바로 알린다 |

## 오류 코드 요약

| 코드 | HTTP | 나오는 경로 | 봇 처리 |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | 봇 경로 전부 | 실패 (stage 는 로그만 남기고 계속) |
| `MEETING_NOT_FOUND` | 404 | end, stage, fail, sources, extractions, uploads claim·file·speakers·resume | 실패 (stage 는 로그만 남기고 계속) |
| `WORKSPACE_NOT_FOUND` | 404 | tasks/similar, members/names | 실패 |
| `WORKSPACE_MISMATCH` | 400 | extractions | 실패 |
| `MEETING_ALREADY_ENDED` | 409 | end, fail, uploads claim·speakers·resume | 지금 상태로 보고 계속 (claim이면 다음 회의로) |
| `MEETING_PROCESSING_IN_PROGRESS` | 409 | uploads claim | 이미 가져갔으니 다음 회의로. 내 재시도라면 이어서 처리 |
| `UPLOAD_NOT_CLAIMED` | 409 | uploads speakers | AI 는 실패(diarize)로 보고하고 로컬을 지운다 |
| `SPEAKERS_ALREADY_REPORTED` | 409 | uploads speakers | 다른 내용의 라벨이 이미 저장됨. 재전송하지 않고 지정 결과 조회로 넘어감. `details.labels`가 내 라벨과 다르면 어긋난 것 |
| `SPEAKERS_NOT_ASSIGNED` | 409 | uploads resume | 아직 지정 전. 다음 조회 때 다시 |
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

- Backend: `app/api/meetings.py`, `app/api/sources.py`, `app/api/similar_tasks.py`, `app/api/extractions.py`, `app/api/integrations.py`의 `get_discord_guild_workspace`, `app/api/bot_lookups.py`(`chat-cursor` 포함), `app/api/integrations.py`의 `list_bot_chat_channels`, `app/services/chat_channel.py`, `app/schemas/integration.py`, `app/api/approvals.py`(채팅 이력 출처), `app/api/workspaces.py`(업로드 가드), `app/api/uploads.py`, `app/services/speaker_assignment.py`, `app/services/meeting_stage.py`, `app/api/deps.py`의 `require_service_token`, `app/schemas/meeting.py`, `app/schemas/member.py`, `app/schemas/source.py`, `app/schemas/task.py`, `app/schemas/workspace.py`, `app/schemas/upload.py`, `app/services/upload_storage.py`, `app/api/bot_messages.py`, `app/services/messages.py`, `app/schemas/message.py`
- AI: `ai/capture/handoff.py`의 `BeClient`(`report_stage`, `STAGE_TIMEOUT_S`), `Handoff`(`report_stage`), `from_env`, `ai/capture/recorder.py`의 `process_session`(`begin`), `ai/draft/reminder_draft.py`의 `draft_reminder`, `ai/capture/dm.py`의 `DmCog`
