"""옛 회의의 요약을 줄 세우거나, 지정한 회의만 바로 돌리거나, BE 에 쓰지 않고 미리 본다.

    python -m capture.backfill_summaries --workspace <ID> --all --dry-run       # ai/ 안에서. 대상과 글자 수, 예상 원. 무료
    python -m capture.backfill_summaries --workspace <ID> --meeting <A> --preview --llm luna --out <레포 밖> --ledger <장부>
    python -m capture.backfill_summaries --workspace <ID> --meeting <A> --meeting <B> --run --llm luna --ledger <장부>
    python -m capture.backfill_summaries --workspace <ID> --all                 # 줄만 세운다. 워커가 시간순으로 돈다
    python -m capture.backfill_summaries --workspace <ID> --all --force         # 프롬프트를 바꿨을 때 처음부터 다시

--preview 는 재료를 읽어 요약만 만든다. 맡지 않고 저장하지 않아 모델 비교에 쓴다. --run 은 지정한 회의만 직접 맡아 저장한다.
범위 없는 claim 을 쓰지 않는다. 쓰면 스위치를 켜기 전에 쌓인 회의까지 비워 2~3건 측정 절차를 건너뛰게 된다. 임대 중인 회의는
기다리지 않는다. 전체를 돌리는 일은 워커 몫이라 --run 과 --preview 는 --meeting 으로만 부른다.

원자료(LLM 출력)는 --out 에만 남기고 --out 은 레포 밖이어야 한다. 화면에는 수치만 찍는다.
종료 코드는 0 정상, 1 실패 있음, 2 처리 중이거나 대기 중인 회의가 남음.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime
from pathlib import Path

from capture.handoff import BeClient, BeError, from_env as handoff_from_env
from capture.summary_sweep import SUMMARY_MODELS, SummaryRunner
from llm import LLMClient, LLMReply, NullLLM, get_llm
from shared.config import AI_ROOT
from shared.schemas import SummaryDraft
from summary.summarize import summarize

RUNNABLE = ("requested", "queued")
READABLE = ("requested", "done", "queued", "gave_up")
CLAIM_SCOPE_MAX = 500

# 청구서로 확인하지 않은 값이다. Terra 추정 $2/$12, 1,400원 가정. 60분 회의가 약 25k자, 12k 토큰이라는 계산도 추측이다
WON_PER_INPUT_TOKEN = 2 / 1_000_000 * 1400
WON_PER_OUTPUT_TOKEN = 12 / 1_000_000 * 1400
CHARS_PER_TOKEN = 2
OUTPUT_TOKENS = 1_500
UNCONFIRMED = "단가 미확정 추정"


def _won(prompt_tokens: float, completion_tokens: float) -> int:
    return math.ceil(prompt_tokens * WON_PER_INPUT_TOKEN + completion_tokens * WON_PER_OUTPUT_TOKEN)


def estimate_won(chars: int) -> int:
    """호출 전 예상. 응답에 usage 가 없을 때도 장부의 합이 비지 않게 이 값을 쓴다."""
    return _won(chars / CHARS_PER_TOKEN, OUTPUT_TOKENS)


def _charged_won(reply: LLMReply, chars: int) -> int:
    prompt = chars / CHARS_PER_TOKEN if reply.prompt_tokens is None else reply.prompt_tokens
    completion = OUTPUT_TOKENS if reply.completion_tokens is None else reply.completion_tokens
    return _won(prompt, completion)


def _record(row: dict, llm: LLMClient, reply: LLMReply, *, mode: str, attempt: int, draft: SummaryDraft | None,
            failure: str | None, out_dir: Path | None, ledger: Path) -> None:
    """호출 한 번을 장부에 한 줄 쓰고, --out 이 있으면 원자료를 남긴다."""
    row["won"] = _charged_won(reply, row["chars"])
    tokens = {"입력": reply.prompt_tokens, "출력": reply.completion_tokens, "추론": reply.reasoning_tokens}
    line = {"시각": datetime.now().astimezone().isoformat(timespec="seconds"), "종류": llm.name,
            "label": f"summary {mode} {row['meeting_id']}", "양": tokens, "원": row["won"], "비고": UNCONFIRMED}
    with ledger.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")
    if out_dir is None:
        return
    written = {"meeting_id": row["meeting_id"], "extraction_id": row["extraction_id"], "title": row["title"],
               "attempt": attempt, "model": llm.model, "finish_reason": reply.finish_reason, "failure": failure,
               "양": tokens, "elapsed_s": round(reply.elapsed_s, 1), "원": row["won"], "원_비고": UNCONFIRMED,
               "draft": draft.to_dict() if draft else None, "raw": reply.data}
    (out_dir / f"{row['meeting_id']}.{llm.name}.json").write_text(json.dumps(written, ensure_ascii=False, indent=2),
                                                                  encoding="utf-8")


def preview(client: BeClient, llm: LLMClient, rows: list[dict], *, out_dir: Path, ledger: Path) -> None:
    """재료를 읽어 요약만 만든다. 맡지 않고 BE 에 쓰지 않는다."""
    for row in rows:
        if row["state"] not in READABLE:
            continue
        try:
            attempt = summarize(client.summary_input(row["extraction_id"]), llm, attempt=1)
        except Exception as e:  # noqa: BLE001 - 한 회의의 실패로 나머지를 멈추지 않는다
            row.update(result="failed", error=f"{type(e).__name__}: {e}")
            continue
        _record(row, llm, attempt.reply, mode="preview", attempt=1, draft=attempt.draft, failure=attempt.failure,
                out_dir=out_dir, ledger=ledger)
        row.update(result="previewed" if attempt.draft else "failed", error=attempt.failure)


def run_named(client: BeClient, llm: LLMClient, rows: list[dict], *, out_dir: Path | None, ledger: Path) -> None:
    """지정한 회의만 맡아 돈다. 회의마다 한 번까지다. 맡을 것이 없으면 claim 을 부르지 않는다."""
    pending = {row["extraction_id"]: row for row in rows if row["state"] in RUNNABLE}
    runner = SummaryRunner(client, llm)
    while pending:
        outcome = runner.run_once(only=list(pending)[:CLAIM_SCOPE_MAX])
        if outcome is None:
            break
        if outcome.extraction_id is None:
            for row in pending.values():
                row.update(result="failed", error=outcome.error)
            return
        row = pending.pop(outcome.extraction_id)
        if outcome.reply is not None:
            _record(row, llm, outcome.reply, mode="run", attempt=outcome.attempt, draft=outcome.draft,
                    failure=outcome.error, out_dir=out_dir, ledger=ledger)
        result = "saved" if outcome.saved else "failed" if outcome.error else "not_applied"
        row.update(result=result, error=outcome.error)
    for row in pending.values():
        row["result"] = "left"


def exit_code(rows: list[dict]) -> int:
    results = {row.get("result") for row in rows}
    return 1 if "failed" in results else 2 if "left" in results else 0


def _usage_problem(a: argparse.Namespace) -> str | None:
    """argparse 의 오류 코드 2 는 여기서 "회의가 남음" 이라 인자 오류를 1 로 돌려주려고 따로 본다."""
    paid = a.run or a.preview
    if not a.workspace:
        return "--workspace 가 필요하다"
    if bool(a.meeting) == a.all:
        return "--meeting 과 --all 중 하나만 준다. 범위를 생략해서 전체가 도는 일이 없게 한다"
    if a.dry_run + a.run + a.preview > 1:
        return "--dry-run, --run, --preview 는 하나만 준다"
    if paid and a.all:
        return "--run 과 --preview 는 --meeting 으로만 부른다. 전체는 줄만 세우면 워커가 돈다"
    if paid and a.llm not in SUMMARY_MODELS:
        return f"--run 과 --preview 는 --llm {' 또는 '.join(SUMMARY_MODELS)} 가 필요하다"
    if paid and not a.ledger:
        return "--run 과 --preview 는 --ledger 가 필요하다. 유료 호출은 호출마다 장부에 남긴다"
    if a.preview and not a.out:
        return "--preview 는 --out 이 필요하다"
    if a.out and Path(a.out).expanduser().resolve().is_relative_to(AI_ROOT.parent):
        return "--out 은 레포 밖이어야 한다. 원자료에 팀원 발언이 들어간다"
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="옛 회의의 요약을 줄 세우거나 지정한 회의만 돌린다")
    ap.add_argument("--workspace", help="워크스페이스 ID")
    ap.add_argument("--meeting", action="append", default=[], help="회의 ID. 여러 번 줄 수 있다")
    ap.add_argument("--all", action="store_true", help="워크스페이스의 모든 회의")
    ap.add_argument("--force", action="store_true", help="요약이 있거나 포기한 회의도 다시 줄 세운다")
    ap.add_argument("--dry-run", action="store_true", help="쓰지 않고 대상과 글자 수, 예상 원을 본다")
    ap.add_argument("--run", action="store_true", help="지정한 회의만 이 프로세스가 직접 돈다")
    ap.add_argument("--preview", action="store_true", help="BE 에 쓰지 않고 요약만 만들어 --out 에 남긴다")
    ap.add_argument("--llm", help="luna 또는 terra")
    ap.add_argument("--out", help="LLM 출력과 수치를 남길 폴더. 레포 밖이어야 한다")
    ap.add_argument("--ledger", help="호출마다 한 줄 쓸 장부 파일")
    a = ap.parse_args(argv)
    problem = _usage_problem(a)
    if problem:
        print(problem, file=sys.stderr)
        return 1
    handoff = handoff_from_env()
    if handoff is None:
        print("BE_BASE_URL, BE_SERVICE_TOKEN 이 다 있어야 돈다", file=sys.stderr)
        return 1
    llm = get_llm(a.llm) if a.run or a.preview else None
    if isinstance(llm, NullLLM):        # 여기서 멈추지 않으면 답 없는 호출이 시도를 태운다
        print(f"{a.llm} LLM 키가 없다", file=sys.stderr)
        return 1
    out_dir = Path(a.out).expanduser() if a.out else None
    ledger = Path(a.ledger).expanduser() if a.ledger else None
    if llm is not None:                 # 돈을 쓰기 전에 파일 자리를 확인한다
        ledger.parent.mkdir(parents=True, exist_ok=True)
        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)

    try:
        rows = handoff.client.request_summaries(a.workspace, meeting_ids=a.meeting or None, include_all=a.all,
                                                force=a.force, dry_run=a.dry_run or a.preview)
    except BeError as e:
        print(f"재처리 표시 실패: {e}", file=sys.stderr)
        return 1

    targets = RUNNABLE if a.run else READABLE if a.preview else ("requested",)
    expected = sum(estimate_won(row["chars"]) for row in rows if row["state"] in targets)
    print(f"대상 {len(rows)}건, 예상 약 {expected}원 ({UNCONFIRMED})")
    if a.run:
        run_named(handoff.client, llm, rows, out_dir=out_dir, ledger=ledger)
    elif a.preview:
        preview(handoff.client, llm, rows, out_dir=out_dir, ledger=ledger)
    elif not a.dry_run:
        for row in rows:
            if row["state"] == "queued":
                row["result"] = "left"
    for row in rows:
        result = f" {row['result']}" if row.get("result") else ""
        error = f" ({row['error']})" if row.get("error") else ""
        won = f" 약 {row['won']}원" if "won" in row else ""
        print(f"{row['meeting_id']} {row['state']}{result}{error} {row['chars']}자{won} {row['title'] or ''}".rstrip())
    if llm is not None:
        print(f"이번 호출 약 {sum(row.get('won', 0) for row in rows)}원 ({UNCONFIRMED})")
    code = exit_code(rows)
    if code == 2:
        print("처리 중이거나 대기 중인 회의가 남았다")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
