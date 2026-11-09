"""옛 회의 요약 명령(capture/backfill_summaries.py). 유료 호출은 FakeLLM 으로만 흉내 낸다."""

import json

import pytest

from capture import backfill_summaries as B
from capture import handoff as H
from llm import FakeLLM, LLMReply, NullLLM
from shared.config import AI_ROOT
from tests.capture.fake_be import FakeBe

GOOD = {"overview": "요약", "key_points": ["핵심"]}


@pytest.fixture
def fake(monkeypatch):
    be = FakeBe()
    monkeypatch.setattr(B, "handoff_from_env", lambda: H.Handoff(H.BeClient("http://be", session=be, service_token="svc-token")))
    return be


@pytest.fixture
def llm(monkeypatch):
    client = FakeLLM()
    client.name, client.model = "luna", "gpt-5.6-luna"
    monkeypatch.setattr(B, "get_llm", lambda which: client)
    return client


def _ws(*args):
    return ["--workspace", "ws-1", *args]


def _paid(tmp_path, *args):
    return _ws(*args, "--llm", "luna", "--out", str(tmp_path / "out"), "--ledger", str(tmp_path / "ledger.jsonl"))


def _ledger(tmp_path):
    return [json.loads(line) for line in (tmp_path / "ledger.jsonl").read_text(encoding="utf-8").splitlines()]


def _claims(be):
    return [c for c in be.calls if c[1] == "/summaries/claim"]


def _writes(be):
    """BE 상태를 바꾸는 호출."""
    return [c for c in be.calls if c[0] == "PUT" or c[1] == "/summaries/claim"
            or (c[1].endswith("/summary-requests") and not c[2]["dry_run"])]


@pytest.mark.parametrize("args", [
    [],
    _ws(),
    _ws("--meeting", "m1", "--all"),
    ["--meeting", "m1"],
    _ws("--all", "--dry-run", "--run"),
    _ws("--meeting", "m1", "--preview", "--run", "--llm", "luna", "--out", "/tmp/x", "--ledger", "/tmp/y"),
])
def test_a_bad_scope_is_an_error_before_any_call(fake, args, capsys):
    assert B.main(args) == 1
    assert fake.calls == [] and capsys.readouterr().err


@pytest.mark.parametrize("mode", ["--run", "--preview"])
def test_paid_modes_need_a_model_and_a_ledger_and_named_meetings(fake, llm, tmp_path, mode):
    out, ledger = ["--out", str(tmp_path / "o")], ["--ledger", str(tmp_path / "l")]
    assert B.main(_ws("--meeting", "m1", mode, *out, *ledger)) == 1                      # 모델 없음
    assert B.main(_ws("--meeting", "m1", mode, "--llm", "gpt4", *out, *ledger)) == 1     # 모르는 모델
    assert B.main(_ws("--meeting", "m1", mode, "--llm", "luna", *out)) == 1              # 장부 없음
    assert B.main(_ws("--all", mode, "--llm", "luna", *out, *ledger)) == 1               # 전체는 워커가 돈다
    assert fake.calls == [] and llm.prompts == []


def test_preview_needs_an_output_folder(fake, llm, tmp_path):
    assert B.main(_ws("--meeting", "m1", "--preview", "--llm", "luna", "--ledger", str(tmp_path / "l"))) == 1
    assert fake.calls == []


def test_raw_output_cannot_go_inside_the_repo(fake, llm, tmp_path, capsys):
    args = _ws("--meeting", "m1", "--preview", "--llm", "luna", "--ledger", str(tmp_path / "l"),
               "--out", str(AI_ROOT / "runs/summary"))
    assert B.main(args) == 1
    assert fake.calls == [] and "레포" in capsys.readouterr().err


@pytest.mark.parametrize("mode", ["--run", "--preview"])
def test_a_null_llm_stops_before_the_be_is_touched(fake, monkeypatch, tmp_path, mode):
    fake.add_summary("m1", requested=False)
    monkeypatch.setattr(B, "get_llm", lambda which: NullLLM())
    assert B.main(_paid(tmp_path, "--meeting", "m1", mode)) == 1
    assert fake.calls == []


