"""Workspace-scoped privacy fences and retryable local artifact cleanup."""
from __future__ import annotations

import functools
import json
import os
from pathlib import Path

ANONYMOUS = '탈퇴한 사용자'


class PrivacyPending(RuntimeError):
    pass


def _component(value: str) -> str:
    from capture.meeting_purge import _component as checked
    return checked(str(value))


def _write(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, path)


def state_path(recordings: Path, workspace_id: str) -> Path:
    return Path(recordings) / '.privacy' / f'{_component(workspace_id)}.json'


def state(recordings: Path, workspace_id: str | None) -> dict:
    if not workspace_id:
        return {}
    path = state_path(recordings, workspace_id)
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def workspace_deleted(recordings: Path, workspace_id: str | None, *, guild_id: str | None = None) -> bool:
    if workspace_id:
        return bool(state(recordings, workspace_id).get('deleted'))
    return any(value.get('deleted') and str(guild_id) in value.get('legacy_guild_ids', [])
               for value in _workspace_states(recordings)) if guild_id else False


def _workspace_states(recordings: Path):
    for path in (Path(recordings) / '.privacy').glob('*.json'):
        yield json.loads(path.read_text(encoding='utf-8'))


def session_fence_path(recordings: Path, session: str) -> Path:
    return Path(recordings) / '.privacy' / 'sessions' / f'{_component(session)}.json'


def guard_manifest(path: Path, manifest: dict) -> None:
    if not path.name.startswith('session_'):
        return
    fence_path = session_fence_path(path.parent, path.stem.removeprefix('session_'))
    fence = json.loads(fence_path.read_text(encoding='utf-8')) if fence_path.exists() else {}
    workspace_id = manifest.get('workspace_id') or fence.get('workspace_id')
    if fence and workspace_id != fence['workspace_id']:
        raise PrivacyPending('session belongs to a retired workspace generation')
    current = state(path.parent, workspace_id)
    if not workspace_id and manifest.get('guild_id'):
        current = next((value for value in _workspace_states(path.parent)
                        if str(manifest['guild_id']) in value.get('legacy_guild_ids', [])), {})
    if current.get('deleted') or int(manifest.get('identity_epoch') or 0) < int(current.get('identity_epoch') or 0):
        raise PrivacyPending('workspace privacy snapshot is stale')


def guard_workspace(recordings: Path, workspace_id: str, identity_epoch: int = 0) -> None:
    current = state(recordings, workspace_id)
    if current.get('deleted') or identity_epoch < int(current.get('identity_epoch') or 0):
        raise PrivacyPending('workspace privacy snapshot is stale')


def chat_writer(function):
    @functools.wraps(function)
    def guarded(*args, **kwargs):
        from contextlib import nullcontext

        from capture.recorder import try_lock
        from shared.config import RECORDINGS_DIR
        lock = try_lock(Path(RECORDINGS_DIR) / '.privacy-chat-writer.json')
        if lock is None:
            return 1
        try:
            workspace_id = kwargs['workspace_id']
            client = args[1]
            epoch = getattr(client, 'workspace_epochs', {}).get(workspace_id, 0)
            guard_workspace(Path(RECORDINGS_DIR), workspace_id, epoch)
            scope = getattr(client, 'privacy_scope', None)
            with scope(epoch) if scope else nullcontext():
                return function(*args, **kwargs)
        except PrivacyPending:
            return 1
        finally:
            lock.release()
    return guarded


def _identity_map(manifest: dict, member_ids: set[str]) -> dict[str, str]:
    identities = {}
    for entry in manifest.get('hint_members') or []:
        if entry.get('member_id') in member_ids and entry.get('discord_user_id'):
            identities[str(entry['discord_user_id'])] = str(entry['member_id'])
    for entry in manifest.get('speakers') or []:
        if entry.get('member_id') in member_ids and entry.get('user_id'):
            identities[str(entry['user_id'])] = str(entry['member_id'])
    return identities


