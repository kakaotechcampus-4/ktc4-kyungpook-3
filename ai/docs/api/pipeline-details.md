# 처리 상세

AI 파트의 녹음 뒤 처리, Backend 인계, 웹 업로드 흐름을 단계별로 적은 참고 문서입니다. 개요는 [AI 파트 README](../../README.md)에 있습니다.

## 녹음 봇

`capture/discord_adapter.py` 의 `RecordingCog` 가 녹음을 맡고, 실행기 `capture/run_recorder.py` 가 봇을 띄웁니다. 운영에서는 systemd `mm-bot` 이 이 실행기를 돌립니다.

## 녹음 뒤 처리

`/stop` 이면 봇은 트랙을 닫고 저장한 뒤 워커(`capture/worker.py`)를 찌르고 `on_session_saved(manifest, manifest_path)` 훅을 부릅니다. 처리는 워커 하나가 합니다(`ai/docs/basis_for_decision/member/2026-10-13-0026-worker-only.md`). 워커가 `capture/recorder.py` 의 `process_session` 으로 전사(`stt/batch.py`) → 회의록 저장 → 할일 추출 → BE 인계 (`capture/handoff.py`)를 돌리고, 단계가 끝날 때마다 그 채널에 알릴 글을 우편함(`recordings/.worker/outbox`)에 씁니다. 봇이 그 글을 채널에 올립니다. BE 가 읽는 전사는 `transcripts/session_{ts}.transcript.json` 입니다.

## Cog 구성

운영에 올리는 Cog 는 `RecordingCog` 하나입니다. `capture/realtime/` 은 실행기에 등록하지 않고 공용 계층 (`voice_client.py`, `streaming_sink.py`, `track_writer.py`)에 기댈 뿐이며 반대 방향 의존은 없습니다. 재연결 키 갱신처럼 두 경로에 다 필요한 처리는 공용 계층에 있습니다.

## Backend 인계

