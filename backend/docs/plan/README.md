# 백엔드 계획과 마일스톤

[전체 계획](backend-plan.md)의 M0~M7 번호·순서로 폴더를 나눴다.

- M0~M7의 `plan.md`는 전체 계획의 해당 절(범위, 작업, 완료 기준)을 옮긴 것이다.
- 전체 계획은 `backend-development-plan.md`에서 `backend-plan.md`로 이름만 바꿨다. 원문 머리말의 "문서 경로"는 이동 전 경로다.

## 마일스톤 연결

현재 근거는 2026-11-09 develop `70534a85` 기준의 코드·결과 문서다. 새 실행 검증이나 배포 확인이 아니다.

| 번호 | 전체 계획의 범위 | 계획 | 현재 코드·결과 근거 |
|---|---|---|---|
| M0 | 서버·DB·실행·검증 기반 | [plan.md](m0/plan.md) | [결과](m0/result.md). CI·테스트 설정 |
| M1 | 인증·워크스페이스·온보딩·권한 | [plan.md](m1/plan.md) | [결과](m1/result.md). 이메일 증명 가입·카카오·계정 탈퇴 |
| M2 | 태스크·승인·변경 이력·동기화 | [plan.md](m2/plan.md) | [결과](m2/result.md). 승인 시 제목 확인과 후속 수정 기록 |
| M3 | 회의·전사·AI 결과 수신 | [plan.md](m3/plan.md) | [결과](m3/result.md). 근거·별칭·회의 삭제. 삭제 운영 활성화는 별도 |
| M4 | Google·Discord·Notion 실제 연결 | [plan.md](m4/plan.md) | result.md 없음. [연동 API 코드](../../app/api/integrations.py), [현재 API 계약](../../../frontend/docs/contracts/frontend-api-contract.md). Discord·Notion 연결 코드 존재, 외부 운영 성공 판정 없음 |
| M5 | 웹 음성 업로드·비동기 처리 | [plan.md](m5/plan.md) | [BE 결과](m5/result.md), [AI 워커](../../../ai/capture/worker.py). 후속 구현 포함 |
| M6 | 프론트·AI 통합과 계약 확정 | [plan.md](m6/plan.md) | [결과](m6/result.md). 진행 보고·승인 합치기·메시지 읽지 않은 수. 합의·검증 범위는 대표 계약 참조 |
| M7 | 운영 배포·관찰·복구 | [plan.md](m7/plan.md) | [결과](m7/result.md), [배포 안내](../../../deploy/README.md). CI·복구 절차 존재. 현재 배포 성공은 별도 확인 |

## 결정 기록 목록

마일스톤별 `basis-for-decision/`의 기록이다. 날짜는 파일 이름의 기록일이다.

### M0

- 2026-11-08 [CI의 uv 설치 버전을 고정한다](m0/basis-for-decision/2026-11-08-pin-ci-uv-version.md)
- 2026-11-09 [소켓 테스트의 DB 연결을 분리하고 인증 세션 종료를 확인한다](m0/basis-for-decision/2026-11-09-socket-test-session-boundary.md)

### M1