def _scrub(value, members: set[str], identities: dict[str, str], paths: dict[str, str], *, field=''):
    if isinstance(value, list):
        return [_scrub(item, members, identities, paths, field=field) for item in value]
    if not isinstance(value, dict):
        if isinstance(value, str):
            if field in ('speaker', 'speaker_id', 'speaker_discord_user_id', 'user_id', 'discord_user_id'):
                return identities.get(value, value)
            if field in ('file', 'audio_file', 'audio_path', 'transcript', 'transcript_json'):
                return paths.get(value, value)
        return value
    owned = any(value.get(key) in members for key in ('member_id', 'speaker_member_id'))
    referenced_member = any(value.get(key) is not None for key in ('member_id', 'speaker_member_id'))
    foreign_member = referenced_member and not owned
    speaker_id = value.get('speaker_id') or value.get('user_id')
    owned = owned or (not referenced_member and isinstance(speaker_id, str) and speaker_id in identities)
    evidence = value.get('evidence_speaker')
    unmapped_evidence = (value.get('evidence_speaker_member_id') is None
                         and isinstance(evidence, str) and evidence in identities)
    out = {}
    for key, item in value.items():
        new_key = identities.get(key, key)
        if key in ('hint_names',) and identities:
            continue
        if ((owned and (key in ('name', 'display_name', 'speaker_name')
                        or (key == 'speaker' and 'speaker_id' in value)))
                or (key == 'assignee_raw' and value.get('assignee_member_id') in members)
                or (key == 'evidence_speaker' and value.get('evidence_speaker_member_id') in members)):
            out[new_key] = None if key == 'evidence_speaker' and item is None else ANONYMOUS
        elif key == 'evidence_speaker' and unmapped_evidence:
            out[new_key] = None
        elif owned and key in ('discord_user_id', 'notion_name', 'aliases'):
            out[new_key] = [] if key == 'aliases' else None
        elif field in ('speakers', 'speaker_names') and key in identities:
            out[new_key] = ANONYMOUS
        elif foreign_member and key in ('speaker', 'speaker_id', 'user_id', 'discord_user_id'):
            out[new_key] = item
        else:
            out[new_key] = _scrub(item, members, identities, paths, field=key)
    if unmapped_evidence:
        out['evidence_speaker_member_id'] = identities[evidence]
    return out


def _json_file(path: Path, members: set[str], identities: dict[str, str], paths: dict[str, str]) -> None:
    if path.name.endswith(('.jsonl', '.jsonl.tmp')):
        rows = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
        cleaned = [_scrub(row, members, identities, paths) for row in rows]
        temporary = path.with_suffix(path.suffix + '.clean')
        temporary.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in cleaned), encoding='utf-8')
        os.replace(temporary, path)
    else:
        original = json.loads(path.read_text(encoding='utf-8'))
        cleaned = _scrub(original, members, identities, paths)
        if cleaned != original:
            _write(path, cleaned)


def _session_files(recordings: Path, transcripts: Path, manifest: dict) -> set[Path]:
    session = _component(manifest['session'])
    files = set()
    directory = recordings / _component(manifest.get('meeting_dir') or session)
    if directory.exists():
        if directory.is_symlink() or getattr(directory, 'is_junction', lambda: False)():
            raise ValueError('unsafe session storage')
        files.update(path for path in directory.rglob('*') if path.is_file())
    for path in transcripts.iterdir() if transcripts.exists() else ():
        if path.name.startswith((f'session_{session}.', f'session_{session}__')):
            files.add(path)
    for speaker in manifest.get('speakers') or []:
        if speaker.get('file'):
            audio = recordings / speaker['file']
            if not audio.resolve().is_relative_to(recordings.resolve()):
                raise ValueError('unsafe speaker storage')
            files.add(audio)
            for path in transcripts.glob(f'{audio.stem}__*'):
                files.add(path)
    # Validate references even when an output has already disappeared on a retry.
    for key in ('transcript', 'transcript_json', 'items', 'tasks'):
        if manifest.get(key):
            path = Path(manifest[key])
            if not path.is_absolute():
                path = recordings / path
            root = transcripts if path.resolve().is_relative_to(transcripts.resolve()) else recordings
            if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
                raise ValueError('unsafe artifact reference')
            if path.exists():
                files.add(path)
    for path in files:
        if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
            raise ValueError('unsafe artifact path')
        if not any(path.resolve().is_relative_to(root.resolve()) for root in (recordings, transcripts)):
            raise ValueError('unsafe artifact path')
    return files


def _markdown(path: Path, manifest: dict) -> None:
    source = path.with_suffix('.jsonl')
    if not source.exists():
        raise PrivacyPending('legacy transcript metadata needs structured speaker rows')
    from capture.handoff import speaker_names
    names = speaker_names(manifest)
    rows = [json.loads(line) for line in source.read_text(encoding='utf-8').splitlines() if line.strip()]
    text = [f"# 회의 전사 {manifest['session']}", '', '## 시간순', '']
    grouped = {}
    for row in rows:
        seconds = int(row.get('start', 0))
        name = names.get(str(row.get('speaker')), str(row.get('speaker') or ''))
        text += [f"({seconds // 60:02d}:{seconds % 60:02d}) **{name}**: {' '.join(str(row.get('text') or '').splitlines())}", '']
        grouped.setdefault(name, []).append(row)
    text += ['', '## 화자별', '']
    for name, group in grouped.items():
        text.append(f'### {name}')
        for row in group:
            seconds = int(row.get('start', 0))
            text += [f"({seconds // 60:02d}:{seconds % 60:02d}) {' '.join(str(row.get('text') or '').splitlines())}", '']
    path.write_text('\n'.join(text) + '\n', encoding='utf-8')


