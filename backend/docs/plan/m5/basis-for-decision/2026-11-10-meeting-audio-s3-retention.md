# 회의 녹음은 S3 한 곳에 7일 보관하고 presigned 302 로 들려 준다

- 기록일: 2026-11-10
- 관련 마일스톤: M5(웹 음성 업로드·비동기 처리), 이슈 #659. M5 plan.md 는 비어 있어 이슈와 사용자와 정한 설계를 작업 근거로 삼으며 마일스톤 완료를 판정하지 않는다.

## 문제와 제약

- 전체 계획 M5 는 음성을 "처리 중 임시 보관, 최종 종료 후 삭제"로, 원본 다시 듣기를 "1차 제외"로 두었다([backend-plan.md](../../backend-plan.md) 250-251줄, 보호 문서라 고치지 않는다). 사용자는 팀원이 웹에서 회의 원문(근거 발화의 시각)을 다시 들을 수 있게 하기로 했고, 보관 기간은 7일로 정했다.
- 대상은 웹 업로드 회의와 디스코드 음성 회의다. 채팅 회의는 녹음이 없어 제외했다. 업로드 원본은 BE 가 이미 갖고 있고, 디스코드 녹음은 AI 서버 디스크에만 있다.
- 운영 서버는 EC2 한 대(docker compose)이고 API 는 `--workers 1` 이다. 재생은 Range 요청(seek)이 되어야 하고 긴 파일을 보내는 동안 BE 연결·DB 연결을 붙잡지 않아야 한다([긴 파일 응답 결정](2026-11-04-close-db-before-file-response.md)).
- S3 버킷과 인스턴스 역할은 인프라 담당이 준비한다. BE 는 AWS 키를 받지 않는다(instance profile).

## 실제 검토한 선택지

설계 합의에서 비교한 선택지다. 안마다 버린 이유는 합의된 설계 문서의 결정 항목과 코드에서 읽은 것이며, 구현 전에 잰 수치는 없다.

1. **S3 단일 저장소 + presigned 302(선택).** 새 녹음과 업로드 원본을 모두 S3 에 두고, 재생은 권한을 확인한 뒤 S3 임시 주소로 302 한다.
2. 디스크에 7일 보관: 기존 `uploads` 볼륨을 그대로 쓴다. 인스턴스 한 대의 디스크에 녹음이 쌓이고, 인스턴스를 바꾸면 사라진다.
3. done 이 된 뒤에 S3 로 복사: 처리 중에는 디스크, 끝나면 S3. 두 저장소를 모두 읽는 경로와 복사 실패·중복 상태 처리가 생긴다.
4. BE 가 S3 를 읽어 스트리밍: Range 를 직접 처리해야 하고, 재생하는 동안 API 프로세스가 바이트를 중계한다.
5. 재생 주소를 JSON 으로 내려주고 프론트가 이동: 응답이 주소를 들고 다녀 `<audio src>` 를 바로 쓸 수 없고, 프론트가 주소 만료를 따로 다뤄야 한다. 302 는 `src=/api/v1/meetings/{id}/audio` 하나로 되고 만료 시 같은 주소를 다시 부르면 된다.

## 선택과 이유

### 저장소와 재생

1번을 택했다. `UPLOAD_STORAGE=local|s3`(기본 local)로 저장소를 고르는 추상화를 두고([upload_storage.py](../../../../app/services/upload_storage.py)), 운영은 s3 만 쓴다. 키는 업로드·디스코드 모두 `{UPLOAD_S3_PREFIX}{meeting_id}/audio.<확장자>`(기본 `meetings/`)로 같다. local 은 개발·테스트용으로 남겼다.

`GET /meetings/{id}/audio` 는 done 회의는 팀원 모두, 그 밖의 상태는 PM 만 허용한다([meetings.py](../../../../app/api/meetings.py)). s3 에서는 `Cache-Control: private, no-store`, 응답 Content-Type 고정(`ResponseContentType`), 유효 시간 `UPLOAD_PLAYBACK_URL_TTL_SECONDS`(기본 3600)의 presigned GET 으로 302 한다. 302 를 내기 전에 DB 연결을 닫는다. S3 가 Range 와 대역폭을 맡으므로 BE 는 재생 중 아무것도 중계하지 않는다.

