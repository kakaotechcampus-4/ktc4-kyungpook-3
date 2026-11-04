# 0043. 업로드 회의는 BE 로 보내기 직전에 라벨을 멤버 ID 로 바꾸고, 지정이 끝난 업로드를 처리 큐 앞에 둔다

- 기록일: 2026-11-05 (사용자와 설계를 확정한 날과 같다)
- 관련 마일스톤: 별도 마일스톤 없음. 수동 업로드 4/4([#286](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/286), 묶음 #258). 앞 결정은 [0028](2026-11-01-0028-manual-upload-hosted-diarization-and-diarized-state.md), [0029](2026-11-02-0029-upload-speaker-mapping-and-upload-guard.md), [0040](2026-11-03-0040-upload-intake-in-worker-submit-then-fetch.md), [0041](2026-11-04-0041-upload-assigned-resume-with-local-record.md), [0042](2026-11-04-0042-upload-report-speakers-fixed-body.md)

## 문제와 제약

PM 지정이 끝난(`mapped`) 업로드 회의를 전사·추출해 BE 로 넘겨야 한다. 디스코드 회의는 화자를 디스코드 uid 로 보내지만, 업로드 회의의 화자는 PM 이 고른 멤버라 uid 가 없을 수 있다. 제약은 아래와 같다.

- 계약: [#254](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/254) 에서 `speaker_member_id`·`evidence_speaker_member_id` 를 합의했고 BE #267 이 develop 에 머지됐다. `shared/schemas.py` 는 BE 와 공유하는 계약이라 사용자 승인을 받았다(2026-11-05).
- 전사는 화자 id 를 wav 파일명(`SPEAKER00`)에서 읽는다. 0028 이 변환 지점을 열어 두었다.
- 디스코드 회의의 BE 요청은 바뀌면 안 된다.
- BE sweeper(#301)는 처리 중 업로드를 마지막 진행(지정, 다시 가져감, 새 발화 저장)에서 3시간 뒤 `failed` 로 닫는다. 이 기한 안에 끝내는 방법을 [#288](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/288) 에서 BE 에 답하기로 했다.
- 처리 중 매니페스트를 지우면 처리 마무리(`_keep_ops`, 잠금 해제)가 매니페스트를 다시 쓴다.

## 실제 검토한 선택지

설계 초안(`ai-designer`)과 사용자 논의에서 나온 것만 적는다.

- 변환 지점: (A) BE 로 보내기 직전, (B) 전사 직후, (C) 멤버 ID 를 화자 자리에 넣어 파이프라인 전체에 흘림.
- 3시간 대비: (a) 대책 없음, (b) 지정이 끝난 업로드를 큐 앞으로, (c) 전사 중 발화를 나눠 보내 시계 갱신, (d) 시작 전 예측으로 미리 포기.
- 외부 참석자 표시: (a) 화자·멤버 모두 비움, (b) 화자 칸에 라벨과 "외부 참석자 N" 이름.
- 외부 참석자 발화를 추출에 넣을지, 첫 전송의 400 `member_ids` 를 비우고 다시 보낼지.

## 선택과 이유

- **A**: 변환은 `capture/handoff.py` 가 BE 본문을 만들 때만 한다. 전사·추출·판단은 라벨 id 를 그대로 써서 디스코드 회의에 대한 회귀 위험이 가장 작다. B 는 외부 참석자가 여럿이면 화자가 뭉치고, C 는 멤버 ID 가 디스코드 uid 칸으로 샐 수 있다. 디스코드 회의의 BE 요청은 legacy·judge 두 경로 모두 바이트 단위 회귀 테스트로 먼저 고정했다.
- **업로드 인계**: `/sources` 는 `speaker=null` + 멤버면 `speaker_member_id`, `/extractions` 는 `evidence_speaker=null` + `evidence_speaker_member_id`. `POST /meetings`·`PATCH /end` 는 부르지 않고 BE 가 만든 회의를 쓴다. BE 가 회의를 끝냈으면(발화 저장 409 `MEETING_FAILED`, 추출 등록 409 `MEETING_NOT_PROCESSING`, 404) 새 회의를 만들지 않고 실패 보고 없이, **잠금을 놓은 뒤** 로컬 매니페스트·트랙을 지운다.
- **3시간 대비 (b)**: 근거는 측정값이다. Elice 로 62분 회의 전사 65초([서버 용량](../member/2026-10-06-server-capacity.md), 0039). Elice 가 정상이면 몇 분이면 끝나므로 지정이 끝난 업로드를 디스코드 회의보다 앞에 두어 기다리는 시간만 없앤다. 서버 CPU 전사(1시간당 81.6분, 측정)로는 녹음 약 132분 이상이 전사만으로 3시간을 넘는다(업로드 상한 100MiB 기준 녹음 약 109~218분, 계산). 이 경우는 BE 가 닫은 뒤 정리만 한다. (c) 는 전사 코드를 크게 바꾸고 추출 단계에는 효과가 없다. 판단(LLM) 단계 시간은 측정값이 없다.
- **외부 참석자 (a)**: 화자 칸의 뜻(디스코드 uid)을 지킨다. 회의록에는 "알 수 없음"으로 보일 수 있어 표시 방식은 BE·FE 확인으로 넘긴다. 추출에는 넣는다(LLM 에는 "외부 참석자 N" 이름으로 보이고, 1인칭 항목은 BE 에서 담당 미정이 된다).
- **400 `member_ids`**: 첫 전송·재전송 모두 그 ID 를 비우고 다시 보낸다. 비운 ID 는 로그와 `be.sources.dropped_member_ids` 에 남긴다.
- **처리 바퀴**: 업로드는 `mapped_at`, 모든 화자의 `member_id` 키, `be.meeting_id`, `workspace_id`, `be.status=processing` 이 갖춰졌을 때만 집는다. 서버 ID 없는 매니페스트를 거르는 필터도 업로드는 통과시킨다.

## 장단점과 감수한 제약

- Elice 장애로 CPU 전사를 쓰는 긴 업로드는 시간만 쓰고 실패할 수 있다.
- 외부 참석자 발화는 BE 회의록에 이름 없이 보일 수 있다.
- 지정과 인계 사이에 탈퇴한 멤버의 발화는 화자 미상으로 저장된다.
- 실제 BE·Elice 로 끝까지 돌려 보지 않았다.

## 영향 범위와 재검토 조건

- `shared/schemas.py`: `TranscriptSegment.speaker_member_id`(선택, 값이 있을 때만 직렬화). 디스코드 본문은 그대로다.
- 계약 문서 `backend/docs/contracts/backend-ai-contract.md` 의 "AI 미구현" 표기를 구현 사실로 고치고 업로드 회의 인계 규칙을 적었다.
- 재검토: CPU 전사가 잦아질 때(3시간 대비 (c)·(d)), FE·BE 가 외부 참석자 표시를 바꾸자고 할 때, BE #267 운영 배포가 늦어질 때(멤버 ID 가 조용히 버려진다).

## 근거와 관련 문서

- 설계 초안과 사용자 확정 논의(2026-11-05), 확정 요약은 #286 댓글
- BE: `backend/app/api/sources.py`, `extractions.py`, `services/upload_sweeper.py`
- 코드: `ai/capture/handoff.py`(업로드 분기, `MeetingEnded`), `ai/capture/recorder.py`(`_upload_ready`, `drop_local`), `ai/shared/schemas.py`, `ai/tests/capture/test_discord_be_requests.py`