def test_missing_be_settings_are_an_error(monkeypatch, capsys):
    monkeypatch.setattr(B, "handoff_from_env", lambda: None)
    assert B.main(_ws("--all", "--dry-run")) == 1


def test_a_be_error_on_the_request_is_exit_one(fake, capsys):
    assert B.main(_ws("--meeting", "nope", "--dry-run")) == 1
    assert "MEETING_NOT_FOUND" in capsys.readouterr().err


def test_dry_run_prints_targets_and_a_labelled_estimate_without_paying_or_writing(fake, monkeypatch, capsys):
    monkeypatch.setattr(B, "get_llm", lambda which: pytest.fail("LLM 을 만들면 안 된다"))
    fake.add_summary("m1", requested=False, chars=24000)
    fake.add_summary("m2", requested=False, saved={"overview": "x"})
    fake.add_summary("m3", blocked="not_done")
    assert B.main(_ws("--all", "--dry-run")) == 0
    out = capsys.readouterr().out
    assert _writes(fake) == [] and fake.summaries["m1"]["requested"] is False
    assert "m1" in out and "requested" in out and "24000자" in out and "done" in out and "not_done" in out
    assert "추정" in out and "미확정" in out


def test_without_a_mode_it_only_queues_and_never_claims(fake, llm, capsys):
    fake.add_summary("m1", requested=False)
    assert B.main(_ws("--all")) == 0
    assert fake.summaries["m1"]["requested"] is True and _claims(fake) == [] and llm.prompts == []


def test_force_requeues_a_finished_meeting(fake):
    fake.add_summary("m1", requested=False, saved={"overview": "x"})
    assert B.main(_ws("--meeting", "m1", "--force")) == 0
    assert fake.summaries["m1"]["requested"] is True
    assert next(body for method, path, body in fake.calls if path.endswith("/summary-requests"))["force"] is True


def test_a_meeting_already_in_line_is_exit_two(fake, capsys):
    fake.add_summary("m1", requested=True, leased=True)
    assert B.main(_ws("--meeting", "m1")) == 2


def test_run_touches_only_the_given_meetings_and_never_claims_without_a_scope(fake, llm, tmp_path, capsys):
    fake.add_summary("old")                                   # 스위치를 켜기 전에 쌓인 회의
    fake.add_summary("m1", requested=False)
    fake.add_summary("m2", requested=False)
    llm.responses = [GOOD, GOOD]
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--meeting", "m2", "--run")) == 0
    assert fake.summaries["old"]["attempts"] == 0 and fake.summaries["old"]["saved"] is None
    assert fake.summaries["m1"]["saved"]["overview"] == "요약" and fake.summaries["m2"]["saved"]
    assert [c[2]["extraction_ids"] for c in _claims(fake)] == [["e-m1", "e-m2"], ["e-m2"]]
    assert len(llm.prompts) == 2


def test_run_with_nothing_runnable_does_not_claim(fake, llm, tmp_path, capsys):
    fake.add_summary("old")
    fake.add_summary("m1", requested=False, saved={"overview": "x"})
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--run")) == 0
    assert _claims(fake) == [] and fake.summaries["old"]["attempts"] == 0


def test_run_leaves_a_leased_meeting_and_exits_two(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=True, leased=True)
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--run")) == 2
    assert llm.prompts == []


def test_a_failed_llm_call_is_exit_one_one_paid_call_and_still_in_the_ledger(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False, chars=24000)
    llm.responses = [LLMReply(GOOD, finish_reason="length", prompt_tokens=12000, completion_tokens=1500, elapsed_s=3.0)]
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--run")) == 1
    assert len(llm.prompts) == 1 and len(_ledger(tmp_path)) == 1
    assert [c for c in fake.calls if c[0] == "PUT"] == []
    written = json.loads((tmp_path / "out/m1.luna.json").read_text(encoding="utf-8"))
    assert written["failure"] == "출력 잘림" and written["raw"] == GOOD and written["draft"] is None


