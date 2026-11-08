import asyncio
import copy
import hashlib
import json
import threading

import pytest

from capture.privacy_cleanup import PrivacyPending, apply_cleanup, cleanup_one, state
from capture.recorder import (
    Claims,
    manifest_path,
    save_manifest,
    try_lock,
    try_restart_lock,
)


def fixture(tmp_path, *, workspace='workspace-a', session='guild_10'):
    recordings = tmp_path / 'recordings'
    transcripts = tmp_path / 'transcripts'
    folder = recordings / session
    folder.mkdir(parents=True)
    transcripts.mkdir(exist_ok=True)
    (folder / '111_10.wav').write_bytes(b'preserved shared audio')
    (folder / '222_10.wav').write_bytes(b'other speaker audio')
    aggregate = transcripts / f'session_{session}.transcript.json'
    aggregate.write_text(json.dumps({'speakers': {'111': 'same name', '222': 'same name'},
                                    'segments': [{'speaker': '111', 'text': 'same name mentioned in body', 'start': 0, 'end': 1}]}), encoding='utf-8')
    data = {'session': session, 'workspace_id': workspace, 'identity_epoch': 0, 'guild_id': 'guild',
            'status': 'handed_off', 'meeting_dir': session, 'be': {'meeting_id': session + '-be'},
            'hint_members': [{'member_id': 'member-a', 'discord_user_id': '111', 'name': 'same name', 'aliases': ['private alias']},
                             {'member_id': 'member-b', 'discord_user_id': '222', 'name': 'same name', 'aliases': ['other alias']}],
            'hint_names': ['same name'], 'transcript_json': str(aggregate),
            'speakers': [{'user_id': '111', 'display_name': 'same name', 'file': f'{session}/111_10.wav'},
                         {'user_id': '222', 'display_name': 'same name', 'file': f'{session}/222_10.wav'}]}
    path = manifest_path(recordings, session)
    save_manifest(path, data)
    return recordings, transcripts, path, data


def claim(**changes):
    return {'cleanup_id': 'cleanup-a', 'workspace_id': 'workspace-a', 'member_ids': ['member-a'],
            'meeting_ids': [], 'guild_ids': ['guild'], 'delete_workspace': False,
            'identity_epoch': 1, 'claim_token': 'lease', **changes}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_shared_metadata_erased_without_body_audio_or_same_named_other_member_changes(tmp_path):
    recordings, transcripts, path, data = fixture(tmp_path)
    before_audio = sha(recordings / 'guild_10/111_10.wav')
    other_audio = sha(recordings / 'guild_10/222_10.wav')
    assert apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    cleaned = json.loads(path.read_text(encoding='utf-8'))
    assert cleaned['hint_members'][0] == {'member_id': 'member-a', 'discord_user_id': None,
                                          'name': '탈퇴한 사용자', 'aliases': []}
    assert cleaned['hint_members'][1] == data['hint_members'][1]
    assert cleaned['speakers'][0]['user_id'] == 'member-a'
    assert cleaned['speakers'][0]['display_name'] == '탈퇴한 사용자'
    assert cleaned['speakers'][1] == data['speakers'][1]
    assert 'hint_names' not in cleaned
    assert not (recordings / 'guild_10/111_10.wav').exists()
    assert sha(recordings / 'guild_10/member-a_10.wav') == before_audio
    assert sha(recordings / 'guild_10/222_10.wav') == other_audio
    transcript = json.loads((transcripts / 'session_guild_10.transcript.json').read_text(encoding='utf-8'))
    assert transcript['speakers'] == {'member-a': '탈퇴한 사용자', '222': 'same name'}
    assert transcript['segments'] == [{'speaker': 'member-a', 'text': 'same name mentioned in body', 'start': 0, 'end': 1}]
    assert apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')


