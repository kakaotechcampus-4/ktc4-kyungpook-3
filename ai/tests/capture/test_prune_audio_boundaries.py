"""보관 정리는 잠근 매니페스트의 소유 트랙만 지운다."""
import json
import os
from datetime import timedelta
from pathlib import Path
import subprocess

import pytest

from capture import recorder as R
from tests.capture.test_prune_audio import HANDED, NOW, _meeting, _wavs


@pytest.mark.parametrize('kind', ['parent', 'absolute', 'other_session', 'non_audio'])
def test_unsafe_track_keeps_all_files_for_that_manifest(tmp_path, kind):
    rec = tmp_path / 'recordings'
    path = _meeting(rec, 'g_1', status=R.STATUS_HANDED_OFF, stages=HANDED)
    outside = tmp_path / 'outside.wav'
    outside.write_bytes(b'owned outside fixture')
    foreign = rec / 'other' / 'track.wav'
    foreign.parent.mkdir()
    foreign.write_bytes(b'other session')
    raw = {'parent': '../outside.wav', 'absolute': str(outside.resolve()),
           'other_session': 'other/track.wav', 'non_audio': 'g_1/transcript.md'}[kind]
    manifest = json.loads(path.read_text(encoding='utf-8'))
    manifest['speakers'][0]['file'] = raw
    R.save_manifest(path, manifest)

    assert R.prune_audio(rec, now=NOW) == []
    assert outside.read_bytes() == b'owned outside fixture'
    assert foreign.read_bytes() == b'other session'
    assert _wavs(rec, 'g_1') == ['1_1.wav', '2_1.wav']
    assert (rec / 'g_1/transcript.md').read_text(encoding='utf-8') == '대본'


def test_manifest_must_match_the_session_whose_lock_is_held(tmp_path):
    rec = tmp_path / 'recordings'
    path = _meeting(rec, 'g_1', status=R.STATUS_HANDED_OFF, stages=HANDED)
    manifest = json.loads(path.read_text(encoding='utf-8'))
    manifest['session'] = 'other'
    R.save_manifest(path, manifest)
    assert R.prune_audio(rec, now=NOW) == []
    assert len(_wavs(rec, 'g_1')) == 2


def test_pruning_holds_the_actual_session_lock_until_files_are_removed(tmp_path, monkeypatch):
    rec = tmp_path / 'recordings'
    path = _meeting(rec, 'g_1', status=R.STATUS_HANDED_OFF, stages=HANDED)
    unlink = Path.unlink
    checked = []

    def remove(audio, *args, **kwargs):
        if audio.suffix == '.wav':
            other = R.try_lock(path)
            if other is not None:
                other.release()
            checked.append(other is None)
            assert other is None, 'another actor acquired the session while audio was being deleted'
        return unlink(audio, *args, **kwargs)

    monkeypatch.setattr(Path, 'unlink', remove)
    assert R.prune_audio(rec, now=NOW) == ['g_1']
    assert checked == [True, True]
    assert _wavs(rec, 'g_1') == []
    free = R.try_lock(path)
    assert free is not None
    free.release()


def test_state_is_read_after_the_session_lock_is_acquired(tmp_path, monkeypatch):
    rec = tmp_path / 'recordings'
    path = _meeting(rec, 'g_1', status=R.STATUS_HANDED_OFF, stages=HANDED)
    acquire = R.try_lock
    rewritten = False

    def writer_then_pruner(candidate):
        nonlocal rewritten
        if candidate == path and not rewritten:
            writer = acquire(path)
            assert writer is not None
            try:
                manifest = json.loads(path.read_text(encoding='utf-8'))
                manifest['status'] = R.STATUS_RECORDING
                R.save_manifest(path, manifest)
                rewritten = True
            finally:
                writer.release()
        return acquire(candidate)

    monkeypatch.setattr(R, 'try_lock', writer_then_pruner)
    assert R.prune_audio(rec, now=NOW) == []
    assert rewritten
    assert len(_wavs(rec, 'g_1')) == 2
    assert json.loads(path.read_text(encoding='utf-8'))['status'] == R.STATUS_RECORDING


def test_partial_unlink_failure_is_retried_without_losing_the_manifest(tmp_path, monkeypatch):
    rec = tmp_path / 'recordings'
    path = _meeting(rec, 'g_1', status=R.STATUS_HANDED_OFF, stages=HANDED)
    unlink = Path.unlink
    failed = False

    def remove(audio, *args, **kwargs):
        nonlocal failed
        if audio.name == '2_1.wav' and not failed:
            failed = True
            raise PermissionError('owned transient fixture')
        return unlink(audio, *args, **kwargs)

    monkeypatch.setattr(Path, 'unlink', remove)
    assert R.prune_audio(rec, now=NOW) == []
    assert _wavs(rec, 'g_1') == ['2_1.wav']
    assert path.exists()
    assert R.prune_audio(rec, now=NOW) == ['g_1']
    assert _wavs(rec, 'g_1') == []
    assert path.exists() and (rec / 'g_1/transcript.md').exists()


