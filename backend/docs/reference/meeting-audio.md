# 회의 녹음 보관과 재생

[Backend README](../../README.md)로 돌아가기

회의 녹음(웹 업로드 원본, 디스코드 회의는 AI 가 섞어 올린 m4a)을 보관 기간 동안 팀원이 웹에서 다시 듣게 한다(#659). 기록은 `meeting_audio` 표에 회의당 한 행(파일명·형식·크기·`retention_from`·`deleted_at`)으로 둔다.

## 재생

`GET /api/v1/meetings/{meeting_id}/audio` 는 done 회의면 소속 누구나, 그 밖의 상태면 PM 만 듣는다.

- 보관 기간 안이면 s3 저장소는 S3 presigned GET URL 로 302, local 저장소는 파일을 그대로 보낸다(Range 지원). 없거나 지났으면 404 `AUDIO_NOT_AVAILABLE`.
- 302 는 `Cache-Control: private, no-store`, 응답 Content-Type 고정, 유효 시간 `UPLOAD_PLAYBACK_URL_TTL_SECONDS` 다. done 회의는 남은 보관 시간이 더 짧으면 그만큼 줄여 주소가 `expires_at` 뒤까지 열려 있지 않게 한다.
- URL 의 host 는 `<bucket>.s3.<AWS_REGION>.amazonaws.com`(리전 가상 호스트)이다.
- 재생 오류가 나면 이 API 를 다시 불러(`<audio>` 의 `src` 재설정) 새 URL 을 받는다.

> [!NOTE]
> 서명한 자격이 임시 자격(인스턴스 역할 등)이면 그 자격이 먼저 끝날 때 TTL 전에도 S3 가 403 으로 거절할 수 있다. 지금 운영의 전용 사용자 키는 해당하지 않는다.

`GET /meetings/{meeting_id}/minutes` 의 `audio: {content_type, expires_at} | null` 은 호출자가 지금 들을 수 있을 때만 값이다. `expires_at` 은 `retention_from` + 보관 기간이다. 처리 중(done·failed 가 아님)인 회의는 이 시각이 지나도 PM 이 들을 수 있어 값이 오므로, 화면은 `expires_at` 만 보고 "만료됨"으로 단정하지 않는다.

## 받기·삭제·원본

- 디스코드 녹음은 `PUT /meetings/{meeting_id}/recording`(서비스 토큰)으로 받고 개인정보 세대(`X-Privacy-Epoch`)는 보지 않는다([봇 계약](../contracts/backend-ai-contract.md#회의-녹음-올리기-put-meetingsmeeting_idrecording--200)).
- 삭제는 s3 저장소에서도 S3 prefix 와 함께 local 폴더(`UPLOAD_DIR/{meeting_id}`, local 로 운영하던 기간에 남은 것)를 지운다.
- 만료 정리는 파일을 잠금 없이 먼저 지운 뒤 공간·회의를 짧게 잠가 `deleted_at` 을 남긴다. 실패 업로드 파일 재시도는 보관 기록이 없는 옛 회의만 본다.
- `GET /uploads/{meeting_id}/file` 의 모양은 그대로다. s3 저장소에서는 BE 가 S3 에서 읽어 바이트를 대신 보낸다(리다이렉트 없음).

## 설정과 자격

| 환경변수 | 기본 | 설명 |
|---|---|---|
| `UPLOAD_STORAGE` | `local` | `local` 또는 `s3` |
| `UPLOAD_S3_BUCKET` | 없음 | s3 일 때 필수. 비어 있으면 500 |
| `UPLOAD_S3_PREFIX` | `meetings/` | 키 접두어. 끝에 `/` 가 없으면 붙인다 |
| `AWS_REGION` | `ap-northeast-2` | S3 클라이언트 리전. 프로세스당 캐시라 바꾸면 재시작 |
| `UPLOAD_AUDIO_RETENTION_DAYS` | `7` | 양의 정수. 잘못된 값은 경고 로그 뒤 7일 |
| `UPLOAD_PLAYBACK_URL_TTL_SECONDS` | `3600` | presigned URL 유효 시간(초). 양의 정수가 아니면 경고 뒤 기본값 |

자격은 boto3 기본 자격 체인으로 받는다. 운영 버킷이 팀 계정 밖(개인 AWS 계정)에 있어, 그 버킷의 `meetings/*` 만 허용한 전용 IAM 사용자 키를 `.env` 의 `AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY` 에 둔다([배포 안내](../../../deploy/README.md#회의-녹음-s3-준비)). 보관 기준·처리 중 보호·정리 규칙은 [운영 문서](operations.md#녹음-보관정리)에 있다.
