"""플랫폼 격리 구조 테스트 — Discord 는 capture/ 안에만 있다 (CLAUDE.md "깨면 안 되는 규칙" 1).

판단 로직(stt, extract, judge, draft, shared, llm, embedding)이 discord 를 import 하면 다른 플랫폼으로
옮길 수 없다. 주석과 설정 이름(DISCORD_BOT_TOKEN 등)은 막지 않고 import 문만 본다.
"""

from __future__ import annotations

import ast
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[1]
GUARDED = ["stt", "extract", "judge", "draft", "shared", "llm.py", "embedding.py", "upload"]
PLATFORM_MODULES = {"discord"}

REMEDIATION = (
    "Discord 는 capture/ 안에만 둔다(ai/CLAUDE.md 규칙 1). 플랫폼 객체 대신 순수 dict 나 "
    "shared.schemas 타입을 넘기고, 화자는 불투명한 uid 문자열로 다룬다. Discord 가 꼭 필요한 처리는 "
    "capture/ 쪽 어댑터로 옮기고 결과만 넘겨라."
)


def _guarded_files() -> list[Path]:
    files: list[Path] = []
    for name in GUARDED:
        p = AI_ROOT / name
        files.extend(sorted(p.rglob("*.py")) if p.is_dir() else [p])
    return files


def _platform_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
        else:
            continue
        for n in names:
            if n.split(".")[0] in PLATFORM_MODULES:
                found.append(f"{path.relative_to(AI_ROOT)}:{node.lineno} import {n}")
    return found


def test_guarded_paths_exist():
    # 폴더 이름이 바뀌어 검사 대상이 조용히 비는 것을 막는다
    missing = [n for n in GUARDED if not (AI_ROOT / n).exists()]
    assert not missing, f"검사 대상이 없다: {missing}. 옮겼다면 GUARDED 를 고쳐라"


def test_judgement_code_does_not_import_discord():
    violations = [v for f in _guarded_files() for v in _platform_imports(f)]
    assert not violations, "\n".join(violations) + "\n\n" + REMEDIATION


def test_upload_code_does_not_mention_discord_at_all():
    # 업로드 경로는 플랫폼과 무관하다. import 뿐 아니라 이름도 두지 않는다
    hits = [f"{f.relative_to(AI_ROOT)}:{i}" for f in sorted((AI_ROOT / "upload").rglob("*.py"))
            for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1)
            if "discord" in line.lower()]
    assert not hits, "\n".join(hits) + "\n\n" + REMEDIATION
