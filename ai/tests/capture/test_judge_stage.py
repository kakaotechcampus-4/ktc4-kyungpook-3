"""추출 단계에 끼운 판단 경로(capture/recorder.py). 결과 저장, 발화 단위 실패의 재시도, 전부 실패, 인계까지.

판단 추출기는 정해 둔 결과를 차례로 돌려주는 가짜다. 모델도 LLM 도 안 쓴다. 시계는 recorder.utcnow 를 바꿔 끼운다.
"""

import json
from datetime import timedelta
from pathlib import Path

import pytest

from capture import judge_path as J
from capture import recorder as R
from tests.capture.fake_be import FakeBe
from tests.capture.test_recorder import DiesOnLong, EchoStt, _run, _session
from tests.capture.test_recovery import _fails, _handoff, _saved, clock, limits  # noqa: F401 - clock, limits 는 fixture


def _item(title, **over):
    base = {"action": "create", "target_task_id": None, "category": "decision", "task_title": title, "due_date": None,
            "status": None, "assignee_type": "first", "assignee_raw": None, "doc_text": f"{title}을 하기로 함",
            "evidence_quote": "제가 할게요.", "evidence_speaker": "1", "evidence_at_ms": 0}
    base.update(over)
    return base


def _fail(text, stage="judge"):
    return {"stage": stage, "text": text, "reason": "Terra 응답을 파싱하지 못했습니다."}


A, B_, C = _item("결제 환불 기능 구현"), _item("검색 성능 개선"), _item("문서 정리")
F1, F2, F3 = _fail("로그인 마감을 미루기로 함"), _fail("소셜 로그인은 빼기로 함"), _fail("색상표를 정리하기로 함", "draft")


class Runs:
    """판단 추출기 자리. 부를 때마다 다음 결과를 돌려주고, 마지막 결과는 계속 돌려준다. 예외면 던진다."""

    def __init__(self, *outs):
        self.outs = list(outs)
        self.calls = 0

    def __call__(self, transcript, names, today):
        self.calls += 1
        out = self.outs.pop(0) if len(self.outs) > 1 else self.outs[0]
        if isinstance(out, Exception):
            raise out
        return out


def _out(items, failures=()):
    return J.JudgeOutput(items=list(items), failures=list(failures))


def _items_on_disk(path):
    return json.loads(Path(_saved(path)["items"]).read_text(encoding="utf-8"))


def _again(rec, tmp_path, extractor, fake, clock, **kw):
    """다음 시도 시각이 지난 뒤의 복구 한 바퀴."""
    clock["t"] += timedelta(hours=1)
    return R.recover(rec, backend=kw.pop("backend", EchoStt()), model_name="echo", workers=1, gate=None,
                     transcripts_dir=tmp_path / "transcripts", extractor=extractor, handoff=_handoff(fake),
                     manual=False, **kw)[0]


def test_judge_items_are_saved_and_handed_off(tmp_path):
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    r = _run(rec, manifest, tmp_path, extractor=Runs(_out([A, B_])), handoff=_handoff(fake))
    assert r["ran"] == ["transcribed", "extracted", "handed_off"] and r["status"] == "handed_off"
    assert r["items"] == [A, B_] and r["tasks"] is None and r["extract_failures"] == []
    saved = _saved(path)
    assert saved["items"].endswith("session_77_500.items.json") and "tasks" not in saved
    assert _items_on_disk(path) == [A, B_]
    assert not {"extract_failures", "extract_runs", "extract_partial"} & set(saved)
    assert fake.extractions["m1"]["items"] == [A, B_]            # BE 에는 파이프라인이 만든 항목이 그대로 갔다
    assert saved["be"]["item_count"] == 2 and R.pending_sessions(rec) == []


def test_all_failed_is_a_stage_failure_and_registers_nothing(tmp_path, clock, limits):
    """토큰이 틀리면 모든 발화가 유사 검색에서 실패한다. 빈 추출을 등록하지 않고, 포기할 때 BE 에 실패로 알린다."""
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(J.JudgeAllFailed("발화 3개의 판단이 모두 실패했다. 첫 실패(similar): BeError: UNAUTHENTICATED"))
    r = _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    assert r["status"] == "failed" and r["failed_stage"] == "extract" and "JudgeAllFailed" in r["error"]
    for _ in range(4):
        r = _again(rec, tmp_path, ex, fake, clock)
    assert r["attempts"] == 5 and r["gave_up"] is True and ex.calls == 5
    assert fake.extractions == {} and fake.meetings["m1"]["status"] == "failed"
    assert fake.meetings["m1"]["failed_stage"] == "extract" and "items" not in _saved(path)


def test_the_path_flag_picks_the_extractor(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(J, "build_extractor", lambda: sentinel)
    monkeypatch.delenv("MM_EXTRACT_PATH", raising=False)
    assert R.build_extractor() is not sentinel            # 기본은 옛 추출기(설정이 없으면 None)
    monkeypatch.setenv("MM_EXTRACT_PATH", "judge")
    assert R.build_extractor() is sentinel
    monkeypatch.setenv("MM_EXTRACT_PATH", "새경로")
    with pytest.raises(ValueError):
        R.build_extractor()


def test_missing_judge_settings_skip_the_stage_by_name(tmp_path, monkeypatch):
    """판단 경로를 켰는데 토큰이 없다. 옛 경로로 넘어가지 않고 무엇이 없는지 말하며 그 단계에서 멈춘다."""
    from types import SimpleNamespace

    from shared import config

    cfg = SimpleNamespace(terra_api_key="k", terra_base_url="u", luna_api_key="k", luna_base_url="u", llm_mode="",
                          be_base_url="http://be", be_workspace_id="ws-1", be_service_token="",
                          llm_api_key="옛 추출기 키", llm_model="m", llm_base_url="")
    monkeypatch.setattr(config, "settings", lambda: cfg)
    monkeypatch.setenv("MM_EXTRACT_PATH", "judge")
    assert R.build_extractor() is None
    rec, path, manifest = _session(tmp_path)
    r = _run(rec, manifest, tmp_path, extractor=R.build_extractor(), handoff=None)
    assert r["ran"] == ["transcribed"] and r["status"] == "transcribed"
    assert r["skipped"]["extracted"].startswith("판단 경로 설정 없음(") and "BE_SERVICE_TOKEN" in r["skipped"]["extracted"]
    assert R.pending_sessions(rec) == [path]
    monkeypatch.delenv("MM_EXTRACT_PATH")
    assert _run(rec, _saved(path), tmp_path, extractor=None, handoff=None)["skipped"] == {"extracted": "LLM 설정 없음"}