def test_stale_cached_manifest_cannot_restore_identity_and_claim_lock_is_released(tmp_path):
    recordings, transcripts, path, data = fixture(tmp_path)
    stale = copy.deepcopy(data)
    assert apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    with pytest.raises(PrivacyPending):
        save_manifest(path, stale)
    assert json.loads(path.read_text(encoding='utf-8'))['identity_epoch'] == 1
    stale_path = manifest_path(recordings, 'stale')
    stale['session'] = 'stale'
    stale_path.write_text(json.dumps(stale), encoding='utf-8')
    assert Claims().acquire(stale_path) is None
    lock = try_lock(stale_path)
    assert lock is not None
    lock.release()


def test_deleted_workspace_purges_unknown_be_id_legacy_capture_and_keeps_new_workspace_same_guild(tmp_path):
    recordings, transcripts, path, data = fixture(tmp_path)
    data.pop('workspace_id')
    data['be'] = {}
    old_unknown_identity = copy.deepcopy(data)
    save_manifest(path, data)
    _, _, other_path, _ = fixture(tmp_path, workspace='workspace-new', session='guild_20')
    other_before = sha(other_path)
    assert apply_cleanup(recordings, transcripts, claim(delete_workspace=True), runs=tmp_path / 'runs')
    assert not path.exists() and not (recordings / 'guild_10').exists()
    assert not (transcripts / 'session_guild_10.transcript.json').exists()
    assert sha(other_path) == other_before
    assert (recordings / 'guild_20').exists()
    assert state(recordings, 'workspace-a')['deleted']
    with pytest.raises(PrivacyPending):
        save_manifest(path, {**data, 'workspace_id': 'workspace-a', 'identity_epoch': 1})
    with pytest.raises(PrivacyPending):
        save_manifest(path, old_unknown_identity)
    assert not path.exists()


@pytest.mark.parametrize('kind', ['restart', 'upload', 'manifest'])
def test_inventory_writer_lock_prevents_false_ack(tmp_path, kind):
    recordings, transcripts, path, _ = fixture(tmp_path)
    lock = (try_restart_lock(recordings) if kind == 'restart' else
            try_lock(recordings / '.uploads-writer.json') if kind == 'upload' else try_lock(path))
    assert lock is not None
    assert not apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    lock.release()
    assert apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')


def test_cleanup_error_never_acknowledges_and_restart_retry_converges(tmp_path, monkeypatch):
    from shared import config
    monkeypatch.setattr(config, 'RUNS_DIR', tmp_path / 'runs')
    recordings, transcripts, path, _ = fixture(tmp_path)
    class Client:
        def __init__(self):
            self.acks = []
        def claim_privacy_cleanup(self):
            return {'item': claim()}
        def ack_privacy_cleanup(self, cleanup_id, token):
            self.acks.append((cleanup_id, token))
    client = Client()
    from capture import privacy_cleanup
    original = privacy_cleanup._json_file
    with monkeypatch.context() as patch:
        patch.setattr(privacy_cleanup, '_json_file', lambda *args: (_ for _ in ()).throw(OSError('disk offline')))
        with pytest.raises(OSError):
            cleanup_one(recordings, transcripts, client=client)
    assert client.acks == [] and path.exists()
    assert privacy_cleanup._json_file is original
    assert cleanup_one(recordings, transcripts, client=client)
    assert client.acks == [('cleanup-a', 'lease')]


def test_ambiguous_legacy_shared_speakers_stay_pending_instead_of_guessing_ownership(tmp_path):
    recordings, transcripts, path, data = fixture(tmp_path)
    data.pop('hint_members')
    save_manifest(path, data)
    before = sha(recordings / 'guild_10/111_10.wav')
    with pytest.raises(PrivacyPending, match='ownership'):
        apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    assert sha(recordings / 'guild_10/111_10.wav') == before


