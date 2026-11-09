"""요약 대기열 한 건(capture/summary_sweep.py). 어떤 실패도 예외로 나가지 않고, 실패하면 아무것도 보내지 않는다."""

import llm as llm_module
import pytest

from capture import handoff as H
from capture import summary_sweep as S
from llm import FakeLLM, LLMReply, NullLLM
from tests.capture.fake_be import FakeBe

GOOD = {"overview": "요약", "key_points": ["핵심"], "topics": [{"key": "T1", "items": ["I1"], "decisions": [
    {"text": "초대는 이메일로만 한다", "replaces": ["D1"]}]}]}


def _runner(fake, *replies):
    return S.SummaryRunner(H.BeClient("http://be", session=fake, service_token="svc-token"), FakeLLM(list(replies)))


def _puts(fake):
    return [c for c in fake.calls if c[0] == "PUT"]


def test_nothing_queued_is_none_and_costs_nothing():
    fake = FakeBe()
    runner = _runner(fake, GOOD)
    assert runner.run_once() is None
    assert runner.llm.prompts == [] and [c[0] for c in fake.calls] == ["POST"]


def test_a_queued_meeting_goes_claim_read_summarize_put_with_real_ids():
    fake = FakeBe()
    fake.add_summary("m1")
    out = _runner(fake, GOOD).run_once()
    assert [c[0] for c in fake.calls] == ["POST", "GET", "PUT"]
    assert out.saved is True and out.error is None and out.extraction_id == "e-m1"
    saved = fake.summaries["m1"]["saved"]
    assert saved["topics"][0]["topic_id"] == "topic-1" and saved["topics"][0]["item_ids"] == ["item-1"]
    assert saved["topics"][0]["decisions"][0]["replaces"] == ["dec-1"]
    assert fake.summaries["m1"]["requested"] is False


def test_the_log_is_one_line_with_tokens_and_seconds(capsys):
    fake = FakeBe()
    fake.add_summary("m1")
    reply = LLMReply(GOOD, finish_reason="stop", prompt_tokens=1200, completion_tokens=300, reasoning_tokens=40,
                     elapsed_s=2.5)
    _runner(fake, reply).run_once()
    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 1
    assert "m1" in lines[0] and "1200" in lines[0] and "300" in lines[0] and "40" in lines[0] and "2.5초" in lines[0]


@pytest.mark.parametrize("reply,reason", [
    (None, "호출 실패"),
    (LLMReply({"overview": ""}, finish_reason="stop"), "형식 오류"),
    (LLMReply(GOOD, finish_reason="length"), "출력 잘림"),
])
def test_a_failed_summary_sends_nothing_and_leaves_the_lease(reply, reason, capsys):
    fake = FakeBe()
    fake.add_summary("m1")
    out = _runner(fake, reply).run_once()
    assert out.saved is False and out.error == reason and _puts(fake) == []
    assert fake.summaries["m1"]["leased"] is True and fake.summaries["m1"]["attempts"] == 1
    assert reason in capsys.readouterr().out


def test_the_second_attempt_after_the_lease_expires_uses_the_compact_prompt():
    fake = FakeBe()
    fake.add_summary("m1")
    runner = _runner(fake, None, GOOD)
    runner.run_once()
    fake.summaries["m1"]["leased"] = False
    assert runner.run_once().saved is True
    assert "key_points 5개" in runner.llm.prompts[0] and "key_points 3개" in runner.llm.prompts[1]


@pytest.mark.parametrize("status,code", [(500, "INTERNAL_ERROR"), (422, "VALIDATION_ERROR"), (404, "EXTRACTION_NOT_FOUND")])
def test_a_failed_put_does_not_raise(status, code):
    fake = FakeBe()
    fake.add_summary("m1")
    fake.summary_put_fail = (status, code)
    out = _runner(fake, GOOD).run_once()
    assert out.saved is False and code in out.error and out.reply is not None


def test_a_be_outage_on_claim_does_not_raise_or_call_the_llm():
    fake = FakeBe()
    fake.down = True
    runner = _runner(fake, GOOD)
    out = runner.run_once()
    assert out.saved is False and out.extraction_id is None and "NETWORK" in out.error
    assert runner.llm.prompts == []


def test_a_read_failure_after_the_claim_does_not_raise_or_call_the_llm():
    fake = FakeBe()
    fake.add_summary("m1")
    fake.summaries["m1"]["lines"] = None
    runner = _runner(fake, GOOD)
    out = runner.run_once()
    assert out.saved is False and out.extraction_id == "e-m1" and runner.llm.prompts == []


def test_an_llm_that_raises_does_not_escape():
    class Broken(FakeLLM):
        def generate_json_once(self, prompt, *, timeout_s, max_completion_tokens, reasoning_effort="medium"):
            raise RuntimeError("boom")

    fake = FakeBe()
    fake.add_summary("m1")
    runner = S.SummaryRunner(H.BeClient("http://be", session=fake, service_token="svc-token"), Broken())
    out = runner.run_once()
    assert out.saved is False and "boom" in out.error


