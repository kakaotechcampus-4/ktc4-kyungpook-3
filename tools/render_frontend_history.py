"""Render frontend work indexes from the captured issue and pull request facts."""

import json
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
plan = root / "frontend/docs/plan"
manifest = json.loads((plan / "work-items.json").read_text(encoding="utf-8"))
records = manifest["records"]
check = sys.argv[1:] == ["--check"]
if sys.argv[1:] and not check:
    raise SystemExit("Usage: python tools/render_frontend_history.py [--check]")
stale_pages = []
labels = {
    "m0": "프로젝트 기반·검증 도구", "m1": "도메인 모델·API·MSW", "m2": "디자인 토큰·공통 UI", "m3": "라우팅·데이터·세션 경계", "m4": "인증·온보딩·앱 진입", "m5": "회의 입력·처리·회의록", "m6": "태스크·승인", "m6-api": "실제 API 연결", "m7": "대시보드", "m8": "태스크 보기·메시지·팀·설정", "refactor": "독립 개선·검증·제품 정리",
}


def cell(text):
    return text.replace("|", "\\|").replace("\n", " ")


def issues_cell(items):
    return "<br>".join(f"[이슈 #{i['number']}]({i['url']}) {i['state']}" for i in items) or "연결 이슈 근거 없음"


def prs_cell(items):
    return "<br>".join(f"[PR #{p['number']}]({p['url']}) {p['state']}" + (f" · {p['merged_at'][:10]} UTC" if p["merged_at"] else " · 병합일 없음") for p in sorted(items, key=lambda p: (p["merged_at"] or "9999", p["number"]))) or "대응 PR 확인 필요"


def local_link(path, page, label):
    relative = os.path.relpath(root / path, page.parent).replace("\\", "/")
    return f"[{cell(label)}]({relative})"


def write(page, lines):
    output = "\n".join(lines) + "\n"
    if check:
        if not page.exists() or page.read_text(encoding="utf-8") != output:
            stale_pages.append(page.relative_to(root).as_posix())
        return
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text(output, encoding="utf-8", newline="\n")


date = manifest["captured_at"][:10]
intro = f"{date} GitHub 조회와 저장소 기록을 대조한 사후 안내다. 원래 계획·완료조건과 당시 검증 결과를 소급해 바꾸지 않는다. PR 병합은 운영 검증 완료를 뜻하지 않는다."
stage_by_key = {m["key"]: m for m in manifest["milestones"]}
work = [r for r in records if r["kind"] in ("followup-result", "refactor-result", "product-decision")]

