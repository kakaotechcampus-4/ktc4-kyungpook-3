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
