"""심사용 시드(#606). 다시 실행해도 같은 결과다.

계정·공간·팀원 자리·온보딩 단계는 DB 에 직접 만들고(seed_accounts), 지난 회의는 AI 봇과 같은
서비스 토큰 API 로 재생한다(replay_meetings). 회의 데이터는 DB 에 직접 넣지 않는다.
"""
import copy
import secrets
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.workspaces import _build_onboarding
from app.cli.demo_seed import SeedData, SeedMeeting
from app.models import (
    Extraction,
    ExtractionItem,
    Meeting,
    Member,
    MemberRole,
    OnboardingStep,
    OnboardingStepStatus,
    Task,
    User,
    Workspace,
    WorkspaceOnboardingStepState,
)
from app.schemas.auth import validate_password
from app.schemas.email import normalize_email
from app.schemas.name import validate_name
from app.services.member_aliases import sync_name_aliases
from app.services.embedding import has_unsearchable_pending, has_unsearchable_tasks
from app.services.passwords import hash_password

PERSON_COUNT = 6
API = "/api/v1"
KST = timezone(timedelta(hours=9))
MEETING_HOUR_KST = 10
# 발화 시각 합성: 한 글자 0.2초, 발화 사이 0.5초
SECONDS_PER_CHAR = 0.2
GAP_SECONDS = 0.5
SUMMARY_MODEL_NAME = "demo-seed"


class SeedError(RuntimeError):
    pass


@dataclass
class SeededWorkspace:
    workspace_id: str
    member_ids: dict[str, str]
    user_ids: dict[str, str]


def emails_from_pattern(pattern: str, count: int = PERSON_COUNT) -> list[str]:
    if "{n}" not in pattern:
        raise SeedError("이메일 패턴에 {n} 자리표시자가 있어야 합니다")
    emails = [pattern.replace("{n}", str(n)) for n in range(1, count + 1)]
    for email in emails:
        if email.count("@") != 1 or email.startswith("@") or email.endswith("@"):
            raise SeedError(f"이메일 형식이 아닙니다: {email}")
    if len({normalize_email(email) for email in emails}) != len(emails):
        raise SeedError("이메일이 서로 겹칩니다")
    return emails


def seed_accounts(
    db: Session,
    data: SeedData,
    *,
    emails: list[str],
    workspace_name: str,
    pm_password: str,
    member2_password: str,
    reset_passwords: bool = False,
) -> SeededWorkspace:
    if len(emails) != len(data.people):
        raise SeedError("이메일 수가 시드 인물 수와 다릅니다")
    for password in (pm_password, member2_password):
        try:
            validate_password(password)
        except ValueError as error:
            raise SeedError(str(error)) from error
    for person in data.people:
        try:
            if validate_name(person.name) != person.name:
                raise ValueError("앞뒤 공백이 있습니다")
        except ValueError as error:
            raise SeedError(f"시드 인물 이름이 규칙에 맞지 않습니다: {person.name!r}") from error
    people = {person.key: person for person in data.people}
    if "p1" not in people or "p2" not in people:
        raise SeedError("시드 인물에 p1·p2 가 있어야 합니다")
    fixed = {"p1": pm_password, "p2": member2_password}

    try:
        users: dict[str, User] = {}
        for person, email in zip(data.people, emails):
            email = normalize_email(email)
            user = db.scalars(select(User).where(User.email == email)).first()
            if user is None:
                password = fixed.get(person.key) or secrets.token_urlsafe(18) + "1"
                user = User(email=email, name=person.name, password_hash=hash_password(password))
                db.add(user)
            elif reset_passwords and person.key in fixed:
                user.password_hash = hash_password(fixed[person.key])
            users[person.key] = user
        db.flush()

        workspace = db.scalars(
            select(Workspace)
            .join(Member, Member.workspace_id == Workspace.workspace_id)
            .where(
                Member.user_id == users["p1"].user_id,
                Member.role == MemberRole.PM,
                Member.is_deleted.is_(False),
                Workspace.name == workspace_name,
                Workspace.deleted_at.is_(None),
            )
        ).first()
        if workspace is None:
            workspace = Workspace(name=workspace_name)
            db.add(workspace)
            db.flush()

        member_ids: dict[str, str] = {}
        for person in data.people:
            member = None
            if person.key != "p2":
                # 이름이 달라도 같은 계정의 활성 자리(create_workspace 로 만든 PM 자리 등)를 먼저 쓴다.
                member = db.scalars(
                    select(Member).where(
                        Member.workspace_id == workspace.workspace_id,
                        Member.user_id == users[person.key].user_id,
                        Member.is_deleted.is_(False),
                    )
                ).first()
            if member is None:
                member = db.scalars(
                    select(Member).where(
                        Member.workspace_id == workspace.workspace_id,
                        Member.display_name == person.name,
                        Member.is_deleted.is_(False),
                    )
                ).first()
            if member is None:
                member = Member(
                    workspace_id=workspace.workspace_id,
                    user_id=None if person.key == "p2" else users[person.key].user_id,
                    display_name=person.name,
                    role=MemberRole.PM if person.key == "p1" else MemberRole.MEMBER,
                )
                db.add(member)
                db.flush()
            sync_name_aliases(db, member)
            member_ids[person.key] = member.member_id

        saved = {state.step: state for state in workspace.onboarding_steps}
        for step in OnboardingStep:
            if step.value in saved:
                if saved[step.value].status == OnboardingStepStatus.PENDING:
                    saved[step.value].status = OnboardingStepStatus.SKIPPED
                continue
            status = (
                OnboardingStepStatus.COMPLETED
                if step == OnboardingStep.CREATE_WORKSPACE
                else OnboardingStepStatus.SKIPPED
            )
            workspace.onboarding_steps.append(
                WorkspaceOnboardingStepState(workspace_id=workspace.workspace_id, step=step, status=status)
            )
        db.flush()
        db.refresh(workspace)
        workspace.onboarding_completed = _build_onboarding(workspace).completed
        db.commit()
    except Exception:
        db.rollback()
        raise
    return SeededWorkspace(
        workspace_id=workspace.workspace_id,
        member_ids=member_ids,
        user_ids={key: user.user_id for key, user in users.items()},
    )