def _clean_session(recordings: Path, transcripts: Path, path: Path, manifest: dict,
                   members: set[str], epoch: int, *, alternate: dict | None = None) -> None:
    identities = _identity_map(manifest, members)
    if alternate:
        identities.update(_identity_map(alternate, members))
    if (manifest.get('source') != 'upload' and manifest.get('speakers')
            and manifest.get('hint_members') is None):
        raise PrivacyPending('legacy speaker ownership needs reconciliation')
    files = _session_files(recordings, transcripts, manifest)
    if alternate:
        files.update(_session_files(recordings, transcripts, alternate))
    renamed = {}
    moves = []
    for file in sorted(files):
        name = file.name
        for external, member in identities.items():
            if name.startswith(external + '_'):
                name = member + name[len(external):]
            name = name.replace('__' + external + '_', '__' + member + '_')
        if name != file.name:
            target = file.with_name(name)
            renamed[str(file)] = str(target)
            renamed[file.name] = target.name
            if file.resolve().is_relative_to(recordings.resolve()):
                renamed[file.relative_to(recordings).as_posix()] = target.relative_to(recordings).as_posix()
            if file.exists():
                moves.append((file, target))
    for file in sorted(files):
        if file.exists() and (file.suffix in ('.json', '.jsonl') or file.name.endswith(('.json.tmp', '.jsonl.tmp'))):
            _json_file(file, members, identities, renamed)
    for old, new in moves:
        if old.is_symlink() or getattr(old, 'is_junction', lambda: False)():
            raise ValueError('unsafe artifact path')
        if new.exists():
            if new.read_bytes() != old.read_bytes():
                raise ValueError('anonymous artifact collision')
            old.unlink()
        else:
            old.replace(new)
    cleaned = _scrub(manifest, members, identities, renamed)
    cleaned['identity_epoch'] = epoch
    for output in files:
        actual = Path(renamed.get(str(output), str(output)))
        if identities and actual.exists() and actual.name == 'transcript.md':
            _markdown(actual, cleaned)
    _write(path, cleaned)
    path.with_suffix('.json.tmp').unlink(missing_ok=True)


