"""회의 음성 보관(#561). 인계가 끝나 더 돌 일이 없는 회의의 트랙 wav 는 바로, 처리를 포기한 회의의 트랙 wav 는
포기 7일 뒤 지운다. 매니페스트·대본·처리 기록은 남기고, 진행 중·잠긴 회의는 지우지 않는다.
정책 시행(AUDIO_PRUNE_SINCE) 전에 인계되거나 포기한 회의는 팀원 동의를 받은 검증용이라 남긴다(#568)."""

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import soundfile as sf

from capture import recorder as R

NOW = datetime(2026, 11, 20, 3, 0, 0, tzinfo=timezone.utc)
HANDED = {"handed_off": R._iso(NOW - timedelta(minutes=1))}   # 정책 시행 뒤 인계


def _meeting(rec, session, *, status, **extra):
    """트랙 두 개와 대본 하나가 있는 회의를 만든다. 매니페스트 경로를 돌려준다."""
    mdir = rec / session
    mdir.mkdir(parents=True)
    speakers = []
    for uid in ("1", "2"):
        (mdir / f"{uid}_1.wav").write_bytes(b"RIFF")
        speakers.append({"user_id": uid, "display_name": uid, "file": f"{session}/{uid}_1.wav"})
    (mdir / "transcript.md").write_text("대본", encoding="utf-8")
    path = R.manifest_path(rec, session)
    R.save_manifest(path, {"session": session, "status": status, "meeting_dir": session, "speakers": speakers, **extra})
    return path


def _wavs(rec, session):
    return sorted(p.name for p in (rec / session).glob("*.wav"))