@dataclass
class ReplayReport:
    done: int
    gates: dict[str, int]
    processing: int
    unembedded: int
    summaries_written: int
    summaries_skipped: list[str] = field(default_factory=list)


def _call(http: httpx.Client, method: str, path: str, *, service_token: str, **kwargs) -> dict | None:
    headers = {"X-Service-Token": service_token, **kwargs.pop("headers", {})}
    res = http.request(method, API + path, headers=headers, **kwargs)
    if not 200 <= res.status_code < 300:
        raise SeedError(f"{method} {path} 가 {res.status_code} 로 실패했습니다: {res.text[:300]}")
    return res.json().get("data")


def _started_at(meeting: SeedMeeting, now: datetime) -> datetime:
    day = (now.astimezone(KST) - timedelta(days=meeting.days_ago)).date()
    return datetime(day.year, day.month, day.day, MEETING_HOUR_KST, tzinfo=KST)


def _segments(meeting: SeedMeeting, member_ids: dict[str, str]) -> list[dict]:
    segments, at = [], 0.0
    for seq, turn in enumerate(meeting.turns):
        end = at + len(turn.text) * SECONDS_PER_CHAR
        segments.append({
            "seq": seq, "start": round(at, 3), "end": round(end, 3), "text": turn.text,
            "speaker_member_id": member_ids[turn.speaker],
        })
        at = end + GAP_SECONDS
    return segments


def _items(meeting: SeedMeeting, member_ids: dict[str, str], meeting_day: date) -> list[dict]:
    """자리표시자(speaker_key, due_in_days)를 실제 값으로 바꾼다. 시드 데이터는 건드리지 않는다."""
    items = copy.deepcopy(meeting.items)
    for item in items:
        speaker_key = item.pop("speaker_key", None)
        if speaker_key is not None:
            item["evidence_speaker_member_id"] = member_ids[speaker_key]
        due_in_days = item.pop("due_in_days", None)
        if due_in_days is not None:
            item["due_date"] = (meeting_day + timedelta(days=due_in_days)).isoformat()
    return items


def _find_meeting(db: Session, workspace_id: str, title: str) -> tuple[str, str, datetime] | None:
    # 엔티티 대신 열만 읽는다. CLI 세션의 식별 맵이 API 가 바꾼 상태를 가리지 않게 하려는 것이다
    row = db.execute(
        select(Meeting.meeting_id, Meeting.status, Meeting.started_at)
        .where(Meeting.workspace_id == workspace_id, Meeting.title == title, Meeting.deleted_at.is_(None))
        .order_by(Meeting.started_at.desc(), Meeting.meeting_id)
        .limit(1)
    ).first()
    return (row[0], row[1], row[2]) if row else None


def _latest_extraction(db: Session, meeting_id: str) -> tuple[str, str | None] | None:
    row = db.execute(
        select(Extraction.extraction_id, Extraction.summary)
        .where(Extraction.meeting_id == meeting_id)
        .order_by(Extraction.created_at.desc())
        .limit(1)
    ).first()
    return (row[0], row[1]) if row else None


def _write_summary(http: httpx.Client, extraction_id: str, meeting: SeedMeeting, service_token: str) -> bool:
    """요약을 claim 해 저장한다. 다른 워커가 가져갔거나 저장되지 않았으면 False."""
    claim = _call(
        http, "POST", "/summaries/claim", service_token=service_token, json={"extraction_ids": [extraction_id]}
    )
    if not claim:
        return False
    body = {**copy.deepcopy(meeting.summary), "claim_token": claim["claim_token"], "model_name": SUMMARY_MODEL_NAME}
    saved = _call(http, "PUT", f"/extractions/{extraction_id}/summary", service_token=service_token, json=body)
    return bool(saved and saved.get("applied"))