def test_retry_after_audio_rename_before_manifest_publish_repairs_references(tmp_path, monkeypatch):
    recordings, transcripts, path, _ = fixture(tmp_path)
    from capture import privacy_cleanup
    original = privacy_cleanup._write
    with monkeypatch.context() as patch:
        def crash_manifest(target, value):
            if target == path:
                raise OSError('crash before manifest replace')
            return original(target, value)
        patch.setattr(privacy_cleanup, '_write', crash_manifest)
        with pytest.raises(OSError):
            apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    assert (recordings / 'guild_10/member-a_10.wav').exists()
    assert apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    cleaned = json.loads(path.read_text(encoding='utf-8'))
    assert cleaned['speakers'][0]['file'] == 'guild_10/member-a_10.wav'
    assert (recordings / cleaned['speakers'][0]['file']).exists()


def test_workspace_debug_intake_and_outbox_copies_are_cleaned_and_late_queue_blocked(tmp_path):
    recordings, transcripts, _, _ = fixture(tmp_path)
    from capture.notify import FileOutbox
    box = FileOutbox(recordings)
    assert box.send('channel', 'private copied name', workspace_id='workspace-a', session='guild_10')
    assert box.send('other-channel', 'unrelated', workspace_id='workspace-other', session='other')
    intake = recordings / '.uploads/m-upload/intake.json'
    intake.parent.mkdir(parents=True)
    intake.write_text(json.dumps({'meeting_id': 'm-upload', 'item': {'workspace_id': 'workspace-a',
                     'attendees': [{'member_id': 'member-a', 'display_name': 'same name'},
                                   {'member_id': 'member-b', 'display_name': 'same name'}]}}), encoding='utf-8')
    runs = tmp_path / 'runs'
    runs.mkdir()
    debug = runs / 'chat_poll_workspace-a_123.json'
    debug.write_text(json.dumps({'workspace_id': 'workspace-a', 'speaker_names': {'111': 'private'}}), encoding='utf-8')
    other = runs / 'chat_poll_workspace-other_123.json'
    other.write_text(json.dumps({'workspace_id': 'workspace-other', 'speaker_names': {'111': 'private'}}), encoding='utf-8')
    assert apply_cleanup(recordings, transcripts, claim(), runs=runs)
    assert not debug.exists() and other.exists()
    (queued,) = box.dir.glob('*.json')
    assert json.loads(queued.read_text(encoding='utf-8'))['workspace_id'] == 'workspace-other'
    assert not box.send('channel', 'old cached publisher', workspace_id='workspace-a', identity_epoch=0)
    assert box.send('channel', 'current anonymous publisher', workspace_id='workspace-a', identity_epoch=1)
    data = json.loads(intake.read_text(encoding='utf-8'))
    assert data['item']['attendees'][0]['display_name'] == '탈퇴한 사용자'
    assert data['item']['attendees'][1]['display_name'] == 'same name'
    assert data['item']['identity_epoch'] == 1


def test_newer_marker_cannot_be_rolled_back_by_old_job(tmp_path):
    recordings, transcripts, _, _ = fixture(tmp_path)
    assert apply_cleanup(recordings, transcripts, claim(identity_epoch=3), runs=tmp_path / 'runs')
    assert apply_cleanup(recordings, transcripts, claim(identity_epoch=1, member_ids=['member-b']), runs=tmp_path / 'runs')
    assert state(recordings, 'workspace-a')['identity_epoch'] == 3
    assert state(recordings, 'workspace-a')['member_ids'] == ['member-a', 'member-b']


def test_session_cannot_be_reassigned_to_new_workspace_to_bypass_old_generation_fence(tmp_path):
    recordings, transcripts, path, data = fixture(tmp_path)
    assert apply_cleanup(recordings, transcripts, claim(delete_workspace=True), runs=tmp_path / 'runs')
    with pytest.raises(PrivacyPending):
        save_manifest(path, {**data, 'workspace_id': 'workspace-new', 'identity_epoch': 1})


