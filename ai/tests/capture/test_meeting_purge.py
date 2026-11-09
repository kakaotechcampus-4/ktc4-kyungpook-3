import json
from pathlib import Path

import pytest

from capture.meeting_purge import deleted, purge_files, purge_one, upload_writer
from capture.recorder import (
    Claims,
    manifest_path,
    save_manifest,
    try_lock,
    try_restart_lock,
)


def fixture_files(tmp_path, session='completed'):
    recordings, transcripts = tmp_path / 'recordings', tmp_path / 'transcripts'
    recordings.mkdir()
    transcripts.mkdir()
    folder = recordings / session
    folder.mkdir()
    (folder / 'audio.wav').write_bytes(b'private audio')
    transcript = transcripts / f'session_{session}.transcript.json'
    transcript.write_text('private transcript', encoding='utf-8')
    data = {'session': session, 'status': 'handed_off', 'be': {'meeting_id': 'm576'},
            'transcript_json': str(transcript)}
    path = manifest_path(recordings, session)
    save_manifest(path, data)
    intake = recordings / '.uploads' / 'm576'
    intake.mkdir(parents=True)
    (intake / 'intake.json').write_text(json.dumps({'private': 'name'}), encoding='utf-8')
    return recordings, transcripts, path, data


def test_completed_manifest_and_every_actual_file_are_purged(tmp_path):
    recordings, transcripts, path, data = fixture_files(tmp_path)
    assert purge_files(recordings, transcripts, 'm576')
    assert deleted(recordings, 'm576')
    assert not path.exists()
    assert not (recordings / data['session']).exists()
    assert not list(transcripts.iterdir())
    assert not (recordings / '.uploads' / 'm576').exists()
    assert purge_files(recordings, transcripts, 'm576')


def test_claim_release_cannot_recreate_files_after_receipt(tmp_path):
    recordings, transcripts, path, _ = fixture_files(tmp_path)
    claims = Claims()
    held = claims.acquire(path)
    assert not purge_files(recordings, transcripts, 'm576')
    held['private'] = 'writer finishes after delete started'
    claims.release(path, held)
    assert purge_files(recordings, transcripts, 'm576')
    assert claims.acquire(path) is None
    assert not path.exists()


@pytest.mark.parametrize('old_be', [{}, {'meeting_id': 'previous', 'status': 'failed'}])
def test_terminal_response_before_identity_publish_defers_ack(tmp_path, old_be):
    recordings, transcripts, path, data = fixture_files(tmp_path)
    data['be'] = old_be
    data['status'] = 'extracted'
    save_manifest(path, data)
    claims = Claims()
    held = claims.acquire(path)

    class Client:
        def __init__(self):
            self.acks = []

        def claim_meeting_purge(self):
            return {'meeting_id': 'new', 'claim_token': 'lease'}

        def ack_meeting_purge(self, mid, token):
            self.acks.append((mid, token))

    client = Client()
    # BE can finish register while the local manifest still has no ID or its predecessor.
    held['be'] = {'meeting_id': 'new', 'status': 'done'}
    if old_be.get('meeting_id'):
        held['be']['replaced'] = [old_be['meeting_id']]
    assert not purge_one(recordings, transcripts, client=client)
    assert client.acks == []
    transcript = Path(held['transcript_json'])
    transcript.write_text('terminal output before final manifest save', encoding='utf-8')
    held['status'] = 'handed_off'
    claims.release(path, held)
    assert purge_one(recordings, transcripts, client=client)
    assert client.acks == [('new', 'lease')]
    assert not path.exists() and not transcript.exists()
    assert not (recordings / data['session']).exists()


def test_recording_creation_barrier_defers_ack_before_manifest_exists(tmp_path):
    recordings, transcripts = tmp_path / 'recordings', tmp_path / 'transcripts'
    restart = try_restart_lock(recordings)
    assert restart is not None
    try:
        assert not purge_files(recordings, transcripts, 'new')
    finally:
        restart.release()
    assert purge_files(recordings, transcripts, 'new')


def test_intake_writer_prevents_ack_and_marker_blocks_cached_pending(tmp_path):
    recordings, transcripts, _, _ = fixture_files(tmp_path)
    lock = try_lock(recordings / '.uploads-writer.json')
    assert not purge_files(recordings, transcripts, 'm576')
    lock.release()
    assert purge_files(recordings, transcripts, 'm576')
    from upload.intake import intake_one

    class Client:
        def pending_uploads(self):
            return [{'meeting_id': 'm576'}]

    assert intake_one(recordings, client=Client(), diarizer=None) is None
    assert not (recordings / '.uploads' / 'm576').exists()


