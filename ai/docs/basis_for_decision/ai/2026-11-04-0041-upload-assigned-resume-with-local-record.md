# 0041. PM 지정 결과는 `assigned` 로 찾고 `resume` 직전에 로컬 기록을 남겨 받는다

- 기록일: 2026-11-04 (사용자와 설계를 확정한 날과 같다)
- 관련 마일스톤: 별도 마일스톤 없음. 수동 업로드 3/4([#285](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/285), 묶음 #258). 앞 결정은 [0029](2026-11-02-0029-upload-speaker-mapping-and-upload-guard.md), [0040](2026-11-03-0040-upload-intake-in-worker-submit-then-fetch.md)

## 문제와 제약

PM 이 웹에서 화자 지정을 끝내면 AI 가 그 결과(`{라벨: 멤버 ID | null}`)를 받아 매니페스트를 `mapped` 로 만들어야 한다. 0029 는 지정 결과를 쓰는 함수(`apply_mapping`)만 만들고, 그 입구(CLI 인지 BE 응답인지)는 [#255](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/255) 에서 정하기로 남겼다. #255 합의와 BE PR #269 로 입구가 `GET /uploads/assigned` 와 `PATCH /uploads/{id}/resume` 으로 정해졌다. 제약은 아래와 같다.

- BE 는 머지 전이다. 열린 #269 코드를 기준으로 구현하고 가짜 BE 를 그 코드에 맞췄다(사용자 결정, 2026-11-04).
- `resume` 은 멱등이다(#269 리뷰 반영). 하지만 `assigned` 는 아직 가져가지 않은 회의만 준다. 그래서 `resume` 응답을 잃거나 그 직후 AI 가 죽으면 목록으로는 그 회의를 다시 찾을 수 없다.
- BE sweeper([#301](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/301), [#288](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/288) 합의)는 처리 중 업로드를 마지막 진행에서 3시간 뒤 `failed` 로 바꾼다. 끝난 회의에는 다시 보내지 않고 로컬 파일을 지운다.

## 실제 검토한 선택지

설계 초안(`ai-designer`)과 사용자 논의에서 나온 것만 적는다.

- 찾는 방식: (A) `assigned` 로 찾고 `resume` 직전에 로컬 기록, (B) 로컬 매니페스트마다 `resume` 으로 상태를 물어봄, (C) A 에 느린 확인을 더함.
- 돌리는 위치: (a) 가져오기 함수 `intake_one` 안, (b) 새 함수를 같은 자리·같은 스위치로, (c) 스위치를 따로.
- `assigned` 에 나왔는데 로컬 매니페스트가 없을 때: 건너뜀 / 바로 실패 보고 / 기록 유무로 나눔.
- 지정 결과를 매니페스트에 쓸 수 없을 때(라벨 불일치 등): `diarize` 로 실패 보고 / 새 실패 값 / BE sweeper 에 맡김.
- 지정이 끝내 오지 않는 회의의 트랙 정리: 별도 이슈 / 이번에 같이.

## 선택과 이유

- **A**: 이슈가 정한 경로를 따르고, 지정이 끝났을 때만 BE 를 부른다. B 는 기다리는 회의마다 최대 7일 동안 BE 를 계속 부르고 반영이 늦다. 응답 유실은 #289 의 claim 처럼 "요청 전에 적기"로 푼다. 기록은 `recordings/.uploads/<meeting_id>/intake.json` 안의 `resume` 키(`resuming` → `mapped` / `ended` / `failing` → `failed`)이고, 가져오기 쪽 상태 기계는 건드리지 않는다.
- **(b)** 새 모듈 `ai/upload/assign.py` 의 `assign_one` 을 워커 `_intake_once` 의 같은 자리(가져오기보다 먼저)와 같은 스위치(`MM_UPLOAD_INTAKE`)로 부른다. 따로 테스트할 수 있고, 둘 중 하나만 켜져 회의가 중간에 멈추는 일이 없다.
- **매니페스트 없음은 건너뜀**: 다른 서버가 가져간 회의를 망치지 않는다. 막힌 워크스페이스는 BE sweeper 가 3시간 뒤 푼다. 단 우리가 이미 `resume` 을 보낸 뒤에 매니페스트가 사라졌으면 우리 회의이므로 실패로 보고한다.
- **쓸 수 없는 지정은 `failed_stage=diarize` 로 바로 보고**: PM 이 바로 실패를 보고 다시 올릴 수 있다. 새 실패 값은 BE·FE 에 알려야 한다.
- **잠금 경합은 일시 실패**: `apply_mapping` 이 잠금을 못 잡으면 `MappingBusy`(ValueError 하위)를 내서 영구 실패와 구분한다.
- **트랙 정리는 별도 이슈**: [#325](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/325). 운영에서 업로드 처리를 켜는 건 라벨 보고(#284)와 인계(#286) 뒤다.

## 장단점과 감수한 제약

- `assigned` 에 끝내 나오지 않는 `diarized` 매니페스트(지정 기한 만료, 라벨 보고 전)는 이 PR 로 지워지지 않는다(#325).
- `resume` 일시 실패에는 포기 한도가 없다(멱등이고 BE 가 회의를 끝내면 409 로 멈춘다). 재시도 간격은 최대 1시간이다.
- 가짜 BE 의 PM 지정 흉내는 #301 의 `assign_speakers` 를 근거로 했고, BE 가 하는 라벨·멤버 검증은 흉내 내지 않는다.
- 이 PR 만으로는 실제 BE 의 `assigned` 가 늘 비어 있다. PM 이 지정하려면 AI 가 먼저 라벨을 보고해야 하는데(#284) 아직 없다.

## 영향 범위와 재검토 조건

- `shared/schemas.py` 와 BE 계약은 바뀌지 않았다. AI 내부 기록 `intake.json` 에 `resume` 키가 더해졌다.
- 재검토: BE #269 가 리뷰에서 응답 모양을 바꿀 때, 워커를 두 대 이상 둘 때(매니페스트 없음 건너뜀의 전제).

## 근거와 관련 문서

- 설계 초안과 사용자 확정 논의(2026-11-04), 확정 요약은 #285 댓글
- BE 기준 코드: #269 (`backend/app/api/uploads.py`, `backend/app/services/speaker_assignment.py`), PM 지정 흉내 근거: #301 `assign_speakers`
- 코드: `ai/upload/assign.py`, `ai/upload/mapping.py`(`MappingBusy`), `ai/capture/handoff.py`(`assigned_uploads`·`resume_upload`), `ai/capture/worker.py`
