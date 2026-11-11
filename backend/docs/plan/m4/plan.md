# M4. Google·Discord·Notion 실제 연결

[전체 계획](../backend-plan.md)의 M4 절을 옮긴 마일스톤 계획이다(기준일 2026-10-02). 이후 진행은 [마일스톤 안내](../README.md)에서 찾는다. 결정 기록은 [basis-for-decision](basis-for-decision/)에 있다.

## 범위

- Google 로그인
- Discord·Notion OAuth
- 연결 조회·해제
- 연결 끊김 상태
- Discord 사용자 목록
- 길드→워크스페이스 조회
- Notion 태스크 쓰기
- Notion 대상 자동 준비·회의록 쓰기

## 작업

- Google 및 provider별 OAuth start·callback을 구현한다.
- 서버 관리 일회성 `state`에 사용자·워크스페이스·허용된 복귀 경로를 연결한다.
- 실제 외부 식별자·표시 이름·연결 상태를 저장한다.
- Discord 서버 목록과 사용자 목록을 실제 데이터로 연결하고 서비스용 길드 매핑 조회를 추가한다.
- Notion 저장 대상을 준비하고 기존 태스크 동기화와 결합한다.
- 회의록 반영도 영속 작업으로 처리한다. 회의록과 자동 태스크는 처리 후, 확인 필요 태스크는 승인 후 반영한다.
- 일시 장애와 권한 철회를 구분하고, 재연결 후 실패 작업을 복구한다.

## 완료 기준

사용자가 수동 DB 조작 없이 연결을 만들고, 실제 Discord 목록과 Notion 회의록·태스크 반영을 확인한다.
