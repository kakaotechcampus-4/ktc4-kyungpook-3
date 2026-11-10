# 백엔드 ↔ AI(녹음 봇) 계약

디스코드 녹음 봇이 회의를 백엔드에 넘길 때 쓰는 API를 현재 코드 기준으로 정리한다. 웹 화면이 쓰는 API는 [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md)에 있고 여기서 다시 적지 않는다.

- 제공자: Backend (`backend/app/api/`)
- 소비자: AI 녹음 봇 (`ai/capture/handoff.py`의 `BeClient`·`Handoff`, 판단 파이프라인 `ai/judge/pipeline.py`). [웹 업로드 가져가기](#웹-업로드-가져가기)의 소비자는 AI 쪽 업로드 처리 워커(`ai/capture/worker.py`)다. [회의 요약](#회의-요약)은 AI `capture/summary_sweep.py`가 소비한다(#560)
- 기준: 2026-10-08 develop 코드 대조. 봇 회의 쓰기 경로의 서비스 토큰은 2026-10-09 #179 변경 코드로, 추출 등록의 auto 판단 키는 2026-10-16 #232 변경 코드로 다시 대조했다. 웹 업로드 가져가기는 2026-10-14 #219 브랜치 코드로, 화자 지정 경로(speakers·assigned·resume)는 2026-11-02 #266 브랜치 코드로, 처리 단계 보고(`PATCH /meetings/{meeting_id}/stage`)는 2026-11-05 #381 브랜치 코드로 대조했다. 라벨 보고 재전송과 지정 대기 만료는 2026-11-06 #438 에서 develop 코드로 다시 대조했다. 회의 요약 경로는 2026-11-07 #462 브랜치 코드로, 승인 대기와 채팅 요약은 2026-11-10 #605 브랜치 코드로 대조했다
- 합의 근거: 인계 방식은 [AI 결정 0009](../../../ai/docs/basis_for_decision/member/2026-09-19-0009-bot-hands-off-to-be-api.md), 발화 저장은 [AI 결정 0017](../../../ai/docs/basis_for_decision/member/2026-10-05-0017-transcript-sources-stage.md)에 AI 쪽 기록이 있다. 이 문서는 그 이후의 필드·오류 세부를 코드에서 읽은 것이며, 별도 합의 문서가 없는 항목은 구현 사실로만 적는다.

## 계정 탈퇴의 개인정보 정리 (#575, 2026-11-09)

계정 탈퇴의 웹 API는 [FE 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md#계정-탈퇴와-정리-상태-575-2026-11-09)에 있다. 이 절은 현재 BE·AI 생산자와 소비자 코드의 규약이며 운영 배포 완료나 공급사의 원격 삭제 확인을 뜻하지 않는다.

| 요청 | 입력과 `data` |
|---|---|
| `POST /bot/privacy-cleanups/claim` | X-Service-Token, 빈 본문. `{item:null}` 또는 `{item:{cleanup_id,workspace_id,identity_epoch,member_ids,meeting_ids,message_ids,guild_ids,delete_workspace,claim_token,lease_until}}` |
| `POST /bot/privacy-cleanups/{cleanup_id}/ack` | X-Service-Token, `{claim_token}`. `{cleanup_id,complete}` |

claim은 SHA-256으로 저장한 토큰과 120초 임대를 사용한다. 만료 후 새 claim은 이전 토큰을 무효화한다. 같은 완료 토큰의 ack 재시도는 수렴하며 토큰 불일치·만료는 409 PURGE_CLAIM_EXPIRED다. claim_token은 정리 작업의 확인 용도이고 개인정보를 조회하는 키가 아니다.

정리 행은 User·Workspace의 생존에 의존하지 않는다. selector에는 익명 Member·회의·메시지 UUID를 사용한다. guild_ids는 개인 Discord 사용자 ID가 아니라 과거 녹음 탐색에 필요한 공동 공간 리소스 ID이며 AI 확인 뒤 지운다. 개인 이름·이메일·개인 Discord ID·토큰을 정리 큐에 복사하지 않는다.

공동 공간은 정확히 연결된 Member의 프로필·구조화 화자·별칭·파일명·캐시 사본을 정리하고 음성 바이트·공동 본문·다른 사람의 메타데이터는 보존한다. 단독 공간은 진행 중 회의와 BE ID 없는 로컬 capture까지 포함해 해당 공간의 파일을 정리한다. 옛 session의 재생성 금지 표식은 같은 guild에 새로 만든 Workspace의 capture를 막지 않는다.

AI는 writer·manifest·outbox·chat·DM 잠금과 처리 세대를 확인하고 실제 로컬 정리가 성공한 뒤에만 ack한다. 실패·살아 있는 writer·소유 근거가 없는 공유 legacy 자료·구조화 화자 자료가 없는 과거 markdown은 완료 ack하지 않는다. backend는 기존 기본 10초 회의 정리 워커에서 저장소 삭제를 재시도하므로 AI가 중단돼도 backend 파일 재시도는 계속된다. backend와 AI가 모두 끝났는지는 웹 영수증 cleanup_status가 최종 기준이다.

Workspace.identity_epoch는 탈퇴 시 증가한다. 서비스 쓰기는 현재 명단·claim의 세대를 X-Privacy-Epoch로 전달한다. 탈퇴가 없던 초기 세대 0은 기존 클라이언트의 무헤더 요청을 허용하지만, 세대가 증가한 공간의 누락·불일치는 409 PRIVACY_VERSION_CHANGED와 details.identity_epoch를 반환한다. 사용자 세션 쓰기는 이 헤더 대신 현재 권한과 공간 상태를 검사한다.

guild/workspace 조회, 전사 명단 조회, 업로드·DM·초안·답장 판단 claim은 해당 snapshot의 identity_epoch를 제공한다. AI는 작업 시작 시 세대를 고정하며 최신 조회를 했다는 이유로 이미 계산한 옛 payload에 새 세대만 붙이지 않는다. in-flight 판단·업로드 결과의 저장도 고정된 세대로 판정한다. 단독 삭제 공간과 삭제 회의의 쓰기 거절은 기존 리소스 오류 규약을 따른다.

임의 본문·음성 익명화, 이미 외부 게시된 결과 회수와 호스팅 diarizer 공급사의 데이터 보관·삭제는 이 로컬 정리 프로토콜의 완료 범위로 추정하지 않는다.

## 명시적 회의 삭제와 재처리 계보 (#576, 2026-11-09)

사용자는 회의 원문·회의록·추출·근거 삭제와 기존 태스크 보존을 확정했다. 혼합 승인 대기 카드는 남은 회의 기여로 재구성한다. 웹 삭제 API는 [FE 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md#회의-삭제와-보존-태스크-576-2026-11-09)에만 정의한다. 이 절의 추가 HTTP 형식은 현재 구현이며 운영 배포를 검증한 기록은 아니다.

`POST /meetings`는 선택 필드 `replaces_meeting_id: string`을 받는다. 실패한 회의를 재처리할 때 이전 ID를 보낸다. 서버는 같은 workspace·source인지 확인하고 원본 root를 잠근다. `manual_upload`의 이 생성 경로는 허용하지 않는다. 같은 이전 ID의 요청을 반복하면 이미 만든 동일 자식 회의를 반환한다. 이전 ID 또는 root가 삭제되었으면 410 `MEETING_DELETED`다. AI는 네트워크 오류나 거절 뒤 이전 ID를 지우고 연결 없는 새 회의로 우회하지 않는다.

새 AI는 회의 생성에 `X-Meeting-Lineage-Version: 1`을 보낸다. 서버 삭제 gate가 켜져 있을 때 이 버전이 없는 Discord 생성은 409 `MEETING_CLIENT_UPDATE_REQUIRED`다. gate가 꺼진 준비 배포에서도 구 클라이언트가 만든 Discord 회의는 검증되지 않은 계보로 남는다. 과거 매니페스트의 `be.replaced`는 DB migration만으로 복구되지 않으며 [운영 활성화 절차](../../../deploy/README.md#회의-삭제-활성화-576)를 따른다.

서버는 `recording_root_id`, 유일한 `replaces_meeting_id`로 계보를 보관한다. 삭제도 같은 root를 잠근다. 재처리가 먼저 시작되어 활성 자식이 있으면 삭제는 409이며, 삭제가 먼저면 새 자식 생성은 410이다. 삭제된 회의의 source·추출·종료·단계·실패·업로드 claim/file/speakers/resume 요청도 410으로 종결한다. 봉투 없는 404는 삭제 신호가 아니므로 로컬 데이터를 지우지 않는다.

봇 파일 정리는 `X-Service-Token`으로 인증한다.

| 요청 | 입력 | `data` |
|---|---|---|
| `POST /bot/meeting-purges/claim` | 빈 객체 | 작업이 없으면 `null`, 있으면 `{meeting_id, claim_token, lease_until}` |
| `POST /bot/meeting-purges/{meeting_id}/ack` | `{claim_token}` | 웹 삭제 API와 같은 receipt. `deleted_meeting_ids`는 계보 전체이고 `cleanup_status`도 계보 전체의 BE·AI 완료를 계산 |

- claim lease는 120초다. 서버에는 토큰 hash만 저장한다. 만료되거나 새 claim으로 교체된 ack는 409 `PURGE_CLAIM_EXPIRED`다. 토큰을 로그에 남기지 않는다.
- AI는 완료된 `handed_off` manifest도 찾아 녹음·업로드 사본·전사 출력·임시 manifest를 정리한다. `.deleted`에는 ID만 남겨 intake·복구·재시작의 재생성을 막는다.
- 업로드 writer와 manifest 처리 lock을 함께 사용한다. 다른 작업이 파일을 쓰고 있거나 unlink가 실패하면 ack하지 않는다. 파일 부재와 쓰기 종결을 확인한 뒤 ack한다.
- purge는 restart·upload writer 잠금과 발견한 모든 manifest 잠금을 먼저 확보하고 다시 읽은 뒤 ID로 대상을 고른다. 새 서버 ID가 아직 저장되지 않은 active writer도 완료를 보류한다. 다른 회의가 처리 중이어도 정리가 늦어질 수 있다.
- 새 STT 트랙 출력은 세션별 이름을 사용한다. 과거 공유 이름의 cache는 소유권을 구분할 수 없어 삭제 대상 원문 제거 때 다른 회의의 같은 cache도 무효화될 수 있다. 다른 회의의 통합 전사와 새 세션별 출력은 보존한다.
- BE 파일 정리 실패도 pending으로 유지하고 재시도한다. `MEETING_PURGE_INTERVAL_SECONDS` 기본값은 10초이고 0 이하이면 BE 주기 작업을 끈다. AI 워커 중단 중에도 DB 원문은 숨기지만 receipt는 complete가 되지 않는다.
- 이미 외부에 전송한 Notion·Discord 결과와 사용자에게 전달된 바이트의 회수는 이 규약의 범위가 아니다. 기존 자동 보관 주기 변경과도 별개다.

코드 근거는 [BE 삭제 서비스](../../app/services/meeting_deletion.py), [purge API](../../app/api/meeting_purges.py), [AI purge](../../../ai/capture/meeting_purge.py), [AI handoff](../../../ai/capture/handoff.py)다. 검증 결과와 PostgreSQL 실행 한계는 [M3 결과](../plan/m3/result.md)에 기록한다.

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
| 워커 바퀴 끝(회의 처리와 별개) | [회의 요약](#회의-요약)의 claim, summary-input, PUT | 변화 없음 | `X-Service-Token` |

봇은 회의 상세 `GET /meetings/{meeting_id}`를 부르지 않는다.

## 인증

- `X-Service-Token`: 봇이 부르는 경로 전부(회의 생성·종료·단계 보고·실패, 발화 저장, 유사 task 검색, 추출 등록, 서버로 워크스페이스 찾기, 전사 힌트 조회, 워크스페이스 용어 목록 조회·추가, 채팅 수집 대상 목록, 리마인드 DM 다섯 경로)와 웹 업로드 가져가기 여섯 경로에 건다 (`deps.require_service_token`). 헤더 값을 서버의 `SERVICE_TOKEN`과 비교하고, 없거나 다르면 401 `UNAUTHENTICATED`다. 서버에 `SERVICE_TOKEN`이 비어 있으면 모든 요청을 거절한다. 사용자 세션은 서비스 토큰을 대신하지 못한다.
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
- 요청: `{ "stage": "stt" | "sources" | "extract" | "handoff", "stt"?: {"done": int, "total": int} }`. 네 단계 값은 AI의 `failed_stage` 이름과 같다. 다른 값이나 빠진 값은 400 `INVALID_REQUEST`.
  - `stt`(선택, #483): 전사 진행. `stage`가 `stt`일 때만 보낼 수 있고, 다른 단계에 실으면 400 `INVALID_REQUEST`다. `total`은 1 이상 2147483647 이하, `done`은 0 이상 `total` 이하의 정수다(bool·문자열은 400). 현재 AI 구현의 단위는 입력 WAV 트랙이다. `total`은 이번 세션 입력 WAV 수로 고정하고, `done`은 해당 트랙의 일반 전사·추가 클립 전사·지연 묶음 처리와 결과 수거를 끝낸 수다. 같은 화자의 WAV도 서로 다른 입력 트랙으로 센다. 무음·필터 탈락·최종 실패 결과도 처리 완료에 포함하므로 성공률이나 회의록 저장 완료를 뜻하지 않는다. BE는 두 숫자를 그대로 저장해 보여 준다.
  - 구현 상태: BE는 #483 A안으로 구현됐고, AI도 선택 `stt`를 보고한다. 기존 BE 규약은 유지하며 입력 WAV 단위·아래 호출 정책은 이번 AI 구현 선택이다. FE의 수치·경과 시간 표시는 별도 작업이다. `stt`를 보내지 않는 요청은 이전과 똑같이 동작한다.
- `data`: `{meeting_id, status, processing_stage, stt, applied}`. `processing_stage`는 이 요청을 처리한 뒤 저장된 값이고 아직 보고가 없으면 `null`이다. `stt`는 저장된 전사 진행이고 `stt` 단계가 아니거나 진행을 받지 않았으면 `null`이다. 회의 상태와 관계없이 저장값을 그대로 보이므로, `applied=false`인 늦은 보고에도 남아 있는 값이 올 수 있다(상세 `processing`은 처리 중일 때만 보인다).
- 순서는 `stt` < `sources` < `extract` < `handoff`이고 단계는 앞으로만 간다. 건너뛰어도 된다(`extract`부터 재개하면 `extract`, `handoff`만 온다).
- 다음은 오류가 아니라 200 `applied=false`이고 저장값을 바꾸지 않는다: 회의가 `processing`이 아닐 때(`created`·`awaiting_speakers`·`done`·`failed`), 같은 단계를 다시 보낼 때, 이미 보고한 단계보다 앞선 단계일 때. 반영할 때만 `applied=true`이고 단계와 갱신 시각을 함께 저장한다. 판정과 쓰기는 조건부 UPDATE 한 문장이라 늦게 도착한 보고가 앞선 단계를 덮지 않는다.
- 전사 진행 규칙(#483):
  - 단계가 앞으로 바뀔 때 진행도 요청 값으로 덮는다. 요청에 `stt`가 없으면 진행은 비워진다. 그래서 `sources` 이후에는 진행이 늘 `null`이다.
  - 같은 `stt` 단계를 `stt`와 함께 다시 보내면 진행만 바꾸고 단계 시작 시각(`processing_stage_at`)은 그대로 둔다. 진행 값이 저장값과 다를 때만 `applied=true`이고, 같으면 `applied=false`다.
  - 같은 `stt` 단계를 `stt` 없이 다시 보내면 지금처럼 `applied=false`이고 저장된 진행을 지우지 않는다.
  - `done`이 줄어도 그대로 덮어쓴다. 재전사나 재시작 때 0부터 다시 오는 경우를 막지 않기 위해서다. 그래서 봇은 진행을 한 번에 하나씩 순서대로 보내야 한다(앞 요청의 응답을 받은 뒤 다음 요청).
  - 중간 값을 건너뛰어도 된다. 진행은 마지막에 저장된 값만 보이므로, 봇이 최신 값만 한 스레드로 순서대로 보내도 된다(보낸 값마다 응답을 받은 뒤 다음 값).
  - 같은 회의에서 `stt` 단계를 다시 시작하면 `{"stage": "stt"}`만 보내서는 이전 진행이 새 진행이 올 때까지 남는다(위 규칙대로 지우지 않는다). 다시 시작할 때는 `{done: 0, total: N}`을 먼저 보내기를 권한다. `total`이 0이면 `stt`를 싣지 않는다(`total`은 1 이상).
  - 진행 보고도 판정과 쓰기를 조건부 UPDATE 한 문장으로 한다. `stt` 다음 단계로 넘어간 회의나 `processing`이 아닌 회의에는 반영하지 않는다.
  - 진행 보고는 업로드 3시간 만료 시계와 관계없다.
  - AI 호출 빈도: 처리 소유 스레드가 시작 `0/N`과 최종 `N/N`을 보내고, 트랙 완료 사건의 중간 보고는 마지막 시도부터 2초 이상 지났을 때 보낸다. 실패한 시도도 간격 계산에 포함하며 별도 타이머·백그라운드 전송기는 없다. 한 시도에서 수치 요청은 최대 `N+1`번이고 최종값은 간격 제한을 적용하지 않는다. 중간 값은 생략될 수 있으며 남은 시간은 추정하지 않는다.
  - AI 실패 줄 재시도도 전체 입력 WAV 수 `N`을 유지한다. 이번에 재시도할 줄이 없는 트랙은 이미 처리한 것으로 세고, 대상 트랙은 마지막 재시도 줄의 결과를 수거한 뒤 센다. 재시도 시작은 `0/N`으로 초기화한다. 입력이 비면 수치를 만들지 않는다. 이미 전사가 끝난 체크포인트를 건너뛰는 실행은 STT 수치를 보내지 않는다.
- 없는 회의는 404 `MEETING_NOT_FOUND`. 새 오류 코드는 없다.
- 회의 상세 응답(`GET /meetings/{meeting_id}`)과 `/fail` 응답에는 `processing`이 있다(#483). 회의가 `processing`일 때만 `{stage, stage_at, stt}` 객체이고, 그 밖의 상태(`created`·`awaiting_speakers`·`done`·`failed`)에서는 `null`이다. `stage`·`stage_at`은 저장된 단계와 그 단계가 시작된 시각이고 보고 전이면 `null`, `stt`는 `stage`가 `stt`이고 진행을 받았을 때만 `{done, total}`이다. 그래서 `/fail` 응답의 `processing`은 늘 `null`이다. 목록 API 에는 없다. 이 필드와 별개로 `progress`도 단계 값을 반영한다. 보고가 없으면 지금처럼 데이터만으로 판정한다. 아래 단계는 "그 단계가 시작됐다"는 뜻이다.

  | progress 키 | true가 되는 때 |
  |---|---|
  | `audio_merged` | `stt` 이후이거나 발화가 있을 때 |
  | `transcribed` | `sources` 이후이거나 발화가 있을 때 |
  | `extracted` | `handoff` 이후이거나 항목이 있는 추출이 있을 때 |

  회의 상세 `GET /meetings/{meeting_id}`와 `PATCH /meetings/{meeting_id}/fail`의 응답 `progress`가 같은 식을 쓴다. 전사 진행은 `progress`에 섞지 않고 `processing.stt`로만 보인다.
- 봇 동작(`Handoff.report_stage`): `be.meeting_id`가 없으면 부르지 않고, 타임아웃 3초(`STAGE_TIMEOUT_S`, requests 에 숫자 하나로 주므로 연결과 읽기에 각각 3초)로 한 번만 보낸다. 일반 전송 오류는 로그만 남기고 삼키며 매니페스트에 쓰지 않는다. `MEETING_DELETED`는 `MeetingEnded`로 처리 소유 스레드에 전파해 종결한다. 수치 보고에서 삭제를 발견하면 전사 산출물 저장·발화 저장·추출·추가 `/fail`로 진행하지 않는다. 대기 중인 모델 작업은 취소하고 이미 실행 중인 호출은 끝날 때까지 기다린다. 로컬 삭제는 기존대로 세션 claim 해제 뒤 수행한다. 호출은 `process_session`의 단계 시작(`begin`)에서 진행 표시 뒤, AI 쪽 단계 시간 기록(ops) 단계를 열기 전에 하므로 단계 시작 보고 시간은 ops 단계 시간에 들어가지 않는다. 전사 도중의 수치 보고 시간은 STT ops 시간에 포함된다. BE 장애 때 단계 시작과 전사 결과 수거가 늦어질 수 있다. 3초는 연결과 읽기에 각각 걸리는 값이고 합계 상한은 보장하지 않는다(응답이 조금씩 오면 읽기 대기가 이어지고, 주소가 여러 개면 연결도 주소마다 걸리며, DNS 조회 시간은 타임아웃에 들어가지 않는다). 디스코드 회의에서 처리 도중 BE 회의가 새 회의로 바뀌면(BE 가 failed 로 닫은 회의에 `end`를 다시 부를 때 봇이 새 회의를 만들고 옛 ID 를 `be.replaced`에 남기는 경우. 업로드 회의는 `end`가 새 회의를 만들지 않아 바뀌지 않는다) 그 단계 보고는 옛 회의로 가 `applied=false`가 되고 새 회의는 그 단계를 받지 못한다. 이때 `progress`는 데이터 판정으로 돌아가 표시만 조금 늦어진다.
- 배포 순서: BE를 먼저 배포한다. 어느 쪽이 먼저 나가도 깨지지 않는다. BE가 먼저면 봇이 아직 보고하지 않아 `progress`는 지금처럼 데이터로 판정한다. 봇이 먼저면 이 경로가 없는 BE는 오류를 돌려주고 봇은 그 오류를 삼켜 처리를 계속한다. 이때 BE 쪽 진행 표시만 앞당겨지지 않는다.
- DB: `meeting.processing_stage`(문자열 16자)와 `processing_stage_at`(시각)을 nullable로 추가했다(마이그레이션 `a3d7f91c5e28`). 전사 진행은 `processing_stt_done`·`processing_stt_total`(정수, nullable, 마이그레이션 `d6e1b4a8c297`, #483)이다. 기존 회의는 `null`이다.

### `PATCH /meetings/{meeting_id}/fail` → 200

- 요청: `{ "failed_stage": "stt" | "extract" | "handoff" … }` (서버는 문자열만 확인)
- BE 도 같은 상태 전이로 멈춘 업로드 회의를 스스로 failed 로 바꾼다(sweeper, 아래 "웹 업로드 가져가기"). 이때 `failed_stage`는 `diarize`(처리 중에 멈춤), `speaker_assignment_expired`(화자 지정 기한 지남), `upload_unclaimed`(AI 가 24시간 동안 가져가지 않음) 중 하나다.
- `data`: 회의 상세 모양 `{meeting_id, workspace_id, title, status: "failed", started_at, ended_at, extraction_id: null, failed_stage, progress, processing: null}`
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
{ "text": "…", "k": 3, "min_similarity": 0.4, "include_pending": false }      // k 1~20, min_similarity 0.0~1.0, include_pending 기본 false(불리언만 받는다). 봇은 text만 보내 기본값을 쓴다
// data
{ "items": [
  { "task_id": "…" | null, "approval_id": "…" | null, "notion_page_id": "…" | null, "title": "…", "content_snippet": "",
    "assignee_member_id": "…" | null, "due_date": "YYYY-MM-DD" | null, "status": "…" | null,
    "similarity": 0.83, "updated_at": "…" }
] }
```

- 항목 필드는 AI `NotionCandidate`(`ai/shared/schemas.py`)와 이름을 맞춘다. `content_snippet`은 지금 항상 빈 문자열이다.
- 같은 워크스페이스에서 임베딩이 있는 task만 유사도 순으로 돌려준다.
- `include_pending`이 true이면 승인 대기 중인 task_create 요청을 후보에 합친다(합의됨 #141). task 상위 `k`개에 pending 최대 2개를 더해 유사도 내림차순(같으면 task가 앞)으로 돌려주고, pending 검색에도 같은 `min_similarity`를 쓴다. false(기본)이면 지금과 같다.
- pending 후보는 `task_id`·`status`·`notion_page_id`가 null이고 `approval_id`가 있다. `title`·`due_date`·`assignee_member_id`는 요청 payload에서 읽고(날짜·담당자 형식이 틀리면 null), `updated_at`은 요청 생성 시각이다. task 후보는 `approval_id`가 null이다.
- AI는 BE 합치기(action=merge, [추출 등록](#추출-등록-post-extractions--201)) 배포 뒤에 `include_pending`을 켠다. pending 후보와 같은 일이면 `action: "merge"`와 그 후보의 `approval_id`를 `target_approval_id`로 보낸다. 모르는 action은 400이라 BE를 먼저 배포한다.
- 없는 워크스페이스는 404 `WORKSPACE_NOT_FOUND`. 임베딩 호출 실패는 빈 목록이 아니라 502 `EMBEDDING_UNAVAILABLE`이다. 봇도 실패를 빈 목록으로 바꾸지 않는다.

## 추출 등록 `POST /extractions` → 201

```jsonc
// 요청
{
  "meeting_id": "…", "workspace_id": "…",
  "transcript_path": "…" | null, "model_name": "…" | null,
  "items": [ {
    "action": "create" | "update" | "merge",  // 기본 create. merge 는 승인 대기 카드에 합친다(#141)
    "target_task_id": "…" | null,             // update일 때 수정할 task
    "target_approval_id": "…" | null,         // merge일 때 합칠 승인 대기 카드(유사 검색 후보의 approval_id). 36자 이하
    "task_title": "…" | null,                 // create·merge면 필수
    "task_confidence": 0.0 | null,            // legacy만 보낸다. 보내지 않으면 null(측정 안 함)
    "assignee_raw": "…" | null, "assignee_type": "first" | "second" | "thirdname" | "thirdpronoun" | "thirdrole" | "group" | "none" | null,   // BE가 저장한다. 그 밖의 값은 NULL로 저장(요청은 받음)
    "due_date": "YYYY-MM-DD" | null, "due_raw": "…" | null, "due_confidence": 0.0 | null,
    "due_cleared": true | false,              // update만. 대상 task의 마감을 없애자는 결정. 생략하면 false. create·merge에 오면 400 없이 무시한다(#624)
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
| 요약 표시 | 선점에 성공한 요청이 같은 트랜잭션에서 [요약 대기열](#회의-요약)에 줄 세운다. 출처와 상관없이 발화가 한 줄이라도 있으면 표시하고, 승인을 기다리는지는 claim 이 본다(#605). 요청과 응답은 그대로다 |
| 멱등 | 이미 `done`이고 추출이 있으면 기존 `extraction_id`와 항목 수를 그대로 돌려준다. 봇의 복구 재전송이 중복을 만들지 않는다 |
| 상태 오류 | `processing`이 아니면 409 `MEETING_NOT_PROCESSING`. 회의가 없으면 404 `MEETING_NOT_FOUND`, 워크스페이스가 다르면 400 `WORKSPACE_MISMATCH` |
| 담당자 | `assignee_type`이 `first`면 화자로 팀원을 찾고, 그 외에는 `assignee_raw`를 별칭으로 매칭한다. 별칭은 "님"·조사를 뗀 후보를 긴 것부터 찾아 처음 걸린 후보로 판정하므로(#459) AI는 원문("하은이가", "지민님", "환 님이")을 그대로 보내도 된다. 후보 규칙은 AI 평가 도구(`_name_candidates`)와 같다(#522 에서 AI 가 맞춤. 바꾸면 둘 다 바꾼다). 규칙은 공백을 한 칸으로 줄이고 후보마다 앞뒤 공백을 지우며, 조사를 떼고 "이"로 끝나면 "이"를 한 번 더 뗀 것도 후보로 두고("하은이는" → 하은이는, 하은이, 하은), "님"처럼 "씨"·"분"도 떼며("민수 씨" → 민수, "디자이너분이" → 디자이너, "분"은 #607 리뷰), 호칭을 뗀 뒤에도 "이"를 한 번 더 뗀다("하은이님이" → 하은). 탈퇴한 팀원의 별칭은 보지 않는다. 한 글자 별칭으로 찾은 담당자는 확인 필요로 두어 auto 가 되지 않는다. 1인칭 화자는 아래 순서로 정한다. ① `evidence_speaker_member_id`가 있으면 그 팀원이다. 이 워크스페이스의 탈퇴하지 않은 팀원이 아니면 uid를 못 찾은 것과 같게 처리하고(`not_found`, `assignee_hint`는 그 ID) ②③으로 넘어가지 않는다. ② `evidence_speaker`(Discord uid)가 있으면 그 uid로 `Member.discord_user_id`를 찾는다. ③ 둘 다 없고 대표 근거 발화(아래 근거 행)가 `evidence_seqs` 중 가장 큰 seq(결론 발화)일 때만 쓴다. 그 발화의 `member_id`가 이 워크스페이스의 탈퇴하지 않은 팀원이면 그 팀원이고, 아니면 그 발화의 `speaker_discord_user_id`로 찾는다. 결론 발화를 찾지 못했으면 쓰지 않는다. ④ 그래도 없으면 화자가 없는 1인칭 항목이다. 화자가 없는 1인칭 항목은 `assignee_raw`를 별칭으로 찾지 않고 담당자를 언급했는데 찾지 못한 것으로 본다(게이트는 아래 create 게이트 행). 틀린 `evidence_speaker_member_id`는 그 항목만 화자를 못 찾은 1인칭으로 처리하고 다른 항목은 그대로 처리한다. 예외로 36자를 넘거나 문자열이 아닌 값은 요청 검증에서 막혀 그 항목만이 아니라 요청 전체가 400 `INVALID_REQUEST`다. AI는 BE가 준 멤버 ID만 보내므로 생기지 않는 경우로 본다. `assignee_hint`가 그 ID 문자열이라 담당자 확신도 0.0이 항목 확신도에 들어가므로, 새 항목은 judge·legacy·경로 불명 어느 쪽이든 `hold`이고 update 항목은 항상 `review`다. 화자도 `assignee_raw`도 없는 1인칭(④)은 새 항목이 judge·경로 불명이면 `hold`이지만 legacy는 확신도로 정해서 `review`가 될 수 있다. `evidence_speaker_member_id`와 `evidence_speaker`는 AI가 결론을 말한 사람으로 직접 보낸 값이라 먼저 쓴다. 대표 근거 발화는 가장 큰 seq가 빠지면 더 앞 발화(보통 일을 요청한 사람)가 되어 다른 사람을 가리킬 수 있다 |
| 근거 | `evidence_seqs`의 seq마다 이 회의의 발화(`source`)를 찾아 `evidence`(type=`task`) 한 줄씩 저장한다. 순서는 자유이고 같은 seq는 한 번만 저장한다. 이 회의에 없는 seq는 그 seq만 건너뛰고(항목마다 빠진 seq를 모아 경고 로그 한 줄) 요청은 그대로 받는다. seq가 0 ~ 2^31-1(발화 저장 API의 seq 범위) 밖이거나 항목 하나의 seq가 100개를 넘으면 400 `INVALID_REQUEST`다. 찾은 발화 중 seq가 가장 큰 것(결론을 말한 마지막 발화)이 대표 근거 발화다. 승인 요청 payload의 `evidence_quote`·`evidence_speaker`·`evidence_at_ms`·`evidence_speaker_member_id`, 별칭 판정 로그의 `source_id`, 추출 조회의 `evidence`에 쓰고, 멤버 ID·`evidence_speaker`가 없고 결론 발화(가장 큰 seq)를 찾았을 때 1인칭 담당자에도 쓴다. 하나도 못 찾으면 evidence 행을 저장하지 않고(추출 조회의 `evidence` 객체는 모든 필드가 null이다) 승인 요청 payload에 요청의 `evidence_quote`·`evidence_speaker`·`evidence_at_ms`를 쓴다. `evidence_speaker_member_id`도 이 워크스페이스의 탈퇴하지 않은 팀원으로 확인된 값이면 payload에 쓴다. 그래서 AI는 `evidence_seqs`와 세 필드(화자의 멤버 ID를 보내면 그것도)를 항상 함께 보낸다 |
| 근거 화자의 멤버 ID | 같은 근거 화자의 멤버 ID가 두 곳에 다른 이름으로 실린다. 승인 요청 payload는 `evidence_speaker_member_id`이고 추출 조회 `evidence`는 `speaker_member_id`다(`EvidenceInfo`). 값은 대표 근거 발화를 찾았으면 그 발화에 저장된 `member_id` 그대로(탈퇴한 팀원이어도, 비어 있으면 null)다. 못 찾았을 때 요청의 `evidence_speaker_member_id`를 쓰는 것은 승인 요청 payload뿐이고, 이 워크스페이스의 탈퇴하지 않은 팀원으로 확인된 값만 싣고 아니면 null이다. 근거 발화를 못 찾으면 저장된 근거(evidence 행)가 없어 추출 조회의 `evidence` 객체는 있지만 `quote`·`speaker`·`at_ms`·`speaker_member_id` 모두 null이다. 그래서 이때는 요청에 활성 팀원의 멤버 ID가 있으면 payload에는 그 값이 실리고 조회 값은 null이라 두 값이 다를 수 있다. 근거 발화를 찾았을 때는 두 값이 같다. 두 출처를 섞지 않는다. 승인 요청은 새 항목·update 항목·auto 되돌리기 세 경로가 같은 규칙이고, 되돌릴 때 근거가 없으면 null이다 |
| 잘못된 항목 | update의 대상이 없거나 다른 워크스페이스 task, create·merge의 제목이 비어 있으면 그 항목만 건너뛴다. `item_count`는 저장된 항목 수(합쳐진 merge 항목 포함) |
| merge 처리 | `target_approval_id`의 카드가 같은 워크스페이스의 승인 대기 task_create 카드면 새 카드·task를 만들지 않고 그 카드에 합친다(팀원이 직접 만든 카드도 받는다). 마감(`due_date`·`due_raw`)은 새 값이 있을 때만, `status`는 보냈을 때만 덮어쓴다(`status`는 카드에 표시용으로만 남고, 승인으로 만드는 task 는 항상 `todo`다). 담당자(`assignee_member_id`·`assignee_raw`)와 카드 gate는 `category`가 `assignee`일 때만 덮어쓴다. 이때 카드에 있던 담당자가 지워지면(담당자 표현이 없는 none·group 항목) 카드 gate 는 `hold`가 된다. 그 밖의 merge 항목은 `assignee_type`·`assignee_raw`를 보지 않는다(별칭을 찾지 않고 판정 로그도 남기지 않으며, 항목의 gate 는 `review`다. AI 는 보내지 않아도 된다). `doc_text`는 " / "로 이어 붙인다. 제목과 대표 근거는 처음 회의 것 그대로이고, 합친 항목의 근거는 payload `merged_items`에 쌓인다. 한 요청에서 같은 카드에 여러 번 합치면 항목 순서대로 덮어쓴다. 마감 지우기는 merge로 전달되지 않는다. 합친 항목의 gate는 `auto`가 되지 않고(auto면 `review`, `hold`는 그대로) judge auto 조건을 보지 않는다 |
| merge 대상을 쓸 수 없을 때 | `target_approval_id`가 없거나, 카드가 없거나, 다른 워크스페이스거나, task_create가 아니거나, 이미 승인·반려됐거나, payload가 깨졌으면 400 없이 그 항목을 create로 처리한다(새 카드). 이때 gate가 `auto`면 `review`로 내린다. 검색 뒤 PM이 먼저 승인한 경우 등이다. BE 로그에 `merge_target_unavailable`과 이유가 남는다 |
| update 처리 | 게이트·승인 생성 규칙과 `target_snapshot`의 충돌 기준값은 [Backend README 유사 task 검색과 AI 판단 접수](../../README.md#유사-task-검색과-ai-판단-접수)를 따른다 |
| update 마감 해제 | `due_date: null`은 "바꾸지 않음"이다. 대상 task의 마감을 없애자는 결정은 `due_cleared: true`로 보낸다. 대상 task에 마감이 있으면 승인 요청 payload에 `"due_date": null`을 싣고 `base_values.due_date`에 원래 마감을 남긴다. 승인하면 task 마감과 Notion 날짜가 비워진다. 마감이 없던 task면 바뀌는 것이 없다. `due_date`가 함께 오면 `due_date`를 따른다. update라 게이트는 항상 `review`다. AI는 대상 task의 마감 유무와 상관없이 결정을 그대로 보내고 BE가 등록 시점 값으로 거른다(#624). 답장 판단의 `due_clear` 줄은 지금처럼 알리기만 한다 |
| `target_snapshot.title` | 유사 검색 응답의 `title`을 그대로 보낸다. 제목을 바꾸는 값이 아니라 승인 때 대상 task가 그대로인지 확인하는 기준이다. 없거나 null이면 등록 시점의 제목을 쓴다. 필드 모양은 #185에서 AI·BE가 정했다 |
| 확신도 | `task_confidence`·`due_confidence`를 보내지 않으면 null(측정 안 함)로 저장하고 0.0(측정했는데 낮음)과 구분한다. 할 일 확신도가 null이면 항목 확신도도 null이다 |
| 추출 경로 | AI가 경로를 따로 보내지 않으므로 BE가 항목이 보낸 키로 가린다. `action`·`category`·`doc_text` 중 하나라도 보냈으면 judge, 아니고 `task_confidence`·`due_confidence`를 보냈으면 legacy, 둘 다 아니면 판별 불가다. 모든 항목이 같은 경로일 때만 추출의 `extraction_path`에 기록하고, 항목이 없거나 섞였거나 판별 불가 항목이 있으면 null이다(#201) |
| create 게이트 | 담당자를 언급했는데 BE가 한 명으로 찾지 못했으면 `hold`다. 이름으로 풀지 못해 `assignee_raw` 없이 `second`·`thirdpronoun`·`thirdrole`만 보낸 항목(원문이 없을 때만이다. `thirdrole`은 AI가 역할 원문을 `assignee_raw`로 보내므로 그 원문을 찾지 못한 것은 위 첫 문장의 "못 찾음"이다)과 화자가 없는 1인칭 항목(틀린 `evidence_speaker_member_id` 포함)도 언급했는데 찾지 못한 것으로 본다. 단 화자도 `assignee_raw`도 없는 legacy 1인칭은 `hint`가 없어 확신도 계산에서 담당자가 빠지므로 아래 legacy 기준(확신도)대로 `hold`가 아니라 `review`가 될 수 있다. 멤버 ID로 정한 화자는 확신도 1.0이라 다른 조건을 만족하면 `auto`가 될 수 있다. judge 항목은 그다음 아래 auto 조건을 모두 만족하면 `auto`, 아니면 `review`다. 경로를 가릴 수 없고 확신도도 없는 항목은 `review`, legacy는 확신도로 정한다(0.8 이상이고 담당자 확인 불필요면 `auto`, 0.5 이상 `review`, 그 아래 `hold`). 경로와 상관없이 `thirdrole` 새 항목은 `auto`가 나와도 `review`로 내린다(#459, 역할은 맡은 사람이 바뀔 수 있음). BE 환경변수 `AUTO_CREATE_ENABLED`가 꺼져 있으면(`false`·`0`·`off`·`no`, 모르는 값도 꺼짐, 기본 켜짐) 경로와 상관없이 `auto`를 `review`로 내린다. AI 요청과 응답은 그대로이고 근거 상태도 저장한다. 검증 실행(AI 의 `JEV_API_KEY`)과 자동 생성(이 값)을 따로 켜고 끈다(#382 멘토 리뷰). update는 지금처럼 항상 `review`다 |
| judge auto 조건 | `task_status`가 certain, 담당자를 언급했으면 BE가 한 명으로 확정(검증된 별칭·화자, 확신도 0.8 이상), `assignee_type`이 `second`·`thirdpronoun`·`thirdrole`이 아님, `due_status`가 certain이거나 missing이고 `due_date` 유무와 맞음(missing인데 날짜가 있거나 certain인데 날짜가 없으면 탈락), `similar_count`가 0이고 워크스페이스에 임베딩이 없는 활성 task가 없음(그런 task는 유사 검색에 잡히지 않는다. 같은 요청에서 앞 항목이 auto로 만든 task와 임베딩 API가 제목을 거절한 task도 해당)이며, 승인 대기 중인 task_create 요청 가운데 임베딩이 없는 것이 없음(`unsearched_pending_exists`. `include_pending`을 켜도 검색이 못 보는 요청이다. 빈 제목으로 건너뛴 요청은 뺀다. 같은 요청에서 앞 항목이 review로 만든 pending은 보지 않는다). `task_status`·`due_status`·`similar_count` 중 하나라도 null이면 `review`라, 이 키를 보내지 않는 AI에서는 지금 동작이 그대로다. 상태 값이 셋 중 하나가 아니면 400 `INVALID_REQUEST`, `similar_count`가 음수거나 `top_similarity`가 0~1 밖이어도 400이다(#232) |
| 근거 상태·유사 검색 값 | `similar_count`는 그 finding을 판단할 때 유사 검색 응답의 후보 수다(BE가 이미 `min_similarity` 미만을 뺀 결과). 같은 회의 앞부분 카드(pending)는 세지 않는다. `include_pending`을 켜면 BE가 준 승인 대기 후보도 센다. update 항목은 보내지 않아도 되고 보내도 게이트에 쓰지 않는다. 값은 추출 항목에 저장되고 추출 조회에 실린다 |
| 전사 오인식 의심 단어 (`asr_suspects`, 2026-11-07) | judge 새 항목에 AI가 보내는 선택 필드. `[{word, source, candidates}]`이고 `source`는 `evidence`(근거 발화)·`title`(제목)·`check_failed`(AI가 검사하지 못함), `candidates`는 발음이 가까운 업무 용어 최대 5개다. 하나라도 있으면 auto 조건에서 막는다(실제 의심 단어는 사유 `asr_suspect`, `check_failed` 는 `asr_check_failed` 로 나눠 분석기 장애와 오탐 증가를 로그에서 구별한다). AI 는 50개까지만 보낸다(게이트는 하나만 있어도 막으므로 잘라도 같다). `source` 는 문자열로 받아 AI 가 새 값을 먼저 배포해도 400 이 되지 않고, 모르는 값도 payload 에 그대로 실린다. FE 는 `evidence`·`title` 만 교정 후보로 보이고, `check_failed`(`word` 가 빈 문자열)는 "검사하지 못함"으로 따로 보인다. 빈 목록(검사했고 없음)과 null(옛 AI)은 게이트에 영향이 없다. 목록 50개·단어 100자·후보 5개를 넘거나 모양이 틀리면 400 `INVALID_REQUEST`다. hold 는 그대로이고, review·hold 승인 요청 payload 에 그대로 싣는다(확인 카드 표시는 FE 후속). AI 쪽 규칙과 측정은 [결정 기록 0051](../../../ai/docs/basis_for_decision/ai/2026-11-07-0051-asr-suspect-gate.md) |

- 담당자 종류 저장과 승인 때 별칭 학습(#459, 현재 구현): BE가 `assignee_type`을 저장해, 담당자를 못 찾은 `thirdname`·`thirdrole` 항목을 PM이 담당자를 골라 승인할 때 `assignee_raw`를 다듬어 그 팀원의 확인된 별칭으로 저장한다. 요청 모양은 바뀌지 않는다. 학습한 별칭은 전사 힌트(`GET .../members/names`의 `aliases`)에도 실린다. AI가 1인칭을 `thirdname`으로 잘못 보내도 그 말이 할 일의 주어로 쓰인 꼴이면(어간 제·저·나·내 / 저희·우리 / 본인 × 복수 들 × 주어 표지, 예: "제가"·"저도"·"저희들은") 학습하지 않는다(#502). 부사어·구("우리끼리")는 막지 않는다. 오분류를 줄이는 것은 AI 몫이다. 규칙은 Backend README의 "1인칭 거르기의 범위"에 있다. `thirdrole`도 학습한다(#522). AI는 새 할 일(create·merge) 항목에 역할 원문("BE 리더가")을 `assignee_raw`로 보내고 추측한 이름은 보내지 않으며(update 카드는 추측한 이름 우선, 없으면 원문), BE는 그 원문을 다듬은 글자("BE 리더")를 `thirdname`과 같은 조건으로 별칭으로 저장한다. `thirdrole` 새 항목은 위 create 게이트에서 계속 `auto`가 아니라 `review`다. 이 변경 전에 저장된 옛 `thirdrole` 대기 카드는 따로 거르지 않는다. 규칙은 [Backend README 승인 때 별칭 학습](../../README.md#승인-때-별칭-학습)에 있다. 합의 상태: 합의됨(#522 BE 제안, 2026-11-09 사용자 확정 — #522 설계 확정 댓글, AI·BE 같은 PR 에서 구현).
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
- `resumed_at`이 비어 있고 지정이 끝났고 회의가 `processing`일 때만 조건부 UPDATE로 기록한다. 현재 구현은 공간→회의 잠금을 먼저 얻는다. 실패 보고·sweeper도 같은 순서로 잠그므로 앞선 resume의 진행 시각을 읽은 뒤 실패 조건을 판단한다.
- 404 `MEETING_NOT_FOUND`: 없는 회의, 업로드 회의가 아님.
- 409 `MEETING_ALREADY_ENDED`(`details.status`): `done`·`failed`.
- 409 `SPEAKERS_NOT_ASSIGNED`(`details.status`): 아직 PM이 지정하지 않았다(`awaiting_speakers`이거나 지정 시각이 없다).

### 처리할 때 주의할 점

- **녹음은 결과 보고 전에 받는다.** 추출 등록으로 `done`이 되거나 실패 보고로 `failed`가 되면 BE가 커밋 뒤 녹음 폴더 제거를 시도한다. `failed`는 처리 실패이며 파일 삭제 완료를 뜻하지 않는다. 파일 잠금·I/O 오류나 커밋 직후 프로세스 종료로 남은 live failed 수동 업로드는 다음 sweeper 바퀴에서 다시 제거한다. 과거 failed 업로드의 잔존 파일도 같은 대상이다. 삭제된 회의·공간은 기존 회의 purge·탈퇴 cleanup이 맡고, 각 영수증의 완료 기준을 따른다. sweeper가 꺼져 있으면 이 재시도도 실행되지 않는다. done·DB 미등록 폴더는 이 실패 업로드 재시도에 포함하지 않는다.
- 업로드 녹음에는 Discord uid가 없다. 화자 분리 없이 전사하면 발화의 `speaker`는 null이고, 회의록 참석자는 발화에서 만들므로 비어 보인다. 업로드 참석자는 지금 `meeting_upload.attendees` 에만 있고 회의록은 이를 읽지 않는다.
- AI 가 없거나 처리 도중 멈추면 업로드 회의가 `processing`에 남아 그 워크스페이스의 업로드가 409 로 막힌다. AI가 가져간 회의와 24시간 동안 가져가지 않은 회의는 BE sweeper가 정리한다(기본 5분마다, `UPLOAD_SWEEP_INTERVAL_SECONDS`가 0 이하면 sweeper가 돌지 않아 7일이 지나도 `failed`가 되지 않는다).
  - `processing`이고 가져간 업로드: 가져간 시각·지정 시각·다시 가져간 시각·마지막 발화 저장 시각 중 가장 늦은 것에서 3시간이 지나면 `failed`(`failed_stage=diarize`). 지정 뒤에 멈춰도 같은 값이다. AI가 발화를 나눠 보내면 그때마다 3시간이 다시 시작된다.
  - `awaiting_speakers`: 라벨 보고 뒤 7일이 지나면 `failed`(`failed_stage=speaker_assignment_expired`). 3시간 규칙은 쓰지 않는다. 7일은 첫 라벨 보고가 성공한 시각(`speakers_reported_at`)부터 센다. sweeper 가 5분마다 돌아서 실제로 `failed`가 되는 때는 조금 늦을 수 있고, 서버가 멈춰 있었으면 더 늦다. 같은 내용 재전송은 이 시각을 바꾸지 않는다.
  - failed 전환이 커밋되면 그 워크스페이스의 업로드 막힘이 풀린다. 파일 삭제 성공과는 별개이며 pending으로 되돌리지 않는다(#288).
  - 정리된 뒤 AI는 `/fail`·라벨 보고·claim·resume에서 409 `MEETING_ALREADY_ENDED`(`details.status=failed`), 발화 저장에서 409 `MEETING_FAILED`를 받는다. 원본 받기는 파일이 실제로 지워지면 404이며, 제거 실패로 남아 있으면 받을 수도 있다. 실패 상태를 받은 AI는 다시 보내지 않고 로컬 파일을 지우고 끝낸다(#288).
  - `processing`이고 아직 아무도 가져가지 않은 업로드: 업로드 시각(`uploaded_at`)에서 24시간이 지나면 `failed`(`failed_stage=upload_unclaimed`, #563). 정확히 24시간은 남긴다. 24시간은 잰 값이 아니라 초기값이다. 그 전에는 `PATCH /meetings/{meeting_id}/fail`(서비스 토큰)로 풀 수 있다. claim과 sweeper는 공간→회의 잠금을 공유한다. claim이 먼저 커밋되면 잠금 뒤 새 UPDATE가 claimed_at을 읽어 만료를 건너뛴다. 만료가 먼저 커밋되면 claim은 409 `MEETING_ALREADY_ENDED`를 받는다.
  - 현재 구현은 후보 조회 후 공간→회의 잠금을 얻고, 그 뒤 새 UPDATE 문장으로 시각·상태 조건을 다시 판단한다. 앞서 완료된 화자 지정·resume·발화 저장의 진행을 반영한다. sweeper 반환 목록은 새 failed 전환 목록이며 파일 삭제 완료 영수증이 아니다. 이 경합·재시도 보완은 BE 구현이며 AI와의 추가 합의 기록은 없다.

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

봇이 전사(STT)에 이름 힌트를 걸 때 쓰는 읽기 경로와, 전사 오인식 의심 단어를 가릴 때 쓰는 워크스페이스 용어 목록이다. 팀원 이름과 용어만 돌려주고 회의 발화나 추출 내용은 돌려주지 않는다.

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

### 워크스페이스 용어 목록 (#532)

AI 는 새 할 일 제목의 명사 중 이 목록에 없는 말을 전사 오인식 의심 단어로 보고 Jev 로 확인한다(추출 등록의 `asr_suspects`). 목록에 들어가는 길은 둘이다.

1. AI 가 회의 인계 때 두 사람 이상이 말한 명사를 `POST`로 올린다.
2. PM 이 task_create 승인으로 태스크를 만들면 BE 가 그 **최종 제목**(PM 이 승인하면서 고쳤으면 고친 제목, `task_overrides.task_title`)을 승인과 같은 트랜잭션에서 제목 큐(`asr_title_queue`)에 한 줄 넣는다. BE 에는 형태소 분석기가 없으므로 AI 가 `GET`의 `pending_titles`로 받아 명사를 뽑고, `POST`의 `words`로 올리면서 `absorbed_title_ids`로 큐에서 지운다.
   - 넣지 않는 경우: 반려, 승인 처리 실패(검증 오류·`APPROVAL_CONFLICT`·`APPROVAL_CHANGED` 등으로 승인이 되돌려짐), task_update 승인, 추출 등록의 auto 생성(PM 이 확인한 제목이 아니다).

#### `GET /workspaces/{workspace_id}/asr-terms` → 200

```jsonc
// 응답 data
{
  "words": ["API", "결제", "정산"],            // 사전순(코드 포인트 순, 한글은 가나다순)
  "pending_titles": [                          // 오래된 순(created_at, 같으면 title_id), 최대 200개
    { "title_id": "3f0c…", "title": "결제 API 연동" }
  ]
}
```

#### `POST /workspaces/{workspace_id}/asr-terms` → 200

```jsonc
// 요청. 두 키 모두 선택, 없으면 빈 목록
{ "words": ["결제", "정산"], "absorbed_title_ids": ["3f0c…"] }
// 응답 data
{ "added": 1, "absorbed": 1 }
```

| 항목 | 동작 |
|---|---|
| `words` | 0~2000개. 각 단어는 앞뒤 공백을 지운 뒤 1~30자. 이미 있는 단어와 요청 안의 중복은 조용히 건너뛰고(`ON CONFLICT DO NOTHING`), 같은 요청을 다시 보내거나 동시에 보내도 오류가 없다. `added`는 새로 넣은 수 |
| `absorbed_title_ids` | 0~200개(각 36자 이하). 이 워크스페이스의 그 큐 행을 지운다. 다른 워크스페이스의 id 와 없는 id 는 무시한다. `absorbed`는 지운 수 |
| 검증 | 개수·길이·모양이 틀리면 400 `INVALID_REQUEST`이고 아무것도 바꾸지 않는다 |
| 대소문자·형태 | BE 는 앞뒤 공백 말고는 정규화하지 않는다. `API`와 `api`는 다른 단어다 |

- 합의 상태: #532 작업 지시의 모양대로 BE 가 구현했다(2026-11-08). AI 쪽 호출은 같은 PR 의 AI 변경 범위이고, 리뷰에서 합의를 확인한다.
- 현재 구현: `app/api/bot_lookups.py`의 `get_asr_terms`·`add_asr_terms`, 큐 적재는 `app/api/approvals.py`의 `_apply_approval`, 모델은 `WorkspaceAsrTerm`·`AsrTitleQueue`(마이그레이션 `9e4b2c7a1f53`).

## 리마인드 DM

PM 이 웹에서 승인한 리마인드와 PM 이 웹에서 쓴 글을 봇이 디스코드 DM 안내로 알리고 답장은 웹에서 받는 경로다. 리마인드 문구 초안을 AI 가 써 넣는 경로도 여기 있다. 웹 쪽 조작(만들기·고치기·승인·취소, 대화 조회, 웹 답장)은 [프론트엔드 대표 계약](../../../frontend/docs/contracts/frontend-api-contract.md) §5.7 에 있다.

- 합의 상태: **BE·봇·초안 워커 구현.** #310 에서 BE 와 AI 쪽 초안 모듈(`ai/draft/reminder_draft.py`)을 만들었고, #317 에서 봇의 DM 발송·수신과 초안 워커(`ai/capture/dm.py`)를 붙였다. #470 에서 PM 글을 같은 발송 경로에 태웠다. #515 에서 DM 을 웹 답장 안내로 바꿨고, 근거는 결정 0048 이다.
- 결정 근거: [결정 0034](../../../ai/docs/basis_for_decision/ai/2026-11-04-0034-reminder-and-thread-message.md), [결정 0035](../../../ai/docs/basis_for_decision/ai/2026-11-04-0035-bot-dm-local-journal-and-backfill.md), [결정 0048](../../../ai/docs/basis_for_decision/ai/2026-11-07-0048-reminder-web-reply-notice.md), FE 메시지 정책(D-174)
- 리마인드 하나는 태스크 하나 × 받는 사람 한 명이다. 같은 받는 사람·같은 발송 시각의 리마인드는 "보낼 메시지"(묶음) 하나로 모이고, PM 은 묶음 문구를 보고 승인한다. 승인된 묶음 문구는 웹 대화에 저장되고, 봇은 BE 가 가져가기 때 만든 안내를 보낸다.
- PM 이 웹에서 남의 대화에 쓴 글(`sender=pm`)은 묶음 없이 바로 발송 대기로 간다. 예약·승인·문구 틀이 없고 시계와 답장 판단을 만들지 않는다. 본문은 웹 대화에 저장하고 봇 DM 에는 공간·작성자 이름과 웹 답장 안내만 보낸다.
- 봇이 BE 를 주기적으로 불러 보낼 메시지를 가져간다. 봇이 꺼져 있는 동안 발송 시각이 된 메시지는 사라지지 않고 다음 가져가기에서 나온다.
- 디스코드에서 보내는 사람은 항상 봇이다. 봇 DM 창에 팀원이 쓴 글은 저장하지 않고 BE 에 넘기지도 않는다. 봇은 같은 사람에게 1시간에 한 번 `여기로 보낸 글은 전달되지 않아요.` 로 시작하는 웹 안내를 돌려준다. 횟수는 봇 로컬 파일로 센다.

| 시점 | 요청 | 인증 |
|---|---|---|
| 주기적으로(초안 워커) | `POST /bot/drafts/claim` | `X-Service-Token` |
| 초안을 쓴 뒤 | `POST /bot/drafts/{bundle_id}` | `X-Service-Token` |
| 주기적으로(봇) | `POST /bot/messages/claim` | `X-Service-Token` |
| DM 을 보낸 뒤(성공·실패) | `POST /bot/messages/{message_id}/result` | `X-Service-Token` |
| 갱신 전 봇만 부른다 | `POST /bot/replies` | `X-Service-Token` |

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
- 그 대화에 처음 나간 리마인드의 `delivered` 보고가 오면, 첫 리마인드 틀로 만들어 둔 승인 전 묶음을 두 번째 틀로 다시 만들고 판을 올린다. `rule`·`ai` 는 규칙 문구로 돌아가 초안을 다시 받고, 메모에 틀만 씌운 `pm` 묶음은 메모 그대로 틀만 바뀐다. PM 이 고친 글은 그대로다.
- 말투는 `style_examples` 가 있으면 그 말투를, 없으면 기본 페르소나(같은 팀 동료인 PM 이 가볍게 묻는 존댓말, 짧게, 재촉하거나 탓하지 않음)를 따른다. 초안 모듈이 이 규칙으로 프롬프트를 만든다. 인사·받는 사람 이름·PM 소개·맺음 안내는 BE 가 붙이는 틀이므로 초안은 마감을 묻는 가운데만 쓰고, `style_examples` 에 들어 있는 틀 줄은 따라 쓰지 않는다.

### `POST /bot/drafts/{bundle_id}` → 200

```jsonc
{ "draft_version": 3, "body": "'API 명세서' 마감이 11/14(토)이라 …" }   // 못 썼으면 "body": null
```

- `body` 가 null 이면 규칙 문구를 그대로 두고 초안 대기를 끝낸다.
- `body` 는 가운데만이다. BE 가 앞뒤 공백을 지우고 틀을 씌워 저장한다. 그 대화에 나간(`delivered`) 리마인드가 없으면 `안녕하세요 {팀원}님, {워크스페이스 이름} {PM}이에요.` 와 이 봇으로 보낸다는 안내, 맺음 `여기로 답장하시면 저한테 바로 전달돼요.` 를, 있으면 `{팀원}님, {PM}이에요.` 만 붙인다. PM 은 묶음의 첫 리마인드를 만든 PM, 없으면 가장 먼저 등록된 PM 이다. 조사는 PM 이름 받침에 맞추고, 마지막 글자가 한글이 아니면 `(이)에요` 다.
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
  "body": "…",                     // BE 가 만든 안내. 저장된 묶음 문구가 아니다
  "scheduled_at": "…" | null       // UTC. PM 글은 null
} ], "total": 1,
  "web_url": "https://…" }         // 끝 / 없는 웹 주소(APP_BASE_URL). 없으면 null. items 가 비어도 온다
```

- `body` 는 저장하지 않는다. 저장된 메시지 본문과 웹 푸시 미리보기는 승인된 묶음 문구 또는 PM 이 쓴 글 그대로다.
- 리마인드의 `body` 첫 줄은 `{워크스페이스 이름}에서 답장을 기다리는 리마인드가 {n}개 있어요.` 다. `n` 은 그 대화의 열린 시계와 이번 묶음의 리마인드를 합쳐 태스크로 중복을 뺀 수다. 열린 시계 중 PM 확인 대기 등으로 일시 정지된 시계(`paused_at` 있음), 지운 태스크, 끝난 태스크, 담당이 대화 주인이 아닌 태스크, 사람이 막힘을 푼 태스크는 뺀다. 태스크 없는 리마인드는 하나씩 센다. 봇이 가져간 뒤에 시계가 열릴 수 있어 이번 묶음을 직접 합친다.
- 계정이 연결된 팀원은 그다음 줄이 `웹에서 답장해 주세요.` 와 대화 링크(`{web_url}/workspaces/{workspace_id}/messages/threads/{thread_id}`)다. `web_url` 이 없으면 `웹사이트에서 답장해 주세요.` 한 줄만 싣고 BE 가 경고 로그를 남긴다.
- 계정이 없는 팀원(`member.user_id` 없음, 연결을 끊은 팀원 포함)은 대화 링크가 403 이다. 가입만으로는 팀원과 계정이 이어지지 않으므로 `웹 답장을 하려면 가입한 뒤 PM 에게 아이디를 알려 초대를 받아 주세요.` 와 `{web_url}/signup` 을 준다. `web_url` 이 없으면 링크 줄을 뺀다.

- **한 메시지는 한 번만 준다.** 가져간 메시지는 다시 나오지 않는다. 동시에 두 번 불러도 같은 메시지가 두 곳에 가지 않는다.
- 가져간 뒤 10분 안에 결과 보고가 없으면 BE 가 못 보냄(`unknown`)으로 닫고 다시 주지 않는다. 같은 DM 이 두 번 가는 것을 막으려는 것이다. 봇이 재시작하면 가져갔지만 보고하지 못한 메시지는 보내지 말고, 보냈다면 결과를 보고한다(늦은 보고는 받는다).
- 디스코드가 연결되지 않은 팀원(`discord_user_id` 없음)의 메시지는 봇에 주지 않는다. BE 가 만드는 순간 `discord_not_linked` 로 표시한다. 만든 뒤 가져가기 직전에 팀원이 탈퇴했거나 연결을 끊은 경우도 그 메시지만 같은 사유(`failed` / `discord_not_linked`)로 닫고 봇에 주지 않는다. 같은 응답의 다른 메시지는 그대로 준다.
- 디스코드 DM 은 한 통에 2,000자까지다. BE 는 길이를 자르지 않으므로 넘으면 봇이 나눠 보낸다.
- PM 글의 `body` 는 쓴 글이 아니라 안내다. 첫 줄은 `{공간 이름} {PM 이름} PM 이 메시지를 보냈어요.` 이고 이후 줄은 위와 같은 계정 연결 여부별 웹 답장 안내다. 계정이 없는 받는 사람에게는 대화 링크 대신 초대 요청과 가입 주소를 준다. 답장을 웹 대화로만 받기로 해서(#515) 본문은 DM 으로 나가지 않는다. 작성자를 찾을 수 없으면 이름을 뺀다. 안내는 가져갈 때 만들고 저장하지 않는다. PM 글에는 리마인드 개수 문구를 붙이지 않는다.

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

지금 봇은 이 경로를 부르지 않는다. 갱신 전 봇을 위해 남겨 둔다. 팀원이 봇 DM 창에 쓴 글을 대화에 넣는다.

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
  2. 그 DM 창에서 이 글 바로 앞에 나간 봇 DM 의 워크스페이스. 리마인드와 PM 글 안내를 모두 뜻한다. 그 DM 이 PM 글 안내이고 답장 기능을 쓰지 않았으며 나간 재촉의 시계가 열린 워크스페이스가 하나면 그 워크스페이스로 간다. 두 글의 시각은 보고 받은 시각이 아니라 디스코드 메시지 id(snowflake)에 든 보낸 시각으로 비교한다. 결과 보고는 답장보다 늦게 올 수 있으므로, 봇이 가져갔지만 아직 보고하지 않은 메시지(10분 시간 초과로 닫힌 것 포함)는 가져간 시각에 나간 것으로 본다. 이 글의 id 가 숫자가 아니면 `sent_at` 을 쓴다
  3. 봇이 가장 최근에 DM 을 보낸 워크스페이스(못 보낸 DM 은 뺀다), 그것도 없으면 가장 나중에 등록된 팀원
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

맡길 답장 한 통을 준다. 없으면 `item` 이 null 이다. 3분 안에 결과가 없으면 `attempt` 를 올려 다시 맡긴다. 답장을 받은 뒤(PM 이 고르면 고른 뒤) 10분이 지난 답장은 더 맡기지 않고 그 자리에서 판단을 끝낸 뒤(`timed_out`, PM 알림 한 번) 같은 대화의 다음 답장을 준다. 그래서 한 차례에 같은 답장을 맡기는 것은 최대 4회(0·3·6·9분)다. 창은 받은 시각 기준이라 같은 대화의 앞 답장이 밀리면 더 적을 수 있다. 스케줄러가 돌지 않아도 claim 이 이 상한을 지킨다(#548). 한 대화의 판단 끝내기가 실패해도 다른 대화의 답장은 그대로 준다.

```jsonc
// data
{ "item": {
    "message_id": "…", "attempt": 1, "workspace_id": "…", "member_name": "재환",
    "reply_date": "2026-11-04",                        // 보낸 날, 한국 시간
    "lines": [{ "sender": "pm" | "member", "text": "…" }],  // 시간순, 마지막이 이번 답장, 최대 12줄. PM 글은 DM 안내가 아니라 쓴 글 전체다
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
- 답장을 받은 뒤(PM 이 고르면 고른 뒤) 10분 안에 결과가 없으면 BE 가 판단을 끝내고 PM 에게 한 번 알린다. 스케줄러와 claim 중 먼저 본 쪽이 끝내고 알림은 한 번만 간다. 그 뒤 온 결과는 200 으로 받아 기록만 하고 반영·승인·알림은 없다. 결과 전송이 5xx 면 봇은 다시 보내지 않고 리스에 맡긴다(#548).
- PM 이 태스크를 고른 뒤의 재판단은 `unknown` 을 버린다. 이미 적은 태스크·필드는 다시 반영하지 않는다.
- PM 이 태스크를 고른 재판단은 대기 카드에 이미 있는 값이어도 줄을 알림에 넣는다. 고른 PM 이 결과를 기다린다.
- 재판단은 더 새 답장이 그 태스크를 말한 줄(`applied`·`proposed`·`skipped`·`noted`, 말하지 않은 후보에 붙는 `field=none` 은 제외)을 남겼으면 자동 반영하지 않고 PM 승인 요청으로 보낸다.
- PM 이 태스크를 고르면 고르지 않은 태스크의 시계는 재판단 결과와 상관없이 남은 시간부터 다시 센다. 재판단이 실패하거나 시간이 지나도 응답으로 치는 것은 고른 태스크뿐이다.

| 코드 | HTTP | 봇 처리 |
|---|---|---|
| `REPLY_JUDGMENT_NOT_FOUND` | 404 | 버리고 넘어간다 |
| `REPLY_JUDGMENT_STALE` | 409 | 버리고 넘어간다. 다시 맡긴 판단이나 PM 이 고른 뒤의 결과다 |
| `INVALID_REQUEST` | 400 | 후보 밖 태스크, 값이 잘못된 줄. 아무것도 반영하지 않는다. 봇은 같은 attempt 로 `failure_reason: "INVALID_REQUEST"` 를 한 번 보내 PM 에게 바로 알린다 |

## 회의 요약

회의가 끝나고 그 회의 항목의 승인 요청이 모두 처리되면 BE 가 쥔 대기열에서 봇이 한 건씩 요약을 만든다. 채팅 회의는 일일 채팅 요약이 된다. 처리 단계와 별개라 요약이 실패해도 회의는 `done` 그대로다.

- 합의 상태: **BE 담당 합의(2026-11-06), BE·AI 구현(#462).** 실제 봇과 운영 서버로는 아직 돌리지 않았다. 워커는 `MM_SUMMARY_LLM` 이 luna 또는 terra일 때만 대기열을 집는다. 로컬 기본은 OFF이고 운영 활성화는 실제 mm-worker 환경과 재시작으로 확인한다.
- 합의 내용: 요약 일감은 BE 가 쥐고 봇이 서비스 토큰으로 회의 전문과 팀원 이름을 읽는다. 라이브와 재처리를 한 경로로 두고 항목 ID 를 얻기 위해서다. 라우터를 `app/api/bot_summaries.py` 로 나눠 회의 내용을 돌려주지 않는 `bot_lookups` 의 약속은 그대로다.
- 대상: `POST /extractions` 가 표시한 회의, 재처리로 표시한 회의 가운데 승인을 기다리지 않는 회의다(#605). 그 회의 추출 항목이 걸린 승인 요청 중 `pending`(보류 포함)이 하나라도 있으면 claim 이 건너뛰고, 기다리는 시간에 끝은 없다. 합쳐진 카드에 걸린 회의는 모두 기다리다가 그 카드를 처리하면 모두 풀린다. 되돌리기로 새 승인 요청이 생기면 다시 기다린다. 채팅 회의는 승인된 항목이 하나 이상 있어야 하고, 반려만 있거나 항목이 없는 날은 돌지 않는다. 표시가 없는 옛 회의는 돌지 않는다. #605 전에 등록된 채팅 회의에도 표시가 없다. BE 는 AI 스위치(`MM_SUMMARY_LLM`)와 상관없이 표시하므로, 꺼 둔 사이 끝난 회의는 켜는 순간부터 시간순으로 모두 돈다(회의당 최대 두 번 호출). 켜기 전에 그 회의들을 돌리지 않으려면 표시를 비워야 한다. 꺼 둔 동안 새 회의의 `summary_status` 는 표시와 마지막 승인이나 반려 가운데 늦은 쪽에서 1시간 동안 `pending` 이다.
- 스위치 OFF 중에도 BE가 대상 회의를 표시한다. ON하면 이미 pending인 회의를 시간순으로 처리하며 비용이 발생한다. 오래된 미요청 회의를 새로 등록하는 backfill과는 다르다. 화면의 pending은 1시간 표시 제한이며 실제 큐를 버리지 않는다.
- 순서: `Meeting.started_at` 오름차순이다. 앞 회의의 주제와 결정이 있어야 뒤 회의가 재사용하고 뒤집을 수 있다. 승인을 기다리는 앞 회의는 뒤 회의를 막지 않아 뒤 회의가 먼저 요약될 수 있다.
- 재시도: claim 때 `attempt` 가 오르고 15분 임대가 걸린다. 임대가 지나면 다음 claim 이 다시 맡긴다. 회의당 2번까지다. 임대가 살아 있는 동안 같은 워크스페이스의 더 늦은 회의는 주지 않는다. 뒤 회의가 앞 회의의 주제와 결정을 재료로 받아야 하기 때문이다. 두 번 다 실패한 회의는 뒤 회의를 막지 않는다. claim 과 PUT 은 BE 안에서 한 줄로 서므로 워커와 재처리 명령이 동시에 불러도 순서가 지켜진다. 실패를 알리는 경로는 없다. 봇은 실패하면 PUT 을 보내지 않는다. LLM 실패, PUT 의 400·5xx, 워커 종료가 모두 같은 길을 간다.

| 시점 | 요청 | 인증 |
|---|---|---|
| 맡기 | `POST /summaries/claim` | `X-Service-Token` |
| 재료 읽기 | `GET /extractions/{extraction_id}/summary-input` | `X-Service-Token` |
| 저장 | `PUT /extractions/{extraction_id}/summary` | `X-Service-Token` |
| 재처리 표시 | `POST /workspaces/{workspace_id}/summary-requests` | `X-Service-Token` |

### `POST /summaries/claim` → 200

```jsonc
// 요청. 본문은 없어도 된다
{ "extraction_ids": ["…"] | null }      // 최대 500개
// data. 맡길 것이 없으면 data 가 null 이다. 답장 claim 의 { "item": null } 과 다르다
{ "extraction_id": "…", "meeting_id": "…", "workspace_id": "…", "attempt": 1, "claim_token": "…", "identity_epoch": 0 }
```

- `extraction_ids` 를 주면 그 안에서만 고른다. 빈 목록은 아무것도 맡기지 않고 `data` 가 null 이다. 본문이 없거나 `extraction_ids` 가 null 이면 범위 없이 고른다.
- 재료는 싣지 않는다. 상태를 바꾸는 호출과 읽기를 나눠 미리 보기가 BE 상태를 건드리지 않는다.
- `claim_token`은 서버가 매 임대마다 발급하며 DB에는 발급 당시 `identity_epoch`와 토큰을 결합한 SHA-256만 저장한다. AI는 토큰을 로그나 평가 산출물에 남기지 않는다.
- claim의 `identity_epoch`는 input GET과 PUT의 `X-Privacy-Epoch`에 고정한다. 탈퇴로 세대가 달라지면 409 `PRIVACY_VERSION_CHANGED`다. 옛 입력에 새 세대만 붙여 다시 보내지 않는다.
- claim 없는 미리보기 GET은 현재 세대를 응답으로 받지만 저장 토큰을 발급하지 않는다. 재처리 CLI는 현재 명단 세대를 읽어 request에 보낸다.
- 삭제된 공간·회의는 claim에서 제외한다. input·request·PUT은 기존 404·410을 따르며 추출이 이미 지워졌으면 404 `EXTRACTION_NOT_FOUND`다.
- 다중 공간 claim은 worker gate, 공간, 회의, 추출 순서로 잠근다. 같은 공간의 PUT과 삭제는 공간 잠금으로 직렬화한다.

### `GET /extractions/{extraction_id}/summary-input` → 200

상태를 바꾸지 않는다. 표시 여부와 무관하게 읽을 수 있다.

```jsonc
// data
{
  "extraction_id": "…", "meeting_id": "…", "workspace_id": "…", "identity_epoch": 0,
  "title": "3주차 정기회의" | null, "started_at": "2026-11-05T05:00:00Z",
  "source": "discord" | "manual_upload" | "chat",
  "members": ["김서연", "민수"], "asr_terms": ["젠킨스"],
  "lines": [{ "seq": 12, "at_ms": 125000, "speaker": "김서연", "text": "…" }],
  "items": [{ "item_id": "…", "action": "create" | "update" | "merge", "title": "…", "assignee": "민수" | null,
              "due_date": "2026-11-14" | null, "status": "done" | null,
              "cleared": ["due_date"], "scope": "소셜 로그인은 이번에 뺀다" | null }],
  "rejected_items": ["발표 자료 작성", "검색 기능 개발 (반려된 변경: 담당 윤지민)"],
  "topics": [{ "topic_id": "…", "name": "로그인·계정", "description": "…" }],
  "decisions": [{ "decision_id": "…", "text": "…", "topic": "팀원 초대", "decided_on": "2026-10-20" }]
}
```

- `lines[].speaker` 는 팀원 이름, 저장된 표시 이름, uid, `Unknown` 순서다.
- `source` 가 `chat` 이면 AI 는 일일 채팅 요약 틀을 쓴다. 기간은 따로 오지 않고 `started_at` 과 마지막 줄의 `at_ms` 로 정한다.
- `members` 는 탈퇴하지 않은 팀원의 표시 이름이고 가입 순서다. `asr_terms` 는 워크스페이스 용어 전체이고 Unicode 코드 포인트 순서다. DB 콜레이션과 무관하게 같은 순서로 온다. 개수 상한은 없으며 전사의 오인식을 고칠 때 쓴다.
- 합친 카드의 새 항목은 각 회의 항목의 값을 유지한다. 예를 들어 A의 마감이 11/20이고 뒤에 합친 B가 11/25면, PM이 카드 값을 그대로 승인해도 A 재료는 11/20, B 재료는 11/25다. PM이 승인하며 별도로 고친 값은 연결된 각 회의 항목에 덮는다. 최종 카드나 현재 태스크의 스냅샷을 주는 계약이 아니다.
- 회의 삭제 예외가 있다. 처리된 합친 카드에 걸린 회의 하나를 지우면 삭제 규칙에 따라 카드 payload 전체를 비운다. 남은 회의의 `items`는 항목 원래 값으로 돌아가 PM의 승인 보정값을 잃는다. 삭제된 원문 사본을 남기지 않는 기존 경계를 유지한 현재 구현의 한계다. 합치기는 `task_create` 카드만 지원하므로 반려된 `task_update`가 여러 회의에 걸리는 경우는 정상 합치기 경로에 없다.
- `items` 는 지금 반영된 항목만이다(#605). 자동 반영됐거나 승인됐고 태스크가 살아 있는 항목이다. 승인 대기, 반려, 되돌린 항목은 없다. 같은 태스크에 이어진 새 항목(`create`, `merge`)은 먼저 만든 하나만 둔다. `update` 항목은 같은 태스크라도 항목마다 따로 오고 각자 `item_id` 가 있다. 값은 그 회의 항목이 정한 값에 PM 이 승인하며 고친 값을 덮은 것이다. 뒤 회의의 수정이나 직접 수정으로 바뀐 태스크의 지금 값은 쓰지 않는다. 그래서 같은 태스크라도 회의마다 그 회의에서 정한 마감이 간다. `assignee` 는 담당 팀원 이름이고 없으면 null 이다.
- `update` 항목은 그 수정이 바꾼 값만 있다. `title` 은 그 회의가 가리킨 태스크 제목이고, 바꾸지 않은 `assignee`, `due_date`, `status` 는 null 이다. `status` 는 `update` 항목에만 오고 `todo`, `in_progress`, `blocked`, `done` 중 하나다. `cleared` 는 그 수정이 비운 칸이고 `assignee`, `due_date` 중에서 온다. 그 칸의 값은 null 이라 바꾸지 않은 칸과는 `cleared` 로 가른다. 마감 해제(`due_cleared`)와 PM 이 승인하며 비운 칸이 여기에 온다. `scope` 는 승인된 범위 결정 수정(`category: scope`)의 설명이다. 범위는 바꾸는 칸이 없어 따로 싣는다. 새 항목(`create`, `merge`)의 `status` 와 `scope` 는 늘 null 이고 `cleared` 는 빈 목록이다.
- `rejected_items` 는 이 회의 항목 가운데 PM 이 반려한 할 일이다(#605). AI 는 이 일을 정해진 일, 맡은 일, 예정된 일로 쓰지 않고, 반려나 승인처럼 회의 뒤에 PM 이 처리한 일도 요약에 쓰지 않는다. 회의에서 제안이나 논의로 나왔다면 그렇게만 쓴다. 반려된 수정은 태스크가 그대로 있어 제목 뒤 괄호에 반려된 변경을 적는다. 비운 칸은 `마감 없앰`, 범위 결정은 `범위: 설명` 으로 적는다. 바꿀 값 없이 반려된 수정은 그 설명을 적는다. `items` 의 제목과 같은 글은 넣지 않는다. 없으면 빈 목록이다.
- 배포 순서: `rejected_items`, `status`, `cleared`, `scope` 는 기본값이 있어 BE 와 AI 중 어느 쪽이 먼저 나가도 읽힌다. 다만 `update` 항목의 null 은 뜻이 바뀌었다. 옛 AI 는 바꾸지 않은 칸을 "담당 미정, 마감 없음" 으로 적고, `cleared` 와 `scope` 를 모르는 AI 는 마감 해제와 범위 변경을 "바꾼 값 없음" 으로 적으므로 운영에서 `MM_SUMMARY_LLM` 을 켜기 전에 두 쪽을 모두 배포한다.
- `topics` 는 최근에 쓴 순서로 최대 100개다.
- `decisions` 는 이 회의 시점에 유효했던 결정이다. 이 회의보다 앞선 회의의 결정 중 뒤집히지 않았거나 이 회의 이후에 뒤집힌 것이고, 최근 순으로 최대 50개다. `decided_on` 은 한국 시간 날짜다.

### `PUT /extractions/{extraction_id}/summary` → 200

```jsonc
// 요청. 예시 전체는 ai/tests/capture/fixtures/summary_put.json
{
  "claim_token": "…",           // claim 응답의 토큰, 필수
  "model_name": "gpt-5.6-luna", "truncated_input": false,
  "overview": "…",                // 필수, 빈 문자열 불가
  "key_points": ["…"],            // 필수
  "discussion": [{ "title": "…", "points": ["…"] }],
  "facts": ["…"],
  "task_changes": [{ "task": "…", "assignee": "", "due": "", "purpose": "", "precondition": "", "item_id": "…" | null }],
  "schedule": [{ "when": "11/20", "what": "…" }],
  "open_items": ["…"],
  "topics": [{
    "topic_id": "…" | null,       // 기존 주제. 이때 name 에는 재료의 주제 이름을 같이 싣는다
    "name": "…" | null,           // 새 주제 또는 기존 주제의 이름. 100자까지. topic_id 와 name 이 둘 다 비면 400
    "description": "",            // 새 주제일 때만 쓴다
    "item_ids": ["…"],            // 500개까지
    "decisions": [{ "text": "…", "reason": "…" | null, "rejected": ["…"], "replaces": ["<decision_id>"] }]
  }]
}
// data
{ "extraction_id": "…", "meeting_id": "…", "applied": true, "topic_count": 1, "decision_count": 1 }
```

| 항목 | 동작 |
|---|---|
| 결정의 자리 | 결정은 주제 아래에만 있다. 주제 없는 결정은 보낼 수 없다 |
| 할 일 변화의 항목 | `item_id` 는 재료 `items` 의 항목이다. 저장은 그대로 하고, 읽을 때(회의록, summary.md, 합본) 그 항목이 지금 반영된 줄만 보인다. `item_id` 가 없거나 null 인 줄과 요약 뒤 되돌리거나 지운 항목의 줄은 보이지 않는다. 키가 없는 옛 봇의 PUT 도 받는다(#605) |
| 먼저 온 쪽 | 표시가 비어 있으면 `applied=false` 이고 아무것도 쓰지 않는다. 늦게 온 PUT, 같은 PUT 재전송, 표시된 적 없는 추출이 여기 든다. 200 이므로 재시도하지 않는다 |
| 임대 | PUT은 잠근 workspace의 현재 세대와 claim_token을 결합한 hash 및 15분 임대를 확인한다. 만료·다른 claim·force·세대 변경으로 무효화된 토큰이면 200 `applied=false`다. 최신 세대 헤더를 붙여도 이전 세대에 발급한 토큰은 저장할 수 없다. 토큰이 없으면 400이다. 성공하면 토큰 hash를 비운다 |
| 건너뜀 | 이 추출에 없는 `item_id`, 이 워크스페이스에 없는 `topic_id`(같이 온 `name` 이 있으면 그 이름으로 찾거나 만든다), 없거나 다른 워크스페이스이거나 이 회의와 같거나 늦은 회의의 `decision_id` 는 그 값만 건너뛴다. 이름 없이 건너뛴 `topic_id` 나 글자가 없는 `name` 의 주제는 그 아래 결정까지 저장하지 않는다 |
| 주제 재사용 | `name` 은 정규화(NFKC, 소문자, 글자와 숫자만 남김)한 값이 같으면 기존 주제를 쓴다. 표기와 설명은 처음 만든 값이 남는다. 한 본문에 같은 주제가 여러 번 있으면 합친다 |
| 재실행 | 이 회의의 연결과 결정을 지우고 다시 쓴다. 이 회의가 뒤집었던 결정은 유효로 돌아갔다가 새 본문의 `replaces` 로 다시 뒤집힌다. 어느 회의에도 남지 않은 주제는 지운다. 다른 회의가 그 주제를 재료로 이미 받았으면 그 회의의 PUT 이 같이 실은 이름으로 다시 만든다. 더 늦은 회의가 이 회의의 결정을 뒤집어 둔 표시는 사라지므로 번복을 맞추려면 시간순으로 전체를 다시 돈다 |
| 저장할 수 없는 글자 | 본문 어디든 NUL 이나 짝 없는 서로게이트가 있으면 400 `INVALID_REQUEST` 다. 봇은 보내기 전에 지운다 |
| 저장 모양 | `Extraction.summary` 에 JSON 으로 저장한다. 기존 `overview`, `key_points`, `decisions`(문자열 목록)가 항상 있고 `decision_details`, `topics`(이름 목록), `meta`, `schema_version` 을 더한다. `schema_version` 2(#605)부터 `decision_details[].decision_id`, `topics` 와 같은 순서의 `topic_ids`, `task_changes[].item_id` 가 있다. 웹 응답은 [프론트엔드 계약 §4.4.2](../../../frontend/docs/contracts/frontend-api-contract.md) 에 있다 |

### `POST /workspaces/{workspace_id}/summary-requests` → 200

옛 회의를 대기열에 넣는다. `dry_run` 기본값이 `true` 라 생략하면 쓰지 않는다.

```jsonc
// 요청. meeting_ids 와 include_all 중 하나만
{ "meeting_ids": ["…"] | null, "include_all": false, "force": false, "dry_run": true }
// data. 회의 시작 순
{ "items": [{ "meeting_id": "…", "extraction_id": "…" | null, "title": "…" | null, "started_at": "…",
              "state": "requested", "chars": 24000 }] }
```

| `state` | 뜻 |
|---|---|
| `requested` | 이번에 표시했다. `dry_run` 이면 표시할 회의다 |
| `done` | 재처리 표시가 없는 저장된 요약이다. `force=false`면 승인된 태스크를 나중에 지워도 이 값을 우선한다. `force=true`면 현재 승인 상태를 다시 판정한다 |
| `queued` | 이미 줄 서 있거나 처리 중이다 |
| `gave_up` | 두 번 실패했다. `force` 면 `requested` 가 된다 |
| `no_sources` | 발화가 없다 |
| `awaiting_approval` | 승인 대기 카드가 남았다. 표시는 하고 승인이 끝나면 돈다 |
| `no_approved_items` | 채팅 회의인데 대기 카드도 승인된 항목도 없다. 표시하지 않는다 |
| `not_done` | 추출이 끝나지 않았다 |

- `force` 는 시도 횟수를 비우고 다시 줄 세운다. 기존 요약은 새 요약이 올 때까지 남는다.
- `chars` 는 그 회의 발화의 글자 수 합이다.
- `meeting_ids` 에 없거나 다른 워크스페이스의 회의가 있으면 아무것도 쓰지 않고 404 `MEETING_NOT_FOUND` 이고 `details.meeting_ids` 에 그 ID 들이 있다.

## 오류 코드 요약

| 코드 | HTTP | 나오는 경로 | 봇 처리 |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | 봇 경로 전부 | 실패 (stage 는 로그만 남기고 계속) |
| `MEETING_NOT_FOUND` | 404 | end, stage, fail, sources, extractions, uploads claim·file·speakers·resume, summary-requests | 실패 (stage 는 로그만 남기고 계속) |
| `WORKSPACE_NOT_FOUND` | 404 | tasks/similar, members/names, asr-terms, summary-requests | 실패 |
| `EXTRACTION_NOT_FOUND` | 404 | summary-input, PUT summary | 실패. 임대가 지나 다시 맡겨진다 |
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

- Backend: `app/api/meetings.py`, `app/api/sources.py`, `app/api/similar_tasks.py`, `app/api/extractions.py`, `app/api/integrations.py`의 `get_discord_guild_workspace`, `app/api/bot_lookups.py`(`chat-cursor`·`asr-terms` 포함), `app/api/integrations.py`의 `list_bot_chat_channels`, `app/services/chat_channel.py`, `app/schemas/integration.py`, `app/api/approvals.py`(채팅 이력 출처), `app/api/workspaces.py`(업로드 가드), `app/api/uploads.py`, `app/services/speaker_assignment.py`, `app/services/meeting_stage.py`, `app/api/deps.py`의 `require_service_token`, `app/schemas/meeting.py`, `app/schemas/member.py`, `app/schemas/source.py`, `app/schemas/task.py`, `app/schemas/workspace.py`, `app/schemas/upload.py`, `app/services/upload_storage.py`, `app/api/bot_messages.py`, `app/services/messages.py`, `app/schemas/message.py`, `app/api/bot_summaries.py`, `app/services/summary.py`, `app/schemas/project_map.py`
- AI: `ai/capture/handoff.py`의 `BeClient`(`report_stage`, `STAGE_TIMEOUT_S`), `Handoff`(`report_stage`), `from_env`, `ai/capture/recorder.py`의 `process_session`(`begin`), `ai/draft/reminder_draft.py`의 `draft_reminder`, `ai/capture/dm.py`의 `DmCog`

회의 요약 경로는 `backend/tests/api/test_summary_queue.py`, `test_summary_save.py` 로 SQLite 와 PostgreSQL 에서 검증했다. 실제 봇과 연결해 돌리지는 않았다. `ai/tests/capture/fixtures/summary_put.json` 은 BE 테스트가 `SummaryWriteRequest` 왕복으로 검증하고, AI 구현이 같은 파일을 쓰게 되어 있다.

### #560 통합의 삭제·탈퇴 경계, 2026-11-09

현재 구현은 회의 삭제와 같은 트랜잭션에서 Decision, TopicMeeting, TopicItem과 고아 Topic을 지운다. 다른 회의 요약의 decision_details.replaces 사본도 삭제된 회의·결정 ID로 제거한다. 생존 Task는 보존하되 프로젝트 맵의 삭제 원문 링크는 제외한다. 공유 공간 탈퇴는 기존 구조화 소유 필드를 익명화하고 옛 세대의 요약 PUT을 막는다. 이미 저장된 공동 자유문장 전체의 이름 치환은 수행하지 않는다.

임대 토큰과 삭제 경계는 #560 통합에서 추가한 현재 구현이다. 별도 팀 합의 여부는 확인 필요다. 선택과 검증 근거는 [결정 기록](../plan/m3/basis-for-decision/2026-11-09-summary-lease-and-deletion.md)과 [통합 결과](../../../frontend/docs/issues/560-summary-integration/result.md)에 있다.
