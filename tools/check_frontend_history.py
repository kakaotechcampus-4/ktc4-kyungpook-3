"""Verify archived migration content and current reference links."""

import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "frontend/docs/plan/work-items.json").read_text(encoding="utf-8"))
records = manifest["records"]
base = manifest["source_commit"]
errors = []
evolved_live_files = []
sources = set()
targets = set()
guide_updates = set(manifest.get("guide_updates", []))
for record in records:
    source = record["source"]
    target = record["target"]
    live_document = record["kind"] in ("reference-update", "guide-update")
    if source in sources or target in targets:
        errors.append(f"Duplicate source or target: {source}")
    sources.add(source)
    targets.add(target)
    path = (root / target).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        errors.append(f"Missing target: {target}")
        continue
    actual = path.read_bytes()
    if hashlib.sha256(actual).hexdigest() != record["target_sha256"]:
        if not live_document:
            errors.append(f"Changed target content: {target}")
        else:
            evolved_live_files.append(target)
    if record["source_origin"] == "git":
        original = subprocess.run(["git", "show", f"{base}:{source}"], cwd=root, capture_output=True)
        if original.returncode:
            errors.append(f"Cannot read original Git content: {source}")
            continue
        original_bytes = original.stdout
        if hashlib.sha256(original_bytes).hexdigest() != record["source_sha256"]:
            errors.append(f"Wrong original hash: {source}")
    else:
        restored = actual.decode("utf-8")
        for edit in reversed(record["link_edits"]):
            start = edit["target_start"]
            if restored[start:start + len(edit["new"])] != edit["new"]:
                errors.append(f"Invalid inverse link edit: {target}")
            restored = restored[:start] + edit["old"] + restored[start + len(edit["new"]):]
        original_bytes = restored.encode("utf-8")
        if hashlib.sha256(original_bytes).hexdigest() != record["source_sha256"]:
            errors.append(f"External snapshot not preserved: {source}")
        git_original = subprocess.run(["git", "show", f"{base}:{source}"], cwd=root, capture_output=True)
        if git_original.returncode == 0 and hashlib.sha256(git_original.stdout).hexdigest() != record["source_sha256"]:
            errors.append(f"External snapshot differs from the now available Git original: {source}")
    if record["kind"] == "guide-update":
        if target not in guide_updates or source != target:
            errors.append(f"Unapproved guide rewrite: {target}")
        continue
    original_text = original_bytes.decode("utf-8")
    link_spans = {(m.start(1), m.end(1)) for m in re.finditer(r"\[[^\]\n]*\]\(([^)\n]+)\)", original_text)}
    expected = original_text
    for edit in reversed(record["link_edits"]):
        start = edit["source_start"]
        end = start + len(edit["old"])
        if (start, end) not in link_spans or expected[start:end] != edit["old"]:
            errors.append(f"Edit is not an original Markdown link: {source}")
        expected = expected[:start] + edit["new"] + expected[end:]
    if not live_document and expected.encode("utf-8") != actual:
        errors.append(f"Body changed beyond allowed link edits: {target}")
    if live_document and hashlib.sha256(expected.encode("utf-8")).hexdigest() != record["target_sha256"]:
        errors.append(f"Invalid original reference snapshot: {target}")
    if source != target and (root / source).exists():
        errors.append(f"Old source still exists: {source}")

original_issues = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", base, "frontend/docs/issues"], cwd=root).decode("utf-8").splitlines()
if not set(original_issues).issubset(sources):
    errors.append("Not every original issues file is mapped")
original_refactor = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", base, "frontend/docs/plan/refactor"], cwd=root).decode("utf-8").splitlines()
if not {name for name in original_refactor if name.endswith(".md")}.issubset(sources):
    errors.append("Not every original refactor file is mapped")
if (root / "frontend/docs/issues").exists() or (root / "frontend/docs/plan/issues").exists():
    errors.append("Legacy issues directory still exists")
for name, digest in manifest["protected_files"].items():
    path = root / name
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        errors.append(f"Protected original changed: {name}")
for reference in manifest.get("historical_code_references", []):
    result = subprocess.run(["git", "cat-file", "-e", f"{reference['commit']}:{reference['path']}"], cwd=root, capture_output=True)
    if result.returncode:
        errors.append(f"Missing historical code revision: {reference['path']}")
for record in records:
    for issue in record.get("issues", []):
        if not issue["url"].endswith(f"/issues/{issue['number']}") or issue["state"] not in ("OPEN", "CLOSED"):
            errors.append(f"Invalid issue fact: {record['id']}")
    for pr in record.get("prs", []) + record.get("related_prs", []):
        if not pr["url"].endswith(f"/pull/{pr['number']}") or ((pr["state"] == "MERGED") != bool(pr["merged_at"])):
            errors.append(f"Invalid pull request fact: {record['id']}")

link_count = 0
for name in sorted(targets | set(manifest.get("generated_files", []))):
    path = root / name
    if path.suffix != ".md" or not path.exists():
        continue
    text = re.sub(r"```[^\n]*\n.*?```", "", path.read_text(encoding="utf-8"), flags=re.S)
    for href in re.findall(r"\[[^\]\n]*\]\(([^)\n]+)\)", text):
        parts = urlsplit(href)
        if parts.scheme or parts.netloc or not parts.path or href.startswith("<") or " " in href:
            continue
        target = (path.parent / unquote(parts.path)).resolve()
        link_count += 1
        if not target.is_relative_to(root) or not target.exists():
            errors.append(f"Broken local link: {name} -> {href}")
for error in errors:
    print(error)
counts = {kind: sum(r["kind"] == kind for r in records) for kind in sorted({r["kind"] for r in records})}
print(json.dumps({"records": counts, "local_links": link_count, "evolved_live_files": evolved_live_files, "errors": len(errors)}, ensure_ascii=True))
raise SystemExit(bool(errors))
