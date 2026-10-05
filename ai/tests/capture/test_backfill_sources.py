"""인계가 끝났는데 발화 저장이 없는 회의에 한 번 보내는 소급 명령(capture/backfill_sources.py, #146)."""

import json

from capture import backfill_sources as BF
from capture import handoff as H
from capture import recorder as R
from tests.capture.fake_be import FakeBe
from tests.capture.test_recorder import _extractor, _run, _session


def _be(fake):
    return H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token"), "ws-1")


def _handed_off_without_lines(tmp_path, fake, ts=500):
    """#146 전에 끝난 회의. 토큰 없이 돌아 발화 저장을 건너뛰고 인계까지 갔다."""
    rec, path, manifest = _session(tmp_path, ts=ts)
    _run(rec, manifest, tmp_path, extractor=_extractor({}),
         handoff=H.Handoff(H.BeClient("http://be", session=fake), "ws-1"))
    return rec, path


def test_only_handed_off_meetings_without_saved_lines_are_targets(tmp_path):
    fake = FakeBe()
    rec, done = _handed_off_without_lines(tmp_path, fake, ts=500)
    _session(tmp_path, ts=600)                                      # 아직 처리 전인 회의. 복구가 맡는다
    _, saved_already = _handed_off_without_lines(tmp_path, fake, ts=700)
    m = json.loads(saved_already.read_text(encoding="utf-8"))
    m["stages"]["sourced"] = "2026-10-05T00:00:00+00:00"
    m["be"]["sources"] = {"inserted": 3, "skipped": 0, "duration_ms": 12000, "meeting_id": m["be"]["meeting_id"]}
    R.save_manifest(saved_already, m)
    assert [p for p, _ in BF.targets(rec)] == [done]


def test_dry_run_lists_the_targets_without_calling_the_be(tmp_path):
    fake = FakeBe()
    rec, done = _handed_off_without_lines(tmp_path, fake)
    fake.calls.clear()
    out = BF.backfill(rec, transcripts_dir=tmp_path / "transcripts", handoff=_be(fake), dry_run=True)
    assert [(r["session"], r["sent"]) for r in out] == [("77_500", False)]
    assert fake.calls == [] and "sourced" not in json.loads(done.read_text(encoding="utf-8"))["stages"]


def test_backfill_saves_the_lines_and_records_the_stage_keeping_the_status(tmp_path):
    fake = FakeBe()
    rec, done = _handed_off_without_lines(tmp_path, fake)
    out = BF.backfill(rec, transcripts_dir=tmp_path / "transcripts", handoff=_be(fake))
    assert out[0]["sent"] is True and out[0]["sources"]["inserted"] == 3
    assert sorted(fake.sources["m1"]) == [1, 2, 3]                  # 이미 done 인 회의에도 BE 가 받는다
    m = json.loads(done.read_text(encoding="utf-8"))
    assert m["status"] == "handed_off" and "sourced" in m["stages"] and m["be"]["sources"]["inserted"] == 3
    assert "claimed_by" not in m
    assert BF.targets(rec) == []                                     # 두 번 보내지 않는다


def test_a_meeting_someone_holds_is_skipped(tmp_path):
    fake = FakeBe()
    rec, done = _handed_off_without_lines(tmp_path, fake)
    lock = R.try_lock(done)
    try:
        out = BF.backfill(rec, transcripts_dir=tmp_path / "transcripts", handoff=_be(fake))
    finally:
        lock.release()
    assert out[0]["sent"] is False and out[0]["busy"] is True and fake.sources == {}


def test_a_failed_save_is_reported_and_left_for_the_next_run(tmp_path):
    fake = FakeBe()
    rec, done = _handed_off_without_lines(tmp_path, fake)
    fake.sources_fail = (503, "SERVICE_UNAVAILABLE")
    out = BF.backfill(rec, transcripts_dir=tmp_path / "transcripts", handoff=_be(fake))
    assert out[0]["sent"] is False and "SERVICE_UNAVAILABLE" in out[0]["error"]
    assert [p for p, _ in BF.targets(rec)] == [done]


def test_main_refuses_without_the_be_settings_and_the_token(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(BF, "handoff_from_env", lambda: None)
    assert BF.main(["--recordings", str(tmp_path), "--dry-run"]) == 1
    monkeypatch.setattr(BF, "handoff_from_env", lambda: H.Handoff(H.BeClient("http://be", session=FakeBe()), "ws-1"))
    assert BF.main(["--recordings", str(tmp_path), "--dry-run"]) == 1           # 토큰이 없다
    assert "BE_SERVICE_TOKEN" in capsys.readouterr().err


def test_main_says_to_run_again_when_a_meeting_was_busy(monkeypatch, tmp_path, capsys):
    fake = FakeBe()
    rec, done = _handed_off_without_lines(tmp_path, fake)
    monkeypatch.setattr(BF, "handoff_from_env", lambda: _be(fake))
    lock = R.try_lock(done)
    try:
        code = BF.main(["--recordings", str(rec), "--transcripts", str(tmp_path / "transcripts")])
    finally:
        lock.release()
    assert code == 2 and "다시 돌려" in capsys.readouterr().out


def test_a_meeting_saved_by_someone_else_meanwhile_is_reported(tmp_path, monkeypatch):
    fake = FakeBe()
    rec, done = _handed_off_without_lines(tmp_path, fake)
    stale = BF.targets(rec)                                      # 목록을 만든 뒤에
    m = json.loads(done.read_text(encoding="utf-8"))
    m["stages"]["sourced"] = "2026-10-05T00:00:00+00:00"
    m["be"]["sources"] = {"inserted": 3, "skipped": 0, "duration_ms": 12000, "meeting_id": "m1"}
    R.save_manifest(done, m)                                     # 봇이 먼저 보냈다
    monkeypatch.setattr(BF, "targets", lambda _rec: stale)
    out = BF.backfill(rec, transcripts_dir=tmp_path / "transcripts", handoff=_be(fake))
    assert out[0]["already"] is True and out[0]["sent"] is False and fake.sources == {}


def test_a_meeting_whose_lines_went_to_a_replaced_be_meeting_is_a_target(tmp_path):
    """발화를 보낸 BE 회의가 뒤에 새 회의로 바뀌었으면 지금 회의에는 발화가 없다. 소급 대상이다."""
    fake = FakeBe()
    rec, done = _handed_off_without_lines(tmp_path, fake)
    m = json.loads(done.read_text(encoding="utf-8"))
    m["stages"]["sourced"] = "2026-10-05T00:00:00+00:00"
    m["be"]["sources"] = {"inserted": 3, "skipped": 0, "duration_ms": 12000, "meeting_id": "옛-회의"}
    R.save_manifest(done, m)
    assert [p for p, _ in BF.targets(rec)] == [done]
