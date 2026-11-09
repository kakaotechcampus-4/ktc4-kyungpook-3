"""심사용 시드(#606). 다시 실행해도 같은 결과다.

계정·공간·팀원 자리·온보딩 단계는 DB 에 직접 만들고(seed_accounts), 지난 회의는 AI 봇과 같은
서비스 토큰 API 로 재생한다(replay_meetings). 회의 데이터는 DB 에 직접 넣지 않는다.
"""
import argparse
import copy
import getpass
import hashlib
import json
import os
import secrets
import sys
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.workspaces import _build_onboarding
from app.cli.demo_seed import DEFAULT_DATA_PATH, SeedData, SeedDataError, SeedMeeting, load_seed_data
from app.core.database import SessionLocal
from app.models import (
    Extraction,
    ExtractionItem,
    Meeting,
    Member,
    MemberRole,
    OnboardingStep,
    OnboardingStepStatus,
    Session as SessionModel,
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
SEED_SOURCE = "discord"


class SeedError(RuntimeError):
    pass


class SeedConflictError(SeedError):
    """시드 것이 아닌 계정·자리·회의를 재사용하게 돼서 아무것도 쓰지 않고 멈췄다."""


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


@dataclass
class ExistingState:
    """시드가 재사용하게 될 기존 행. 읽기만 해서 모은다."""

    reused_emails: list[str] = field(default_factory=list)
    # 이메일은 같지만 이름이 시드 인물과 다른 계정(실제 사람 계정일 수 있다)
    foreign_users: list[str] = field(default_factory=list)
    workspace_id: str | None = None
    seats: int = 0
    # 시드 인물이 아니거나 시드 밖 계정에 연결된 활성 자리
    foreign_seats: list[str] = field(default_factory=list)
    meetings: int = 0
    # 시드 회의(source=discord 이고 제목이 시드 회의 제목)가 아닌 회의
    foreign_meetings: int = 0

    def problems(self) -> list[str]:
        problems = []
        if self.foreign_users:
            problems.append(f"이름이 시드 인물과 다른 기존 계정: {', '.join(self.foreign_users)}")
        if self.foreign_seats:
            problems.append(f"시드 인물이 아닌 자리: {', '.join(self.foreign_seats)}")
        if self.foreign_meetings:
            problems.append(f"시드가 만들지 않은 회의 {self.foreign_meetings}개")
        return problems


def inspect_existing(db: Session, data: SeedData, *, emails: list[str], workspace_name: str) -> ExistingState:
    """seed_accounts 가 재사용할 계정·공간·자리·회의를 읽기만 해서 모은다(--dry-run 과 실행 전 검사)."""
    state = ExistingState()
    seed_user_ids: dict[str, str] = {}
    for person, email in zip(data.people, emails):
        email = normalize_email(email)
        user = db.scalars(select(User).where(User.email == email)).first()
        if user is None:
            continue
        state.reused_emails.append(email)
        seed_user_ids[person.key] = user.user_id
        if user.name != person.name:
            state.foreign_users.append(email)
    if "p1" not in seed_user_ids:
        return state
    workspace = _find_workspace(db, seed_user_ids["p1"], workspace_name)
    if workspace is None:
        return state
    state.workspace_id = workspace.workspace_id
    keys_by_name = {person.name: person.key for person in data.people}
    seed_users = set(seed_user_ids.values())
    seats = db.scalars(
        select(Member).where(Member.workspace_id == workspace.workspace_id, Member.is_deleted.is_(False))
    ).all()
    state.seats = len(seats)
    for seat in seats:
        if seat.user_id is not None and seat.user_id in seed_users:
            continue
        key = keys_by_name.get(seat.display_name)
        # 팀원2 자리는 초대·수락 시연으로 시드 밖 계정과 이어질 수 있다
        if key is not None and (seat.user_id is None or key == "p2"):
            continue
        state.foreign_seats.append(seat.display_name)
    titles = {meeting.title for meeting in data.meetings}
    meetings = db.execute(
        select(Meeting.source, Meeting.title).where(
            Meeting.workspace_id == workspace.workspace_id, Meeting.deleted_at.is_(None)
        )
    ).all()
    state.meetings = len(meetings)
    state.foreign_meetings = sum(1 for source, title in meetings if source != SEED_SOURCE or title not in titles)
    return state


def _find_workspace(db: Session, pm_user_id: str, workspace_name: str) -> Workspace | None:
    return db.scalars(
        select(Workspace)
        .join(Member, Member.workspace_id == Workspace.workspace_id)
        .where(
            Member.user_id == pm_user_id,
            Member.role == MemberRole.PM,
            Member.is_deleted.is_(False),
            Workspace.name == workspace_name,
            Workspace.deleted_at.is_(None),
        )
    ).first()


def username_for(index: int, email: str) -> str:
    """시드 계정의 아이디(#610). 몇 번째 인물인지 보이게 demo<n> 으로 시작하고, 이메일 해시를 붙여 패턴을 바꿔
    다시 시드해도 앞선 시드 계정과 겹치지 않게 한다. 아이디 규칙(영문 소문자·숫자 4~20자) 안이다."""
    return f"demo{index}" + hashlib.sha256(email.encode()).hexdigest()[:10]


def seed_accounts(
    db: Session,
    data: SeedData,
    *,
    emails: list[str],
    workspace_name: str,
    pm_password: str,
    member2_password: str,
    reset_passwords: bool = False,
    allow_existing: bool = False,
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
        if not allow_existing:
            # 이메일·공간 이름을 잘못 넣어 실제 계정·공간과 겹치면 쓰기 전에 멈춘다(실제 공간에 자리·회의가 들어가지 않게)
            problems = inspect_existing(db, data, emails=emails, workspace_name=workspace_name).problems()
            if problems:
                raise SeedConflictError(
                    "시드가 아닌 기존 데이터를 재사용하게 됩니다(" + "; ".join(problems) + "). "
                    "이메일 패턴·공간 이름을 확인하고, 그래도 재사용하려면 --allow-existing 을 붙이세요"
                )
        users: dict[str, User] = {}
        for index, (person, email) in enumerate(zip(data.people, emails), start=1):
            email = normalize_email(email)
            user = db.scalars(select(User).where(User.email == email)).first()
            if user is None:
                username = username_for(index, email)
                if db.scalar(select(User.user_id).where(User.username == username)) is not None:
                    raise SeedError(f"시드 아이디 {username} 를 다른 계정이 쓰고 있습니다. 이메일 패턴을 바꾸세요")
                password = fixed.get(person.key) or secrets.token_urlsafe(18) + "1"
                user = User(
                    email=email, username=username, name=person.name, password_hash=hash_password(password)
                )
                db.add(user)
            elif reset_passwords and person.key in fixed:
                user.password_hash = hash_password(fixed[person.key])
                # 실제 비밀번호 재설정(password_reset.confirm_reset)처럼 옛 비밀번호로 연 세션도 끝낸다.
                db.execute(delete(SessionModel).where(SessionModel.user_id == user.user_id))
            users[person.key] = user
        db.flush()

        workspace = _find_workspace(db, users["p1"].user_id, workspace_name)
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
    try:
        res = http.request(method, API + path, headers=headers, **kwargs)
    except httpx.TransportError as error:
        raise SeedError(f"{method} {path} 를 보내지 못했습니다(API 서버 주소·실행 여부 확인): {error!r}") from error
    if not 200 <= res.status_code < 300:
        raise SeedError(f"{method} {path} 가 {res.status_code} 로 실패했습니다: {res.text[:300]}")
    try:
        body = res.json()
    except ValueError as error:
        raise SeedError(f"{method} {path} 응답이 JSON 이 아닙니다: {res.text[:300]}") from error
    if not isinstance(body, dict):
        raise SeedError(f"{method} {path} 응답이 Envelope 모양이 아닙니다: {res.text[:300]}")
    return body.get("data")


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
        .where(
            Meeting.workspace_id == workspace_id,
            Meeting.title == title,
            # 같은 제목의 업로드·채팅 회의는 시드가 만든 회의가 아니다
            Meeting.source == SEED_SOURCE,
            Meeting.deleted_at.is_(None),
        )
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
        # CLI 세션이 HTTP 호출·임베딩 대기 동안 읽기 트랜잭션을 열어 두지 않게 바로 닫는다
        db.rollback()
        if found is None:
            created = _call(
                http, "POST", "/meetings", service_token=service_token,
                headers={"X-Meeting-Lineage-Version": "1"},
                json={
                    "workspace_id": workspace_id, "title": meeting.title, "source": SEED_SOURCE,
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
            db.rollback()
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
        Meeting.source == SEED_SOURCE,
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
    db.rollback()
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
                    "임베딩 워커를 확인하세요(채워지기 전에는 다음 회의 항목이 auto 로 가지 않습니다). "
                    "키가 맞다면 임베딩 API 가 제목을 거절한 task·승인 카드(embedding_rejected_title 에 제목이 "
                    "있는 행)일 수 있습니다. 그 행은 다시 시도하지 않아 제목을 고치거나 지울 때까지 기다림이 끝나지 않습니다"
                )
            time.sleep(min(interval_s, remaining))

    return wait


# 종료 코드: 0 성공, 1 시드 실패(SeedError), 2 입력·환경 부족이나 기존 데이터 재사용 거절(아무것도 쓰지 않음), 3 성공했으나 gate 분포 경고
EXIT_OK, EXIT_FAILED, EXIT_USAGE, EXIT_GATE_WARNING = 0, 1, 2, 3


def _password(env_name: str, label: str) -> str:
    value = os.environ.get(env_name)
    if value:
        return value
    if sys.stdin.isatty():
        return getpass.getpass(f"{label} 비밀번호: ")
    raise SeedError(f"{env_name} 환경변수가 필요합니다(터미널이 아니면 입력을 받을 수 없습니다)")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli.seed_demo", description="심사용 시드(#606)")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API 호스트 루트(/api/v1 은 붙이지 않는다)")
    parser.add_argument("--email-pattern", required=True, help="{n} 이 1..6 으로 바뀌는 이메일 패턴")
    parser.add_argument("--workspace-name", default=None, help="공간 이름(기본은 시드 데이터 값)")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA_PATH)
    parser.add_argument(
        "--dry-run", action="store_true", help="DB 를 읽기만 해서 재사용할 계정·공간·회의를 출력하고 쓰지 않는다"
    )
    parser.add_argument("--embed-timeout", type=float, default=120, help="임베딩 대기 초(회의마다)")
    parser.add_argument("--reset-passwords", action="store_true", help="기존 계정 비밀번호도 다시 정한다")
    parser.add_argument(
        "--allow-existing", action="store_true", help="시드가 아닌 계정·자리·회의가 있어도 재사용한다"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        emails = emails_from_pattern(args.email_pattern)
    except SeedError as error:
        print(f"오류: {error}", file=sys.stderr)
        return EXIT_USAGE
    try:
        data = load_seed_data(args.data)
    except (SeedError, SeedDataError) as error:
        print(f"오류: {error}", file=sys.stderr)
        return EXIT_FAILED
    workspace_name = args.workspace_name or data.workspace_name
    try:
        pm_password = _password("DEMO_PM_PASSWORD", "PM")
        member_password = _password("DEMO_MEMBER_PASSWORD", "팀원2")
        for password in (pm_password, member_password):
            validate_password(password)
    except (SeedError, ValueError) as error:
        print(f"오류: {error}", file=sys.stderr)
        return EXIT_USAGE

    if args.dry_run:
        with SessionLocal() as db:
            existing = inspect_existing(db, data, emails=emails, workspace_name=workspace_name)
            db.rollback()
        print(f"공간 이름: {workspace_name}")
        print(f"시드 계정: {len(emails)}개 ({', '.join(emails)}), 그중 이미 있는 계정 {len(existing.reused_emails)}개")
        if existing.workspace_id is None:
            print("공간: 새로 만든다")
        else:
            print(f"공간: 기존 공간 재사용 ({existing.workspace_id}), 활성 자리 {existing.seats}개, 회의 {existing.meetings}개")
        print(f"재생할 회의 {len(data.meetings)}개:")
        for meeting in data.meetings:
            print(f"- {meeting.title}")
        problems = existing.problems()
        if problems and not args.allow_existing:
            for problem in problems:
                print(f"멈출 이유: {problem}", file=sys.stderr)
            print("실제 실행은 아무것도 쓰지 않고 멈춘다. 재사용하려면 --allow-existing 을 붙이세요", file=sys.stderr)
            return EXIT_USAGE
        return EXIT_OK

    service_token = os.environ.get("SERVICE_TOKEN")
    if not service_token:
        print("오류: SERVICE_TOKEN 환경변수가 필요합니다", file=sys.stderr)
        return EXIT_USAGE

    try:
        with SessionLocal() as db, httpx.Client(base_url=args.base_url, timeout=30) as http:
            seeded = seed_accounts(
                db,
                data,
                emails=emails,
                workspace_name=workspace_name,
                pm_password=pm_password,
                member2_password=member_password,
                reset_passwords=args.reset_passwords,
                allow_existing=args.allow_existing,
            )
            report = replay_meetings(
                http,
                db,
                seeded,
                data,
                service_token=service_token,
                wait_for_embeddings=poll_embeddings(SessionLocal, args.embed_timeout),
            )
    except SeedConflictError as error:
        print(f"오류: {error}", file=sys.stderr)
        return EXIT_USAGE
    except SeedError as error:
        print(f"오류: {error}", file=sys.stderr)
        return EXIT_FAILED

    print(json.dumps({"workspace_id": seeded.workspace_id, **asdict(report)}, ensure_ascii=False))
    missing = [gate for gate in ("auto", "review", "hold") if report.gates.get(gate, 0) == 0]
    if missing:
        print(
            f"경고: gate 가 0 건인 분류가 있습니다({', '.join(missing)}). 심사 시연에 세 분류가 모두 필요하면 "
            "API 서버의 AUTO_CREATE_ENABLED 가 켜져 있는지, 회의를 재생할 때 임베딩이 아직 없는 task·승인 대기 "
            "카드가 남아 있지 않았는지(서버 로그의 unsearched_task_exists·unsearched_pending_exists) 확인하세요",
            file=sys.stderr,
        )
        return EXIT_GATE_WARNING
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
