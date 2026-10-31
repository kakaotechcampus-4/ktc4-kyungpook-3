---
name: ai-feature
description: ai/ 파트 기능 하나를 받아 설계 → 테스트 먼저 구현 → pytest → 셀프 리뷰 → develop 대상 PR 생성까지 역할별 에이전트로 돌리고, PR 을 올리면 끝낸다. 사용자가 AI 파트(capture·stt·extract·judge·draft·shared) 기능 구현이나 버그 수정을 맡기거나 /ai-feature 로 부를 때 쓴다. 다른 파트 작업, 문서만 고치는 작업, PR 리뷰 답변(ai-pr-reply)에는 쓰지 않는다.
argument-hint: "[기능 설명 또는 이슈·계획 경로]"
---

# AI 파트 기능 하네스

요청: $ARGUMENTS

끝은 **develop 대상 PR 생성**이다. 머지는 사람이 PR 을 확인한 뒤 한다. 규칙은 `ai/CLAUDE.md` 와 `docs/agent-rules.md` 를 따른다.
Superpowers 스킬을 쓰되, 이 문서가 정한 부분은 Superpowers 기본값보다 우선한다.
설계는 1단계의 `ai-designer` 가 맡으므로 `superpowers:brainstorming` 은 부르지 않는다. `using-superpowers` 가 brainstorming 을 먼저 하라고 해도 이 문서의 1단계가 그 자리다.

역할과 모델:

| 역할 | 에이전트 | 모델 |
|---|---|---|
| 설계 초안 | `ai-designer` | opus |
| 태스크 구현 | `ai-implementer` | sonnet |
| 리뷰 | `ai-reviewer` | sonnet |

에이전트를 부를 때는 브리프에 태스크 설명과 파일 경로만 넣는다. 파일 내용을 붙여 넣지 않는다.

## 0. 준비

- `git status` 를 본다. 이번 기능과 무관한 커밋 안 된 변경이 있으면 멈추고 묻는다.
- `git fetch origin develop` 후 `origin/develop` 에서 `feature/<짧은-영문-slug>` 브랜치를 만든다. 이미 이 기능의 feature 브랜치에 있으면 그대로 쓴다.
- **git 워크트리를 만들지 않는다.** `ai/.venv` 가 git 밖에 있어서 워크트리에서는 pytest 와 Stop 훅 게이트가 돌지 않는다. 지금 체크아웃의 feature 브랜치가 격리 작업 공간이다 (`using-git-worktrees` 를 쓰지 않는다).

## 1. 설계

1. `ai-designer` 에게 요청과 관련 경로를 넘겨 설계 초안을 받는다.
2. 초안의 **크기 판정**으로 경로를 정한다. 판정이 애매하면 `large`.
3. 사람에게 보여준다: 목표·완료 조건, 추천 접근안, 변경 범위, 계약 영향, 테스트 전략, 질문.
   - 질문은 **한 번에 모아서** 묻는다 (brainstorming 의 "한 번에 하나" 대신).
   - `large` 는 승인을 받을 때까지 멈춘다. 이 하네스에서 사람을 기다리는 곳은 여기 하나다.
   - `small` 은 질문이 없으면 승인 없이 진행한다. 설계는 PR 본문에 남아 사람이 확인한다.
4. `large` 는 승인된 설계를 `.superpowers/specs/YYYY-MM-DD-<slug>.md` 에 저장한다. git 에 올리지 않는 작업 파일이다.

다음 경우에는 크기와 상관없이 멈추고 묻는다: `shared/schemas.py` 나 BE API 계약 변경, 비용이 드는 실제 API 호출(LLM·STT·임베딩)이 필요할 때.

## 2. 구현

### small

`superpowers:test-driven-development` 대로 메인 세션에서 직접 한다. 서브에이전트를 띄우지 않는다.
테스트 먼저 → 예상한 이유로 실패 확인 → 최소 구현 → 전체 pytest (`ai/` 안에서 `.venv/bin/python -m pytest -q`) → 커밋.

### large

1. `superpowers:writing-plans` 로 계획을 쓴다. 저장 위치는 `.superpowers/plans/YYYY-MM-DD-<slug>.md` 다. 마일스톤 `plan.md` 나 전체 계획 파일은 쓰지 않는다. 실행 방식은 묻지 않고 subagent-driven 으로 간다.
2. `superpowers:subagent-driven-development` 로 실행한다. 단:
   - 구현자는 `ai-implementer`, 태스크 리뷰어와 최종 리뷰어는 `ai-reviewer` 로 부른다.
   - 최종 리뷰는 `shared/schemas.py` 나 여러 모듈에 걸친 변경일 때만 `model: opus` 로 올린다. 나머지는 에이전트 기본 모델을 쓴다.
   - 수정 라운드는 태스크당 최대 2회. 남은 지적은 ledger 에 판정과 함께 남기고 PR 본문으로 옮긴다.
   - 마지막의 `finishing-a-development-branch` 메뉴는 띄우지 않는다. 이 문서의 4단계로 간다.

응답을 끝낼 때마다 Stop 훅이 `ai/` pytest 를 돌리고 실패하면 끝내지 못하게 막는다. 막히면 출력된 실패를 고친다. 테스트를 지우거나 단언을 약하게 만들어 통과시키지 않는다.

## 3. 셀프 리뷰

- `small`: `ai-reviewer` 를 한 번 부른다. 범위는 `origin/develop...HEAD`. `blocker`·`should-fix` 를 고치고 전체 pytest 를 다시 돌린다. 재리뷰는 하지 않는다.
- `large`: subagent-driven-development 의 최종 리뷰가 셀프 리뷰다. 따로 더 돌리지 않는다.
- 고치지 않은 지적은 이유와 함께 PR 본문에 남긴다. 사람이 마지막에 본다.

## 4. 기록

- 여러 선택지 중 하나를 고른 결정이 있었으면 `decision-record` 스킬로 `ai/docs/basis_for_decision/ai/` 에 남긴다. 단순 구현은 남기지 않는다.
- `shared/schemas.py` 나 BE 호출이 바뀌었으면 `contract-update` 스킬을 쓴다.
- 대상 마일스톤이 명확할 때만 `milestone-result` 스킬을 쓴다.
- 기록도 커밋에 포함한다 (`docs(ai): ...`).

## 5. PR 생성 (여기서 끝)

1. 전체 pytest 를 한 번 더 돌려 통과를 확인한다.
2. `git push -u origin <브랜치>` 후 `gh pr create --base develop` 로 PR 을 만든다. 제목은 대표 커밋 형식 `type(scope): 한국어 요약`.
3. PR 본문 (한국어):

```markdown
## 요약
<무엇을 왜 바꿨는지 2~3줄>

## 설계
<완료 조건, 고른 접근안과 이유, 계약 영향>

## 변경
- <파일 또는 모듈>: <무엇을 바꿨는지>

## 검증
- `<실제로 돌린 명령>`: <통과·실패 수>
- 돌리지 못한 것: <없으면 "없음">

## 셀프 리뷰
- 고친 것: ...
- 남긴 것과 이유: ...

## 사람이 확인할 것
- <에이전트가 혼자 판정한 것(ruling), 위험, 확신 없는 부분>

## 기록
- <결정 기록·계약 문서 경로, 없으면 "없음">

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

4. 사용자에게 PR 링크와 "사람이 확인할 것"만 짧게 보고하고 끝낸다. 머지, 리뷰어 지정, 리뷰 답변은 하지 않는다. PR 에 리뷰가 달리면 `/ai-pr-reply <PR번호>` 로 답한다.
