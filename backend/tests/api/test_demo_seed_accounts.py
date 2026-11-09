"""심사용 시드의 계정·공간·팀원·온보딩 단계(#606)."""
import dataclasses

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.cli.demo_seed import SeedPerson, load_seed_data
from app.cli.seed_demo import SeedError, emails_from_pattern, seed_accounts
from app.main import app
from app.models import (
    Member,
    MemberAlias,
    OnboardingStep,
    OnboardingStepStatus,
    User,
    Workspace,
    WorkspaceOnboardingStepState,
)
from app.services.passwords import hash_password

PM_PW = "demo-pm-1234"
M2_PW = "demo-m2-1234"
EMAILS = [f"demo+{n}@example.com" for n in range(1, 7)]
NAME = "심사용 테스트 팀"


def _seed(db, **kwargs):
    options = {"emails": EMAILS, "workspace_name": NAME, "pm_password": PM_PW, "member2_password": M2_PW}
    options.update(kwargs)
    return seed_accounts(db, load_seed_data(), **options)


def _login(email, password):
    client = TestClient(app, base_url="https://testserver")
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return client, res


def _counts(db):
    return [db.scalar(select(func.count()).select_from(model)) for model in (User, Workspace, Member, MemberAlias)]


def test_seed_creates_six_logins_and_pm(mdb):
    seeded = _seed(mdb)

    assert _login(EMAILS[0], PM_PW)[1].status_code == 200
    assert _login(EMAILS[1], M2_PW)[1].status_code == 200
    members = mdb.scalars(select(Member).where(Member.workspace_id == seeded.workspace_id)).all()
    by_id = {m.member_id: m for m in members}
    assert len(members) == 6
    assert by_id[seeded.member_ids["p1"]].role == "pm"
    assert by_id[seeded.member_ids["p1"]].user_id == seeded.user_ids["p1"]
    assert by_id[seeded.member_ids["p2"]].user_id is None
    for key in ("p3", "p4", "p5", "p6"):
        assert by_id[seeded.member_ids[key]].role == "member"
        assert by_id[seeded.member_ids[key]].user_id == seeded.user_ids[key]


def test_pm_can_invite_member2_and_member2_accepts(mdb):
    seeded = _seed(mdb)
    pm, _ = _login(EMAILS[0], PM_PW)
    invited = pm.post(
        f"/api/v1/workspaces/{seeded.workspace_id}/invitations",
        json={"member_id": seeded.member_ids["p2"], "email": EMAILS[1]},
    )
    assert invited.status_code == 201

    second, _ = _login(EMAILS[1], M2_PW)
    mine = second.get("/api/v1/invitations/me").json()["data"]
    items = mine["items"] if isinstance(mine, dict) else mine
    assert len(items) == 1
    accepted = second.post(f"/api/v1/invitations/{items[0]['invitation_id']}/accept")
    assert accepted.status_code == 200


def test_onboarding_completed(mdb):
    seeded = _seed(mdb)
    pm, _ = _login(EMAILS[0], PM_PW)

    data = pm.get("/api/v1/workspaces").json()["data"]
    items = data["items"] if isinstance(data, dict) else data
    row = next(w for w in items if w["workspace_id"] == seeded.workspace_id)
    assert row["onboarding"]["completed"] is True


def test_seed_accounts_is_idempotent(mdb):
    first = _seed(mdb)
    before = _counts(mdb)

    second = _seed(mdb)

    assert _counts(mdb) == before
    assert second.workspace_id == first.workspace_id
    assert second.member_ids == first.member_ids


def test_existing_user_is_reused_without_password_change(mdb):
    mdb.add(User(email=EMAILS[2], name="기존", password_hash=hash_password("existing-pw-1")))
    mdb.add(User(email=EMAILS[0], name="기존PM", password_hash=hash_password("old-pm-pw-1")))
    mdb.commit()

    _seed(mdb)

    assert mdb.scalar(select(func.count()).select_from(User)) == 6
    assert _login(EMAILS[2], "existing-pw-1")[1].status_code == 200
    assert _login(EMAILS[0], "old-pm-pw-1")[1].status_code == 200
    assert _login(EMAILS[0], PM_PW)[1].status_code == 401

    _seed(mdb, reset_passwords=True)
    assert _login(EMAILS[0], PM_PW)[1].status_code == 200


def test_invalid_password_writes_nothing(mdb):
    with pytest.raises(SeedError):
        _seed(mdb, pm_password="short")

    assert mdb.scalar(select(func.count()).select_from(User)) == 0


def test_email_pattern_requires_placeholder():
    with pytest.raises(SeedError):
        emails_from_pattern("demo@x.com")
    assert emails_from_pattern("a+{n}@x.com") == [f"a+{n}@x.com" for n in range(1, 7)]


def test_member2_password_invalid_writes_nothing(mdb):
    with pytest.raises(SeedError):
        _seed(mdb, member2_password="short")

    assert mdb.scalar(select(func.count()).select_from(User)) == 0


def test_existing_pm_seat_with_other_name_is_reused(mdb):
    pm = User(email=EMAILS[0], name="다른이름", password_hash=hash_password(PM_PW))
    mdb.add(pm)
    mdb.flush()
    workspace = Workspace(name=NAME)
    mdb.add(workspace)
    mdb.flush()
    mdb.add(Member(workspace_id=workspace.workspace_id, user_id=pm.user_id, display_name="다른이름", role="pm"))
    mdb.commit()

    _seed(mdb)
    members_after_first = mdb.scalar(select(func.count()).select_from(Member))
    _seed(mdb)

    seats = mdb.scalars(select(Member).where(Member.user_id == pm.user_id, Member.is_deleted.is_(False))).all()
    assert len(seats) == 1
    assert mdb.scalar(select(func.count()).select_from(Member)) == members_after_first == 6


def test_pending_onboarding_rows_become_skipped(mdb):
    seeded = _seed(mdb)
    for state in mdb.scalars(select(WorkspaceOnboardingStepState)).all():
        if state.step != OnboardingStep.CREATE_WORKSPACE:
            state.status = OnboardingStepStatus.PENDING
    mdb.get(Workspace, seeded.workspace_id).onboarding_completed = False
    mdb.commit()

    _seed(mdb)

    pm, _ = _login(EMAILS[0], PM_PW)
    data = pm.get("/api/v1/workspaces").json()["data"]
    items = data["items"] if isinstance(data, dict) else data
    assert next(w for w in items if w["workspace_id"] == seeded.workspace_id)["onboarding"]["completed"] is True


def test_reused_seat_gets_name_aliases_without_duplicates(mdb):
    seeded = _seed(mdb)
    p3 = seeded.member_ids["p3"]

    def count():
        return mdb.scalar(select(func.count()).select_from(MemberAlias).where(MemberAlias.member_id == p3))

    first = count()
    assert first > 0
    for alias in mdb.scalars(select(MemberAlias).where(MemberAlias.member_id == p3)).all():
        mdb.delete(alias)
    mdb.commit()
    assert count() == 0

    _seed(mdb)
    assert count() == first
    _seed(mdb)
    assert count() == first


def test_invalid_person_name_writes_nothing(mdb):
    data = load_seed_data()
    bad = dataclasses.replace(data, people=[SeedPerson(key="p1", name="  "), *data.people[1:]])

    with pytest.raises(SeedError):
        seed_accounts(
            mdb, bad, emails=EMAILS, workspace_name=NAME, pm_password=PM_PW, member2_password=M2_PW
        )

    assert mdb.scalar(select(func.count()).select_from(User)) == 0