BE 인계는 봇과 워커가 BE 회의 API 를 직접 부릅니다 (`ai/docs/basis_for_decision/member/2026-09-19-0009-bot-hands-off-to-be-api.md`). `/record` 에서 봇이 `POST /api/v1/meetings`, 워커가 `PATCH /meetings/{id}/end`, 추출 뒤 `POST /extractions`, 자동 재시도를 멈추면 `PATCH /meetings/{id}/fail`. `BE_BASE_URL` 과 `BE_SERVICE_TOKEN` 이 없으면 이 단계에서 멈춥니다. 워크스페이스는 `/record` 때 디스코드 서버로 BE 에 물어 매니페스트에 고정합니다. 웹에서 연결하지 않은 서버면 녹음을 시작하지 않고, 처리할 때 연결이 없으면 채널에 한 번 알리고 연결될 때까지 전사하지 않습니다(#199).

## 웹 업로드 가져오기와 인계 요약

웹 업로드 회의 가져오기도 워커가 BE 를 직접 부릅니다. 대기 목록·claim·파일은 `GET /uploads/pending`, `PATCH /uploads/{id}/claim`, `GET /uploads/{id}/file`(헤더 `X-Service-Token`)이고, 분리에 실패하면 `PATCH /meetings/{id}/fail` 에 `failed_stage=diarize` 를 보냅니다. 진행은 `recordings/.uploads/<meeting_id>/intake.json`, 결과는 세션 `upload_<meeting_id>` 의 `diarized` 매니페스트(`be`, `workspace_id`, `attendees`, `upload` 포함)입니다. 자세한 흐름은 아래 "수동 업로드" 항목에 있습니다. PM 의 지정이 끝난 뒤에는 `mapped` 매니페스트를 처리 바퀴가 집어 `POST /meetings/{id}/sources`(화자는 `speaker_member_id`)와 `POST /extractions` 로 인계하며 `POST /meetings`·`PATCH /end` 는 부르지 않습니다. 그 앞 단계에서 화자 라벨 보고(`POST /uploads/{id}/speakers`), 지정 조회(`GET /uploads/assigned`), `PATCH /uploads/{id}/resume` 도 같은 워커가 부릅니다(아래 "업로드 회의 인계").

## 추출 경로

추출 단계의 추출기는 `MM_EXTRACT_PATH` 로 고릅니다 (`ai/docs/basis_for_decision/member/2026-09-30-0016-judge-path-flag-and-unjudged-findings.md`). 기본(`legacy`)은 `extract/` 의 `extract_tasks`, `judge` 는 판단 파이프라인(`judge/pipeline.py`)입니다. `judge` 는 1단계가 전사록에서 고른 finding(결정이나 진척 보고 하나. 근거 줄 하나나 여러 줄과 요약 문장)마다 그 요약 문장으로 BE 의 유사 task 검색 (`POST /workspaces/{id}/tasks/similar`, 헤더 `X-Service-Token`)을 부릅니다. 전사록의 줄마다가 아닙니다. 나온 항목은 회의마다 한 번 그대로 `POST /extractions` 로 보냅니다. 판단하지 못한 finding 이 남으면 인계를 미루고 다시 돌리며, 등록할 항목 없이 판단하지 못한 finding 만 남으면 빈 추출을 등록하지 않고 단계 실패로 셉니다.

## 매니페스트와 단계 상태

매니페스트 `recordings/session_{ts}.json` = `{"session", "status", "stages", "started_at", "timezone", "meeting_dir", "transcript", "tasks" 또는 "items", "be", "speakers": [{"user_id", "display_name", "file", "duration_sec"}]}`. `status` 는 recording → saved → transcribed → extracted → handed_off (실패 시 failed 와 `failed_stage`) 이고, 워커가 마지막으로 끝난 단계 다음부터 마저 처리합니다. 실패 5회로 자동 재시도를 멈춘 회의는 서버에서 `python -m capture.worker --retry <서버ID>` 로 다시 돌립니다. 포기 7일 뒤에는 음성이 지워져 다시 돌릴 수 없습니다. 상대 날짜("내일")의 기준일은 처리하는 날이 아니라 `started_at` 을 `timezone` 으로 바꾼 회의 날짜입니다.

## 수동 업로드 (`upload/`)

회의를 녹음하지 못했을 때 오디오 파일 하나를 `python -m upload.prepare <오디오> --started-at <ISO>` (pyannoteAI 를 실제로 부르므로 `PYANNOTEAI_API_KEY` 가 필요하고 과금됩니다)로 화자 분리해 화자 라벨마다 원본 길이의 가상 트랙 `recordings/upload_{ts}/{id}_{ts}.wav` 와 `diarization.json`, 매니페스트를 만듭니다. 매니페스트는 `status` 가 `diarized`, `source` 가 `upload` 입니다. 화자 라벨을 멤버에 지정하는 함수는 `upload.mapping.apply_mapping` 이고, 개발·운영용으로 `python -m upload.mapping <매니페스트> <mapping.json>` 입구가 있습니다(PM 이 쓰는 경로가 아닙니다). PM 의 지정을 웹으로 받는 BE 경로와는 `upload/assign.py` 가 assigned·resume 으로 연결합니다(아래 지정 받기). `mapping.json` 은 `{"mapping": {"SPEAKER_00": "멤버ID", "SPEAKER_01": null}}` 이거나 안쪽 객체 그대로이고, 키는 `SPEAKER_00` 도 `SPEAKER00` 도 됩니다. 모든 라벨을 한 번에 지정해야 하고(빠진·모르는 라벨, 빈 문자열이거나 앞뒤 공백이 있는 멤버 ID 는 거절하며 파일은 그대로입니다), `null` 은 외부 참석자이고, 같은 멤버를 여러 라벨에 지정해도 됩니다. 결과는 `speakers[].member_id`, 최상위 `mapped_at`, `status` 가 `mapped` 입니다. `user_id`(라벨 id)·`file`·wav 이름은 그대로이고 `mapped` 에서 다시 지정하면 덮어씁니다. `diarized` 인 업로드 매니페스트와 `workspace_id`·BE 회의(`be.meeting_id`)가 없는 업로드 매니페스트는 상태가 무엇이든 (사람이 `saved` 로 고쳐도) 워커의 자동 바퀴·`--retry` 바퀴·복구 어디서도 처리하지 않습니다. 이 경로(`prepare`)로 만든 매니페스트에는 `workspace_id` 와 BE 회의 정보가 없고 디스코드 길드·채널이 없어 `guild`·`channel` 이 null 이라 여기에 해당합니다. PM 의 지정은 BE 웹 경로와 `upload.assign` 이 받고, 지정이 끝나 `mapped` 가 된 BE 업로드 회의는 워커의 처리 바퀴가 전사·BE 인계합니다 (아래 "업로드 회의 인계").

## 웹 업로드 가져오기 (`upload/intake.py`)

PM 이 웹에 올린 오디오 회의를 워커가 가져와 같은 `diarized` 매니페스트로 만듭니다. 명시적 opt-in 입니다. 환경 변수 `MM_UPLOAD_INTAKE=1` 이고 `BE_BASE_URL`·`BE_SERVICE_TOKEN`·`PYANNOTEAI_API_KEY` 가 모두 있을 때만 켜지고, 아니면 BE 도 pyannoteAI 도 부르지 않습니다. **운영 서버 한 대에서만 켭니다(BE 의 claim 계약은 단일 워커를 전제로 합니다).** 워커가 바퀴 끝(정지 신호가 없을 때만)에 한 번 `intake_one` 을 부르며, 한 번에 한 건을 한 단계만 진전시킵니다. 흐름은 BE `GET /uploads/pending` → `PATCH /uploads/{id}/claim`(조건부 한 번) → 원본 내려받기(`size_bytes` 확인) → 16kHz mono wav 변환 → pyannoteAI 제출(`job_id` 기록. `job_id` 를 적은 뒤에는 재시작해도 다시 제출하지 않습니다. 다만 제출 응답을 받기 전에 끊기거나 30분이 지나도 결과가 없거나 job 이 실패하면 다시 제출(과금)될 수 있습니다). claim 한 뒤 2시간 30분이 지나면 다시 맡기지 않고 `failed_stage=diarize` 로 실패를 보고합니다(BE 가 3시간 뒤 정리하기 전에 끝내기 위해서입니다) → 결과 조회 → 트랙·매니페스트 작성 → 원본·wav 삭제입니다. 진행 기록은 `recordings/.uploads/<meeting_id>/intake.json`(상태 `claiming`·`claimed`·`converted`· `submitted`·`done`·`failed`)이라 재시작해도 이어 갑니다. 일시 실패는 복구와 같은 시도 한도·대기로 다시 하고, 영구 실패나 한도 초과는 BE 에 `PATCH /meetings/{id}/fail`(`failed_stage=diarize`)을 보냅니다. 보내지 못하면 다음 바퀴에 다시 보냅니다. 세션 이름은 `upload_<meeting_id>` 이고 매니페스트(`recordings/session_upload_<meeting_id>.json`)는 `be`(`{meeting_id, status}`), `workspace_id`, `title`, `attendees`, `upload`(원본 파일 정보)를 더해 `status` 가 `diarized` 입니다. 이 매니페스트도 위와 같이 워커의 처리 바퀴가 집지 않습니다(지정 전이라서입니다). 워커 로그에는 `[worker] 업로드 <meeting_id> <진행>` 한 줄이 남고, 하트비트 `current` 는 가져오는 동안 `upload` 입니다.

## 지정 받기 (`upload/assign.py`)

PM 이 웹에서 화자 지정을 끝낸 업로드 회의를 워커가 `mapped` 로 바꿉니다. 같은 opt-in 이고, 워커가 같은 자리(한 번에 한 회의)에서 `intake_one` 보다 먼저 `assign_one` 을 한 번 부릅니다. 한 번에 한 건을 한 단계만 진전시킵니다. 흐름은 BE `GET /uploads/assigned` → `PATCH /uploads/{id}/resume` 직전에 로컬 기록(`recordings/.uploads/<meeting_id>/intake.json` 의 `resume` 키, 상태 `resuming`)을 남김 → resume 응답의 mapping 으로 `apply_mapping` → `mapped` 기록입니다. assigned 는 resume 하지 않은 건만 주므로, resume 응답을 잃거나 죽어도 로컬 기록을 보고 다시 resume 합니다(resume 은 멱등입니다). 때가 된 `resuming` 기록을 assigned 보다 먼저 이어 갑니다. 409 `SPEAKERS_NOT_ASSIGNED` 는 매니페스트를 그대로 두고 fail 도 보내지 않고 다음에 다시 봅니다. 409 `MEETING_ALREADY_ENDED` 와 404 는 BE 가 이미 끝낸 회의라 로컬 매니페스트·트랙·잠금을 지우고 `ended` 로 기록하며 fail 을 보내지 않습니다. 연결 실패·5xx·`apply_mapping` 잠금 경합은 일시 실패라 대기 뒤 다시 하고 포기 한도는 없습니다. assigned 에 나왔는데 로컬 매니페스트가 없으면 resume 하지 않고 건너뜁니다(로그는 실행 동안 회의마다 한 번). resume 은 됐는데 지정을 쓸 수 없으면(라벨 불일치 등) `PATCH /meetings/{id}/fail`(`failed_stage=diarize`)을 보내고(409 ended 는 성공으로 봅니다) 로컬을 정리해 `failed` 로 기록하며, fail 을 보내지 못하면 기록에 남겨 다음에 다시 보냅니다. `mapped` 매니페스트는 워커의 처리 바퀴가 이어서 집습니다(아래 "업로드 회의 인계"). 로그는 같은 `[worker] 업로드 <meeting_id> <진행>` 한 줄입니다.

## 라벨 보고 (`upload/report.py`)

가져오기가 끝난(`done`) 회의의 화자 라벨과 샘플 구간을 워커가 BE 에 보고합니다. 같은 opt-in 이고, 워커가 같은 자리(한 번에 한 회의)에서 `assign_one` 다음, `intake_one` 보다 먼저 `report_one` 을 한 번 부릅니다. BE 는 보고를 받아야 `awaiting_speakers` 로 바뀌고 PM 이 웹에서 지정할 수 있습니다.

- 샘플 규칙: 라벨마다 `total_sec` 는 그 라벨 구간 길이의 합(다른 라벨과 겹친 부분 포함, 소수 셋째 자리)입니다. 샘플은 다른 라벨과 겹치지 않는 구간 중 2초 이상을 긴 순서로 최대 3개 고르고 각각 앞에서부터 10초로 자르며, 시작 시각 오름차순으로 보냅니다. 2초 이상인 깨끗한 구간이 없으면 가장 긴 깨끗한 구간 하나, 깨끗한 구간이 전혀 없으면 가장 긴 원래 구간 하나를 씁니다. 같은 입력이면 같은 결과이고 매니페스트의 모든 라벨이 한 번씩 들어갑니다.
- 기록: `recordings/.uploads/<meeting_id>/intake.json` 의 `report` 키(상태 `reporting` → `reported`·`ended`, 실패는 `failing` → `failed`)입니다. 보고 본문은 처음 만들 때 기록에 고정하고 재전송은 그 본문을 그대로 보내므로, 응답을 잃어도 같은 내용으로 다시 보냅니다. 가져오기 상태와 매니페스트(`diarized`)는 바꾸지 않습니다. `reporting` 인데 지정 받기가 남긴 `resume` 키가 있으면(PM 지정이 이미 끝난 회의) BE 를 부르지 않고 `reported` 로 닫습니다. 아래 어느 응답 처리에서도 `mapped` 매니페스트는 지우지 않습니다.
- 응답 처리: 200 이면 `reported` 입니다. 409 `SPEAKERS_ALREADY_REPORTED` 는 BE 가 가진 라벨이 우리 것과 같으면 `reported`, 다르면 로컬을 정리하고 `failed_stage=diarize` 로 실패를 보고합니다. 409 `MEETING_ALREADY_ENDED` 와 404 는 로컬을 정리하고 `ended` 로 기록하며 fail 을 보내지 않습니다. 409 `UPLOAD_NOT_CLAIMED` 와 400 은 로컬 정리 뒤 fail 을 보냅니다. 매니페스트·분리 파일이 없거나 깨졌거나 라벨이 어긋나도 같습니다. 연결 실패·5xx·401·BAD_RESPONSE 는 일시 실패라 대기 뒤 다시 하고 포기 한도는 없습니다. fail 을 보내지 못하면 `failing` 으로 남겨 다음에 다시 보냅니다.

## 업로드 회의 인계

지정이 끝나 `mapped` 가 되고(모든 화자에 `member_id` 키가 있음) `workspace_id`·`be.meeting_id` 가 있는 업로드 매니페스트는 워커의 처리 바퀴(`run_pass`·복구)가 디스코드 회의보다 먼저 집어 전사 → 회의록 → 할일 추출 → BE 인계를 합니다. 디스코드 서버가 없어도 집습니다. 디스코드 회의가 BE 에 보내는 요청은 그대로입니다.

- 변환은 인계 직전에만 합니다. 전사 계약 파일과 추출 입력은 라벨 id(`SPEAKER00`)를 그대로 쓰고, BE 로 나갈 때만 라벨을 멤버 ID 로 바꿉니다.
- `POST /meetings/{id}/sources` 는 모든 발화에 `speaker` 를 null 로 두고, 멤버에 지정된 라벨의 발화에는 `speaker_member_id` 를 싣습니다. `speaker_names` 는 보내지 않습니다.
- `POST /extractions` 는 judge·legacy 항목 모두 `evidence_speaker` 를 null 로 두고 `evidence_speaker_member_id` 를 싣습니다.
- 외부 참석자로 지정한 라벨은 화자도 멤버 ID 도 비웁니다. 그 발화도 전사·발화 저장·추출에는 넣습니다. LLM 에는 "외부 참석자 N" 이라는 이름으로 보입니다.
- BE 회의는 가져오기 때 이미 만들어져 있어 `POST /meetings`·`PATCH /meetings/{id}/end` 를 부르지 않습니다.
- 400 `details.member_ids` 를 받으면 그 ID 를 null 로 바꿔 다시 보내고(서로 다른 ID 수만큼만), 버린 ID 는 `be.sources.dropped_member_ids` 와 로그에 남깁니다.
- 발화 저장의 409 `MEETING_FAILED`·404, 추출 등록의 409 `MEETING_NOT_PROCESSING`·404 는 BE 가 이미 끝낸 회의라는 뜻입니다. 새 회의를 만들지 않고 실패 횟수·`/fail` 도 없이 잠금을 놓은 뒤 로컬 매니페스트·잠금·트랙 폴더를 지웁니다.
- 로컬 정리(`upload/cleanup.py`): 워커가 바퀴 끝에 `cleanup_one` 을 한 번 더 부릅니다. 지정 기한이 지난 업로드는 BE 가 끝났다고 답할 때만 로컬을 지우고, 포기한 업로드와 끝난 가져오기 기록은 7일 보관 뒤 지웁니다. 인계가 끝난 회의의 트랙 wav 는 업로드든 디스코드든 워커가 바퀴마다 바로 지웁니다(`recorder.prune_audio`, [결정 기록 0055](../basis_for_decision/ai/2026-11-08-0055-meeting-audio-retention.md)). 포기한 회의는 포기 7일 뒤, 인계까지 못 가고 멈춘 디스코드 회의는 마지막 진행 7일 뒤 지웁니다.
- 음성 정리 기준 `AUDIO_PRUNE_SINCE` 는 2026-11-09 00:00 KST이며 별도 활성화 설정은 없습니다. 배포 후 첫 워커 바퀴부터 기준에 맞는 트랙을 지웁니다. 기준과 비교하는 값은 회의 생성일이 아니라 인계·포기·마지막 진행 시각입니다. 오래된 녹음도 그 진행 시각이 기준 이후면 대상입니다. 기준 이전 진행 기록과 시간대가 없거나 해석할 수 없는 시각은 보존하며, 운영 기록 대조가 필요합니다. 기존 검증용 회의의 보존 여부도 이 조건으로 확인해야 합니다.
- `prune_audio` 는 매니페스트의 세션 잠금을 잡고 상태를 다시 읽은 뒤, 그 세션 폴더의 `speakers[].file` 에 등록된 실제 wav만 지웁니다. 경로가 다른 세션·폴더 밖·링크를 가리키면 해당 매니페스트의 정리를 보류합니다. 일부 파일 삭제가 실패하면 매니페스트를 남겨 다음 바퀴에서 남은 파일을 다시 지웁니다. 미등록 wav는 소유를 추정해 지우지 않습니다. 업로드 원본과 변환 wav는 트랙 생성 뒤 `upload/intake.py` 가 별도로 정리합니다.

## 회의 요약


`capture/summary_sweep.py`는 BE 요약 큐에서 한 건을 claim하고 재료를 읽어 요약한 뒤 저장합니다. claim의 토큰과 `identity_epoch`를 입력 조회·저장까지 고정합니다. 탈퇴나 회의 삭제로 바뀐 입력에 옛 결과를 저장하지 않습니다. 순수 요약 생성은 `summary/`가 맡고 Discord나 로컬 녹음 파일을 읽지 않습니다. 계약은 [BE 요약 API](../../../backend/docs/contracts/backend-ai-contract.md#회의-요약)에 있습니다.

워커는 일반 처리·업로드·개인정보 정리·회의 삭제 정리·음성 정리 뒤에 요약 작업 하나를 예약합니다. 진행 중인 요약이 있으면 추가 작업을 만들지 않습니다. 요약은 일반 회의의 처리 자리를 점유하지 않으므로 다음 바퀴가 계속 돌고, 종료할 때 진행 중 요약이 끝난 뒤 stopped 하트비트를 남깁니다. 하트비트의 `summary_running`이 병행 요약 상태입니다.

로컬 기본 `MM_SUMMARY_LLM`은 빈 값이며 OFF입니다. `luna` 또는 `terra`를 설정하면 대응 모델·BE 설정이 필요하고 과금됩니다. 운영은 실제 mm-worker 환경에 `MM_SUMMARY_LLM=luna`를 적용하고 재시작해야 합니다. 예제 파일 수정만으로 켜지지 않습니다. 초기화 성공 로그는 `[summary] runner ready model=luna`이며 API 인증·요약 품질 검증과는 별개입니다.

BE는 스위치 OFF 중에도 대상 회의를 표시합니다. ON하면 기존 pending도 회의 시각 순서로 처리합니다. 회의당 15분 임대와 최대 두 번 시도를 유지하며, 화면의 pending은 1시간 뒤 감춰도 큐에는 남습니다. 표시되지 않은 옛 회의는 자동으로 등록하지 않습니다. 재처리 명령은 `python -m capture.backfill_summaries --workspace ID --all --dry-run`이고 유료 실행은 `--meeting`으로 범위를 지정합니다.