def test_partial_unlink_failure_retries_without_receipt(tmp_path, monkeypatch):
    recordings, transcripts, path, _ = fixture_files(tmp_path)
    class Client:
        def __init__(self):
            self.acks = []
        def claim_meeting_purge(self):
            return {'meeting_id': 'm576', 'claim_token': 'secret'}
        def ack_meeting_purge(self, mid, token):
            self.acks.append((mid, token))
    client = Client()
    original = Path.unlink
    def fail_once(p, *args, **kwargs):
        if p == path:
            raise PermissionError('in use')
        return original(p, *args, **kwargs)
    with monkeypatch.context() as context:
        context.setattr(Path, 'unlink', fail_once)
        with pytest.raises(PermissionError):
            purge_one(recordings, transcripts, client=client)
    assert client.acks == []
    assert purge_one(recordings, transcripts, client=client)
    assert client.acks == [('m576', 'secret')]


def test_untrusted_manifest_path_cannot_remove_outside_storage(tmp_path):
    recordings, transcripts, path, data = fixture_files(tmp_path)
    outside = tmp_path / 'outside-secret.txt'
    outside.write_text('must survive', encoding='utf-8')
    data['items'] = str(outside)
    save_manifest(path, data)
    with pytest.raises(ValueError):
        purge_files(recordings, transcripts, 'm576')
    assert outside.read_text(encoding='utf-8') == 'must survive'


def test_upload_writer_uses_stable_os_lock(tmp_path):
    @upload_writer
    def write(recordings):
        return True
    lock = try_lock(tmp_path / '.uploads-writer.json')
    assert write(tmp_path) is None
    lock.release()
    assert write(tmp_path)


def test_replaced_identity_purges_current_files_and_marks_every_lineage_id(tmp_path):
    recordings, transcripts, path, data = fixture_files(tmp_path)
    data['be'] = {'meeting_id': 'current', 'replaced': ['m576', 'intermediate']}
    save_manifest(path, data)
    assert purge_files(recordings, transcripts, 'm576')
    assert not path.exists() and not list(transcripts.iterdir())
    assert not (recordings / data['session']).exists()
    for mid in ['m576', 'current', 'intermediate']:
        receipt = recordings / '.deleted' / f'{mid}.json'
        assert json.loads(receipt.read_text(encoding='utf-8')) == {'meeting_id': mid}


def test_absent_manifest_still_purges_upload_original_tracks_and_outputs(tmp_path):
    recordings, transcripts, path, data = fixture_files(tmp_path, session='upload_m576')
    path.unlink()
    assert purge_files(recordings, transcripts, 'm576')
    assert not (recordings / data['session']).exists()
    assert not (recordings / '.uploads' / 'm576').exists()
    assert not list(transcripts.iterdir())


@pytest.mark.parametrize('original_exists', [True, False])
def test_interrupted_atomic_manifest_write_does_not_leave_private_tempfile(tmp_path, original_exists):
    recordings, transcripts, path, data = fixture_files(tmp_path)
    partial = path.with_suffix('.json.tmp')
    partial.write_text(json.dumps(data), encoding='utf-8')
    if not original_exists:
        path.unlink()
    assert purge_files(recordings, transcripts, 'm576')
    assert not path.exists() and not partial.exists()
    assert not (recordings / data['session']).exists() and not list(transcripts.iterdir())


def test_intake_creation_during_delete_cannot_ack_until_writer_finishes(tmp_path, monkeypatch):
    from upload import intake

    recordings, transcripts = tmp_path / 'recordings', tmp_path / 'transcripts'
    receipts = []
    original = intake._save

    def save_while_deleting(directory, rec):
        original(directory, rec)
        receipts.append(purge_files(recordings, transcripts, 'm576'))

    monkeypatch.setattr(intake, '_save', save_while_deleting)

    class Client:
        def pending_uploads(self):
            return [{'meeting_id': 'm576'}]
        def claim_upload(self, mid):
            return {}

    intake.intake_one(recordings, client=Client(), diarizer=None)
    assert receipts and not any(receipts)
    assert deleted(recordings, 'm576')
    assert (recordings / '.uploads' / 'm576' / 'intake.json').exists()
    assert purge_files(recordings, transcripts, 'm576')
    assert not (recordings / '.uploads' / 'm576').exists()
    assert intake.intake_one(recordings, client=Client(), diarizer=None) is None


