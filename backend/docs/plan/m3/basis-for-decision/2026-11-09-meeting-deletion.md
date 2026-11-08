# 회의 원문 삭제와 업무·재처리 계보 보존

- 기록일: 2026-11-09
- 관련 작업: #572, #576. M3의 회의·추출 생명주기 범위이며 plan.md는 비어 있다.

## 문제와 제약

사용자는 회의를 지울 때 전사·회의록·추출·근거를 제거하고 생성된 태스크는 남기기로 했다. 여러 회의가 합쳐진 대기 카드는 남은 회의 기여로 재구성하기로 확정했다. 기존 Task는 Meeting을 참조하며 채팅 cursor도 회의 메타데이터를 사용한다. 실패 재처리는 새 회의 ID를 만들고, BE와 AI 파일은 서로 다른 저장소에 있다.

## 실제 검토한 선택지

두 독립 설계안으로 원문을 비운 Meeting 행을 남기는 방식과 Meeting을 물리 삭제하고 별도 원장·태스크 출처·cursor 구조를 만드는 방식을 비교했다. 첫 방식을 선택했다. 다른 모델 가족은 도구에서 제공되지 않아 설계 후보는 같은 모델의 독립 작업으로 작성했고, 구현 검토는 별도 가용 모델로 진행했다.

## 선택과 이유

`deleted_at`을 남긴 Meeting 행에서 제목·원문·추출·파일 정보를 제거한다. Task의 FK와 채팅 cursor를 유지해 업무 필드·버전·이력·Notion 작업을 바꾸지 않는다. 중앙 live 검사와 410 응답으로 늦은 AI 쓰기를 막는다.

DB 원문 제거와 파일 제거를 한 번의 성공으로 묶지 않는다. DB에서 삭제를 접수하고 BE·AI 파일 작업이 모두 끝날 때까지 pending을 반환한다. claim token hash와 만료 시각으로 이전 작업자의 ack를 거부한다. AI는 ID만 담은 삭제 표식과 writer·manifest 잠금으로 복구 시 파일이 다시 생기는 것을 막는다.

기존 실패 재처리는 없애지 않고 `replaces_meeting_id`와 root를 추가했다. 오래된 failed 응답 뒤 새 회의가 생기는 경합을 막으려면 DELETE와 재처리 생성이 같은 root를 잠가야 한다. 동일 이전 ID의 재전송은 동일 자식을 반환한다.

대기 카드는 살아 있는 ExtractionItem과 대표 task 근거를 다시 읽어 구성하고 payload 버전과 임베딩을 무효화한다. 마지막 기여를 지웠으면 빈 pending 카드로 남기지 않는다. 이미 닫힌 카드의 원문 payload도 제거하되 카드 ID·상태·태스크 연결은 보존한다.

## 장단점과 감수한 제약

- 참조 이관 없이 기존 업무와 cursor를 보존한다. 대신 정상 조회와 모든 쓰기 경계에 삭제 검사가 필요하다.
- 파일 실패를 사용자에게 pending으로 드러내고 재시도할 수 있다. AI 워커가 중단되면 complete까지 지연된다.
- 처리 중 취소는 구현하지 않았다. 같은 계보가 모두 done/failed일 때만 삭제한다.
- 외부 Notion·Discord에 이미 게시된 결과와 이미 전달된 원문 바이트는 회수하지 않는다.
- 로컬 SQLite 검증으로 PostgreSQL 행 잠금을 증명하지 않는다. 독립 세션 경합과 migration은 PostgreSQL CI에서 확인해야 한다.

## 영향 범위와 재검토 조건

웹 receipt와 Task 삭제 표시는 [FE 계약](../../../../../frontend/docs/contracts/frontend-api-contract.md)에, 봇 재처리·purge는 [BE·AI 계약](../../../contracts/backend-ai-contract.md)에 둔다. 처리 중 취소, 외부 게시물 삭제, 저장소 변경을 도입할 때 이 경계를 다시 검토한다.

## 근거와 관련 문서

- [#576](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/576)
- [M3 실제 결과](../result.md)
- [삭제 서비스](../../../../app/services/meeting_deletion.py)
- [삭제 경합·보존 테스트](../../../../tests/api/test_meeting_deletion.py)
