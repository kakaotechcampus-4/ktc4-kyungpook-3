# 공통 스키마·설정·의존성·테스트 골격 초기화

- 날짜: 2026-09-09
- 이슈: #2
- PR: #3
- 브랜치: chore/2-scaffolding
- 작성자: 유재환

## 한 일

- AI-BE 공통 데이터 모델(`shared/schemas.py`) — Member/Task/TaskHistory/ApprovalRequest 4테이블 + 단계 간 입출력 타입
- 환경변수/설정 로딩(`shared/config.py`)
- 의존성·테스트 실행 환경(`requirements.txt`, `pyproject.toml`, `tests/`)
- 트레이드오프 결정 기록 체계(`decision_log/`) 신설

## 왜

프로젝트 초기 스캐폴딩(이슈 #2) — AI 파트가 다른 팀원(BE/FE)과 계약을 맞추려면 공통 스키마부터
확정해야 했고, 이후 모든 PR이 공유할 테스트/설정 골격이 먼저 있어야 했다.

`ai/`를 독립 프로젝트 루트로 둘지 폴더만 옮길지 고민했는데, 이후 별도 배포 가능성을 고려해
독립 루트로 결정했다 — 자세한 근거는 `decision_log/0002-monorepo-restructure.md` 참고.

## 결과

`pytest` 통과 확인. 이슈 #2 체크리스트 4개 항목 전부 반영.

## 다음

캡처(음성 녹음) 기능 구현 → PR #6.
