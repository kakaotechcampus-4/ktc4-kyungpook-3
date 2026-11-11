"""Check frontend presentation documents and preserve the working baseline."""

import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parents[1]
baseline = root / ".verify/frontend-docs/baseline.json"
pages = [
    root / "frontend/docs" / name
    for name in (
        "index.md",
        "techspec.md",
        "structure.md",
        "troubleshooting.md",
        "tradeoffs-decisions.md",
        "performance.md",
        "verification.md",
        "contract-first-msw.md",
        "ai-result-ui.md",
        "realtime-messages.md",
        "a11y-performance.md",
    )
]
nav_pages = pages + [root / "docs/index.md"]
pages += [
    root / "docs/index.md",
    root / "frontend/docs/README.md",
    root / "frontend/docs/performance/README.md",
]
protected = set()
for part in ("frontend", "backend", "ai"):
    for path in (root / part / "docs").rglob("*.md"):
        if path.name in ("plan.md", f"{part}-plan.md") or "trouble-shooting" in path.parts:
            protected.add(path)
for folder in ("frontend/src", "frontend/e2e"):
    protected.update(path for path in (root / folder).rglob("*") if path.is_file())
snapshot = {
    path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
    for path in sorted(protected)
}
if sys.argv[1:] == ["--baseline"]:
    if baseline.exists():
        raise SystemExit("Baseline already exists. Keep the original baseline.")
    baseline.parent.mkdir(parents=True, exist_ok=True)
    baseline.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved baseline for {len(snapshot)} protected and application files.")
    raise SystemExit(0)
docs_only = sys.argv[1:] == ["--docs-only"]
if sys.argv[1:] and not docs_only:
    raise SystemExit("Usage: python tools/check_frontend_docs.py [--baseline | --docs-only]")
errors = []
if (root / "docs/design/frontend").exists():
    errors.append("Frontend documents belong in frontend/docs, not docs/design/frontend")
if not baseline.exists():
    errors.append("Baseline missing. Preservation cannot be verified.")
else:
    before = json.loads(baseline.read_text(encoding="utf-8"))
    for name in sorted(before.keys() | snapshot.keys()):
        if docs_only and name.startswith(("frontend/src/", "frontend/e2e/")):
            continue
        if before.get(name) != snapshot.get(name):
            errors.append(f"Changed baseline file: {name}")
links = 0
source_links = 0
for page in pages:
    if not page.exists():
        errors.append(f"Missing page: {page.relative_to(root)}")
        continue
    content = page.read_text(encoding="utf-8")
    content = re.sub(r"```[^\n]*\n.*?```", "", content, flags=re.S)
    if len(re.findall(r"^#(?!#)", content, flags=re.M)) != 1:
        errors.append(f"Expected one title: {page.relative_to(root)}")
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", content):
        url = urlsplit(target.strip("<>"))
        source_prefix = "/kakaotechcampus-4/ktc4-kyungpook-3/"
        if url.netloc == "github.com" and url.path.startswith(source_prefix):
            parts = url.path[len(source_prefix):].split("/", 2)
            if len(parts) == 3 and parts[0] in ("blob", "tree") and parts[1] == "develop":
                source_links += 1
                resolved = (root / unquote(parts[2])).resolve()
                if not resolved.is_relative_to(root) or not resolved.exists():
                    errors.append(f"Missing repository source: {target}")
        if url.scheme or url.netloc or not url.path:
            continue
        links += 1
        resolved = (page.parent / unquote(url.path)).resolve()
        if not resolved.is_relative_to(root) or not resolved.exists():
            errors.append(f"Broken local link: {page.relative_to(root)} -> {target}")
# 목차는 문서 첫 화면, 설계 심화 개요, 프론트엔드 개요다. 발표 문서가 셋 중 한 곳에서 링크돼야 한다.
# docs/ 밖의 frontend/docs 는 GitHub 주소로 링크하므로 그 주소도 저장소 경로로 바꿔 본다.
repo_url = "https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/"
nav_sources = [root / "docs/index.md", root / "docs/design/index.md", root / "frontend/docs/index.md"]
nav = set()
for source in nav_sources:
    for target in re.findall(r"\]\(([^)\s]+)", source.read_text(encoding="utf-8")):
        if target.startswith(repo_url):
            nav.add((root / unquote(urlsplit(target[len(repo_url):]).path)).resolve())
            continue
        url = urlsplit(target)
        if not url.scheme and not url.netloc and url.path:
            nav.add((source.parent / unquote(url.path)).resolve())
for page in nav_pages:
    if page not in nav_sources and page.resolve() not in nav:
        errors.append(f"Missing navigation entry: {page.name}")
for error in errors:
    print(error)
print(f"Checked {len(pages)} pages, {links} local links, {source_links} repository sources, {len(snapshot)} baseline files.")
if docs_only:
    print("Application source preservation excluded. Protected document hashes were compared.")
print("Fragment anchors and rendered layout require separate inspection.")
raise SystemExit(bool(errors))
