# 0030. 웹 업로드 가져오기는 워커 바퀴 끝에서 한 단계씩, 화자 분리는 맡겨 놓고 다음 바퀴에 확인한다

- 기록일: 2026-11-03 (사용자와 설계를 확정한 날과 같다)
- 관련 마일스톤: 별도 마일스톤 없음. 수동 업로드 1/4([#283](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/283), 묶음 #258). 앞 결정은 [0028](2026-11-01-0028-manual-upload-hosted-diarization-and-diarized-state.md), [0029](2026-11-02-0029-upload-speaker-mapping-and-upload-guard.md)

## 문제와 제약

BE 가 웹 업로드를 받아 두면 AI 가 가져가 화자 분리까지 해야 한다. 경로는 [#255](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/255) 에서 합의했다: `GET /uploads/pending` → `PATCH /uploads/{id}/claim` → `GET /uploads/{id}/file`, 실패는 `PATCH /meetings/{id}/fail` 에 `failed_stage=diarize`. 제약은 아래와 같다.

- 워커는 한 번에 회의 하나만 처리한다. 화자 분리는 외부 서비스(pyannoteAI)라 걸리는 시간을 측정한 적이 없다. 기다리는 한도는 30분으로 두었다.
- 0029 의 업로드 가드(`_is_pending` 이 업로드 매니페스트를 건너뜀)는 화자 지정 전 회의가 전사·인계로 새지 않게 막는 장치라 건드리지 않는다.
- 서버는 t3.medium 이고 워커 메모리 한도는 3GB 다([서버 용량](../member/2026-10-06-server-capacity.md)). 기존 오디오 읽기는 원본을 통째로 올려 48k 스테레오 1시간이면 약 1.4GB 였다(계산값).
- 계약은 claim 응답을 잃고 다시 claim 해서 409 를 받은 경우 단일 워커면 이어서 처리하라고 한다. 다른 곳이 가져간 경우와 구분해야 한다.
- BE 는 m4a·webm 도 받는다. AI 서버에 ffmpeg 프로그램을 새로 설치하지 않기로 했다(#255 AI 답글).

## 실제 검토한 선택지

설계 초안(`ai-designer`)과 사용자 논의에서 나온 것만 적는다.

- 가져오기 위치: (A) 새 모듈을 워커 바퀴 끝에서 한 건씩, (B) 기존 `process_session` 에 새 단계로, (C) 별도 프로세스와 systemd 서비스. 사용자 질문으로 A 를 고친 (A') 화자 분리를 맡겨 놓고 다음 바퀴에 확인하는 안이 더해졌다.
- 오디오 읽기: 모든 형식을 PyAV 로 vs m4a·webm 만 PyAV 로.
- 원본 보관: 매니페스트 저장 뒤 바로 삭제 vs 회의가 끝날 때까지 보관.
- 폴더: 디스코드와 같은 `recordings/` vs 분리.
- pyannoteAI 입력: 16k mono wav vs 원본.
- 실패: 고칠 수 없는 것만 바로 보고하고 일시 오류는 재시도 vs 모두 바로 보고.

## 선택과 이유

- **A'**: `ai/upload/intake.py` 의 `intake_one` 을 워커 바퀴 끝에서 한 번 부르고, 한 번에 한 단계만 진전시킨다(claiming → claimed → converted → submitted → done). 화자 분리는 `Diarizer.submit` 으로 맡기고 job_id 를 진행 기록에 적은 뒤, 다음 바퀴부터 `fetch` 로 확인한다. 분리를 기다리는 동안 디스코드 회의가 밀리지 않고, job_id 를 적은 뒤에는 재시작해도 다시 제출(과금)하지 않는다. 가드와 `process_session` 을 건드리지 않아 0029 의 안전성이 유지된다. B 는 가드를 풀어야 하고, C 는 서버 메모리와 운영 서비스 부담이 생긴다.
- **진행 기록 `recordings/.uploads/<meeting_id>/intake.json` 을 claim 전에 쓴다**: 재시작 전의 claiming 기록이면 409 를 이어서 처리, 방금 쓴 기록이면 건너뛴다.
- **모든 형식을 PyAV 로 조금씩 읽어 16kHz 로 리샘플**: m4a·webm 을 서버 설치 없이 읽고 메모리 위험도 줄인다. 채널은 원래 배치로 리샘플한 뒤 직접 평균한다(PyAV 의 mono 다운믹스는 0.707 계수라 기존 기대값과 다르다).
- **원본은 매니페스트 저장 뒤 삭제, `recordings/` 공유(세션 `upload_<meeting_id>`), pyannoteAI 에는 16k mono wav**.
- **실패**: 시간대 없는 `started_at`, 파일 없음, 디코딩 실패, 화자 구간 없음은 바로 `failed_stage=diarize`. 연결·5xx·pyannoteAI 오류·30분 초과는 디스코드 회의와 같은 재시도 규칙(5회, 60초부터 두 배). 재시도 횟수는 업로드 한 건 전체에 누적한다.
- **claim 뒤 전체 기한 2시간 30분** (2026-11-04 추가): BE sweeper([#301](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/301))는 마지막 진행에서 3시간이 지난 업로드를 `failed` 로 바꾼다([#288](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/288) 합의). 결과 대기 30분 × 5회와 재시도 간격을 더하면 3시간 근처라, claim 시각부터 2시간 30분이 지나면 다시 맡기지도 트랙을 쓰지도 않고 `failed_stage=diarize` 로 보고한다. BE 가 먼저 실패 처리했으면 원본은 404, `/fail` 은 409 `MEETING_ALREADY_ENDED` 이고 둘 다 끝난 것으로 보고 로컬 원본·변환 파일만 지운다.

## 장단점과 감수한 제약

- 다운로드·변환·제출 단계에서는 여전히 워커가 그 시간만큼 붙잡힌다(분리 대기만 빠짐).
- 제출 응답을 받기 전에 끊기거나, 30분 초과·job 실패면 다시 제출되어 과금이 한 번 더 될 수 있다.
- 결과 단계에서 변환 wav 를 다시 통째로 읽는 부분은 트랙 쓰기 구조상 남았다.
- 업로드 가져오기는 명시적으로 켜야 한다(`MM_UPLOAD_INTAKE=1`). 개발 기기의 설정만으로 운영 업로드를 가져가지 않게 하려는 것이다(셀프 리뷰에서 추가).
- 실제 BE·pyannoteAI 로 돌려 본 적이 없다. 처리 시간, 비용, 30분 한도의 적정성은 측정 전이다.

## 영향 범위와 재검토 조건

- `shared/schemas.py` 와 BE 계약은 바뀌지 않았다. 매니페스트(AI 내부)에 업로드용 `be`, `workspace_id`, `title`, `attendees`, `upload` 와 작업 폴더 `recordings/.uploads/` 가 더해졌다.
- 재검토: pyannoteAI 처리 시간을 실제로 잰 뒤, 업로드가 늘어 디스코드 회의 지연이 문제가 될 때(별도 프로세스 C 재검토), 워커를 두 대 이상 둘 때(claim 409 해석 전제가 깨짐).

## 근거와 관련 문서

- 설계 초안과 사용자 확정 논의(2026-11-03), 확정 요약은 #283 댓글
- 계약: `backend/docs/contracts/backend-ai-contract.md` 의 "웹 업로드 가져가기"(develop)
- 코드: `ai/upload/intake.py`, `ai/upload/tracks.py`, `ai/upload/diarize.py`(`submit`·`fetch`), `ai/capture/handoff.py`(`pending_uploads`·`claim_upload`·`download_upload`), `ai/capture/worker.py`