def test_manifest_and_epoch_client_keep_roster_snapshot_despite_newer_lookup_cache():
    from capture.handoff import BeClient, Handoff
    class Response:
        status_code = 200
        def json(self):
            return {'data': {'meeting_id': 'meeting', 'status': 'created'}, 'error': None}
    class Session:
        def __init__(self):
            self.headers = []
        def request(self, method, url, **kwargs):
            self.headers.append(kwargs.get('headers') or {})
            return Response()
    transport = Session()
    client = BeClient('http://isolated', session=transport, service_token='service')
    client.workspace_epochs['workspace-a'] = 9
    manifest = {'workspace_id': 'workspace-a', 'identity_epoch': 2}
    Handoff(client).start(manifest)
    assert transport.headers[-1]['X-Privacy-Epoch'] == '2'
    assert client.meeting_epochs['meeting'] == 2
    assert manifest['identity_epoch'] == 2


def test_structured_line_cache_and_markdown_preserve_same_named_other_speaker_and_body(tmp_path):
    recordings, transcripts, path, data = fixture(tmp_path)
    folder = recordings / 'guild_10'
    jsonl = folder / 'transcript.jsonl'
    jsonl.write_text('\n'.join(json.dumps(row) for row in [
        {'speaker': '111', 'start': 0, 'end': 1, 'text': 'same name is spoken here'},
        {'speaker': '222', 'start': 1, 'end': 2, 'text': 'other original body'},
    ]), encoding='utf-8')
    markdown = folder / 'transcript.md'
    markdown.write_text('old speaker metadata', encoding='utf-8')
    data['transcript'] = 'guild_10/transcript.md'
    save_manifest(path, data)
    cache = transcripts / 'session_guild_10.lines.json'
    cache.write_text(json.dumps([{'speaker_id': '111', 'speaker_name': 'same name', 'text': 'body'},
                                 {'speaker_id': '222', 'speaker_name': 'same name', 'text': 'other'}]), encoding='utf-8')
    assert apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    rows = json.loads(cache.read_text(encoding='utf-8'))
    assert rows == [{'speaker_id': 'member-a', 'speaker_name': '탈퇴한 사용자', 'text': 'body'},
                    {'speaker_id': '222', 'speaker_name': 'same name', 'text': 'other'}]
    document = markdown.read_text(encoding='utf-8')
    assert '**탈퇴한 사용자**: same name is spoken here' in document
    assert '**same name**: other original body' in document
    assert '## 화자별' in document


def test_outside_artifact_reference_never_changes_outside_file_or_returns_success(tmp_path):
    recordings, transcripts, path, data = fixture(tmp_path)
    outside = tmp_path / 'outside-private.json'
    outside.write_text(json.dumps({'speaker_id': '111', 'speaker_name': 'same name'}), encoding='utf-8')
    data['items'] = str(outside)
    save_manifest(path, data)
    original = sha(outside)
    with pytest.raises(ValueError, match='unsafe artifact reference'):
        apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    assert sha(outside) == original


def test_deleted_workspace_intake_without_manifest_is_removed_and_new_guild_generation_can_start(tmp_path):
    recordings, transcripts, _, _ = fixture(tmp_path)
    intake = recordings / '.uploads/orphan/intake.json'
    intake.parent.mkdir(parents=True)
    intake.write_text(json.dumps({'meeting_id': 'orphan', 'item': {'workspace_id': 'workspace-a'}}), encoding='utf-8')
    audio = recordings / 'upload_orphan'
    audio.mkdir()
    (audio / 'audio.wav').write_bytes(b'sole workspace audio')
    assert apply_cleanup(recordings, transcripts, claim(delete_workspace=True), runs=tmp_path / 'runs')
    assert not intake.parent.exists() and not audio.exists()
    assert state(recordings, 'workspace-a')['legacy_guild_ids'] == []
    fresh = manifest_path(recordings, 'guild_new')
    save_manifest(fresh, {'session': 'guild_new', 'workspace_id': 'workspace-new', 'guild_id': 'guild', 'identity_epoch': 0})
    assert fresh.exists()