def test_applied_false_is_a_finished_run_not_a_failure(capsys):
    fake = FakeBe()
    fake.add_summary("m1")
    runner = _runner(fake, GOOD)
    original = fake.request

    def lost_race(method, url, **kw):
        if method == "PUT":
            fake.summaries["m1"]["requested"] = False
        return original(method, url, **kw)

    fake.request = lost_race
    out = runner.run_once()
    assert out.saved is False and out.error is None and len(_puts(fake)) == 1
    assert "먼저" in capsys.readouterr().out


def test_only_limits_the_claim():
    fake = FakeBe()
    fake.add_summary("old")
    fake.add_summary("m1")
    assert _runner(fake, GOOD).run_once(only=["e-m1"]).meeting_id == "m1"
    assert fake.summaries["old"]["attempts"] == 0


def _settings(monkeypatch, *, url="http://be", token="svc", key="luna-key"):
    cfg = llm_module.settings()
    fake_cfg = type(cfg)(be_base_url=url, be_service_token=token, luna_api_key=key, luna_base_url="http://llm",
                         terra_api_key=key, terra_base_url="http://llm", llm_mode="")
    monkeypatch.setattr(S, "settings", lambda: fake_cfg)
    monkeypatch.setattr(llm_module, "settings", lambda: fake_cfg)
    monkeypatch.setattr(llm_module, "_cached", {})


def test_empty_switch_is_off(monkeypatch):
    _settings(monkeypatch)
    for value in ("", "  "):
        monkeypatch.setenv("MM_SUMMARY_LLM", value)
        assert S.summary_from_env() is None


@pytest.mark.parametrize("which", ["luna", "terra"])
def test_a_known_model_builds_a_runner(monkeypatch, capsys, which):
    _settings(monkeypatch)
    monkeypatch.setenv("MM_SUMMARY_LLM", which)
    runner = S.summary_from_env()
    assert runner.llm.model == f"gpt-5.6-{which}" and isinstance(runner.client, H.BeClient)
    assert capsys.readouterr().out == f"[summary] runner ready model={which}\n"


def test_an_unknown_model_raises(monkeypatch):
    _settings(monkeypatch)
    monkeypatch.setenv("MM_SUMMARY_LLM", "opus")
    with pytest.raises(ValueError):
        S.summary_from_env()


def test_a_null_llm_means_not_enabled_because_it_would_burn_every_attempt(monkeypatch, capsys):
    _settings(monkeypatch, key="")
    monkeypatch.setenv("MM_SUMMARY_LLM", "luna")
    assert isinstance(llm_module.get_llm("luna"), NullLLM)
    assert S.summary_from_env() is None
    assert "MM_SUMMARY_LLM" in capsys.readouterr().out


def test_missing_be_settings_mean_not_enabled_and_values_are_not_printed(monkeypatch, capsys):
    _settings(monkeypatch, url="http://be-secret-host", token="")
    monkeypatch.setenv("MM_SUMMARY_LLM", "luna")
    assert S.summary_from_env() is None
    out = capsys.readouterr().out
    assert "BE_SERVICE_TOKEN" in out and "be-secret-host" not in out


def test_claim_epoch_is_fixed_for_input_and_put_even_if_client_cache_changes():
    fake = FakeBe()
    fake.add_summary("m1")
    runner = _runner(fake, GOOD)
    original = fake.request

    def cached_newer_epoch(method, url, **kwargs):
        if method == "GET" and url.endswith("/summary-input"):
            runner.client.workspace_epochs["ws-1"] = 10
        return original(method, url, **kwargs)

    fake.request = cached_newer_epoch
    assert runner.run_once().saved is True
    assert [headers.get("X-Privacy-Epoch") for headers in fake.headers] == [None, "0", "0"]
    assert fake.calls[-1][2]["claim_token"] == fake.summaries["m1"]["claim_token"]


def test_withdrawal_during_llm_discards_old_payload_without_refreshing_epoch():
    fake = FakeBe()
    fake.add_summary("m1")

    class WithdrawDuringReply(FakeLLM):
        def generate_json_once(self, prompt, *, timeout_s, max_completion_tokens, reasoning_effort="medium"):
            fake.summaries["m1"]["identity_epoch"] += 1
            return super().generate_json_once(prompt, timeout_s=timeout_s, max_completion_tokens=max_completion_tokens,
                                              reasoning_effort=reasoning_effort)

    runner = S.SummaryRunner(H.BeClient("http://be", session=fake, service_token="svc-token"), WithdrawDuringReply([GOOD]))
    outcome = runner.run_once()
    assert outcome.saved is False and "PRIVACY_VERSION_CHANGED" in outcome.error
    assert fake.summaries["m1"]["saved"] is None
    assert fake.headers[-1]["X-Privacy-Epoch"] == "0"
