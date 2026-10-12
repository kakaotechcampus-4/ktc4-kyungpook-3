"""추출 단계에 끼운 판단 경로(capture/recorder.py). 결과 저장, finding 단위 실패의 재시도, 전부 실패, 인계까지.

판단 추출기는 정해 둔 결과를 차례로 돌려주는 가짜다. 모델도 LLM 도 안 쓴다. 시계는 recorder.utcnow 를 바꿔 끼운다.
"""

import json
import os
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pytest

from capture import judge_path as J
from capture import recorder as R
from tests.capture.fake_be import FakeBe
from tests.capture.test_recorder import DiesOnLong, EchoStt, _run, _session
from tests.capture.test_recovery import _fails, _handoff, _saved, clock, limits  # noqa: F401 - clock, limits 는 fixture


@pytest.fixture(autouse=True)
def rerun_limit(monkeypatch):
    """다시 돌리는 횟수의 기본값을 테스트 안에 적어 둔다. .env 나 환경 변수로 바뀌어도 기대값은 그대로다."""
    monkeypatch.setattr(R, "EXTRACT_RETRY_MAX", 2)


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
    assert r["ran"] == ["transcribed", "sourced", "extracted", "handed_off"] and r["status"] == "handed_off"
    assert r["items"] == [A, B_] and r["tasks"] is None and r["extract_failures"] == []
    saved = _saved(path)
    assert saved["items"].endswith("session_77_500.items.json") and "tasks" not in saved
    assert _items_on_disk(path) == [A, B_]
    assert not {"extract_failures", "extract_runs", "extract_partial"} & set(saved)
    assert fake.extractions["m1"]["items"] == [A, B_]            # BE 에는 파이프라인이 만든 항목이 그대로 갔다
    assert saved["be"]["item_count"] == 2 and R.pending_sessions(rec) == []


def test_partial_failures_hold_the_handoff_and_wait_for_a_rerun(tmp_path, clock, limits):
    """finding 하나를 판단하지 못했다. 성공한 것만 먼저 보내면 그 결정은 다시 못 넣는다(BE 는 회의당 추출을 한 번 받는다)."""
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    r = _run(rec, manifest, tmp_path, extractor=Runs(_out([A], [F1])), handoff=_handoff(fake))
    assert r["status"] == "failed" and r["failed_stage"] == "extract" and r["ran"] == ["transcribed", "sourced"]
    assert "ExtractIncomplete" in r["error"] and "1개" in r["error"]
    assert r["attempts"] == 1 and r["retry_in_s"] == 60.0 and r["gave_up"] is False
    saved = _saved(path)
    assert saved["extract_runs"] == 1 and saved["extract_failures"] == [F1] and "extracted" not in saved["stages"]
    assert _items_on_disk(path) == [A]                           # 결과는 버리지 않고 둔다
    assert fake.extractions == {} and fake.meetings["m1"]["status"] == "processing" and _fails(fake) == 0
    assert R.pending_sessions(rec) == [path]


def test_a_clean_rerun_clears_the_failure_marks(tmp_path, clock, limits):
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A], [F1]), _out([A, B_]))
    _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    r2 = _again(rec, tmp_path, ex, fake, clock)
    assert r2["ran"] == ["extracted", "handed_off"] and r2["items"] == [A, B_] and r2["extract_failures"] == []
    saved = _saved(path)
    assert not {"extract_failures", "extract_runs", "extract_partial", "recovery", "error"} & set(saved)
    assert fake.extractions["m1"]["items"] == [A, B_] and "missing_findings" not in saved["be"] and ex.calls == 2


def test_a_worse_rerun_does_not_replace_the_kept_result(tmp_path, clock, limits):
    """1단계는 돌릴 때마다 발화를 다르게 묶을 수 있다. 다시 돌린 결과가 더 나쁘면 앞의 것을 둔다."""
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A, B_], [F1]), _out([A], [F1, F2]))
    _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    r2 = _again(rec, tmp_path, ex, fake, clock)
    assert r2["status"] == "failed" and r2["attempts"] == 2 and r2["retry_in_s"] == 120.0
    saved = _saved(path)
    assert _items_on_disk(path) == [A, B_] and saved["extract_failures"] == [F1] and saved["extract_runs"] == 2
    assert fake.extractions == {}


