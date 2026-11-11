# 업로드 만료는 생명주기 잠금 뒤 판정하고 실패 파일은 다시 정리한다

- 기록일: 2026-11-09
- 관련 마일스톤: M5, 이슈 #563·#572, PR #567 검토

## 문제와 제약

사용자는 #567 검토와 처리 가능한 코드·문서 보완을 요청했다. [24시간 미인계 업로드 만료](2026-11-08-unclaimed-upload-sweep.md)의 시간·대상 정책은 유지한다.

최신 통합 코드에서 실제 claim HTTP 요청과 sweeper를 PostgreSQL의 독립 세션으로 교차했다. claim이 공간·회의 잠금을 보유하고 MeetingUpload만 변경한 동안 sweeper UPDATE가 대기했다. `pg_blocking_pids`로 대기를 확인한 뒤 claim을 먼저 커밋했지만, claim은 200을 받고 회의는 failed가 되며 음성이 삭제됐다. UPDATE가 시작할 때의 snapshot은 잠금을 기다리는 동안 다른 테이블에 커밋된 claimed_at을 놓칠 수 있었다.

파일 제거에 PermissionError를 한 번 주입하면 DB는 failed로 커밋되지만 폴더는 남았다. 다음 바퀴는 failed 회의를 후보에서 제외해 파일을 다시 지우지 않았다. 처리 실패는 파일 삭제 완료의 증거가 아니다. `stored_filename`은 NOT NULL 파일명이며 상태 표식으로 바꾸지 않는다.

## 실제 검토한 선택지

1. 기존 failed/manual_upload 상태에서 재시도 대상을 찾는다. 새 컬럼 없이 매 바퀴 live failed 업로드의 파일 제거를 반복한다. 이미 없는 폴더는 멱등 성공이다.
2. 파일 정리 상태 컬럼이나 전용 작업 테이블을 추가한다. 상태 전환과 같은 트랜잭션에 pending 작업을 기록하고, 파일 제거 뒤 완료를 기록한다. 대기 작업만 조회할 수 있지만 마이그레이션·과거 잔존 파일 backfill·회의 및 탈퇴 purge와의 조정이 늘어난다.

## 선택과 이유

첫 번째 안을 선택했다. 실패한 음성은 보관하지 않는 기존 정책을 복구하는 범위이며 별도 업무 상태를 추가할 필요가 없다. failed인 Meeting과 MeetingUpload가 재시도 근거로 남는다. 커밋 뒤 파일 삭제 전에 프로세스가 종료돼도 다음 바퀴가 남은 폴더를 지운다.

상태 전환은 기존 `require_live_meeting(lock=True)`로 공간→회의 잠금을 얻은 뒤 새 UPDATE 문장에서 조건을 판정한다. claim·resume·발화 저장이 먼저 커밋했다면 새 조건 조회에 반영한다. sweeper 전체를 직렬화하는 전역 잠금은 추가하지 않는다.

파일 재시도는 새 실패 전환 전에 별도 pass로 실행한다. 기존 `remove_upload`의 best-effort·None 반환 계약은 유지한다. `fail_meeting_if`의 True와 sweeper 반환 목록은 처리 상태 전환만 뜻한다. 파일 정리 결과는 실제 파일과 후속 재시도로 확인한다.

## 장단점과 감수한 제약

- 별도 마이그레이션과 중복 pending 상태가 없다. 대신 이미 파일이 없는 과거 failed 업로드도 매 바퀴 조회·잠금·제거 시도의 대상이다. 실패 이력이 커져 조회 비용이 문제가 되면 별도 작업 상태를 검토한다. 성능 측정 결과는 없다.
- 파일 잠금·I/O 오류는 로그에 남고 다음 바퀴에 재시도한다. 서버나 sweeper가 정지한 동안은 복구되지 않는다.
- 과거 failed/manual_upload의 잔존 음성도 삭제될 수 있다. 이는 처리 종료 후 음성을 삭제하는 기존 정책의 복구다. 재처리에 필요한 음성 보존이나 복구 기능은 제공하지 않는다.
- done 업로드나 저장 실패로 DB 소유 행이 없는 폴더는 이 재시도 대상이 아니다. 회의·공간 삭제는 기존 전용 purge가 맡으며 해당 영수증의 완료 상태를 이 코드가 바꾸지 않는다.

## 영향 범위와 재검토 조건

공통 실패 helper의 소비자는 AI `/meetings/{id}/fail`과 sweeper다. 파일 제거 helper는 추출 완료·업로드 트랜잭션 실패·저장 실패에서도 쓰이므로 반환·예외 계약을 바꾸지 않았다. 실패 파일 정리 완료를 사용자에게 제공하거나 실패 이력이 커져 매번 조회하기 어려워지면 전용 상태 대안을 검토한다.

## 근거와 관련 문서

- [M5 결과](../result.md), [봇 계약](../../../contracts/backend-ai-contract.md)
- 구현: [실패 전환](../../../../app/services/meeting_failure.py), [sweeper](../../../../app/services/upload_sweeper.py), [파일 저장](../../../../app/services/upload_storage.py)
- 재현·회귀: [HTTP·PG 교차](../../../../tests/services/test_upload_sweeper_concurrency.py), [파일 오류·회의 삭제·탈퇴 인계](../../../../tests/services/test_upload_sweeper.py)
- 실제 운영 자료 삭제·배포 검증은 하지 않았다. 로컬 검증 내역과 한계는 M5 결과에 기록한다.