def test_legacy_dm_receipt_selected_by_message_uuid_and_private_rate_cache_are_erased(tmp_path):
    recordings, transcripts, _, _ = fixture(tmp_path)
    sent = recordings / '.bot/dm/sent'
    sent.mkdir(parents=True)
    target = sent / 'target-message.json'
    other = sent / 'other-message.json'
    target.write_text(json.dumps({'message_id': 'target-message', 'discord_user_id': 'unmapped-private-id',
                                  'parts_sent': ['target-remote-id']}), encoding='utf-8')
    other.write_text(json.dumps({'message_id': 'other-message', 'discord_user_id': 'another-private-id',
                                 'parts_sent': ['other-remote-id']}), encoding='utf-8')
    notice = sent.parent / 'web_notice.json'
    notice.write_text(json.dumps({'unmapped-private-id': 1}), encoding='utf-8')
    assert apply_cleanup(recordings, transcripts, claim(message_ids=['target-message']), runs=tmp_path / 'runs')
    assert not target.exists() and not notice.exists()
    assert json.loads(other.read_text(encoding='utf-8')) == {'message_id': 'other-message', 'parts_sent': ['other-remote-id']}


async def test_stale_new_dm_is_not_sent_but_failed_receipt_is_reported_for_convergence(tmp_path):
    from tests.capture.test_dm import FakeBot, FakeUser, _cog, _item
    recordings, transcripts, _, _ = fixture(tmp_path)
    user = FakeUser()
    cog, backend = _cog(recordings, FakeBot([user]))
    assert apply_cleanup(recordings, transcripts, claim(workspace_id='ws'), runs=tmp_path / 'runs')
    backend.claims.append([_item()])
    await cog.run_round()
    assert user.sent == []
    assert backend.sent('/bot/messages/msg-1/result') == [('/bot/messages/msg-1/result', {
        'status': 'failed', 'failure_reason': 'unknown', 'discord_message_ids': [],
    })]


async def test_busy_dm_transport_does_not_consume_global_claim(tmp_path):
    from tests.capture.test_dm import FakeBot, FakeUser, _cog, _item
    cog, backend = _cog(tmp_path, FakeBot([FakeUser()]))
    backend.claims.append([_item()])
    lock = try_lock(tmp_path / '.privacy-dm-writer.json')
    try:
        await cog.run_round()
    finally:
        lock.release()
    assert len(backend.claims) == 1 and backend.calls == []


@pytest.mark.parametrize('kind', ['draft', 'judgment'])
async def test_inflight_llm_snapshot_pins_epoch_and_defers_cleanup_ack(tmp_path, kind):
    from tests.capture.fake_be import _err
    from tests.capture.test_dm import FakeBot, _bundle, _claimed, _cog
    recordings, transcripts, _, _ = fixture(tmp_path)
    started, release = threading.Event(), threading.Event()
    def slow(item):
        started.set()
        assert release.wait(timeout=5)
        return 'old private name' if kind == 'draft' else {
            'attempt': item['attempt'], 'failure_reason': None, 'model_name': 'fixture', 'changes': [],
        }
    cog, backend = _cog(recordings, FakeBot(), drafter=slow, judger=slow)
    headers = []
    def response(method, url, **kwargs):
        headers.append(kwargs.get('headers') or {})
        return _err(409, 'PRIVACY_VERSION_CHANGED')
    backend.request = response
    item = {**(_bundle('bundle') if kind == 'draft' else _claimed()), 'identity_epoch': 2}
    task = asyncio.create_task(cog._draft_item(item) if kind == 'draft' else cog._judge_item(item))
    try:
        assert await asyncio.wait_for(asyncio.to_thread(started.wait), timeout=2)
        assert not apply_cleanup(recordings, transcripts, claim(workspace_id='ws', identity_epoch=3), runs=tmp_path / 'runs')
        cog.be.workspace_epochs['ws'] = 9
    finally:
        release.set()
    await asyncio.wait_for(task, timeout=3)
    assert headers[-1]['X-Privacy-Epoch'] == '2'
    assert apply_cleanup(recordings, transcripts, claim(workspace_id='ws', identity_epoch=3), runs=tmp_path / 'runs')


