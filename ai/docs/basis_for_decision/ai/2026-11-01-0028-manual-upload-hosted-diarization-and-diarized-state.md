# 0028. 수동 업로드의 화자 분리는 호스팅 API 로, 라벨 상태는 `diarized` 로 막는다

- 기록일: 2026-11-01 (결정은 2026-10-31 설계 논의에서 사용자와 확정)
- 관련 마일스톤: 별도 마일스톤 없음. 수동 회의록 업로드 AI 첫 단계(`feature/manual-upload-diarize`). 앞 결정은 [0027](2026-10-30-0027-manual-upload-overlap-deferred.md)

## 문제와 제약

음성 파일 하나(모든 화자가 한 트랙)를 지금 디스코드 녹음과 같은 모양(화자별 wav + 매니페스트)으로 만들어야 한다. 그 뒤 `stt.batch.run`(chunk 모드)부터는 바꾸지 않는다. 제약은 아래와 같다.

- 서버는 t3.medium 이다. 로컬 전사 모델은 메모리를 2GiB 넘게 써서 워커 2개가 스왑 없이 들어가지 않았다([서버 용량 측정](../member/2026-10-06-server-capacity.md)). 사용자도 "로컬 pyannote 는 돌아가지 않을 것"이라고 확인했다. 로컬 pyannote 를 직접 재 보지는 않았다.
- 전사 단계는 wav 파일명에서 첫 `_` 앞부분을 화자 id 로 쓴다(`stt/transcribe.py` `parse_wav_stem`). 라벨 `SPEAKER_00` 을 그대로 쓰면 모든 화자가 `SPEAKER` 하나로 합쳐진다.
- 워커는 상태가 `handed_off` 가 아니면 매니페스트를 집는다. 라벨 상태의 회의가 BE 인계까지 갈 수 있다.
- 겹친 발화는 처리하지 않는다([0027](2026-10-30-0027-manual-upload-overlap-deferred.md) 선택지 C).

## 실제 검토한 선택지

설계 초안(`ai-designer`)과 사용자 논의에서 나온 것만 적는다.

- 화자 분리 실행: (1) 로컬 pyannote, (2) 호스팅 API. 초안은 인터페이스 뒤에 로컬 어댑터를 두고 운영 위치는 측정 뒤 정하자고 추천했다. 사용자가 호스팅 API 로 정했다.
- 새 상태: (1) `diarized` 상태를 추가하고 워커가 건너뛰게 한다, (2) 매니페스트를 `session_*.json` 이 아닌 이름이나 다른 폴더에 둬서 워커가 못 보게 한다.
- 모듈 위치: (1) 새 `upload/` 패키지, (2) `stt/diarize.py`.
- 입력 리샘플: (1) soundfile + scipy, (2) ffmpeg CLI.

## 선택과 이유

- **호스팅 API(pyannoteAI)**. `Diarizer` 인터페이스(경로 → 구간 목록) 뒤에 어댑터를 둔다. 서버 메모리를 쓰지 않고, 로컬은 돌아가지 않는다는 사용자 판단을 따른다. 어댑터는 `upload/diarize.py` 의 `PyannoteAiDiarizer` 이고 키는 `PYANNOTEAI_API_KEY` 다. 요청·응답 필드는 2026-10-31 에 공식 `openapi.json` 과 대조했다.
- **`diarized` 상태 + 워커 건너뛰기**. 한 줄 변경으로 라벨 상태 회의가 인계되는 것을 막고, 상태가 문서에 드러난다. 다른 폴더에 두는 방식은 다음 PR 에서 옮기는 단계가 생긴다.
- **`upload/` 패키지**. `capture/` 와 같은 층의 입력 어댑터이고, `stt/` 가 매니페스트·recordings 구조까지 알게 되는 것을 피한다. 플랫폼 격리 검사 대상에 `upload` 를 넣었다.
- **화자 id 는 밑줄을 뺀 라벨**(`SPEAKER00`), `display_name` 은 원 라벨(`SPEAKER_00`). 멤버 지정 칸은 만들지 않고 다음 PR 에서 정한다.
- **soundfile + scipy**. 시스템 의존성을 늘리지 않는다. m4a 는 범위 밖이다.

## 장단점과 감수한 제약

- 회의 음성이 외부 서비스로 나가고 호출마다 비용이 든다. 비용·보존 정책(결과 24시간 보존)은 이번에 따져 보지 않았다.
- 실제 API 호출로는 한 번도 검증하지 않았다. 테스트는 가짜 세션만 쓰고, 필드는 문서 대조로만 확인했다.
- 폴링 간격 10초, 전체 타임아웃 30분, 요청 timeout 60초(PUT 600초)는 구현자가 정한 값이고 측정 근거는 없다.
- `saved` 로 바꾼 업로드 매니페스트는 `guild_id` 없는 자동 바퀴가 집는다(`--retry <서버ID>` 바퀴는 거른다). `workspace_id` 가 없어 BE 인계는 안 되지만 전사·추출 비용은 들 수 있다. 이번 PR 은 이를 막지 않고 README 에 사실대로 적었다.

## 영향 범위와 재검토 조건

- `shared/schemas.py` 와 BE API 호출은 바뀌지 않았다. 매니페스트(AI 내부 문서 계약)에 상태 `diarized`, 최상위 `source`, 회의 폴더의 `diarization.json` 이 추가됐다.
- 다음 PR(PM 라벨 지정 흐름)에서 정할 것: 라벨 → 멤버 지정 방식, `saved` 로 바꾼 뒤 자동 바퀴가 집는 문제와 `workspace_id`, 인계 시 `evidence_speaker` 가 디스코드 uid 라는 전제.
- 재검토: 실제 호출 비용·지연을 재 본 뒤, 또는 호스팅 서비스 정책이 바뀌면.

## 근거와 관련 문서

- 설계 초안과 사용자 확정 논의(2026-10-31, 세션 작업 파일. 저장소에는 올리지 않음)
- [0027 겹친 발화 보류](2026-10-30-0027-manual-upload-overlap-deferred.md), [0008 화자 트랙 배치 전사](../member/2026-09-16-0008-batch-transcription-by-speaker-chunks.md), [서버 용량 측정](../member/2026-10-06-server-capacity.md)
- 코드: `ai/upload/`, `ai/capture/recorder.py` 의 `STATUS_DIARIZED` 와 `_is_pending`
