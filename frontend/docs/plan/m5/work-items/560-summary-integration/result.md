# #560 요약 통합 결과

## 작업 근거와 요약

2026-11-09 사용자 요청은 PR #560의 병합 문제 해결과 자동 요약 ON이다. 최신 develop의 삭제·탈퇴·동의·소켓·음성 정리를 보존해 통합한다. 마일스톤 계획 밖 이슈 작업이므로 이 결과에만 기록하며 전체 계획과 사람의 트러블슈팅은 수정하지 않는다.

## 실제 구현 및 관련 코드

- 8개 충돌을 해소했다. AI 워커는 일반 처리·업로드 뒤 개인정보/회의 정리와 음성 정리를 유지하며 요약 한 건을 별도 작업으로 예약한다. 진행 중 요약이 끝나기 전에 다음 일반 바퀴가 돌고, 종료 때 요약을 마친 뒤 stopped를 기록한다.
- [요약 서비스](../../../../../../backend/app/services/summary.py)는 발급 당시 identity_epoch를 결합한 claim token과 15분 임대, 공간·회의 생존 여부를 검사한다. 만료·교체·중복·세대 변경 결과는 applied=false다. 최신 세대 헤더를 붙여도 이전 토큰을 재사용할 수 없다. 두 번 시도와 ready/pending/none 규약을 유지한다.
- [회의 삭제](../../../../../../backend/app/services/meeting_deletion.py)는 Topic·Decision 연결과 다른 요약의 삭제 원문 사본을 지운다. 프로젝트 맵·합본·다운로드는 삭제 회의를 제외하고 Task 업무를 보존한다.
- 미배포 migration 7536c5a1a471의 부모를 develop head f7f0dc53a63a로 연결했다. 임대 토큰 hash와 요청된 행의 부분 인덱스를 포함한다. 기존 AI 결정 번호 충돌은 0058·0059로 정리하고 0053·0055와 원문 판단을 보존했다.
- `summary_from_env`의 기본 OFF를 유지하고 성공 시 비밀 없는 runner ready 로그를 남긴다. 실제 운영 Luna ON은 배포 설정과 실행 환경에서 별도로 검증한다.
- [배포 helper](../../../../../../deploy/enable-summary.py)는 기존 active 워커에 고정 Luna drop-in을 설치하고 재시작한다. 실제 실행 환경과 PID·시작시각에 연결된 준비 로그로 ON을 판정한다. 미활성·실패 시 성공 배포 SHA를 유지한다.

## 요청 조건 확인

| 조건 | 상태 | 근거 |
|---|---|---|
| 충돌 해소와 기존 경로 보존 | 구현·기존 회귀 확인 | 충돌 마커 없음, BE baseline SQLite 138개·PG 포함 274개 통과 |
| 늦은 응답·삭제·탈퇴 차단 | 격리 API·DB 확인 | 기존 API 반례 6개 red 보존, 새 token·epoch·삭제 사본·동시성·실제 공유 공간 탈퇴 검사 통과 |
| 일반 회의 처리와 요약 병행 | 확인 | 막힌 FakeLLM에서 다음 pass·단일 claim·종료 drain 검사, AI 관련 164개 통과 |
| 단일 migration head | 확인 | base downgrade와 fresh 전체 upgrade, 부모 downgrade/재적용, alembic check 통과 |
| 실제 운영 요약 ON | 별도 배포 검증 필요 | 예제 변경과 runner 생성만으로 운영 ON을 완료했다고 판정하지 않음 |

## 검증 내역

초기 SQLite API에서 삭제된 회의·공간 claim/input, 탈퇴 전 epoch PUT, 첫 임대의 늦은 PUT을 여섯 개 실패 사례로 확인했다. 최종 요약 큐·저장·맵·삭제·탈퇴·수명주기 검사는 SQLite와 전용 PostgreSQL에서 411개 통과, PostgreSQL 전용 검사의 SQLite 실행 등 9개 건너뜀이다. 동일 공간의 네 claim, 삭제/PUT 양방향 잠금, 실제 공유 공간 탈퇴 후 옛 epoch 거절, 동명이인 보존, 삭제된 replaces 사본과 합본·맵의 원문 링크 제거를 확인했다.

이후 실제 API 검증에서 탈퇴 전 토큰에 최신 세대 헤더를 붙이면 저장되는 반례를 확인했다. 실제 공유 공간 탈퇴 API를 호출하는 SQLite와 PostgreSQL 테스트에서 두 건의 실패를 보존했다. 토큰 hash에 발급 세대를 결합한 뒤 수명주기 검사 33개가 통과했고 SQLite에서 PostgreSQL 전용 검사 3개를 건너뛰었다. 이전 세대 헤더의 409, 최신 헤더와 이전 토큰의 `applied=false`, 새 세대 재claim의 정상 저장을 확인했다. 백엔드 전체 Ruff 검사도 통과했다.

