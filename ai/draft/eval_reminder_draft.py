"""리마인드 문구 초안(draft/reminder_draft.py) 실제 Luna 확인 스크립트. 4건 모두 합성 데이터다.

pytest 스위트엔 안 넣는다. 실제 Luna 호출이라 비용이 들고 응답이 매번 다르다.
검사를 못 넘은 응답도 보이도록 Luna 원문과 검사 결과를 함께 출력한다.

실행 (ai/ 디렉토리 안에서, LUNA_API_KEY 필요):
    .venv/bin/python -m draft.eval_reminder_draft

호출마다 토큰 양을 장부(LEDGER)에 한 줄씩 적고, 입력·출력 원문은 레포 밖 OUT_DIR 에 남긴다.
Luna 단가는 확인된 값이 없어 "원"은 null 로 적는다. 단가를 알게 되면 여기서 계산한다.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

from openai.resources.chat.completions import Completions

from draft.reminder_draft import _parse_reminder_response, _reminder_prompt
from llm import get_llm

EVAL_RUNS = Path.home() / "Desktop/카테캠 아이디어톤/mm/eval-runs"
LEDGER = EVAL_RUNS / "ledger/feature-310-reminder-messages.jsonl"
OUT_DIR = EVAL_RUNS / "2026-11-04-310-reminder-draft"


def _task(task_id, title, due_date, status="in_progress", note=None):
    return {"task_id": task_id, "title": title, "due_date": due_date, "status": status, "note": note}


def _item(label, recipient, tasks, style_examples=()):
    return label, {
        "bundle_id": f"synthetic-{label}", "draft_version": 1, "workspace_id": "synthetic",
        "recipient_name": recipient, "scheduled_at": "2026-11-12T09:00:00+09:00",
        "tasks": tasks, "style_examples": list(style_examples), "fallback_body": "(규칙 문구)",
    }


CASES = [
    _item("synthetic-single", "수빈", [_task("t1", "결제 내역 화면 개발", "2026-11-14")]),
    _item("synthetic-three-blocked", "태윤", [
        _task("t1", "알림 설정 API", "2026-11-13"),
        _task("t2", "검색 결과 페이지 반응형", "2026-11-17", status="blocked"),
        _task("t3", "에러 로그 대시보드", None, status="todo"),
    ]),
    _item("synthetic-banmal-emoji", "지민", [
        _task("t1", "회원가입 이메일 인증", "2026-11-15"),
        _task("t2", "프로필 사진 업로드", "2026-11-18", status="todo"),
    ], style_examples=[
        "하은아 배포 가이드 어디까지 했어? 급한 건 아니고 그냥 궁금해서 ㅎㅎ 🙌",
        "도윤아 내일 리뷰 전에 한번 봐 줄 수 있어? 고마워 😊",
    ]),
    _item("synthetic-pm-note", "현우", [
        _task("t1", "관리자 통계 차트", "2026-11-16", note="주간 그래프는 이번엔 빼도 괜찮아요"),
        _task("t2", "공지사항 게시판", "2026-11-19", status="todo"),
    ]),
]


def _record_usage(label_ref: list[str]) -> None:
    # MLAPIClient 가 응답의 usage 를 버리므로 SDK 호출을 감싸 토큰을 잡는다(207 평가 도구와 같은 방식)
    orig = Completions.create

    def create(self, *a, **kw):
        resp = orig(self, *a, **kw)
        u = resp.usage
        reasoning = getattr(getattr(u, "completion_tokens_details", None), "reasoning_tokens", None)
        row = {"시각": datetime.now().isoformat(timespec="seconds"), "종류": "luna", "label": label_ref[0],
               "양": {"입력": u.prompt_tokens, "출력": u.completion_tokens, "추론": reasoning}, "원": None}
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with LEDGER.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        return resp

    Completions.create = create


def main() -> None:
    client = get_llm("luna")
    if client.name == "off":
        sys.exit("LUNA_API_KEY 가 없어 실행하지 않습니다.")
    label_ref = [""]
    _record_usage(label_ref)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{datetime.now():%Y%m%dT%H%M%S}.jsonl"

    for label, item in CASES:
        label_ref[0] = label
        raw = client.generate_json(_reminder_prompt(item), reasoning_effort="medium")
        body = _parse_reminder_response(raw, item) if raw is not None else None
        with out_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"label": label, "item": item, "raw": raw, "body": body}, ensure_ascii=False) + "\n")

        print(f"=== {label} (합성) ===")
        print(f"받는 사람: {item['recipient_name']}")
        for t in item["tasks"]:
            print(f"  {t['title']} / 마감 {t['due_date'] or '없음'} / {t['status']} / 메모 {t['note'] or '없음'}")
        if item["style_examples"]:
            print("  말투 예시: " + " | ".join(item["style_examples"]))
        print(f"Luna 원문: {raw}")
        print(f"검사 결과: {'통과' if body is not None else '탈락 (None, 규칙 문구로 둠)'}\n")

    print(f"장부 {LEDGER}\n원자료 {out_path}")


if __name__ == "__main__":
    main()