AI 가 가져가는 `GET /uploads/{id}/file` 은 모양을 바꾸지 않았다. s3 에서는 BE 가 S3 에서 읽어 바이트를 대신 보낸다(리다이렉트 없음). AI 쪽 코드를 건드리지 않기 위해서다.

### 보관 기준은 DB, 처리 중에는 지우지 않는다

회의마다 `meeting_audio` 한 행(파일명·형식·크기·`retention_from`·`deleted_at`)을 둔다([meeting_audio.py](../../../../app/services/meeting_audio.py)). 업로드 회의는 파일을 저장한 같은 커밋에서 만든다. 만료·재생 가능 여부는 파일이 아니라 이 행으로 판단한다. 이유는 S3 객체의 시각을 다시 읽지 않아도 되고, 업로드 행이 없는 디스코드 회의도 같은 규칙으로 다루기 위해서다.

- 보관 기준 `retention_from`: 업로드는 받은 시각(`uploaded_at`), 디스코드는 회의 종료 시각(`meeting.ended_at`, 없으면 받은 시각). 기준에서 `UPLOAD_AUDIO_RETENTION_DAYS`(기본 7)일 뒤가 `expires_at` 이다. 디스코드를 받은 시각이 아니라 종료 시각으로 센 것은 이슈 #659 리뷰(2026-11-10)를 사용자가 받아들인 결정이다. AI 가 늦게 올려도 팀원이 듣는 기간이 길어지지 않고, 올라온 시점에 이미 기간이 지났으면 저장하지 않고 `stored=false` 로 답한다.
- 처리 중 보호: sweeper 는 done 이면서 기간이 지난 녹음만 지운다. 처리 중(done·failed 가 아님)인 업로드는 7일이 지나도 지우지 않는다. 화자 지정 대기 같은 처리에는 아직 녹음이 필요하기 때문이다. failed 회의의 녹음은 지금처럼 즉시 지운다. 회의를 잠근 뒤 조건을 다시 확인하고 파일 삭제가 성공한 뒤에만 `deleted_at` 을 커밋한다. 삭제 실패는 다음 바퀴에 다시 한다.
- 안전망: S3 lifecycle `meetings/` 30일 만료를 인프라 체크리스트에 올렸다([deploy/README.md](../../../../../deploy/README.md#회의-녹음-s3-준비)). DB 정리가 어긋나도 30일 안에는 사라진다.

### 디스코드 녹음은 AI 가 섞어 올린다

디스코드 녹음은 화자별 wav 트랙이 AI 디스크에만 있다. AI 는 인계 직후 트랙을 샘플 0 에 맞춰 m4a 하나로 섞어 `PUT /meetings/{id}/recording`(서비스 토큰)으로 올린다([sources.py](../../../../app/api/sources.py), [계약](../../../contracts/backend-ai-contract.md#회의-녹음-올리기-put-meetingsmeeting_idrecording--200)). BE 는 m4a 만 받고, 디스코드 회의이고 done 일 때만 받으며, 같은 회의에 다시 올리면 파일만 바꾸고 `retention_from` 은 유지한다(멱등). 올리는 동안 DB 연결을 잡지 않고, 올리는 사이 회의가 지워졌거나 정리됐으면 새 파일을 치운다. 그래서 `Source.start_ms`(근거의 `evidence_at_ms`, 대본의 `at_ms`)가 섞은 파일 안 위치와 같다. 새 시각 필드는 만들지 않았다.

## 전체 계획 250-251줄과 다른 이유

보호 계획의 "최종 종료 후 삭제"와 "원본 다시 듣기 1차 제외"는 이번 요구와 맞지 않는다. 계획 파일은 고치지 않는다. 다른 점은 이 기록과 [M5 결과](../result.md)에 남긴다.

- 최종 종료 뒤에도 7일 보관한다(처리 중이면 그 이상).
- 원본 듣기를 제공한다. 웹 화면은 FE 이슈로 요청했다.
- 음성은 민감한 개인정보이므로 기간은 짧게(7일), 실패한 회의는 즉시 지운다는 기존 방침의 취지는 유지했다.

## 동의 버전은 올리지 않는다

BE `CURRENT_VERSIONS`(약관·방침 동의 버전)는 그대로 둔다. 음성 보관 7일 안내는 방침 문구와 봇 녹음 시작 안내(AI)만 바꾸고, 팀원에게 재동의를 받지 않는다. 이는 사용자가 정했고 이슈 #659 리뷰 때 다시 확인했다. 방침 문구는 FE 가 고친다(문구만, POLICY_VERSION 그대로). 업로드 회의가 처리 중이면 7일을 넘길 수 있다는 점을 문구에 적어 달라고 요청한다. 이 선택의 법적·운영 영향은 BE 가 판단하지 않았다.

## 장단점과 감수한 제약

- S3 의존이 생긴다. 설정 누락(버킷 없음·알 수 없는 `UPLOAD_STORAGE`)은 가려 주지 않고 500 이다. `_s3_client` 는 프로세스당 캐시라 `AWS_REGION` 을 바꾸면 재시작해야 한다.
- 디스크에서 S3 로 옮길 때 디스크를 예비로 읽는 경로가 없다. 전환 전에 만든 업로드는 S3 에 없으므로 처리 중인 업로드가 없을 때 `UPLOAD_STORAGE=s3` 로 바꾼다(배포 체크리스트). 마이그레이션은 처리 중(done·failed 가 아님)인 기존 업로드 회의만 `meeting_audio` 로 채운다. 이미 done 이라 디스크에 남은 옛 업로드 녹음에는 행이 없어 `no_recording` 이다.
- 302 로 브라우저가 S3 출처에 직접 요청한다. `crossOrigin`·Web Audio 를 쓰면 S3 CORS 가 필요하고, Caddy CSP 의 `media-src` 가 S3 출처를 허용해야 한다(#654 확인). 주소는 만료되므로(기본 1시간) 프론트가 다시 `src` 를 설정해야 한다.
- 7일은 사용자가 정한 값이다. 사용량으로 정한 것이 아니다. S3 용량·비용은 측정하지 않았다.
- AI 가 올리지 못한 디스코드 녹음은 인계 7일 뒤 AI 가 포기해 그 회의는 녹음이 없다(`no_recording`).

## 영향 범위와 재검토 조건

- 계약: [BE↔AI 계약](../../../contracts/backend-ai-contract.md)의 업로드 녹음 저장 위치·삭제 시점·`PUT /meetings/{id}/recording`. 웹 쪽(`/audio` 권한·302, `minutes.audio`, `AUDIO_NOT_AVAILABLE`)은 FE 대표 계약이 관리하므로 고치지 않았고 FE 이슈로 전한다.
- DB: 새 표 `meeting_audio`(마이그레이션 [c7a1e4d92b35](../../../../migrations/versions/c7a1e4d92b35_add_meeting_audio.py)).
- 보관 기간이나 저장소를 바꾸거나, 재처리·다운로드 같은 기능이 녹음을 더 필요로 하면 다시 본다.

## 근거와 관련 문서

- [M5 결과](../result.md), [BE README](../../../../README.md#회의-녹음-보관과-재생), [배포 안내](../../../../../deploy/README.md#회의-녹음-s3-준비)
- 구현: [저장소](../../../../app/services/upload_storage.py), [보관 판단·정리](../../../../app/services/meeting_audio.py), [재생](../../../../app/api/meetings.py), [녹음 받기](../../../../app/api/sources.py)
- AI 쪽 구현: [audio_outbox.py](../../../../../ai/capture/audio_outbox.py), [audio_mix.py](../../../../../ai/capture/audio_mix.py). 이 기록은 BE 선택만 다루고, AI 쪽 선택(섞기·대기 폴더·포기)은 [AI 결정 기록 0066](../../../../../ai/docs/basis_for_decision/ai/2026-11-10-0066-mix-discord-audio-and-upload-to-be.md)에 있다.
