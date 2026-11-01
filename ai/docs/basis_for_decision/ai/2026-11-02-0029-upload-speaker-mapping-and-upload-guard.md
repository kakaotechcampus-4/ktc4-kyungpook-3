# 0029. 업로드 화자 지정은 `member_id` 칸과 `mapped` 상태로 남기고, 인계 합의 전까지 업로드 회의는 워커가 집지 않는다

- 기록일: 2026-11-02 (사용자와 설계 확정한 날과 같다)
- 관련 마일스톤: 별도 마일스톤 없음. 수동 회의록 업로드 2단계(`feature/manual-upload-speaker-mapping`, #252 위에 쌓음). 앞 결정은 [0028](2026-11-01-0028-manual-upload-hosted-diarization-and-diarized-state.md)

## 문제와 제약

#252 는 업로드 음성을 화자 라벨(`SPEAKER00`)별 트랙과 `diarized` 매니페스트로 만든다. PM 이 라벨을 멤버로 지정하는 결과를 매니페스트에 남겨야 한다. 제약은 아래와 같다.

- 업로드 회의를 BE 로 인계하는 방식(화자를 멤버 ID 로 보내기, [#254](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/254), [#255](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/255))은 BE 와 합의 전이다. 이번에는 인계를 하지 않는다.
- 전사 단계는 wav 파일명 첫 `_` 앞을 화자 id 로 쓴다(`stt/transcribe.py` `parse_wav_stem`). 이미 쓴 파일명과 어긋나면 안 된다.
- `shared/schemas.py` 와 BE 계약은 바꾸지 않는다.

설계 중에 0028 의 서술 하나가 틀렸다는 것을 확인했다. "`saved` 로 바꾼 업로드 매니페스트를 자동 바퀴가 집는다"고 적었지만, 실제 워커 바퀴(`recover_pass`)는 서버를 정하지 않은 바퀴에서도 `guild_id` 없는 매니페스트를 거른다. 0028 은 2026-11-02 에 정정했다. 다만 이 필터는 업로드를 막으려고 둔 것이 아니어서, 필터가 바뀌면 업로드가 처리될 수 있다.

## 실제 검토한 선택지

설계 초안(`ai-designer`)과 사용자 논의에서 나온 것만 적는다.

- 지정을 남기는 방식: (1) `speakers[].member_id` 칸 추가, `user_id`(라벨) 유지, (2) 최상위 `speaker_map`, (3) `user_id` 를 멤버 ID 로 교체.
- 지정 완료 후 상태와 막는 방식: (A) 새 상태 `mapped` + `_is_pending` 에서 `source == "upload"` 를 상태와 무관하게 막기, (B) `saved` 로 보내고 `process_session` 에서 BE 직전에 멈추기, (C) `saved` 로 보내고 기존 `guild_id` 필터에 기대기.
- 부분 지정 허용 여부, 같은 멤버를 여러 라벨에 지정 허용 여부, 입력 방식(JSON 파일 vs 옵션 인자).

## 선택과 이유

- **`member_id` 칸 추가 (1)**. 파일명·`user_id` 가 그대로라 전사 규칙과 어긋나지 않는다. #254 의 "기존 필드 뜻은 유지, 멤버는 새 칸" 원칙과 같다. `null` 은 외부 참석자다. 칸이 없으면 아직 지정하지 않은 것이다.
- **`mapped` + `_is_pending` 업로드 가드 (A)**. 막는 곳이 한 군데라 목록, 재확인, `recover()`, 자동·`--retry` 바퀴에 모두 적용된다. 사람이 상태를 직접 `saved` 로 고쳐도 막힌다. B 는 쓰는 곳 없는 전사·LLM 비용이 들고 위험이 큰 `process_session` 에 분기가 는다. C 는 우연에 기대는 방어라 필터를 고치는 순간 새어 나간다.
- **모든 라벨을 한 번에 지정**. #255 의 BE→AI 지정 결과도 한 번에 오는 모양이다.
- **같은 멤버를 여러 라벨에 지정 허용**. 화자 분리가 한 사람을 두 라벨로 나눌 수 있다(측정한 것은 아니다).
- **입력은 함수 `upload.mapping.apply_mapping` 과 CLI `python -m upload.mapping <매니페스트> <mapping.json>`**. JSON 은 #255 모양(`{"mapping": {...}}`)이나 dict 그대로를 받는다.

## 장단점과 감수한 제약

- 이번 PR 에서는 업로드 회의가 전사도 되지 않는다. 지정까지 끝나도 다음 PR(인계)이 가드를 풀기 전까지 처리되지 않는다.
- 멤버 ID 가 실제 워크스페이스 멤버인지는 AI 가 알 수 없어 형식만 확인한다. 실제 확인은 BE 가 지정 API 나 #254 의 발화 저장 400 으로 한다.
- 구현 중 정한 거부 규칙(같은 라벨 두 표기 중복, 공백 멤버 ID, 잠금 중)은 측정이 아니라 안전 쪽으로 판단한 것이다.

## 영향 범위와 재검토 조건

- 매니페스트(AI 내부 문서 계약)에 상태 `mapped`, `speakers[].member_id`, 최상위 `mapped_at` 이 추가됐다. `shared/schemas.py` 와 BE 호출은 바뀌지 않았다.
- 디스코드 매니페스트에는 최상위 `source` 가 없어 가드의 영향을 받지 않는다.
- 다음 PR(인계)에서 `_is_pending` 의 업로드 가드를 풀고 `mapped` 회의를 처리 대상으로 바꾼다. #254·#255 합의가 선행 조건이다.

## 근거와 관련 문서

- 설계 초안과 사용자 확정 논의(2026-11-02, 세션 작업 파일. 저장소에는 올리지 않음)
- [0028](2026-11-01-0028-manual-upload-hosted-diarization-and-diarized-state.md), [0027](2026-10-30-0027-manual-upload-overlap-deferred.md)
- 코드: `ai/upload/mapping.py`, `ai/capture/recorder.py` 의 `STATUS_MAPPED`·`_is_pending`·`recover_pass`
