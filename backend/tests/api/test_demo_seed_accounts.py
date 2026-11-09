"""심사용 시드의 계정·공간·팀원·온보딩 단계(#606)."""
import dataclasses

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.cli.demo_seed import SeedPerson, load_seed_data
from app.cli.seed_demo import (
    ExistingState,
    SeedConflictError,
    SeedError,
    emails_from_pattern,
    inspect_existing,
    seed_accounts,
)
from app.cli.seed_demo import username_for as seed_username_for
from app.main import app
from tests.usernames import username_for
from app.models import (
    Meeting,
    Member,
    MemberAlias,
    OnboardingStep,
    OnboardingStepStatus,
    User,
    Workspace,
    WorkspaceOnboardingStepState,
)
from app.schemas.username import validate_username
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
    mdb.add(User(email=EMAILS[2], username=username_for(EMAILS[2]), name="기존", password_hash=hash_password("existing-pw-1")))
    mdb.add(User(email=EMAILS[0], username=username_for(EMAILS[0]), name="기존PM", password_hash=hash_password("old-pm-pw-1")))
    mdb.commit()

    _seed(mdb, allow_existing=True)

    assert mdb.scalar(select(func.count()).select_from(User)) == 6
    assert _login(EMAILS[2], "existing-pw-1")[1].status_code == 200
    assert _login(EMAILS[0], "old-pm-pw-1")[1].status_code == 200
    assert _login(EMAILS[0], PM_PW)[1].status_code == 401

    _seed(mdb, reset_passwords=True, allow_existing=True)
    assert _login(EMAILS[0], PM_PW)[1].status_code == 200


def test_reset_passwords_ends_existing_sessions(mdb):
    mdb.add(User(email=EMAILS[0], username=username_for(EMAILS[0]), name="기존PM", password_hash=hash_password("old-pm-pw-1")))
    mdb.commit()
    old_client, res = _login(EMAILS[0], "old-pm-pw-1")
    assert res.status_code == 200
    assert old_client.get("/api/v1/auth/me").status_code == 200

    _seed(mdb, reset_passwords=True, allow_existing=True)

    # 실제 비밀번호 재설정처럼 옛 비밀번호로 연 세션도 끝난다.
    assert old_client.get("/api/v1/auth/me").status_code == 401


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
    pm = User(email=EMAILS[0], username=username_for(EMAILS[0]), name="다른이름", password_hash=hash_password(PM_PW))
    mdb.add(pm)
    mdb.flush()
    workspace = Workspace(name=NAME)
    mdb.add(workspace)
    mdb.flush()
    mdb.add(Member(workspace_id=workspace.workspace_id, user_id=pm.user_id, display_name="다른이름", role="pm"))
    mdb.commit()

    _seed(mdb, allow_existing=True)
    members_after_first = mdb.scalar(select(func.count()).select_from(Member))
    _seed(mdb, allow_existing=True)

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


def _snapshot(db):
    steps = [(s.workspace_id, s.step, s.status) for s in db.scalars(select(WorkspaceOnboardingStepState)).all()]
    return _counts(db), db.scalar(select(func.count()).select_from(Meeting)), sorted(steps)


def test_existing_user_with_other_name_stops_without_writing(mdb):
    mdb.add(User(email=EMAILS[0], username=username_for(EMAILS[0]), name="실제PM", password_hash=hash_password("real-pm-pw-1")))
    mdb.commit()
    before = _snapshot(mdb)

    with pytest.raises(SeedConflictError) as error:
        _seed(mdb, reset_passwords=True)

    assert EMAILS[0] in str(error.value)
    assert _snapshot(mdb) == before
    assert _login(EMAILS[0], "real-pm-pw-1")[1].status_code == 200


