import pytest

from capture import backfill_sources as BF
from capture import handoff as H
from capture import recorder as R
from capture.meeting_purge import deleted, mark_deleted
from tests.capture.fake_be import FakeBe, _Resp
from tests.capture.test_backfill_sources import _be, _handed_off_without_lines
from tests.capture.test_handoff import _manifest
from tests.capture.test_recorder import EchoStt, _session


@pytest.mark.parametrize("code,status", [("MEETING_DELETED", 410), ("HTTP_404", 404), ("NETWORK", 0)])
def test_rejected_replacement_keeps_predecessor_on_every_retry(tmp_path, code, status):
    fake = FakeBe()
    handoff = H.Handoff(H.BeClient("http://be", session=fake, service_token="svc-token"))
    manifest, _ = _manifest(tmp_path)
    handoff.start(manifest)
    fake.meetings["m1"]["status"] = "failed"
    attempts = []

    def rejected(workspace_id, **kwargs):
        attempts.append(kwargs.get("replaces_meeting_id"))
        error = H.MeetingEnded if code == "MEETING_DELETED" else H.BeError
        raise error(code, "rejected", status=status)

    handoff.client.create_meeting = rejected
    for _ in range(2):
        with pytest.raises(H.BeError) as error:
            handoff.end(manifest)
        assert error.value.code == code
        assert manifest["be"]["meeting_id"] == "m1"
        assert manifest["be"].get("replaced", []) == []
    assert attempts == ["m1", "m1"]


def test_deleted_envelope_is_permanent_including_replacement_create():
    class Session:
        def request(self, *args, **kwargs):
            return _Resp(410, {"error": {"code": "MEETING_DELETED", "message": "deleted"}})

    client = H.BeClient("http://be", session=Session())
    with pytest.raises(H.MeetingEnded) as error:
        client.create_meeting("workspace", replaces_meeting_id="old")
    assert error.value.code == "MEETING_DELETED"


def test_successful_replacement_sends_predecessor_to_backend(tmp_path):
    fake = FakeBe()
    handoff = _be(fake)
    manifest, _ = _manifest(tmp_path)
    handoff.start(manifest)
    fake.meetings['m1']['status'] = 'failed'
    handoff.end(manifest)
    creates = [body for method, path, body in fake.calls if method == 'POST' and path == '/meetings']
    assert 'replaces_meeting_id' not in creates[0]
    assert creates[1]['replaces_meeting_id'] == 'm1'
    assert manifest['be']['meeting_id'] == 'm2' and manifest['be']['replaced'] == ['m1']


@pytest.mark.parametrize('returned_status', ['created', 'processing', 'done', 'failed'])
def test_replacement_reuses_backend_identity_after_lost_response(tmp_path, returned_status):
    manifest, _ = _manifest(tmp_path, be={'meeting_id': 'old', 'status': 'failed'})
    attempts = []

    class Client:
        def create_meeting(self, workspace, **kwargs):
            attempts.append(kwargs['replaces_meeting_id'])
            return {'meeting_id': 'persisted-child', 'status': returned_status}
        def end_meeting(self, mid):
            return 'failed' if mid == 'old' else returned_status

    handoff = H.Handoff(Client())
    handoff.end(manifest)
    assert attempts == ['old']
    assert manifest['be']['meeting_id'] == 'persisted-child'
    assert manifest['be']['replaced'] == ['old']


def test_backfill_deleted_meeting_stops_permanently_and_cleans_actual_files(tmp_path):
    fake = FakeBe()
    rec, path = _handed_off_without_lines(tmp_path, fake)
    fake.sources_fail = (410, "MEETING_DELETED")
    out = BF.backfill(rec, transcripts_dir=tmp_path / 'transcripts', handoff=_be(fake))
    assert out[0]['ended'] and out[0]['error'] is None
    assert not path.exists() and not (rec / '77_500').exists()
    assert deleted(rec, 'm1')
    fake.calls.clear()
    assert BF.backfill(rec, transcripts_dir=tmp_path / 'transcripts', handoff=_be(fake)) == []
    assert fake.calls == []


@pytest.mark.parametrize('status,code', [(404, 'HTTP_404'), (503, 'SERVICE_UNAVAILABLE'), (0, 'NETWORK')])
def test_backfill_transient_failure_preserves_originals_for_retry(tmp_path, status, code):
    fake = FakeBe()
    rec, path = _handed_off_without_lines(tmp_path, fake)
    fake.sources_fail = (status, code)
    out = BF.backfill(rec, transcripts_dir=tmp_path / 'transcripts', handoff=_be(fake))
    assert code in out[0]['error'] and not out[0]['sent']
    assert path.exists() and (rec / '77_500').exists()
    assert not deleted(rec, 'm1')
    assert BF.targets(rec)


def test_recovery_obeys_predecessor_marker_without_running_stt(tmp_path):
    rec, path, data = _session(tmp_path)
    data['be'] = {'meeting_id': 'current', 'replaced': ['old']}
    R.save_manifest(path, data)
    mark_deleted(rec, {'old'})
    result = R.recover_one(rec, path, claims=R.Claims(), backend=None, model_name='unused', workers=1,
                           transcripts_dir=tmp_path / 'transcripts')
    assert result['ended']
    assert not path.exists() and not (rec / data['session']).exists()
    assert deleted(rec, 'current')


def test_deleted_stage_response_terminates_recovery_before_stt(tmp_path):
    rec, path, data = _session(tmp_path)
    fake = FakeBe()
    handoff = _be(fake)
    handoff.start(data)
    R.save_manifest(path, data)

    def stage(*args):
        raise H.MeetingEnded('MEETING_DELETED', 'deleted', status=410)

    handoff.client.report_stage = stage
    result = R.recover_one(rec, path, claims=R.Claims(), backend=EchoStt(), model_name='echo', workers=1,
                           transcripts_dir=tmp_path / 'transcripts', handoff=handoff)
    assert result['ended'] and result['error'] is None
    assert result['ran'] == [] and result['attempts'] == 0
    assert not path.exists() and not (rec / data['session']).exists()
    assert deleted(rec, 'm1')


def test_deleted_fail_ack_is_terminal_instead_of_retrying_forever(tmp_path):
    manifest, _ = _manifest(tmp_path, be={'meeting_id': 'm1', 'status': 'processing'})
    manifest['recovery'] = {'gave_up_at': '2026-11-01T00:00:00+00:00'}
    fake = FakeBe()
    handoff = _be(fake)

    def fail(*args):
        raise H.MeetingEnded('MEETING_DELETED', 'deleted', status=410)

    handoff.client.fail_meeting = fail
    handoff.fail(manifest, 'stt')
    assert manifest['be']['status'] == 'deleted'
    assert not R._due(manifest, R.utcnow())


async def test_worker_purges_without_upload_intake_enabled(tmp_path):
    from capture.worker import Worker
    from tests.capture.test_meeting_purge import fixture_files
    recordings, transcripts, path, _ = fixture_files(tmp_path)

    class Client:
        def __init__(self):
            self.acks = []
        def claim_meeting_purge(self):
            return {'meeting_id': 'm576', 'claim_token': 'token'}
        def ack_meeting_purge(self, mid, token):
            self.acks.append((mid, token))

    client = Client()
    worker = Worker(recordings, transcripts_dir=transcripts, handoff_factory=lambda: H.Handoff(client),
                    intake_factory=lambda: None)
    await worker._intake_once()
    await worker._purge_once()
    assert client.acks == [('m576', 'token')]
    assert not path.exists() and not list(transcripts.iterdir())