def apply_cleanup(recordings: Path, transcripts: Path, claim: dict, *, runs: Path | None = None) -> bool:
    from capture import audio_outbox
    from capture.meeting_purge import _remove, mark_deleted, meeting_ids, purge_files
    from capture.recorder import manifest_path, try_lock, try_restart_lock
    from shared.config import RUNS_DIR
    recordings, transcripts = Path(recordings), Path(transcripts)
    workspace_id = _component(claim['workspace_id'])
    members = set(claim['member_ids'])
    marker_lock = try_lock(state_path(recordings, workspace_id))
    if marker_lock is None:
        return False
    try:
        previous = state(recordings, workspace_id)
        current = {'workspace_id': workspace_id,
                   'identity_epoch': max(int(previous.get('identity_epoch') or 0), int(claim.get('identity_epoch') or 1)),
                   'member_ids': sorted(set(previous.get('member_ids') or []) | members),
                   'deleted': bool(previous.get('deleted') or claim['delete_workspace']),
                   'legacy_guild_ids': sorted(set(previous.get('legacy_guild_ids') or []) |
                                             ({str(guild) for guild in claim.get('guild_ids') or []}
                                              if claim['delete_workspace'] else set()))}
        _write(state_path(recordings, workspace_id), current)
    finally:
        marker_lock.release()
    restart = try_restart_lock(recordings)
    if restart is None:
        return False
    locks = []
    targets = []
    try:
        for shared in ('.uploads-writer.json', '.privacy-chat-writer.json', '.privacy-outbox-writer.json',
                       '.privacy-dm-writer.json', '.privacy-notice-writer.json',
                       '.privacy-draft-writer.json', '.privacy-judgment-writer.json'):
            lock = try_lock(recordings / shared)
            if lock is None:
                return False
            locks.append(lock)
        paths = set(recordings.glob('session_*.json'))
        paths.update(path.with_suffix('') for path in recordings.glob('session_*.json.tmp'))
        for path in sorted(paths):
            lock = try_lock(path)
            if lock is None:
                return False
            locks.append(lock)
        known = set(claim.get('meeting_ids') or [])
        guilds = {str(value) for value in claim.get('guild_ids') or []}
        channels = set()
        identities = {}
        for path in sorted(paths):
            source = path if path.exists() else path.with_suffix('.json.tmp')
            data = json.loads(source.read_text(encoding='utf-8'))
            belongs = data.get('workspace_id') == workspace_id
            if not data.get('workspace_id'):
                belongs = bool(known & meeting_ids(data)) or str(data.get('guild_id')) in guilds
            if not belongs:
                continue
            temporary = path.with_suffix('.json.tmp')
            alternate = json.loads(temporary.read_text(encoding='utf-8')) if path.exists() and temporary.exists() else None
            if alternate and (alternate.get('session') != data.get('session') or
                              alternate.get('workspace_id') not in (None, workspace_id)):
                raise ValueError('temporary manifest belongs to another session generation')
            if path != manifest_path(recordings, _component(data['session'])):
                raise ValueError('manifest session does not match inventory lock')
            data['workspace_id'] = workspace_id
            _write(session_fence_path(recordings, data['session']), {'workspace_id': workspace_id})
            identities.update(_identity_map(data, set(current['member_ids'])))
            if data.get('text_channel_id'):
                channels.add(str(data['text_channel_id']))
            if claim['delete_workspace']:
                ids = meeting_ids(data)
                if not ids:
                    # A private local UUID selector lets the existing purge walk the whole session.
                    ids = {'privacy-' + _component(claim['cleanup_id']) + '-' + _component(data['session'])}
                    data['be'] = {'meeting_id': next(iter(ids))}
                mark_deleted(recordings, ids)
                _write(path, data)
                targets.extend(ids)
            else:
                _clean_session(recordings, transcripts, path, data, set(current['member_ids']), current['identity_epoch'],
                               alternate=alternate)
        for path in (recordings / '.uploads').glob('*/intake.json'):
            data = json.loads(path.read_text(encoding='utf-8'))
            item = data.get('item') or {}
            if item.get('workspace_id') != workspace_id and data.get('meeting_id') not in known:
                continue
            if claim['delete_workspace']:
                targets.append(_component(data['meeting_id']))
            else:
                cleaned = _scrub(data, set(current['member_ids']), identities, {})
                cleaned.setdefault('item', {})['identity_epoch'] = current['identity_epoch']
                _write(path, cleaned)
        for path in (recordings / '.worker' / 'outbox').glob('*'):
            if path.suffix not in ('.json', '.tmp'):
                continue
            data = json.loads(path.read_text(encoding='utf-8'))
            if data.get('workspace_id') == workspace_id or (
                not data.get('workspace_id') and str(data.get('channel_id')) in channels
            ):
                _remove(path, recordings)
        # 올리지 못해 대기 중인 섞은 녹음(#659)은 화자별로 가를 수 없어 이 워크스페이스 것을 모두 지운다
        audio_outbox.remove_workspace(recordings, workspace_id)
        for meeting_id in known:
            audio_outbox.remove_meeting(recordings, _component(meeting_id))
        message_ids = set(claim.get('message_ids') or [])
        for path in (recordings / '.bot' / 'dm' / 'sent').glob('*'):
            if not path.name.endswith(('.json', '.json.tmp')):
                continue
            data = json.loads(path.read_text(encoding='utf-8'))
            if (data.get('message_id') in message_ids or
                (data.get('workspace_id') == workspace_id and
                 (claim['delete_workspace'] or data.get('member_id') in set(current['member_ids'])))):
                _remove(path, recordings)
            elif 'discord_user_id' in data:
                del data['discord_user_id']
                _write(path, data)
        notice = recordings / '.bot' / 'dm' / 'web_notice.json'
        if notice.exists():
            _remove(notice, recordings)
        temporary_notice = notice.with_name('.' + notice.name + '.tmp')
        if temporary_notice.exists():
            _remove(temporary_notice, recordings)
        run_root = Path(runs) if runs is not None else Path(RUNS_DIR)
        for path in run_root.glob('chat_poll_*') if run_root.exists() else ():
            if path.suffix != '.json':
                continue
            data = json.loads(path.read_text(encoding='utf-8'))
            if data.get('workspace_id') == workspace_id or path.name == f'chat_poll_attempt_{workspace_id}.json':
                _remove(path, run_root)
    finally:
        for lock in reversed(locks):
            lock.release()
        restart.release()
    if claim['delete_workspace']:
        for meeting_id in sorted(set(targets) | set(claim.get('meeting_ids') or [])):
            if not purge_files(recordings, transcripts, meeting_id):
                return False
        marker_lock = try_lock(state_path(recordings, workspace_id))
        if marker_lock is None:
            return False
        try:
            finished = state(recordings, workspace_id)
            finished['legacy_guild_ids'] = []
            _write(state_path(recordings, workspace_id), finished)
        finally:
            marker_lock.release()
    return True


def cleanup_one(recordings: Path, transcripts: Path, *, client) -> bool:
    response = client.claim_privacy_cleanup()
    claim = response.get('item') if isinstance(response, dict) else None
    if claim is None:
        return False
    if not apply_cleanup(recordings, transcripts, claim):
        return False
    client.ack_privacy_cleanup(claim['cleanup_id'], claim['claim_token'])
    return True