for key, label in labels.items():
    page = plan / key / "README.md"
    lines = [f"# {key.upper()} {label}", "", intro, "", "[전체 작업 안내](../README.md) · [실제 병합 순서](../implementation-history.md)", ""]
    if key != "refactor":
        lines += ["## 처음 계획과 구현", "", "| 원래 작업 이슈 | 실제 PR과 병합일 |", "|---|---|"]
        stage = stage_by_key[key]
        lines += [f"| {issues_cell(stage['issues'])} | {prs_cell(stage['prs'])} |", ""]
        if key == "m5":
            lines += ["과거 이슈 #126도 CLOSED이지만 대체·종료 PR 근거는 확인하지 못했다. 실제 구현 이슈 #143과 PR #169에 같은 완료 관계로 묶지 않는다.", ""]
        if key == "m8":
            lines += ["PR #260은 계획 정리이며, 실제 구현은 A 태스크 보기 #262·B 설정과 팀 #264·C 메시지 #263으로 나뉜다.", ""]
        lines += ["## 원본 계획·결과·결정", ""]
        for candidate in sorted((plan / key).iterdir()):
            if candidate.name in ("README.md", "work-items"):
                continue
            if candidate.suffix == ".md" or candidate.is_dir():
                lines.append(f"- [{candidate.name}]({candidate.name}/)" if candidate.is_dir() else f"- [{candidate.name}]({candidate.name})")
        lines += [""]
    lines += ["## 실제 이슈·PR별 후속 작업", "", "아래 소속은 사후 탐색을 위한 주 담당 영역이다. 처음 계획에 이 작업들이 모두 포함돼 있었다는 뜻은 아니다.", "", "| 작업 결과 원문 | 실제 이슈 상태 | PR 상태·병합일 |", "|---|---|---|"]
    selected = [r for r in work if r["owner"] == key]
    for record in sorted(selected, key=lambda r: (min((p["merged_at"] or "9999" for p in r["prs"]), default="9999"), r["id"])):
        title = record["title"].lstrip("# ")
        result = local_link(record["target"], page, title)
        if record["kind"] == "refactor-result":
            original_plan = next(r for r in records if r["id"] == record["id"] and r["kind"] == "refactor-plan")
            result += "<br>" + local_link(original_plan["target"], page, "원래 계획")
        lines.append(f"| {result} | {issues_cell(record['issues'])} | {prs_cell(record['prs'])} |")
    if not selected:
        lines += ["", "이 조회 범위에서 별도 이슈 결과 파일은 없다. 위 구현 PR·기존 결과와 결정 기록을 기준으로 읽는다."]
    lines += ["", "## 상태를 해석할 때", "", "- OPEN 이슈에 MERGED PR이 연결돼 있어도 이슈를 완료로 바꾸지 않았다.", "- 결과 원문의 `PR 전`·`미검증`은 당시 상태다. 위 GitHub 사실은 그 이후 병합 여부만 보완한다.", "- 폴더 숫자가 PR인 기록도 있다. 이슈·PR은 위 링크 종류로 구분한다.", "- AI·BE 구현과 연동 검증 기록은 FE의 지원·연결 근거로 읽는다. 모든 코드를 FE가 작성했다고 해석하지 않는다."]
    if any(r["id"] == "682-landing-navigation" for r in selected):
        landing_pr = next(p for r in selected if r["id"] == "682-landing-navigation" for p in r["prs"] if p["number"] == 682)
        lines += [f"- PR #682는 처음 조사할 때 로컬에만 있던 기록이다. 추가 확인 상태는 {landing_pr['state']}이며 위 표의 병합일을 따른다. 이 이관이 앱 코드를 변경한 것은 아니다."]
    if key == "m5":
        audio = next((p for p in manifest.get("context_prs", []) if p["number"] == 670), None)
        audio_state = audio["state"] if audio else "OPEN"
        lines += [f"- FE 원문 듣기 PR #680은 MERGED이며 BE 녹음 보관 PR #670의 조회 상태는 {audio_state}다. 실제 운영 재생 검증과 구분한다."]
    write(page, lines)

page = plan / "README.md"
followups = [r for r in records if r["kind"] == "followup-result"]
lines = ["# 프론트엔드 계획과 실제 작업 이력", "", intro, "", "M0~M8는 기능 영역과 원래 계획의 번호다. 실제 이슈 생성·병합 순서가 번호 순서와 항상 같지는 않다. M2의 초기 PR은 M1보다 먼저 병합됐다. 각 영역의 README에서 처음 구현과 후속 수정을 이어 읽는다.", "", "## 기능별 진입점", "", "| 영역 | 원래 구현 이슈 | 실제 PR | 후속 결과 파일 |", "|---|---|---|---|"]
for key, label in labels.items():
    stage = stage_by_key.get(key)
    issue_links = issues_cell(stage["issues"]) if stage else "작업별 이슈로 관리"
    pr_links = ", ".join(f"[#{p['number']}]({p['url']})" for p in stage["prs"]) if stage else "개별 작업 안내 참조"
    count = len([r for r in work if r["owner"] == key])
    lines.append(f"| [{key.upper()} {label}]({key}/README.md) | {issue_links} | {pr_links} | {count} |")
lines += ["", "## 실제 순서와 기록의 범위", "", "- [이슈 생성·PR 병합 이력](implementation-history.md)은 확인된 날짜 순서로 초기 구현과 후속 작업을 연결한다.", f"- 기존 이슈 결과 디렉터리의 추적 결과 65개와 로컬 PR #682 결과 1개를 합쳐 {len(followups)}개 결과 파일을 이관했다. 같은 이슈 #551의 개별 결과 파일도 각각 보존했다.", "- refactor의 계획·결과 5쌍과 제품 결정 1개는 작업별 폴더에 보존했다.", "- [2026-11-07까지의 기존 후속 목록](history/2026-11-07-followups.md)은 과거 안내 원문이다. 그 안의 당시 운영 규칙은 현재 규칙을 대체하지 않는다.", "- [원본 전체 계획](frontend-plan.md)은 과거 사전 계획으로 보존한다. [제품·기술 결정](../decision/frontend-decisions.md), [대표 API 계약](../contracts/frontend-api-contract.md), [구현 결정 안내](basis-for-decision-guide.md)는 기존 위치에서 관리한다.", "", "## 이관과 검증", "", "[work-items.json](work-items.json)은 원래 경로·새 경로·원문 해시·허용한 링크 편집과 조회 당시 이슈·PR 사실의 단일 색인이다. 새 원문 위치만 관리하며 기존 issues 디렉터리는 제거했다. 문서 원문의 실험 결과를 새 실행처럼 고쳐 쓰지 않았다.", "", "```sh", "python tools/check_frontend_history.py", "python tools/render_frontend_history.py", "```", "", "첫 명령은 이관 누락·원문 보존·링크를 검사한다. 두 번째는 같은 색인에서 이 안내와 영역별 README를 다시 만든다. 새 작업 기록은 주 담당 `plan/mN/work-items/<식별자>-<이름>/`에 둔다. 독립적인 개선은 `plan/refactor/work-items/`를 사용한다. 이슈가 없는 PR 번호를 식별자로 쓰면 색인에서 그 종류를 명시한다.", "", "전체 계획의 이동 전 인라인 경로는 역사적 표기다. 현재 위치는 위 진입점에서 찾는다. 사람이 작성하는 트러블슈팅은 원문을 보존한다."]
lines += ["", "재구성 과정의 선택과 검증은 [작업 기록](history/2026-11-11-reorganization.tsv)에 남겼다."]
write(page, lines)