AI는 요약 생성·공유 스키마·클라이언트·재처리·워커·병행 스케줄링 범위에서 164개가 통과했다. Windows SIGTERM 종료 코드는 원본에서도 발생하는 환경 실패로 별도 보존했다. 전체 AI 수집은 Windows의 resource/fcntl 부재로 10개 오류가 있었고 이 테스트를 약화하지 않았다. 실제 LLM·운영 API·Discord 발송은 이 격리 검사에 포함하지 않는다.

전용 PostgreSQL에서 최종 migration을 base까지 되돌린 뒤 전체 head 적용, check, develop 부모까지 downgrade, 재적용과 check를 실행했다. 모두 성공했고 head는 7536c5a1a471 하나다.

독립 실제 HTTPS 검증은 PostgreSQL과 실제 AI SummaryRunner·BeClient를 사용해 86개 요청을 통과했다. 요약 대기·임대 교체·중복 저장, PM·팀원 조회와 비멤버 차단, Markdown 다운로드, 삭제 사본 정리, 생존 Task 보존과 탈퇴 세대 변경을 확인했다. 외부 모델 대신 FakeLLM을 사용했다. 검증 서버 포트, scratch와 전용 DB 테이블은 정리했다.

배포 helper는 저장소 테스트 38개와 새 독립 검사 16개를 통과했다. 실제 Bash의 생략·실패·성공·재실행에서 배포 SHA를 확인했다. 재사용 PID의 과거 준비 로그는 거부하고 현재 실행의 준비 로그만 수락했다. 같은 GPT 계열의 별도 reviewer가 실행했으며 실제 Linux systemd·공급사 인증·운영 활성화의 근거는 아니다.

추가 독립 PostgreSQL 검사에서 프로젝트 맵 조회 중 다른 트랜잭션이 회의를 추가·삭제하면 KeyError가 나는 두 반례를 확인했다. 연결을 이번 응답이 로드한 live 회의 집합에 한정한 뒤 같은 두 회귀가 통과했다. 실제 삭제 뒤 태스크 보존과 삭제 회의 링크 제외, 다음 조회의 새 회의 노출을 확인했다. 전체 맵 검사는 108개 통과, SQLite의 PostgreSQL 전용 검사 2개 건너뜀이며 백엔드 전체 Ruff도 통과했다.

PR #560은 병합됐고 CI를 통과했으나 [첫 실제 배포](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/actions/runs/42602812466)는 활성 워커의 `worker-command-unsupported` 판정으로 실패했다. 실제 인자는 관측하지 못했다. 절대 경로 Python의 선택적인 `-u`와 [장기 워커 CLI](../../../../../../ai/capture/worker.py)의 세 옵션을 비출력 parser로 검증하도록 보완했다. 원본에서 정상 실행 형식 세 건이 거부되는 반례를 보존했고, 기존 검사와 비밀값 누출·미지원 명령 거부를 포함한 51개 검사가 통과했다. 기존 독립 검사 16개와 실제 Bash의 생략·실패·성공·재실행도 다시 통과했다. 이 결과는 운영 ON 판정이 아니며 다음 배포에서 실제 명령의 안전한 형태와 runner 준비를 확인한다.

## 계획 대비 변경

단순 충돌 해소만으로는 기존 삭제·탈퇴 규칙을 우회하고 오래된 응답을 저장했다. 실제 API 반례를 근거로 임대 토큰과 삭제 정리를 추가했다. ON 시 일반 처리를 막는 문제도 Event 반례로 확인해 요약 작업 하나를 분리했다. 사용자에게 새 정책 승인 단계를 추가하지 않았다.

## 남은 작업과 제한 사항

CI·병합·운영 활성화는 후속 확인 대상이다. 이미 저장한 공동 자유문장의 전역 이름 치환은 수행하지 않는다. 유료 기존 회의 전체 backfill은 실행하지 않았다. 보호 계획·사람의 트러블슈팅 38개는 시작 해시와 같고 새 기록의 상대 링크가 존재함을 확인했다.

## 관련 기록

- [대표 BE·AI 계약](../../../../../../backend/docs/contracts/backend-ai-contract.md#회의-요약).
- [임대와 삭제 경계 선택](../../../../../../backend/docs/plan/m3/basis-for-decision/2026-11-09-summary-lease-and-deletion.md).
- [AI 실행 안내](../../../../../../ai/README.md#회의-요약).