- 2026-11-05 [비밀번호 재설정: 메일 발송·토큰·요청 제한 방식](m1/basis-for-decision/2026-11-05-password-reset.md)
- 2026-11-06 [이메일 정규화: 규칙·저장값 변환·기존 데이터 처리](m1/basis-for-decision/2026-11-06-email-normalization.md)
- 2026-11-06 [카카오 로그인은 가입 화면을 거치고, 기존 이메일이 같으면 자동으로 잇는다](m1/basis-for-decision/2026-11-06-kakao-login-decision.md)
- 2026-11-06 [가입 이메일 인증과 카카오 로그인을 더했다](m1/basis-for-decision/2026-11-06-kakao-login-progress.md)
- 2026-11-06 [로그인 제한: 수치·응답·저장 위치](m1/basis-for-decision/2026-11-06-login-rate-limit.md)
- 2026-11-06 [세션 토큰 해시 저장과 만료 세션 정리](m1/basis-for-decision/2026-11-06-session-token-hash.md)
- 2026-11-06 [가입 이름 검증: 규칙과 적용 범위](m1/basis-for-decision/2026-11-06-signup-name-rule.md)
- 2026-11-08 [이용약관·개인정보처리방침 동의 기록](m1/basis-for-decision/2026-11-08-consent-records.md)
- 2026-11-08 [팀원 표시명 검증: 가입 이름 규칙 공유와 PATCH null 처리](m1/basis-for-decision/2026-11-08-member-display-name-rule.md)
- 2026-11-08 [비밀번호 재설정 메일에 전체 상한과 IP 상한을 둔다](m1/basis-for-decision/2026-11-08-reset-mail-cap.md)
- 2026-11-09 [동의 기록의 멱등 저장과 계정 종료 경계](m1/basis-for-decision/2026-11-09-consent-transaction-boundary.md)
- 2026-11-09 [#575 계정 삭제와 파일 정리 확인의 경계](m1/basis-for-decision/2026-11-09-withdrawal-cleanup-protocol.md)
- 2026-11-09 [#575 영구 탈퇴자의 익명 기록 주체](m1/basis-for-decision/2026-11-09-withdrawn-record-actor.md)
- 2026-11-10 [디스코드 연결은 한 요청으로 옮기고, 이으면 지난 발화 화자도 다시 붙이고, 같은 이름은 서버가 막는다](m1/basis-for-decision/2026-11-10-discord-link-move-decision.md)
- 2026-11-10 [디스코드 연결 옮기기, 지난 발화 화자 다시 붙이기, 같은 이름 거절을 BE 에 더했다](m1/basis-for-decision/2026-11-10-discord-link-move-progress.md)
- 2026-11-10 [팀원 초대는 아이디를 정확히 입력해 찾은 가입자에게 보낸다](m1/basis-for-decision/2026-11-10-invite-by-username-decision.md)
- 2026-11-10 [팀원 초대를 이메일 대신 아이디로 찾은 가입자에게 보내게 했다](m1/basis-for-decision/2026-11-10-invite-by-username-progress.md)
- 2026-11-10 [팀원 삭제는 행을 남기고 is_deleted 만 켠다](m1/basis-for-decision/2026-11-10-member-delete-decision.md)
- 2026-11-10 [PM 이 팀원을 명단에서 뺄 수 있게 했다](m1/basis-for-decision/2026-11-10-member-delete-progress.md)
- 2026-11-10 [모든 계정에 아이디를 두고, 카카오 가입은 카카오만으로 끝낸다](m1/basis-for-decision/2026-11-10-signup-username-decision.md)
- 2026-11-10 [가입에 아이디를 받고 카카오 가입을 카카오만으로 끝냈다](m1/basis-for-decision/2026-11-10-signup-username-progress.md)
- 2026-11-11 [가입 코드 IP 상한, 잠긴 이메일의 재설정, 비밀번호 해시 횟수를 보강한다](m1/basis-for-decision/2026-11-11-auth-abuse-hardening-decision.md)
- 2026-11-11 [가입 코드 IP 상한, 잠긴 이메일의 재설정, 비밀번호 해시 횟수를 보강했다](m1/basis-for-decision/2026-11-11-auth-abuse-hardening-progress.md)
- 2026-11-11 [팀원의 디스코드 계정은 연결한 서버의 멤버일 때만 붙인다](m1/basis-for-decision/2026-11-11-member-discord-guild-check.md)

### M2

- 2026-11-05 [태스크 응답의 자동 막힘 여부는 이력이 아니라 취소 API 조건으로 판정한다](m2/basis-for-decision/2026-11-05-task-auto-blocked.md)

### M3

- 2026-11-06 [승인 때 별칭 학습: 저장 대상과 판단 위치](m3/basis-for-decision/2026-11-06-learn-alias-on-approval.md)
- 2026-11-06 [담당자 별칭 자동 채우기: 후보 검색·이름 별칭·닉네임 별칭](m3/basis-for-decision/2026-11-06-member-alias-auto-fill.md)
- 2026-11-09 [회의 원문 삭제와 업무·재처리 계보 보존](m3/basis-for-decision/2026-11-09-meeting-deletion.md)
- 2026-11-09 [요약 임대와 삭제 경계](m3/basis-for-decision/2026-11-09-summary-lease-and-deletion.md)

### M4

- 2026-11-06 [디스코드 채팅 수집 채널 설정(저장·공지·잠금)](m4/basis-for-decision/2026-11-06-discord-chat-channel-setting.md)

### M5

- 2026-10-14 [업로드 회의는 처음부터 processing 으로 두고, AI 가 가져간 것은 meeting_upload 에 기록한다](m5/basis-for-decision/2026-10-14-upload-claim.md)
- 2026-11-02 [업로드 회의의 화자 지정 대기는 새 상태 awaiting_speakers 로 두고, 동시 처리 제한에서 뺀다](m5/basis-for-decision/2026-11-02-awaiting-speakers-status.md)
- 2026-11-02 [업로드 회의 화자 지정은 meeting_upload 컬럼과 AI 목록 조회·재개, PM 원본 재생으로 구현한다](m5/basis-for-decision/2026-11-02-speaker-assignment-flow.md)
- 2026-11-03 [멈춘 업로드 회의를 서버 안 워커가 실패로 정리한다](m5/basis-for-decision/2026-11-03-upload-sweeper.md)
- 2026-11-04 [파일처럼 오래 보내는 응답은 보내기 전에 DB 세션을 닫는다](m5/basis-for-decision/2026-11-04-close-db-before-file-response.md)
- 2026-11-08 [가져가지 않은 업로드도 24시간 뒤 실패로 정리한다](m5/basis-for-decision/2026-11-08-unclaimed-upload-sweep.md)
- 2026-11-09 [업로드 만료는 생명주기 잠금 뒤 판정하고 실패 파일은 다시 정리한다](m5/basis-for-decision/2026-11-09-failed-upload-cleanup-fence.md)
- 2026-11-10 [회의 녹음은 S3 한 곳에 7일 보관하고 presigned 302 로 들려 준다](m5/basis-for-decision/2026-11-10-meeting-audio-s3-retention.md)
- 2026-11-11 [업로드 본문 크기는 인증 전에 앱 앞단에서 받으면서 잰다](m5/basis-for-decision/2026-11-11-upload-body-limit.md)

### M6

- 2026-11-04 [메시지·알림 설정 저장과 재촉 자동 승인](m6/basis-for-decision/2026-11-04-message-settings.md)
- 2026-11-05 [AI 처리 단계 보고를 회의 컬럼으로 저장한다](m6/basis-for-decision/2026-11-05-processing-stage-report.md)
- 2026-11-06 [묶음 응답의 재촉 이유·근거·요약을 읽을 때 계산하기](m6/basis-for-decision/2026-11-06-bundle-reason-evidence.md)
- 2026-11-07 [자동 생성과 근거 검증을 별도 스위치로 나눈다](m6/basis-for-decision/2026-11-07-auto-create-switch.md)
- 2026-11-07 [메시지 탭 읽지 않은 수를 대화별 읽은 위치로 센다](m6/basis-for-decision/2026-11-07-message-unread-count.md)
- 2026-11-07 [승인 대기 새 항목 요청을 유사 검색 후보에 따로 더한다](m6/basis-for-decision/2026-11-07-pending-approval-search.md)
- 2026-11-07 [다른 회의의 같은 새 항목을 승인 대기 카드에 합친다](m6/basis-for-decision/2026-11-07-pending-merge.md)
- 2026-11-07 [답장 담당자 변경 승인에서 PM 이 담당자를 고르게 한다](m6/basis-for-decision/2026-11-07-reply-assignee-override.md)
- 2026-11-08 [승인 카드를 본 뒤 내용이 바뀌었으면 승인·반려를 409 로 막는다](m6/basis-for-decision/2026-11-08-approval-payload-version.md)
- 2026-11-08 [전사 진행과 단계 시작 시각을 회의 상세에 노출한다](m6/basis-for-decision/2026-11-08-processing-stt-progress.md)
- 2026-11-08 [답장 판단 재시도 상한을 숫자 대신 판단 창으로 지킨다](m6/basis-for-decision/2026-11-08-reply-judgment-attempt-cap.md)
- 2026-11-08 [범위 변경(scope) 승인을 태스크 이력 한 줄로 남긴다](m6/basis-for-decision/2026-11-08-scope-change-history.md)

### M7

- 2026-10-09 [배포 전 CI 를 매번 전부 돌리고 워크플로 단위로 순서를 지킨다](m7/basis-for-decision/2026-10-09-deploy-ci-gate.md)
- 2026-11-10 [운영 모니터링을 Grafana Cloud 무료 플랜과 DB 집계 view 로 본다](m7/basis-for-decision/2026-11-10-grafana-cloud-monitoring.md)
- 2026-11-11 [모니터링 운영 설치에서 바꾼 것: 시드 포함, Alloy root 실행, 알림 규칙 생략](m7/basis-for-decision/2026-11-11-monitoring-install-changes.md)