def test_foreign_seat_in_found_workspace_stops_without_writing(mdb):
    seeded = _seed(mdb)
    outsider = User(email="real@example.com", username=username_for("real@example.com"), name="실제팀원", password_hash=hash_password("real-pw-1"))
    mdb.add(outsider)
    mdb.flush()
    mdb.add(Member(workspace_id=seeded.workspace_id, user_id=outsider.user_id, display_name="실제팀원", role="member"))
    for state in mdb.scalars(select(WorkspaceOnboardingStepState)).all():
        state.status = OnboardingStepStatus.PENDING
    mdb.commit()
    before = _snapshot(mdb)

    with pytest.raises(SeedConflictError) as error:
        _seed(mdb)

    assert "실제팀원" in str(error.value)
    assert _snapshot(mdb) == before

    _seed(mdb, allow_existing=True)
    assert mdb.scalar(select(func.count()).select_from(Member).where(Member.workspace_id == seeded.workspace_id)) == 7


def test_seat_with_seed_name_linked_to_outsider_stops(mdb):
    data = load_seed_data()
    seeded = _seed(mdb)
    outsider = User(email="real@example.com", username=username_for("real@example.com"), name="실제팀원", password_hash=hash_password("real-pw-1"))
    mdb.add(outsider)
    mdb.flush()
    p3 = mdb.get(Member, seeded.member_ids["p3"])
    p3_name = next(person.name for person in data.people if person.key == "p3")
    # p3 자리를 지우고 같은 이름의 자리를 시드 밖 계정에 잇는다
    p3.is_deleted = True
    mdb.add(Member(workspace_id=seeded.workspace_id, user_id=outsider.user_id, display_name=p3_name, role="member"))
    mdb.commit()

    with pytest.raises(SeedConflictError):
        _seed(mdb)


def test_member2_seat_linked_after_invite_is_still_seed(mdb):
    seeded = _seed(mdb)
    joined = User(email="m2-real@example.com", username=username_for("m2-real@example.com"), name="합류한팀원", password_hash=hash_password("m2-real-pw-1"))
    mdb.add(joined)
    mdb.flush()
    mdb.get(Member, seeded.member_ids["p2"]).user_id = joined.user_id
    mdb.commit()

    assert _seed(mdb).workspace_id == seeded.workspace_id


def test_non_seed_meeting_in_found_workspace_stops(mdb):
    seeded = _seed(mdb)
    mdb.add(Meeting(workspace_id=seeded.workspace_id, title="실제 주간 회의", source="discord"))
    mdb.commit()

    with pytest.raises(SeedConflictError) as error:
        _seed(mdb)
    assert "회의 1개" in str(error.value)


def test_inspect_existing_reports_reuse(mdb):
    data = load_seed_data()
    assert inspect_existing(mdb, data, emails=EMAILS, workspace_name=NAME) == ExistingState()

    seeded = _seed(mdb)
    state = inspect_existing(mdb, data, emails=EMAILS, workspace_name=NAME)

    assert state.workspace_id == seeded.workspace_id
    assert len(state.reused_emails) == 6
    assert state.seats == 6
    assert state.problems() == []


def test_seeded_accounts_get_rule_following_unique_usernames(mdb):
    seeded = _seed(mdb)

    users = [mdb.get(User, seeded.user_ids[f"p{n}"]) for n in range(1, 7)]
    for n, user in enumerate(users, start=1):
        assert user.username == seed_username_for(n, EMAILS[n - 1])
        assert validate_username(user.username) == user.username
    pm, _ = _login(EMAILS[0], PM_PW)
    assert pm.get("/api/v1/auth/me").json()["data"]["user"]["username"] == users[0].username


def test_seed_username_taken_by_other_account_stops(mdb):
    taken = seed_username_for(1, EMAILS[0])
    mdb.add(User(email="other@example.com", username=taken, name="다른사람", password_hash=hash_password("other-pw-1")))
    mdb.commit()

    with pytest.raises(SeedError, match=taken):
        _seed(mdb)

    assert mdb.scalar(select(func.count()).select_from(User)) == 1
