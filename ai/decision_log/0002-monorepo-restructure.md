# 0002. 모노레포 구조로 재편 — ai/ 를 독립 프로젝트 루트로

- 날짜: 2026-09-09
- 상태: 결정됨

## 배경

원래 `implementation_plan_1.md` 2장의 디렉토리 구조는 `shared/` 를 `ai/`, `be/`, `fe/` 와 형제로 두고
있었다(AI-BE 공통 계약이라는 이유). 그런데 팀이 실제로는 `ai/` `be/` `fe/` 를 각자 독립된 하위
프로젝트(각자 venv·의존성·테스트)로 운영하기로 하면서, AI 파트가 소유하는 모든 것 — `shared/` 포함 —
을 `ai/` 안에 넣기로 했다.

## 검토한 선택지

- **폴더만 옮기고 `ai.` 임포트 접두어는 유지**: 코드 수정은 적지만, `ai.xxx` 를 패키지로 인식시키려면
  파이썬 실행 설정(`pyproject.toml` 등)이 여전히 진짜 저장소 루트에 남아있어야 해서 `ai/` 하나만으로는
  완전히 독립되지 않는다.
- **`ai/` 를 독립 프로젝트 루트로**: `pyproject.toml`·`requirements.txt`·`.venv`·`tests/` 를 전부 `ai/`
  안으로 옮기고, 내부 임포트에서 `ai.` 접두어를 제거(`from ai.shared.schemas` → `from shared.schemas`).
  `cd ai && pytest` 처럼 이 디렉토리 하나로 완결된다. 대신 `capture/discord_adapter.py`,
  `stt/transcribe.py`, `tests/test_recording_store.py` 등 여러 파일의 import 문과 `sys.path.insert` 깊이,
  `eval.py`의 `BASE_DIR` 계산을 전부 손봐야 했다.

## 결정

후자를 선택. AI 파트가 이후 별도 배포·별도 저장소로 분리될 가능성(9주차 이후 웹사이트 이전)까지
고려하면, `ai/` 가 처음부터 완전히 자기완결적인 편이 낫다고 판단.

## 영향받은 파일

- 이동: `shared/`, `tests/`, `recordings/`, `transcripts/`, `fixtures/`, `data/`, `decision_log/`,
  `requirements.txt`, `pyproject.toml`, `.env(.example)`, `.gitignore`, `README.md`, `CLAUDE.md`,
  `stt_diarization_validation_plan.md` → 전부 `ai/` 안으로.
- `shared/config.py`: `REPO_ROOT` → `AI_ROOT` 로 이름 변경(의미가 바뀌어서).
- `capture/discord_adapter.py`, `capture/run_recorder.py`, `stt/transcribe.py`,
  `tests/test_recording_store.py`, `tests/test_transcribe.py`: `from ai.xxx import` → `from xxx import`.
- `sys.path.insert` 깊이: `capture/*.py`, `stt/transcribe.py` 는 `parents[2]`→`parents[1]`,
  `stt/eval/eval.py` 의 `BASE_DIR` 은 `parents[3]`→`parents[2]`.
- `ai/__init__.py` 삭제(더 이상 `ai` 자체를 패키지로 import 하지 않음).

## 다시 볼 조건

`be/`, `fe/` 가 실제로 채워지고 나서, BE 가 `shared/schemas.py` 를 파이썬으로 직접 import 해서 쓰는
구조라면(같은 언어인 경우) 경로 참조 방식을 다시 논의해야 함 — 지금은 BE가 이걸 참고 문서로만 보고
자기 DB 모델을 별도로 만드는 걸 전제로 한 결정.
