"""Durable deletion receipts share the upload writer and recovery manifest locks."""
from __future__ import annotations

import functools
import json
import shutil
from pathlib import Path

from capture import audio_outbox
from capture.recorder import manifest_path, save_manifest, try_lock, try_restart_lock


def _component(value: str) -> str:
    if not value or Path(value).name != value or value in ('.', '..') or any(c in value for c in '\\/:*?[]'):
        raise ValueError('invalid storage identifier')
    return value


def marker(recordings: Path, meeting_id: str) -> Path:
    _component(meeting_id)
    return Path(recordings) / '.deleted' / f'{meeting_id}.json'


def deleted(recordings: Path, meeting_id: str) -> bool:
    return marker(recordings, meeting_id).exists()


def meeting_ids(manifest: dict) -> set[str]:
    be = manifest.get('be') or {}
    return {mid for mid in [be.get('meeting_id'), *(be.get('replaced') or [])] if mid}


def mark_deleted(recordings: Path, ids) -> None:
    for meeting_id in sorted(ids):
        path = marker(recordings, meeting_id)
        if not path.exists():
            save_manifest(path, {'meeting_id': meeting_id})


def upload_writer(function):
    @functools.wraps(function)
    def guarded(recordings_dir, *args, **kwargs):
        lock = try_lock(Path(recordings_dir) / '.uploads-writer.json')
        if lock is None:
            return None
        try:
            return function(recordings_dir, *args, **kwargs)
        finally:
            lock.release()
    return guarded


def _remove(path: Path, root: Path) -> None:
    root = root.resolve()
    junction = getattr(path, 'is_junction', lambda: False)()
    if path.is_symlink() or junction or not path.resolve().is_relative_to(root) or path.resolve() == root:
        raise ValueError('unsafe deletion path')
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)
    if path.exists():
        raise OSError('deletion incomplete')


def purge_files(recordings: Path, transcripts: Path, meeting_id: str) -> bool:
    recordings, transcripts = Path(recordings), Path(transcripts)
    mark_deleted(recordings, {meeting_id})
    restart_lock = try_restart_lock(recordings)
    if restart_lock is None:
        return False
    upload_lock = None
    locks = []
    try:
        upload_lock = try_lock(recordings / '.uploads-writer.json')
        if upload_lock is None:
            return False
        paths = set(recordings.glob('session_*.json'))
        paths.update(path.with_suffix('') for path in recordings.glob('session_*.json.tmp'))
        expected = manifest_path(recordings, f'upload_{meeting_id}')
        paths.add(expected)
        # An active writer may know a terminal BE ID that is not in its manifest yet.
        # Lock the inventory before selecting IDs; creation uses restart/upload locks.
        for path in sorted(paths):
            lock = try_lock(path)
            if lock is None:
                return False
            locks.append(lock)
        manifests = []
        for path in sorted(paths):
            if path.exists():
                data = json.loads(path.read_text(encoding='utf-8'))
            elif path.with_suffix('.json.tmp').exists():
                data = json.loads(path.with_suffix('.json.tmp').read_text(encoding='utf-8'))
            elif path == expected:
                data = {'session': f'upload_{meeting_id}'}
            else:
                continue
            if path == expected or meeting_id in meeting_ids(data):
                manifests.append((path, data))
        for path, data in manifests:
            session = _component(str(data['session']))
            if path != manifest_path(recordings, session):
                raise ValueError('manifest session does not match its lock')
            ids = meeting_ids(data) | {meeting_id}
            mark_deleted(recordings, ids)
            prefixes = [f'session_{session}.', f'session_{session}__']
            prefixes += [f"{Path(s['file']).stem}__" for s in data.get('speakers') or [] if s.get('file')]
            for output in transcripts.iterdir() if transcripts.exists() else ():
                if any(output.name.startswith(prefix) for prefix in prefixes):
                    _remove(output, transcripts)
            for key in ('transcript', 'transcript_json', 'items', 'tasks'):
                if data.get(key):
                    output = Path(data[key])
                    if key == 'transcript' and not output.is_absolute():
                        output = recordings / output
                    root = transcripts if output.resolve().is_relative_to(transcripts.resolve()) else recordings
                    _remove(output, root)
            _remove(recordings / session, recordings)
            if data.get('meeting_dir'):
                _remove(recordings / data['meeting_dir'], recordings)
            for mid in ids:
                _remove(recordings / '.uploads' / _component(mid), recordings)
                audio_outbox.remove_meeting(recordings, mid)   # 아직 올리지 못한 섞은 녹음(#659)
            _remove(path.with_suffix('.json.tmp'), recordings)
            _remove(path, recordings)
        _remove(recordings / '.uploads' / meeting_id, recordings)
        audio_outbox.remove_meeting(recordings, meeting_id)
        return True
    finally:
        for lock in reversed(locks):
            lock.release()
        if upload_lock is not None:
            upload_lock.release()
        restart_lock.release()


def purge_one(recordings: Path, transcripts: Path, *, client) -> bool:
    claim = client.claim_meeting_purge()
    if claim is None:
        return False
    if not purge_files(recordings, transcripts, claim['meeting_id']):
        return False
    client.ack_meeting_purge(claim['meeting_id'], claim['claim_token'])
    return True