@pytest.mark.parametrize('session', ['*', '../outside', 'a[bc]', 'a\\outside'])
def test_untrusted_session_cannot_expand_to_unrelated_outputs(tmp_path, session):
    recordings, transcripts, path, data = fixture_files(tmp_path)
    other = transcripts / 'session_other.transcript.json'
    other.write_text('unrelated', encoding='utf-8')
    data['session'] = session
    save_manifest(path, data)
    with pytest.raises(ValueError):
        purge_files(recordings, transcripts, 'm576')
    assert other.read_text(encoding='utf-8') == 'unrelated'


@pytest.mark.parametrize('lane', ['assign', 'report', 'cleanup'])
def test_deleted_upload_response_preserves_writer_lock_until_purge(tmp_path, lane):
    from capture.handoff import MeetingEnded
    from upload.assign import assign_one
    from upload.cleanup import cleanup_one
    from upload.report import report_one

    recordings, transcripts, path, data = fixture_files(tmp_path, session='upload_m576')
    data['source'] = 'upload'
    save_manifest(path, data)
    rec = {'meeting_id': 'm576', 'state': 'done', 'item': {}}
    if lane == 'assign':
        rec['resume'] = {'state': 'resuming'}
    else:
        rec['report'] = {'state': 'reporting' if lane == 'report' else 'reported', 'speakers': [],
                         'reported_at': '2020-01-01T00:00:00+00:00'}
    save_manifest(recordings / '.uploads' / 'm576' / 'intake.json', rec)
    claims = Claims()
    held = []

    class Client:
        def gone(self, *args):
            held.append(claims.acquire(path))
            raise MeetingEnded('MEETING_DELETED', 'deleted', status=410)
        resume_upload = gone
        report_speakers = gone

    if lane == 'assign':
        result = assign_one(recordings, client=Client())
    elif lane == 'report':
        result = report_one(recordings, client=Client())
    else:
        result = cleanup_one(recordings, transcripts, client=Client())
    assert result.event in ('ended', 'expired') and held[0] is not None
    assert path.exists() and try_lock(path) is None
    assert deleted(recordings, 'm576') and not purge_files(recordings, transcripts, 'm576')
    claims.release(path, held[0])
    assert purge_files(recordings, transcripts, 'm576')
    assert not path.exists() and not (recordings / data['session']).exists()


def test_identical_track_names_have_separate_outputs_and_purging_a_preserves_b(tmp_path):
    from stt import transcribe as T
    from tests.stt.test_transcribe_batch import EchoStt, _session

    recordings, transcripts = tmp_path / 'recordings', tmp_path / 'transcripts'
    manifests = {}
    for session, meeting_id in [('A', 'meeting-A'), ('B', 'meeting-B')]:
        directory = recordings / session
        directory.mkdir(parents=True)
        wavs = _session(directory)
        run = T.run_session(wavs, {'1': f'private-{session}'}, EchoStt(), model_name='echo',
                            out_dir=transcripts, session_id=session)
        manifest = {'session': session, 'be': {'meeting_id': meeting_id}, 'status': 'handed_off',
                    'speakers': [{'file': f'{session}/{wav.name}'} for wav in wavs],
                    'transcript_json': str(run['transcript_json'])}
        path = manifest_path(recordings, session)
        save_manifest(path, manifest)
        manifests[session] = path
    b_outputs = {path: path.read_bytes() for path in transcripts.glob('session_B*')}
    assert (transcripts / 'session_A__1_500__echo.json').exists()
    assert (transcripts / 'session_B__1_500__echo.json').exists()
    legacy = transcripts / '1_500__echo.json'
    legacy.write_bytes((transcripts / 'session_A__1_500__echo.json').read_bytes())
    assert T.build_session_transcript(transcripts, 'B', 'echo') is not None
    assert purge_files(recordings, transcripts, 'meeting-A')
    assert not legacy.exists()
    assert not list(transcripts.glob('session_A*')) and not manifests['A'].exists()
    assert manifests['B'].exists() and (recordings / 'B' / '1_500.wav').exists()
    assert all(path.read_bytes() == content for path, content in b_outputs.items())