def test_a_failed_put_is_exit_one_and_the_paid_call_is_recorded(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False)
    fake.summary_put_fail = (500, "INTERNAL_ERROR")
    llm.responses = [GOOD]
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--run")) == 1
    assert len(_ledger(tmp_path)) == 1


def test_applied_false_is_not_a_failure(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False)
    llm.responses = [GOOD]
    original = fake.request

    def lost_race(method, url, **kw):
        if method == "PUT":
            fake.summaries["m1"]["requested"] = False
        return original(method, url, **kw)

    fake.request = lost_race
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--run")) == 0


def test_a_be_outage_during_the_run_ends_with_exit_one(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False)
    original = fake.request

    def outage(method, url, **kw):
        fake.down = url.endswith("/summaries/claim")
        return original(method, url, **kw)

    fake.request = outage
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--run")) == 1
    assert llm.prompts == []


def test_the_ledger_has_one_line_per_call_in_the_shared_format(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False)
    llm.responses = [LLMReply(GOOD, finish_reason="stop", prompt_tokens=10000, completion_tokens=1000,
                              reasoning_tokens=200)]
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--run")) == 0
    line = _ledger(tmp_path)[0]
    assert set(line) == {"시각", "종류", "label", "양", "원", "비고"}
    assert line["종류"] == "luna" and "m1" in line["label"]
    assert line["양"] == {"입력": 10000, "출력": 1000, "추론": 200}
    assert isinstance(line["원"], int) and line["원"] > 0 and "추정" in line["비고"]
    assert "추정" in capsys.readouterr().out


def test_a_call_without_usage_is_still_counted_from_the_transcript_length(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False, chars=24000)
    llm.responses = [None]
    B.main(_paid(tmp_path, "--meeting", "m1", "--run"))
    assert _ledger(tmp_path)[0]["원"] == B.estimate_won(24000)


def test_run_without_an_output_folder_still_saves_and_keeps_the_ledger(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False)
    llm.responses = [GOOD]
    args = _ws("--meeting", "m1", "--run", "--llm", "luna", "--ledger", str(tmp_path / "ledger.jsonl"))
    assert B.main(args) == 0
    assert fake.summaries["m1"]["saved"] and len(_ledger(tmp_path)) == 1


def test_preview_summarizes_by_extraction_id_and_never_writes(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False, saved={"overview": "옛 요약"})
    fake.add_summary("m2", requested=False)
    fake.add_summary("m3", blocked="no_sources")
    llm.responses = [GOOD, GOOD]
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--meeting", "m2", "--meeting", "m3", "--preview")) == 0
    assert _writes(fake) == []
    assert [c[1] for c in fake.calls if c[0] == "GET"] == ["/workspaces/ws-1/members/names", "/extractions/e-m1/summary-input",
                                                           "/extractions/e-m2/summary-input"]
    assert fake.summaries["m1"]["saved"] == {"overview": "옛 요약"} and fake.summaries["m2"]["attempts"] == 0
    assert json.loads((tmp_path / "out/m1.luna.json").read_text(encoding="utf-8"))["draft"]["overview"] == "요약"
    assert not (tmp_path / "out/m3.luna.json").exists()
    assert len(_ledger(tmp_path)) == 2


def test_preview_keeps_going_after_a_failed_meeting(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False)
    fake.add_summary("m2", requested=False)
    fake.summaries["m1"]["lines"] = None
    llm.responses = [GOOD]
    assert B.main(_paid(tmp_path, "--meeting", "m1", "--meeting", "m2", "--preview")) == 1
    assert (tmp_path / "out/m2.luna.json").exists()


def test_raw_output_stays_out_of_the_terminal(fake, llm, tmp_path, capsys):
    fake.add_summary("m1", requested=False)
    llm.responses = [{"overview": "민감한 발언 요약", "key_points": []}]
    B.main(_paid(tmp_path, "--meeting", "m1", "--preview"))
    assert "민감한 발언" not in capsys.readouterr().out