def test_linked_session_directory_keeps_the_target_audio(tmp_path):
    rec = tmp_path / 'recordings'
    _meeting(rec, 'g_1', status=R.STATUS_HANDED_OFF, stages=HANDED)
    directory, target = rec / 'g_1', tmp_path / 'linked-target'
    assert directory.resolve().is_relative_to(tmp_path.resolve())
    assert target.resolve().is_relative_to(tmp_path.resolve())
    directory.rename(target)
    try:
        try:
            directory.symlink_to(target, target_is_directory=True)
        except OSError:
            if os.name != 'nt':
                raise
            subprocess.run(['cmd.exe', '/d', '/c', 'mklink', '/J', str(directory), str(target)],
                           check=True, capture_output=True)
        assert R.prune_audio(rec, now=NOW) == []
        assert sorted(p.name for p in target.glob('*.wav')) == ['1_1.wav', '2_1.wav']
    finally:
        if directory.is_symlink():
            directory.unlink()
        elif getattr(directory, 'is_junction', lambda: False)():
            directory.rmdir()


def test_linked_track_keeps_the_target_and_other_tracks(tmp_path):
    rec = tmp_path / 'recordings'
    path = _meeting(rec, 'g_1', status=R.STATUS_HANDED_OFF, stages=HANDED)
    target = tmp_path / 'external.wav'
    target.write_bytes(b'owned target')
    link = rec / 'g_1/linked.wav'
    try:
        link.symlink_to(target)
    except OSError as error:
        pytest.skip(f'file symlinks unavailable: {error}')
    try:
        manifest = json.loads(path.read_text(encoding='utf-8'))
        manifest['speakers'][0]['file'] = 'g_1/linked.wav'
        R.save_manifest(path, manifest)
        assert R.prune_audio(rec, now=NOW) == []
        assert target.read_bytes() == b'owned target'
        assert (rec / 'g_1/2_1.wav').exists()
    finally:
        link.unlink(missing_ok=True)


@pytest.mark.parametrize('raw', ['2026-11-08T22:00:00', 'not-a-time'])
def test_unverified_handoff_time_keeps_its_audio(tmp_path, raw):
    rec = tmp_path / 'recordings'
    _meeting(rec, 'g_1', status=R.STATUS_HANDED_OFF, stages={'handed_off': raw})
    assert R.prune_audio(rec, now=NOW) == []
    assert len(_wavs(rec, 'g_1')) == 2


def test_unverified_latest_progress_does_not_fall_back_to_an_older_time(tmp_path):
    rec = tmp_path / 'recordings'
    _meeting(rec, 'g_1', status=R.STATUS_SAVED,
             recorded_at=R._iso(NOW - timedelta(days=8)),
             stages={'transcribed': NOW.replace(tzinfo=None).isoformat()})
    assert R.prune_audio(rec, now=NOW) == []
    assert len(_wavs(rec, 'g_1')) == 2


def test_future_cutoff_does_not_allow_audio_deletion_before_it_begins(tmp_path, monkeypatch):
    rec = tmp_path / 'recordings'
    future = NOW + timedelta(days=1)
    monkeypatch.setattr(R, 'AUDIO_PRUNE_SINCE', future)
    _meeting(rec, 'g_1', status=R.STATUS_HANDED_OFF, stages={'handed_off': R._iso(future)})
    assert R.prune_audio(rec, now=NOW) == []
    assert len(_wavs(rec, 'g_1')) == 2


def test_offset_representations_of_the_cutoff_have_the_same_result(tmp_path):
    rec = tmp_path / 'recordings'
    utc = R.AUDIO_PRUNE_SINCE.astimezone(R.timezone.utc).isoformat()
    _meeting(rec, 'g_kst', status=R.STATUS_HANDED_OFF,
             stages={'handed_off': R.AUDIO_PRUNE_SINCE.isoformat()})
    _meeting(rec, 'g_utc', status=R.STATUS_HANDED_OFF, stages={'handed_off': utc})
    assert R.prune_audio(rec, now=NOW) == ['g_kst', 'g_utc']
    assert _wavs(rec, 'g_kst') == _wavs(rec, 'g_utc') == []
