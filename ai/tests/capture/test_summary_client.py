"""회의 요약 경로의 BeClient. 본문 없음과 빈 목록이 전혀 다른 뜻이라 호출 모양을 본다."""

import pytest

from capture import handoff as H
from shared.schemas import SummaryInput
from tests.capture.fake_be import FakeBe


def _client(fake):
    return H.BeClient("http://be", session=fake, service_token="svc-token")


def test_claim_without_a_scope_sends_no_body():
    fake = FakeBe()
    fake.add_summary("m1")
    claim = _client(fake).claim_summary()
    assert fake.calls == [("POST", "/summaries/claim", None)]
    assert (claim.extraction_id, claim.meeting_id, claim.workspace_id, claim.attempt) == ("e-m1", "m1", "ws-1", 1)


def test_claim_with_a_scope_sends_it_and_leaves_other_meetings_alone():
    fake = FakeBe()
    fake.add_summary("old")
    fake.add_summary("m1")
    assert _client(fake).claim_summary(["e-m1"]).meeting_id == "m1"
    assert fake.calls == [("POST", "/summaries/claim", {"extraction_ids": ["e-m1"]})]
    assert fake.summaries["old"]["attempts"] == 0


def test_an_empty_scope_is_sent_as_an_empty_list_and_claims_nothing():
    fake = FakeBe()
    fake.add_summary("m1")
    assert _client(fake).claim_summary([]) is None
    assert fake.calls == [("POST", "/summaries/claim", {"extraction_ids": []})]
    assert fake.summaries["m1"]["attempts"] == 0


def test_nothing_queued_is_none():
    assert _client(FakeBe()).claim_summary() is None


def test_summary_input_is_typed_and_waits_longer_than_the_default():
    fake = FakeBe()
    fake.add_summary("m1")
    parsed = _client(fake).summary_input("e-m1")
    assert isinstance(parsed, SummaryInput) and parsed.lines[0].speaker == "민수"
    assert fake.calls == [("GET", "/extractions/e-m1/summary-input", None)]
    assert fake.timeouts == [H.SUMMARY_BE_TIMEOUT_S] and H.SUMMARY_BE_TIMEOUT_S > H.TIMEOUT_S


def test_submit_returns_the_result_and_a_second_put_is_not_applied():
    fake = FakeBe()
    fake.add_summary("m1")
    client = _client(fake)
    body = {"overview": "요약", "key_points": [], "topics": []}
    assert client.submit_summary("e-m1", body)["applied"] is True
    assert client.submit_summary("e-m1", body)["applied"] is False


def test_put_errors_are_be_errors():
    fake = FakeBe()
    fake.add_summary("m1")
    fake.summary_put_fail = (500, "INTERNAL_ERROR")
    with pytest.raises(H.BeError):
        _client(fake).submit_summary("e-m1", {"overview": "x", "key_points": [], "topics": []})


def test_a_wrong_service_token_is_refused():
    fake = FakeBe()
    with pytest.raises(H.BeError) as e:
        H.BeClient("http://be", session=fake, service_token="wrong").claim_summary()
    assert e.value.status == 401


def test_request_sends_every_field_so_the_be_defaults_never_decide():
    fake = FakeBe()
    fake.add_summary("m1", requested=False)
    rows = _client(fake).request_summaries("ws-1", meeting_ids=["m1"], dry_run=True)
    assert fake.calls[-1][2] == {"meeting_ids": ["m1"], "include_all": False, "force": False, "dry_run": True}
    assert [(r["meeting_id"], r["state"]) for r in rows] == [("m1", "requested")]
    assert fake.summaries["m1"]["requested"] is False


def test_a_request_for_a_meeting_outside_the_workspace_is_an_error():
    with pytest.raises(H.BeError) as e:
        _client(FakeBe()).request_summaries("ws-1", meeting_ids=["nope"], dry_run=True)
    assert e.value.code == "MEETING_NOT_FOUND"
