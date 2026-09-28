# 테스트 디렉토리를 소스 구조에 맞춰 재구성

- 날짜: 2026-09-16
- PR: #29
- 브랜치: chore/tests-reorg
- 작성자: 유재환

## 한 일

- `tests/`에 22개 파일이 평평하게 섞여있어서 이름만 봐선 뭘 테스트하는지 알기 어려웠던 것을
  소스 구조(`capture/`, `stt/`, `shared/`)에 맞춰 하위 폴더로 분리
  - `tests/capture/` — 캡처/녹음 관련 11개
  - `tests/stt/` — 전사 관련 8개
  - `tests/shared/` — `test_schemas.py`
- `tests/replay.py`(wav를 디스코드 패킷처럼 흘려보내는 헬퍼, 테스트 아님)를 `tests/capture/`로 이동
- `tests.replay`를 직접 import하던 4개 파일 경로를 `tests.capture.replay`로 수정
- `CLAUDE.md` 테스트 실행 예시 경로 갱신

## 왜

`test_backend.py`가 `backend/`(BE 프로젝트)랑 헷갈리는데 실제론 `stt/backend.py` 테스트라서,
팀원이 파일명만 보고 오해할 소지가 있었다. 기능이 늘어나기 전에 정리했다.

## 결과

전체 285 passed, 1 skipped (파일 이동 전과 동일 — 내용 변경 없음, 위치만 이동).

## 다음

임베딩 유사도 검색 유틸(PR #27).