def test_handed_off_tracks_are_dropped_and_the_rest_stays(tmp_path):
    rec = tmp_path / "recordings"
    path = _meeting(rec, "g_1", status=R.STATUS_HANDED_OFF, stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert _wavs(rec, "g_1") == []
    assert (rec / "g_1" / "transcript.md").exists()
    assert path.exists()


def test_handed_off_upload_tracks_are_dropped_right_away(tmp_path):
    rec = tmp_path / "recordings"
    _meeting(rec, "upload_m1", status=R.STATUS_HANDED_OFF, source="upload", be={"meeting_id": "m1", "status": "done"},
             stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == ["upload_m1"]
    assert _wavs(rec, "upload_m1") == []


def test_partial_meeting_with_retries_left_keeps_its_tracks(tmp_path):
    rec = tmp_path / "recordings"
    _meeting(rec, "g_1", status=R.STATUS_HANDED_OFF, partial=True, retry_runs=0, stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == []
    assert len(_wavs(rec, "g_1")) == 2


def test_partial_meeting_without_retries_left_drops_its_tracks(tmp_path):
    rec = tmp_path / "recordings"
    _meeting(rec, "g_1", status=R.STATUS_HANDED_OFF, partial=True, retry_runs=R.PARTIAL_RETRY_MAX, stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert _wavs(rec, "g_1") == []


def test_given_up_partial_meeting_keeps_tracks_seven_days(tmp_path):
    rec = tmp_path / "recordings"
    for days in (6, 8):
        _meeting(rec, f"g_{days}", status=R.STATUS_PARTIAL,
                 recovery={"attempts": 5, "gave_up_at": R._iso(NOW - timedelta(days=days))})
    assert R.prune_audio(rec, now=NOW) == ["g_8"]
    assert len(_wavs(rec, "g_6")) == 2


def test_meetings_in_progress_keep_their_tracks(tmp_path):
    rec = tmp_path / "recordings"
    for i, status in enumerate((R.STATUS_RECORDING, R.STATUS_SAVED, R.STATUS_TRANSCRIBED, R.STATUS_PARTIAL,
                                R.STATUS_SOURCED, R.STATUS_EXTRACTED, R.STATUS_FAILED, R.STATUS_DIARIZED)):
        _meeting(rec, f"g_{i}", status=status, recovery={"attempts": 1, "next_at": R._iso(NOW)})
    assert R.prune_audio(rec, now=NOW) == []
    assert all(len(_wavs(rec, f"g_{i}")) == 2 for i in range(8))


def test_given_up_tracks_stay_seven_days(tmp_path):
    rec = tmp_path / "recordings"
    six = R._iso(NOW - timedelta(days=6))
    eight = R._iso(NOW - timedelta(days=8))
    _meeting(rec, "g_6", status=R.STATUS_FAILED, recovery={"attempts": 5, "gave_up_at": six})
    _meeting(rec, "g_8", status=R.STATUS_FAILED, recovery={"attempts": 5, "gave_up_at": eight})
    assert R.prune_audio(rec, now=NOW) == ["g_8"]
    assert len(_wavs(rec, "g_6")) == 2
    assert _wavs(rec, "g_8") == []
    assert (rec / "g_8" / "transcript.md").exists()


def test_meetings_before_the_policy_keep_their_tracks(tmp_path):
    """정책 시행 전에 인계되거나 포기한 회의, 시각이 없거나 깨진 회의, 자동 복구 전의 실패는 지우지 않는다(#568)."""
    rec = tmp_path / "recordings"
    before = R._iso(R.AUDIO_PRUNE_SINCE - timedelta(seconds=1))
    _meeting(rec, "g_handed", status=R.STATUS_HANDED_OFF, stages={"handed_off": before})
    _meeting(rec, "g_gave_up", status=R.STATUS_FAILED, recovery={"attempts": 5, "gave_up_at": before})
    _meeting(rec, "g_no_time", status=R.STATUS_HANDED_OFF)
    _meeting(rec, "g_broken", status=R.STATUS_HANDED_OFF, stages={"handed_off": "어제"})
    _meeting(rec, "g_legacy", status=R.STATUS_FAILED)
    assert R.prune_audio(rec, now=NOW + timedelta(days=30)) == []
    assert all(len(_wavs(rec, s)) == 2 for s in ("g_handed", "g_gave_up", "g_no_time", "g_broken", "g_legacy"))


def test_meetings_right_after_the_policy_follow_the_rule(tmp_path):
    rec = tmp_path / "recordings"
    since = R._iso(R.AUDIO_PRUNE_SINCE)
    _meeting(rec, "g_handed", status=R.STATUS_HANDED_OFF, stages={"handed_off": since})
    _meeting(rec, "g_gave_up", status=R.STATUS_FAILED, recovery={"attempts": 5, "gave_up_at": since})
    assert R.prune_audio(rec, now=R.AUDIO_PRUNE_SINCE + timedelta(days=8)) == ["g_gave_up", "g_handed"]


def test_locked_meeting_is_skipped(tmp_path):
    rec = tmp_path / "recordings"
    path = _meeting(rec, "g_1", status=R.STATUS_HANDED_OFF, stages=HANDED)
    lock = R.try_lock(path)
    try:
        assert R.prune_audio(rec, now=NOW) == []
        assert len(_wavs(rec, "g_1")) == 2
    finally:
        lock.release()


def test_already_pruned_meetings_are_not_reported_again(tmp_path):
    rec = tmp_path / "recordings"
    _meeting(rec, "g_1", status=R.STATUS_HANDED_OFF, stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert R.prune_audio(rec, now=NOW) == []


def test_broken_manifest_and_bad_entries_do_not_raise(tmp_path):
    rec = tmp_path / "recordings"
    rec.mkdir()
    (rec / "session_broken.json").write_text("{", encoding="utf-8")
    R.save_manifest(R.manifest_path(rec, "odd"), {"session": "odd", "status": R.STATUS_HANDED_OFF,
                                                  "speakers": [{"user_id": "1"}, "x"]})
    _meeting(rec, "g_1", status=R.STATUS_HANDED_OFF, stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == ["g_1"]


def _stalled(rec, session, *, at, **extra):
    """인계도 포기도 못 하고 멈춘 디스코드 회의. 저장 시각(recorded_at)이 at 이다."""
    return _meeting(rec, session, status=R.STATUS_SAVED, recorded_at=R._iso(at), **extra)


def test_stalled_meeting_keeps_tracks_six_days_and_drops_them_after_eight(tmp_path):
    rec = tmp_path / "recordings"
    saved = R.AUDIO_PRUNE_SINCE + timedelta(days=1)
    _stalled(rec, "g_1", at=saved, workspace_wait=R._iso(saved + timedelta(days=7)))   # 연결 확인은 진행이 아니다
    assert R.prune_audio(rec, now=saved + timedelta(days=6)) == []
    assert R.prune_audio(rec, now=saved + timedelta(days=8)) == ["g_1"]
    assert _wavs(rec, "g_1") == []
    assert (rec / "g_1" / "transcript.md").exists()


def test_stalled_meeting_counts_from_its_latest_progress(tmp_path):
    """마지막 진행은 저장 시각·단계 시각·다음 재시도 시각 가운데 가장 늦은 것이다."""
    rec = tmp_path / "recordings"
    saved = R.AUDIO_PRUNE_SINCE + timedelta(days=1)
    _stalled(rec, "g_stage", at=saved, stages={"transcribed": R._iso(saved + timedelta(days=3))})
    _stalled(rec, "g_retry", at=saved, recovery={"attempts": 2, "next_at": R._iso(saved + timedelta(days=3))})
    assert R.prune_audio(rec, now=saved + timedelta(days=8)) == []
    assert R.prune_audio(rec, now=saved + timedelta(days=11)) == ["g_retry", "g_stage"]


def test_stalled_meeting_before_the_policy_keeps_its_tracks(tmp_path):
    rec = tmp_path / "recordings"
    _stalled(rec, "g_old", at=R.AUDIO_PRUNE_SINCE - timedelta(seconds=1))
    _meeting(rec, "g_no_time", status=R.STATUS_SAVED)
    assert R.prune_audio(rec, now=R.AUDIO_PRUNE_SINCE + timedelta(days=30)) == []


def test_stalled_rule_skips_uploads_and_recordings(tmp_path):
    """업로드는 #439 정리와 BE 만료가 맡고, 녹음 중인 회의는 지우지 않는다."""
    rec = tmp_path / "recordings"
    saved = R.AUDIO_PRUNE_SINCE + timedelta(days=1)
    _stalled(rec, "upload_m1", at=saved, source="upload")
    _meeting(rec, "g_rec", status=R.STATUS_RECORDING, recorded_at=R._iso(saved))
    assert R.prune_audio(rec, now=saved + timedelta(days=30)) == []


# ───────────────────────────────────────────── 지우기 직전 올리기 대기 폴더에 넣기(#659)
def _real_meeting(rec, session, *, status=R.STATUS_HANDED_OFF, broken=False, **extra):
    """실제 16kHz wav 트랙 둘이 있는 회의. broken 이면 트랙이 wav 가 아니라 섞을 수 없다."""
    mdir = rec / session
    mdir.mkdir(parents=True)
    speakers = []
    for uid in ("1", "2"):
        if broken:
            (mdir / f"{uid}_1.wav").write_bytes(b"RIFF")
        else:
            sf.write(str(mdir / f"{uid}_1.wav"), np.full(8000, 0.1, dtype=np.float32), 16000, subtype="PCM_16")
        speakers.append({"user_id": uid, "display_name": uid, "file": f"{session}/{uid}_1.wav"})
    path = R.manifest_path(rec, session)
    R.save_manifest(path, {"session": session, "status": status, "meeting_dir": session, "speakers": speakers,
                           "workspace_id": "ws-1", **extra})
    return path


def _queued(rec):
    box = rec / "audio_outbox"
    return sorted(p.name for p in box.glob("*")) if box.exists() else []


def test_prune_enqueues_before_deleting_wav(tmp_path):
    rec = tmp_path / "recordings"
    _real_meeting(rec, "g_1", be={"meeting_id": "m1", "status": "done"}, stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert _wavs(rec, "g_1") == []
    assert _queued(rec) == ["m1.json", "m1.m4a"]
    meta = json.loads((rec / "audio_outbox" / "m1.json").read_text(encoding="utf-8"))
    assert meta == {"meeting_id": "m1", "workspace_id": "ws-1", "handed_off_at": HANDED["handed_off"]}


def test_prune_keeps_manifest_content_unchanged(tmp_path):
    rec = tmp_path / "recordings"
    path = _real_meeting(rec, "g_1", be={"meeting_id": "m1", "status": "done"}, stages=HANDED)
    before = path.read_text(encoding="utf-8")
    R.prune_audio(rec, now=NOW)
    assert path.read_text(encoding="utf-8") == before
    assert not [k for k in json.loads(before) if k.startswith("audio")]   # 올리기 상태가 매니페스트에 생기지 않는다


def test_prune_deletes_wav_even_when_mixing_fails(tmp_path, capsys):
    # 녹음 올리기는 곁가지다. 섞지 못해도(디스크 가득 참 등) wav 는 지금처럼 지워 공간을 비운다(#670 리뷰)
    rec = tmp_path / "recordings"
    _real_meeting(rec, "g_1", broken=True, be={"meeting_id": "m1", "status": "done"}, stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert _wavs(rec, "g_1") == []
    assert _queued(rec) == []
    assert "녹음 섞기 실패" in capsys.readouterr().out   # 웹 재생 녹음이 빠진 걸 로그로 알 수 있다


def test_prune_does_not_retry_mixing_on_the_next_pass(tmp_path, monkeypatch):
    rec = tmp_path / "recordings"
    _real_meeting(rec, "g_1", broken=True, be={"meeting_id": "m1", "status": "done"}, stages=HANDED)
    calls = []
    real = R.audio_outbox.enqueue
    monkeypatch.setattr(R.audio_outbox, "enqueue", lambda *a, **k: calls.append(1) or real(*a, **k))
    R.prune_audio(rec, now=NOW)
    R.prune_audio(rec, now=NOW + timedelta(seconds=10))
    assert calls == [1]                         # wav 가 지워졌으니 다음 바퀴에 같은 섞기를 다시 하지 않는다


def test_prune_deletes_without_mix_after_7_days(tmp_path):
    rec = tmp_path / "recordings"
    old = {"handed_off": R._iso(NOW - timedelta(seconds=R.AUDIO_KEEP_AFTER_GIVE_UP_S))}
    _real_meeting(rec, "g_1", broken=True, be={"meeting_id": "m1", "status": "done"}, stages=old)
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert _wavs(rec, "g_1") == []              # 디스크를 지키려고 섞지 못해도 지운다
    assert _queued(rec) == []


def test_prune_does_not_mix_for_a_meeting_older_than_7_days_even_if_mixable(tmp_path):
    rec = tmp_path / "recordings"
    old = {"handed_off": R._iso(NOW - timedelta(days=8))}
    _real_meeting(rec, "g_1", be={"meeting_id": "m1", "status": "done"}, stages=old)
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert _queued(rec) == []                   # BE 가 보관 기간을 이미 넘긴 회의다


def test_prune_does_not_enqueue_upload_source(tmp_path):
    rec = tmp_path / "recordings"
    _real_meeting(rec, "upload_m1", source="upload", be={"meeting_id": "m1", "status": "done"}, stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == ["upload_m1"]
    assert _queued(rec) == []


def test_prune_does_not_enqueue_a_meeting_without_be_id(tmp_path):
    rec = tmp_path / "recordings"
    _real_meeting(rec, "g_1", stages=HANDED)
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert _queued(rec) == []


def test_prune_does_not_enqueue_gave_up_meetings(tmp_path):
    rec = tmp_path / "recordings"
    _real_meeting(rec, "g_1", status=R.STATUS_FAILED, be={"meeting_id": "m1", "status": "failed"},
                  recovery={"attempts": 5, "gave_up_at": R._iso(NOW - timedelta(days=8))})
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert _queued(rec) == []


def test_prune_keeps_the_existing_queue_entry_when_wavs_come_back(tmp_path):
    rec = tmp_path / "recordings"
    _real_meeting(rec, "g_1", be={"meeting_id": "m1", "status": "done"}, stages=HANDED)
    box = rec / "audio_outbox"
    box.mkdir()
    (box / "m1.m4a").write_bytes(b"first")
    (box / "m1.json").write_text("{}", encoding="utf-8")
    assert R.prune_audio(rec, now=NOW) == ["g_1"]
    assert (box / "m1.m4a").read_bytes() == b"first"      # 이미 있으면 다시 섞지 않는다