def replay_meetings(
    http: httpx.Client,
    db: Session,
    seeded: SeededWorkspace,
    data: SeedData,
    *,
    service_token: str,
    wait_for_embeddings: Callable[[str], None],
    now: datetime | None = None,
) -> ReplayReport:
    """지난 회의를 봇과 같은 API 순서(생성 → 종료 → 발화 → 추출 → 요약)로 재생한다.

    제목으로 기존 회의를 찾아 멈춘 단계부터 잇는다. 회의마다 임베딩이 채워질 때까지 기다려야 다음 회의의
    첫 항목이 auto 로 갈 수 있다(임베딩 없는 task·대기 카드가 있으면 auto 를 막는다).
    """
    now = now or datetime.now(timezone.utc)
    workspace_id = seeded.workspace_id
    written, skipped = 0, []
    for meeting in data.meetings:
        found = _find_meeting(db, workspace_id, meeting.title)
        if found is None:
            created = _call(
                http, "POST", "/meetings", service_token=service_token,
                headers={"X-Meeting-Lineage-Version": "1"},
                json={
                    "workspace_id": workspace_id, "title": meeting.title, "source": "discord",
                    "started_at": _started_at(meeting, now).isoformat(),
                },
            )
            found = (created["meeting_id"], created["status"], datetime.fromisoformat(created["started_at"]))
        meeting_id, status, started_at = found
        if status not in ("created", "processing", "done"):
            raise SeedError(f"회의 '{meeting.title}' 가 {status} 상태라 이어 갈 수 없습니다. 새 공간 이름으로 다시 시드하세요")
        if status == "created":
            _call(http, "PATCH", f"/meetings/{meeting_id}/end", service_token=service_token)
            status = "processing"
        if status == "processing":
            _call(
                http, "POST", f"/meetings/{meeting_id}/sources", service_token=service_token,
                json={"source": "meeting", "segments": _segments(meeting, seeded.member_ids)},
            )
            if started_at.tzinfo is None:  # SQLite 는 시간대를 저장하지 않는다
                started_at = started_at.replace(tzinfo=timezone.utc)
            extraction = _call(
                http, "POST", "/extractions", service_token=service_token,
                json={
                    "meeting_id": meeting_id, "workspace_id": workspace_id,
                    "items": _items(meeting, seeded.member_ids, started_at.astimezone(KST).date()),
                },
            )
            summary_target = extraction["extraction_id"]
        else:
            latest = _latest_extraction(db, meeting_id)
            summary_target = latest[0] if latest is not None and latest[1] is None else None
        if summary_target is not None:
            if _write_summary(http, summary_target, meeting, service_token):
                written += 1
            else:
                skipped.append(meeting.title)
        wait_for_embeddings(workspace_id)

    _call(
        http, "POST", f"/workspaces/{workspace_id}/asr-terms", service_token=service_token,
        json={"words": data.asr_terms},
    )
    return _report(db, workspace_id, data, written, skipped)


def _report(db: Session, workspace_id: str, data: SeedData, written: int, skipped: list[str]) -> ReplayReport:
    seeded_meetings = (
        Meeting.workspace_id == workspace_id,
        Meeting.title.in_([m.title for m in data.meetings]),
        Meeting.deleted_at.is_(None),
    )
    statuses = Counter(db.scalars(select(Meeting.status).where(*seeded_meetings)))
    gates = Counter(db.scalars(
        select(ExtractionItem.gate)
        .join(Extraction, Extraction.extraction_id == ExtractionItem.extraction_id)
        .join(Meeting, Meeting.meeting_id == Extraction.meeting_id)
        .where(*seeded_meetings)
    ))
    unembedded = db.scalar(
        select(func.count()).select_from(Task).where(
            Task.workspace_id == workspace_id, Task.is_deleted.is_(False), Task.embedding.is_(None)
        )
    )
    return ReplayReport(
        done=statuses.get("done", 0),
        gates={str(gate): count for gate, count in gates.items() if gate is not None},
        processing=statuses.get("processing", 0),
        unembedded=unembedded or 0,
        summaries_written=written,
        summaries_skipped=skipped,
    )


def poll_embeddings(
    session_factory: Callable[[], Session], timeout_s: float, interval_s: float = 2.0
) -> Callable[[str], None]:
    """임베딩 워커가 공간의 task·승인 대기 카드를 다 채울 때까지 기다리는 콜백을 만든다."""

    def wait(workspace_id: str) -> None:
        deadline = time.monotonic() + timeout_s
        while True:
            with session_factory() as session:
                waiting = has_unsearchable_tasks(session, workspace_id) or has_unsearchable_pending(
                    session, workspace_id
                )
            if not waiting:
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise SeedError(
                    f"{timeout_s:g}초 안에 임베딩이 채워지지 않았습니다. API 서버의 EMBEDDING_API_KEY 와 "
                    "임베딩 워커를 확인하세요(채워지기 전에는 다음 회의 항목이 auto 로 가지 않습니다)"
                )
            time.sleep(min(interval_s, remaining))

    return wait
