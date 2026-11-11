# M0. 서버·DB·실행·검증 기반

[전체 계획](../backend-plan.md)의 M0 절을 옮긴 마일스톤 계획이다(기준일 2026-10-02). 이후 진행과 검증 결과는 [결과](result.md)에 있다. 결정 기록은 [basis-for-decision](basis-for-decision/)에 있다.

## 범위

- FastAPI 라우터·응답 봉투·오류 처리
- PostgreSQL·SQLAlchemy·Alembic
- pgvector
- 로컬 실행·운영 Docker 구성
- 백엔드 CI
- 마이그레이션·실제 동시성 검증
- README·프론트 계약의 최신성

## 작업

- 현재 코드·OpenAPI와 문서의 차이를 정리하고 기준 커밋을 남긴다.
- 빈 DB 초기화와 기존 DB 업그레이드를 CI에서 검증한다.
- SQLite 테스트를 유지하되 잠금·경합·유일 제약은 실제 PostgreSQL 테스트로 보완한다.
- 환경변수, 워커 활성화 조건, 프록시·health 점검 경로를 정리한다.
- 전체 테스트의 기준 실행 결과를 기록한다.

## 완료 기준

새 환경에서 설치·마이그레이션·서버 실행·테스트를 문서대로 재현할 수 있다.
