"""심사용 시드: 계정·공간·팀원 자리·온보딩 단계를 DB 에 만든다(#606). 다시 실행해도 같은 결과다."""
import secrets
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.workspaces import _build_onboarding
from app.cli.demo_seed import SeedData
from app.models import (
    Member,
    MemberRole,
    OnboardingStep,
    OnboardingStepStatus,
    User,
    Workspace,
    WorkspaceOnboardingStepState,
)
from app.schemas.auth import validate_password
from app.schemas.email import normalize_email
from app.schemas.name import validate_name
from app.services.member_aliases import sync_name_aliases
from app.services.passwords import hash_password

PERSON_COUNT = 6


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