page = plan / "implementation-history.md"
events = {}
for stage in manifest["milestones"]:
    for pr in stage["prs"]:
        linked_issues = [i for i in stage["issues"] if not pr["closing_issues"] or i["number"] in pr["closing_issues"]]
        events[pr["number"]] = {"pr": pr, "issues": {i["number"]: i for i in linked_issues}, "references": [(f"frontend/docs/plan/{stage['key']}/README.md", stage["key"].upper())]}
for record in work:
    for pr in record["prs"]:
        event = events.setdefault(pr["number"], {"pr": pr, "issues": {}, "references": []})
        event["issues"].update({i["number"]: i for i in record["issues"]})
        event["references"].append((record["target"], record["id"]))
lines = ["# 실제 이슈 생성과 PR 병합 이력", "", intro, "", "[기능별 작업 안내](README.md)", "", "UTC 날짜로 정렬했다. 이슈 생성일, 이슈 OPEN·CLOSED, PR OPEN·MERGED를 각각 표시한다. 이슈 종료와 PR 병합 사이의 인과는 직접 연결 또는 원문 근거가 있는 범위만 색인에 기록했다.", "", "| PR 병합일 또는 현재 상태 | 실제 PR·작성자 | 작업 이슈·생성일·상태 | 원문 |", "|---|---|---|---|"]
for event in sorted(events.values(), key=lambda e: (e["pr"]["merged_at"] or "9999", e["pr"]["number"])):
    pr = event["pr"]
    when = pr["merged_at"][:10] + " UTC" if pr["merged_at"] else pr["state"] + " · 병합일 없음"
    issue_text = "<br>".join(f"[#{i['number']}]({i['url']}) · {i['created_at'][:10]} UTC · {i['state']}" for i in event["issues"].values()) or "연결 이슈 근거 없음"
    references = "<br>".join(local_link(path, page, label) for path, label in dict.fromkeys(event["references"]))
    lines.append(f"| {when} | [PR #{pr['number']}]({pr['url']}) {cell(pr['title'])}<br>{pr['author']} | {issue_text} | {references} |")
lines += ["", "원본 BE·FE PR과 통합 PR이 따로 있는 #626·#631 기록은 원문과 색인의 related_prs도 함께 읽는다. PR #682는 처음 조사 후 별도로 병합된 사실을 추가 확인했다. 이번 문서 이관은 그 앱 코드를 변경하지 않는다."]
if manifest.get("unavailable_references"):
    reference_page = plan / "history/unavailable-references.md"
    reference_lines = ["# 과거 기록의 현재 없는 코드 경로", "", "원문이 가리킨 코드가 현재 없고 Git 이력에서도 같은 경로를 확인하지 못한 항목이다. 존재하지 않는 파일을 복원하거나 구현 완료로 표시하지 않았다. 원래 링크는 이 안내로 연결하고 코드 경로를 남겼다."]
    for index, item in enumerate(manifest["unavailable_references"], 1):
        reference_lines += ["", f"## 기록 {index}", "", f"원래 경로는 `{item['path']}`다.", "", item["reason"]]
    write(reference_page, reference_lines)
write(page, lines)
page_count = len(labels) + 2 + bool(manifest.get("unavailable_references"))
print(f"Rendered {page_count} history pages from {len(work)} work records.")
for page in stale_pages:
    print(f"Stale generated page: {page}")
raise SystemExit(bool(stale_pages))