def test_an_empty_rerun_does_not_replace_the_kept_result(tmp_path, clock, limits):
    """다시 돌렸더니 1단계가 발화를 하나도 고르지 못했다(항목 0, 실패 0). 실패 수만 견주면 빈 결과가 가진 결과를
    밀어내고 빈 추출이 등록된다. 항목이 더 많은 쪽을 남기고, 남긴 결과에 실패가 있으니 다시 돌린다."""
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A, B_], [F1]), _out([]))
    _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    r2 = _again(rec, tmp_path, ex, fake, clock)
    assert r2["status"] == "failed" and "ExtractIncomplete" in r2["error"] and fake.extractions == {}
    saved = _saved(path)
    assert _items_on_disk(path) == [A, B_] and saved["extract_failures"] == [F1] and saved["extract_runs"] == 2
    r3 = _again(rec, tmp_path, ex, fake, clock)
    assert r3["status"] == "handed_off" and r3["items"] == [A, B_] and r3["extract_failures"] == [F1]
    assert fake.extractions["m1"]["items"] == [A, B_] and _saved(path)["be"]["missing_findings"] == 1


def test_a_rerun_with_fewer_items_does_not_replace_on_equal_failures(tmp_path, clock, limits):
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A, B_, C], [F1]), _out([A], [F2]))
    _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    _again(rec, tmp_path, ex, fake, clock)
    assert _items_on_disk(path) == [A, B_, C] and _saved(path)["extract_failures"] == [F1]


def test_a_rerun_with_more_items_replaces_the_kept_result(tmp_path, clock, limits):
    """항목이 더 많으면 실패가 늘었어도 바꾼다. 1단계가 발화를 더 잘게 골라 판단한 것이 더 많다."""
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A], [F1]), _out([A, B_, C], [F1, F2]))
    _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    r2 = _again(rec, tmp_path, ex, fake, clock)
    assert r2["status"] == "failed" and _items_on_disk(path) == [A, B_, C]
    assert _saved(path)["extract_failures"] == [F1, F2]


def test_after_two_reruns_the_best_result_goes_out_with_failures_recorded(tmp_path, clock, limits):
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A], [F1, F2]), _out([A, B_], [F1]), _out([A], [F2, F3]))
    _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    _again(rec, tmp_path, ex, fake, clock)
    r3 = _again(rec, tmp_path, ex, fake, clock)
    assert ex.calls == 3 and r3["ran"] == ["extracted", "handed_off"] and r3["status"] == "handed_off"
    assert r3["items"] == [A, B_] and r3["extract_failures"] == [F1]      # 세 번 중 항목이 가장 많았던 결과
    saved = _saved(path)
    assert saved["extract_partial"] is True and saved["extract_failures"] == [F1] and "recovery" not in saved
    assert fake.extractions["m1"]["items"] == [A, B_] and saved["be"]["missing_findings"] == 1
    assert _fails(fake) == 0 and R.pending_sessions(rec) == []


def test_all_failed_is_a_stage_failure_and_registers_nothing(tmp_path, clock, limits):
    """토큰이 틀리면 finding 이 모두 유사 검색에서 실패한다. 빈 추출을 등록하지 않고, 포기할 때 BE 에 실패로 알린다."""
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(J.JudgeAllFailed("등록할 항목이 없고 판단하지 못한 발화 3개만 남았다. 첫 실패(similar): BeError: UNAUTHENTICATED"))
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


def test_a_partial_result_goes_out_instead_of_giving_up(tmp_path, clock, limits, monkeypatch):
    """다음 실패가 포기가 되는 차례면 부분 결과라도 인계한다. 가진 결과를 두고 회의를 실패로 닫지 않는다."""
    monkeypatch.setattr(R, "RECOVERY_MAX_ATTEMPTS", 2)
    monkeypatch.setattr(R, "EXTRACT_RETRY_MAX", 5)
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A], [F1]))
    r1 = _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    assert r1["status"] == "failed" and r1["attempts"] == 1
    r2 = _again(rec, tmp_path, ex, fake, clock)
    assert r2["status"] == "handed_off" and r2["extract_failures"] == [F1]
    assert _fails(fake) == 0 and fake.extractions["m1"]["items"] == [A]