def test_assignee_and_evidence_owner_are_scrubbed_independently(tmp_path):
    recordings, transcripts, path, data = fixture(tmp_path)
    output = transcripts / 'session_guild_10.items.json'
    rows = [{'assignee_member_id': 'member-b', 'assignee_raw': 'same name',
             'evidence_speaker_member_id': 'member-a', 'evidence_speaker': 'same name'},
            {'assignee_member_id': 'member-a', 'assignee_raw': 'same name',
             'evidence_speaker_member_id': 'member-b', 'evidence_speaker': 'same name'}]
    output.write_text(json.dumps(rows), encoding='utf-8')
    data['items'] = str(output)
    save_manifest(path, data)
    assert apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    cleaned = json.loads(output.read_text(encoding='utf-8'))
    assert cleaned[0]['assignee_raw'] == 'same name' and cleaned[0]['evidence_speaker'] == '탈퇴한 사용자'
    assert cleaned[1]['assignee_raw'] == '탈퇴한 사용자' and cleaned[1]['evidence_speaker'] == 'same name'


@pytest.mark.parametrize('evidence_hint', [{}, {'evidence_speaker_member_id': None}])
def test_discord_judge_output_erases_raw_evidence_speaker_and_retains_anonymous_provenance(tmp_path, evidence_hint):
    from capture.judge_path import JudgeOutput, _restore
    from capture.recorder import _keep_judge_output

    recordings, transcripts, path, data = fixture(tmp_path)
    items = _restore([{**evidence_hint, 'evidence_speaker': 'same name', 'assignee_member_id': 'member-b',
                       'assignee_raw': 'other alias'}], {'111': 'same name'}, {'111': 'same name'}, {'111'})
    output = _keep_judge_output(transcripts, data, JudgeOutput(items=items))
    save_manifest(path, data)
    assert json.loads(output.read_text(encoding='utf-8'))[0]['evidence_speaker'] == '111'
    assert apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    cleaned = json.loads(output.read_text(encoding='utf-8'))[0]
    assert cleaned['evidence_speaker'] is None
    assert cleaned['evidence_speaker_member_id'] == 'member-a'
    assert cleaned['assignee_member_id'] == 'member-b' and cleaned['assignee_raw'] == 'other alias'
    assert apply_cleanup(recordings, transcripts, claim(), runs=tmp_path / 'runs')
    assert json.loads(output.read_text(encoding='utf-8'))[0] == cleaned


def test_chat_snapshot_epoch_reaches_separately_constructed_ai_tool_client(tmp_path, monkeypatch):
    from capture.handoff import BeClient
    from capture.privacy_cleanup import chat_writer
    from shared import config
    from tests.capture.fake_be import _ok
    monkeypatch.setattr(config, 'RECORDINGS_DIR', tmp_path / 'recordings')
    headers = []
    class Session:
        def request(self, method, url, **kwargs):
            headers.append(kwargs.get('headers') or {})
            return _ok(200, {'items': []})
    client = BeClient('http://isolated', session=Session())
    client.workspace_epochs['workspace-a'] = 4
    @chat_writer
    def operation(reader, client, *, workspace_id):
        BeClient('http://isolated', session=Session())._call('POST', f'/workspaces/{workspace_id}/tasks/similar', {'text': 'body'})
        return 0
    assert operation(None, client, workspace_id='workspace-a') == 0
    assert headers[-1]['X-Privacy-Epoch'] == '4'
