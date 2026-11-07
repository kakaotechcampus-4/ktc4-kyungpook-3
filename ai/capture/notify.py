"""회의 처리 알림. 워커가 회의를 처리하면서 그 회의를 녹음한 채널에 무엇이 끝났는지 알린다.

플랫폼은 모른다. send(channel_id, text, file=None) 을 가진 notifier 를 받는다. 워커는 파일 우편함(FileOutbox)에
쓰고, 디스코드에 붙어 있는 봇이 그것을 채널에 올린다(capture/discord_adapter.py). 그래서 워커는 디스코드도 봇
토큰도 모른다.

늘 알리는 것
  처음 처리를 시작할 때 한 줄, 단계가 끝날 때마다 한 줄(전사, 웹 회의록, 할 일 찾기, 웹에 올림)
  처음 실패했을 때와 자동 재시도를 멈췄을 때, 빠진 구간, 건너뛴 단계, BE·판단 경로의 경고
  서버에 연결된 워크스페이스가 없어 기다리기 시작할 때 한 번
  처음 집은 회의가 아무 단계도 돌지 못했으면(BE 토큰 거절처럼) 건너뛴 이유를 한 번
MM_DEBUG_REPORT 를 켜면 더 알리는 것
  단계 시작 줄, 회의록 파일, 할 일 목록, 처리 시간·대기·최대 메모리 한 줄(capture/ops_record.summary_line)
알리지 않는 것
  워커는 설정이 없어 멈춘 회의와 연결을 기다리는 회의를 바퀴마다 다시 집는다. 이번 처리에서 단계가 움직이지
  않았고 처음 실패도 포기도 아니면 아무것도 올리지 않는다. 예약된 재시도의 실패는 로그로만 남긴다
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from capture.ops_record import summary_line
from capture.recorder import STATUS_EXTRACTED, STATUS_FAILED, STATUS_HANDED_OFF, STATUS_PARTIAL, STATUS_SAVED, \
    STATUS_SOURCED, STATUS_TRANSCRIBED

MESSAGE_MAX = 2000   # 디스코드 메시지 한 개의 글자 수 상한
SHOWN_MAX = 10       # 목록에 보이는 항목 수. 나머지는 "외 N건"
LINE_MAX = 150       # 목록 한 줄 길이
STAGE_LABEL = {STATUS_TRANSCRIBED: "전사", STATUS_SOURCED: "회의록 저장", STATUS_EXTRACTED: "할일 추출",
               STATUS_HANDED_OFF: "BE 인계",
               "stt": "전사", "sources": "회의록 저장", "extract": "할일 추출", "handoff": "BE 인계"}
STAGE_START = {"stt": "🎧 전사 시작", "sources": "🗂 회의록 저장 시작", "extract": "🔎 할일 추출 시작",
               "handoff": "📨 BE 인계 시작"}
NOT_CONNECTED_WAIT = ("ℹ️ 이 서버가 웹 워크스페이스에 연결돼 있지 않아 회의 처리를 멈췄습니다. "
                      "PM 이 웹 온보딩의 디스코드 연결 단계에서 이 서버를 연결하면 이어서 처리합니다.")


def debug_from_env() -> bool:
    """MM_DEBUG_REPORT 가 1·on·true 면 켠다. 개발할 때 켜고 운영에서는 끈다."""
    return os.environ.get("MM_DEBUG_REPORT", "").strip().lower() in ("1", "on", "true")


def _clip(text, limit: int = LINE_MAX) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[:limit - 3] + "..."


def _listed(head: str, lines: list[str], total: int) -> str:
    shown = lines[:SHOWN_MAX]
    if total > SHOWN_MAX:
        shown.append(f"외 {total - SHOWN_MAX}건")
    return (head + "\n" + "\n".join(shown))[:MESSAGE_MAX]


class FileOutbox:
    """알림을 녹음 폴더의 .worker/outbox 에 한 건씩 파일로 쓴다. 봇이 이름 순서대로 읽어 채널에 올리고 지운다."""

    def __init__(self, recordings_dir: Path) -> None:
        self.dir = Path(recordings_dir) / ".worker" / "outbox"
        self._n = 0

    def send(self, channel_id: str, text: str, file: Path | None = None) -> bool:
        self.dir.mkdir(parents=True, exist_ok=True)
        self._n += 1
        name = f"{time.time_ns():020d}-{os.getpid()}-{self._n:06d}"
        tmp = self.dir / f".{name}.tmp"
        tmp.write_text(json.dumps({"channel_id": str(channel_id), "text": text[:MESSAGE_MAX],
                                   "file": str(file) if file else None, "at": time.time()}, ensure_ascii=False),
                       encoding="utf-8")
        tmp.replace(self.dir / f"{name}.json")      # 다 쓴 파일만 보이게 이름을 바꾼다
        return True


class MeetingReporter:
    """회의 하나의 처리 알림. started → progress(process_session 이 부른다) → finished 순서로 부른다.

    announced 는 워커가 이번 실행 동안 처리 시작을 알린 회의 ID 다. 아무 단계도 돌지 못하는 회의를 바퀴마다
    다시 집어도 시작과 건너뛴 이유는 한 번만 말한다. 워커를 다시 띄우면 한 번 더 말한다.
    """

    def __init__(self, notifier, manifest: dict, *, debug: bool = False, announced: set[str] | None = None) -> None:
        self._notifier = notifier
        self._channel = manifest.get("text_channel_id")
        self._session = str(manifest.get("session"))
        self._announced = announced if announced is not None else set()
        self._waiting = bool(manifest.get("workspace_wait"))   # 이미 연결을 기다리던 회의. 다시 알리지 않는다
        self._first = manifest.get("status") in (STATUS_SAVED, None) and not manifest.get("stages") \
            and not self._waiting and self._session not in self._announced
        self._guild = manifest.get("guild_id")
        self.debug = debug

    def _send(self, text: str, file: Path | None = None) -> None:
        if self._notifier is None or not self._channel:
            return
        try:
            self._notifier.send(str(self._channel), text, file=file)
        except Exception as e:  # noqa: BLE001 - 알림이 실패해도 처리는 그대로 간다
            print(f"[notify] 알림 실패: {type(e).__name__}: {e} :: {text[:60]}", flush=True)

    def started(self) -> None:
        if self._first:
            self._announced.add(self._session)
            self._send("⏳ 회의 처리를 시작합니다.")

    def progress(self, stage: str, info: dict | None = None) -> None:
        """process_session 의 progress. 단계 시작은 (단계, None), 단계 끝은 ("done", {"stage", "result"})."""
        if stage == "done":
            self._stage_done(info["stage"], info["result"])
        elif info is None and self.debug:
            self._send(STAGE_START.get(stage, stage))

    def _stage_done(self, stage: str, r: dict) -> None:
        if stage == STATUS_TRANSCRIBED:
            tr = r.get("transcribe") or {}
            file = Path(tr["markdown"]) if self.debug and tr.get("markdown") else None
            self._send(f"📝 전사를 마쳤습니다. 줄 {tr.get('lines', 0)}개.", file=file)
        elif stage == STATUS_SOURCED:
            self._send(f"🗂 웹 회의록에 {(r.get('sources') or {}).get('inserted', 0)}줄을 올렸습니다.")
        elif stage == STATUS_EXTRACTED:
            self._send(self._found(r))
        elif stage == STATUS_HANDED_OFF:
            be = r.get("be") or {}
            self._send(f"📨 웹에 올렸습니다. PM 승인을 기다리는 항목 {be.get('item_count', 0)}건.")
            if be.get("dropped_items"):
                self._send(f"⚠️ BE 가 항목 {be['dropped_items']}건을 받지 않았습니다. 수정 대상 task 가 사라졌거나 "
                           "제목이 빈 항목입니다.")
            if be.get("stale_extraction"):
                self._send("⚠️ 전사가 바뀌어 할일을 다시 뽑았지만 BE 에는 예전 추출이 남아 있습니다.")

    def _found(self, r: dict) -> str:
        items = r.get("items")
        if items is not None:          # 판단 경로(MM_EXTRACT_PATH=judge)
            head = f"📋 할 일 후보 {len(items)}건을 찾았습니다."
            if not self.debug:
                return head
            creates = sum(1 for x in items if x.get("action") != "update")
            lines = [f"- {_clip(x.get('doc_text') or x.get('task_title') or '(설명 없음)')}" for x in items]
            return _listed(f"{head} (새 항목 {creates}, 수정 {len(items) - creates})", lines, len(items))
        tasks = r.get("tasks") or []
        head = f"📋 할 일 {len(tasks)}건을 찾았습니다."
        if not self.debug:
            return head
        lines = [f"- {x.get('task')} / {x.get('assignee_resolved') or x.get('assignee_mention') or '담당 미정'} / "
                 f"{x.get('due_date') or '마감 미정'}" for x in tasks]
        return _listed(head, lines, len(tasks))

    @staticmethod
    def should_tell(r: dict, *, manual: bool = False) -> bool:
        """이번 처리 결과를 알릴 일인가. 단계가 움직였거나, 처음 실패했거나, 포기했을 때만."""
        if manual:
            return bool(r.get("ran")) or r.get("status") == STATUS_FAILED
        moved = any(s != "retried" for s in r.get("ran") or [])
        first_failure = r.get("status") in (STATUS_FAILED, STATUS_PARTIAL) and (r.get("attempts") or 0) == 1
        return moved or first_failure or bool(r.get("gave_up"))

    def _next(self, r: dict, *, auto: str) -> str:
        n = r.get("attempts") or 0
        if r.get("gave_up"):
            return (f"실패 {n}회로 자동 재시도를 멈췄습니다. 서버에서 `python -m capture.worker --retry {self._guild}` "
                    "로 다시 시도할 수 있습니다.")
        if r.get("retry_in_s"):
            mins = max(1, int((r["retry_in_s"] + 59) // 60))
            return f"{mins}분 뒤 {auto}(실패 {n}회)."
        return "다음 처리 때 다시 시도합니다."

    def finished(self, r: dict, *, manual: bool = False) -> None:
        if r.get("workspace") == "not_connected" and not self._waiting:
            self._send(NOT_CONNECTED_WAIT)
            return
        stuck_at_start = self._first and not r.get("ran")     # 처음 집었는데 아무 단계도 못 돌았다. 이유를 한 번 말한다
        if not (self.should_tell(r, manual=manual) or stuck_at_start):
            return
        unjudged = r.get("extract_failures") or []
        if STATUS_EXTRACTED in (r.get("ran") or []) and unjudged:
            lines = [f"- {_clip(f.get('text'))}" for f in unjudged] if self.debug else []
            self._send(_listed(f"⚠️ 판단하지 못한 발화 {len(unjudged)}건은 결과에 없습니다.", lines, len(unjudged))
                       if lines else f"⚠️ 판단하지 못한 발화 {len(unjudged)}건은 결과에 없습니다.")
        if r.get("partial"):
            self._send(f"⚠️ 빠진 구간 {r.get('missing_units', 0)}개를 둔 채 진행했습니다.")
        by_reason: dict[str, list[str]] = {}
        for stage, why in (r.get("skipped") or {}).items():
            by_reason.setdefault(why, []).append(STAGE_LABEL.get(stage, stage))
        for why, labels in by_reason.items():
            self._send(f"ℹ️ 건너뛴 단계: {', '.join(labels)} ({why}).")
        if r.get("status") == STATUS_PARTIAL:
            failed = (r.get("transcribe") or {}).get("failed", 0)
            self._send(f"⚠️ 전사 실패 {failed}줄. 이 회의는 아직 끝나지 않았습니다. "
                       + self._next(r, auto="그 구간만 자동으로 다시 보냅니다"))
        if r.get("status") == STATUS_FAILED:
            label = STAGE_LABEL.get(r.get("failed_stage"), r.get("failed_stage"))
            self._send(f"⚠️ {label} 실패: {r.get('error')}. " + self._next(r, auto="이 단계부터 자동으로 다시 시도합니다"))
        if self.debug and r.get("ops"):
            self._send(summary_line(r["ops"]))