def test_a_kept_result_goes_out_when_the_last_attempt_fails_entirely(tmp_path, clock, limits):
    """부분 결과를 하나 얻은 뒤로는 파이프라인이 통째로 실패하기만 했다. 다음 실패가 포기인 차례에는 가진 결과로 닫는다."""
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A], [F1]), J.JudgeAllFailed("등록할 항목이 없고 판단하지 못한 발화 2개만 남았다. 첫 실패(judge): Terra 응답 없음"))
    r = _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    for _ in range(3):
        r = _again(rec, tmp_path, ex, fake, clock)
        assert r["status"] == "failed" and "JudgeAllFailed" in r["error"]      # 아직 기회가 남아 있어 다시 돈다
    assert r["attempts"] == 4 and fake.extractions == {} and _items_on_disk(path) == [A]
    r5 = _again(rec, tmp_path, ex, fake, clock)
    assert ex.calls == 5 and r5["ran"] == ["extracted", "handed_off"] and r5["status"] == "handed_off"
    assert r5["items"] == [A] and r5["extract_failures"] == [F1] and r5["gave_up"] is False
    saved = _saved(path)
    assert saved["extract_partial"] is True and "JudgeAllFailed" in saved["extract_error"]
    assert fake.extractions["m1"]["items"] == [A] and saved["be"]["missing_findings"] == 1 and _fails(fake) == 0


def test_without_a_kept_result_the_last_attempt_still_gives_up(tmp_path, clock, limits):
    """가진 결과가 없으면 닫을 것이 없다. 파이프라인이 죽은 회의는 포기하고 BE 에 실패로 알린다."""
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(RuntimeError("1단계 응답을 읽지 못했다"))
    r = _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    for _ in range(4):
        r = _again(rec, tmp_path, ex, fake, clock)
    assert r["gave_up"] is True and r["status"] == "failed" and "items" not in _saved(path)
    assert r["error"] == "RuntimeError: 1단계 응답을 읽지 못했다"          # 마지막 차례에도 원래 실패가 그대로 남는다
    assert fake.extractions == {} and fake.meetings["m1"]["status"] == "failed"


def test_a_manual_recover_after_giving_up_hands_the_kept_result_off(tmp_path, clock, limits):
    """가진 결과가 있는데도 포기로 끝난 회의다(처리 도중 프로세스가 죽어 센 실패로 포기하면 그렇게 된다).
    결과 파일은 남아 있어서 사람이 /recover 를 치면 새 BE 회의에 그 결과로 인계한다."""
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A], [F1]), RuntimeError("1단계 응답을 읽지 못했다"))
    _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    m = _saved(path)
    m["recovery"] = {"attempts": 5, "gave_up_at": "2026-09-26T08:00:00+00:00", "failed_stage": "extract"}
    _handoff(fake).fail(m, "extract")                     # 포기하면서 BE 회의를 failed 로 닫았다
    R.save_manifest(path, m)
    assert fake.meetings["m1"]["status"] == "failed"
    r = R.recover(rec, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                  transcripts_dir=tmp_path / "transcripts", extractor=ex, handoff=_handoff(fake), manual=True)[0]
    assert r["status"] == "handed_off" and r["items"] == [A] and r["extract_failures"] == [F1]
    saved = _saved(path)
    assert saved["be"]["meeting_id"] == "m2" and saved["be"]["replaced"] == ["m1"]
    assert fake.extractions["m2"]["items"] == [A] and saved["be"]["missing_findings"] == 1


