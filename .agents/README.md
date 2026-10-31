# 팀 공통 문서 스킬

`.agents/skills/`는 팀 스킬의 원본이며 `.claude/skills/`는 동일한 내용을 복사한 배포본입니다. 두 경로의 실제 파일을 함께 Git으로 관리합니다. 개인 PC의 절대 경로나 junction은 포함하지 않습니다.

## 사용

저장소를 clone/pull한 뒤 프로젝트에서 Codex 또는 Claude Code를 실행합니다. 프로젝트 스킬을 별도로 개인 경로에 설치할 필요는 없습니다. 목록에 반영되지 않으면 새 세션에서 확인합니다. 개인 경로에도 같은 이름의 스킬이 있다면 프로젝트 버전과 혼동되지 않도록 호출 대상과 내용을 확인합니다.

| 스킬 | 역할 |
|---|---|
| docs-bootstrap | 명시적인 요청으로 문서 초기 구조화·보완 |
| milestone-plan | 명시적인 요청으로 특정 마일스톤 계획 작성·수정 |
| troubleshooting-review | 사람이 쓴 기록의 정리안 제시, 파일 수정 없음 |
| contract-update | 인터페이스 변경에 따른 계약 갱신 |
| milestone-result | 구현 결과와 파트 README 갱신 |
| decision-record | 실제 구현 선택과 근거 기록 |
| docs-audit | 구조·링크·완료조건·보호 문서 읽기 전용 검사 |

Codex 호출 예시:

```text
$docs-bootstrap 현재 저장소의 문서를 구조화하고, AGENTS.md와 CLAUDE.md 양쪽에서 docs/agent-rules.md를 먼저 읽도록 연결해줘.
```

Claude Code 호출 예시:

```text
/docs-bootstrap 현재 저장소의 문서를 구조화하고, AGENTS.md와 CLAUDE.md 양쪽에서 docs/agent-rules.md를 먼저 읽도록 연결해줘.
```

루트 `AGENTS.md`와 `CLAUDE.md`는 공통 규칙인 [docs/agent-rules.md](../docs/agent-rules.md)를 먼저 읽도록 안내합니다. 문서 구조와 양식은 [docs/README.md](../docs/README.md)를 참조합니다. 파트별 기존 문서의 재배치는 별도의 초기 구조화 작업으로 진행합니다. 전체 계획과 사람의 트러블슈팅 기록은 보호하며, design·mascot 등 파트 고유 문서는 유지합니다.

## 스킬 수정과 동기화

1. `.agents/skills/`의 원본만 수정합니다.
2. 수정한 파일과 필요한 템플릿을 `.claude/skills/`의 같은 스킬 경로에도 복사합니다. 삭제한 파일이 있다면 양쪽을 확인해 함께 정리합니다.
3. 두 폴더의 변경을 함께 검토하고 커밋합니다.

별도의 동기화 스크립트는 사용하지 않습니다. 스킬 수정 작업을 에이전트에게 맡길 때도 양쪽 파일을 동일하게 반영하도록 요청합니다.

## Claude Code AI 파트 하네스

아래는 Claude Code 전용이라 `.agents/skills/` 원본 없이 `.claude/` 에만 둡니다. [Superpowers](https://github.com/obra/superpowers) 플러그인을 씁니다. 프로젝트 설정에 켜 두었으므로 처음 실행할 때 설치 안내가 나오면 설치합니다.

| 명령 | 하는 일 |
|---|---|
| `/ai-feature <기능 설명>` | 설계 → 테스트 먼저 구현 → pytest → 셀프 리뷰 → develop 대상 PR 생성. PR 을 올리면 끝나고, 머지는 사람이 확인한 뒤 합니다 |
| `/ai-pr-reply [PR번호]` | PR 리뷰를 모아 지적마다 판정하고, 맞는 지적은 고쳐서 push 한 뒤 답글을 답니다. 반박·질문 답글은 사용자 승인 후 답니다 |

- 역할별 에이전트는 `.claude/agents/` 에 있고 모델이 고정돼 있습니다: `ai-designer`(opus, 설계 초안), `ai-implementer`(sonnet, 구현), `ai-reviewer`(sonnet, 리뷰). 팀 기본 모델은 sonnet 입니다.
- 작은 작업(바뀌는 파일 2개 이하, 태스크 하나, 계약 변경 없음)은 서브에이전트 없이 메인 세션에서 처리하고, 큰 작업만 설계 승인 후 태스크별 구현·리뷰 에이전트를 씁니다.
- `ai/` 아래 `.py` 가 바뀐 채로 응답을 끝내면 Stop 훅(`.claude/hooks/ai-tests-gate.sh`)이 pytest 를 돌리고, 실패하면 끝내지 못하게 막습니다. 같은 변경 상태로 통과했으면 다시 돌리지 않습니다.
- 설계·계획 작업 파일은 git 에 올리지 않는 `.superpowers/` 에 둡니다.