def test_no_rerun_when_the_limit_is_zero(tmp_path, clock, limits, monkeypatch):
    monkeypatch.setattr(R, "EXTRACT_RETRY_MAX", 0)
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    ex = Runs(_out([A], [F1]))
    r = _run(rec, manifest, tmp_path, extractor=ex, handoff=_handoff(fake))
    assert r["status"] == "handed_off" and ex.calls == 1 and _saved(path)["extract_partial"] is True


def test_a_changed_transcript_drops_the_kept_judge_result(tmp_path, clock, limits, monkeypatch):
    """전사가 바뀌면 옛 전사로 낸 판단 결과와 견주지 않는다. 새 결과가 실패가 더 많아도 새 전사의 것을 쓴다."""
    monkeypatch.setattr(R, "PARTIAL_RETRY_MAX", 1)
    monkeypatch.setattr(R, "EXTRACT_RETRY_MAX", 0)
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    stt = DiesOnLong()                                    # 화자 1 의 묶음만 죽는다
    ex = Runs(_out([A], [F1]), _out([C], [F2, F3]))
    assert _run(rec, manifest, tmp_path, backend=stt, extractor=ex, handoff=_handoff(fake))["status"] == "partial"
    stt.limit_s = 1.0                                     # 재전사도 죽는다. 상한(1회)에 닿아 빠진 채 추출로 간다
    r2 = _again(rec, tmp_path, ex, fake, clock, backend=stt)
    assert r2["status"] == "handed_off" and _items_on_disk(path) == [A] and _saved(path)["extract_failures"] == [F1]
    monkeypatch.setattr(R, "PARTIAL_RETRY_MAX", 2)
    stt.limit_s = 3.5                                     # 이번엔 살아서 전사가 바뀐다
    r3 = _again(rec, tmp_path, ex, fake, clock, backend=stt)
    assert r3["ran"] == ["retried", "sourced", "extracted", "handed_off"]
    assert _items_on_disk(path) == [C] and _saved(path)["extract_failures"] == [F2, F3]
    assert r3["be"]["stale_extraction"] is True           # BE 에는 옛 추출이 남아 있다


def test_a_changed_transcript_drops_a_kept_result_still_waiting_for_a_rerun(tmp_path, clock, limits, monkeypatch):
    """추출 단계가 아직 열려 있는데(다시 돌릴 차례) 전사가 바뀌었다. 옛 전사로 낸 결과는 항목이 더 많아도 남기지 않는다."""
    monkeypatch.setattr(R, "PARTIAL_RETRY_MAX", 1)
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    stt = DiesOnLong()
    ex = Runs(_out([A, B_], [F1]), _out([C], [F2, F3]))
    assert _run(rec, manifest, tmp_path, backend=stt, extractor=ex, handoff=_handoff(fake))["status"] == "partial"
    stt.limit_s = 1.0                                     # 재전사도 죽는다. 상한(1회)에 닿아 빠진 채 추출로 간다
    r2 = _again(rec, tmp_path, ex, fake, clock, backend=stt)
    assert r2["status"] == "failed" and "ExtractIncomplete" in r2["error"] and _items_on_disk(path) == [A, B_]
    monkeypatch.setattr(R, "PARTIAL_RETRY_MAX", 2)
    stt.limit_s = 3.5                                     # 이번엔 살아서 전사가 바뀐다
    r3 = _again(rec, tmp_path, ex, fake, clock, backend=stt)
    assert "retried" in r3["ran"] and r3["status"] == "failed" and fake.extractions == {}
    saved = _saved(path)
    assert _items_on_disk(path) == [C] and saved["extract_failures"] == [F2, F3] and saved["extract_runs"] == 1


def test_empty_values_copied_from_the_env_example_mean_the_defaults():
    """.env.example 을 그대로 복사하면 값이 빈 줄이 환경 변수로 들어온다. 빈 값 때문에 시작하다 죽으면 안 된다."""
    env = {**os.environ, "MM_EXTRACT_RETRY_MAX": "", "MM_EXTRACT_PATH": ""}
    code = "from capture import judge_path as J, recorder as R; print(R.EXTRACT_RETRY_MAX, J.extract_path())"
    out = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[2], env=env,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    assert out.stdout.split() == ["2", "legacy"]
