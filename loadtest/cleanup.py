"""부하테스트 계정·공간을 지운다. api 컨테이너 안에서 돈다: docker compose exec -T -e LT_PASSWORD api python - < cleanup.py

제품 경로만 쓴다. PM 이 팀원을 명단에서 빼고(DELETE /members/{id}) 탈퇴하면(DELETE /auth/me) 혼자 남은 공간이 지워진다.
남은 테스트 계정(공간 없는 팀원 계정)은 탈퇴 서비스로 지운다. 대상은 이메일이 lt-w<n>-p<n>@example.com 인 계정뿐이다.
"""
import os
import re
import secrets
import sys

import httpx
from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models import Member, MemberRole, User, Workspace
from app.services import account_withdrawal

API = "http://localhost:8000/api/v1"
PATTERN = re.compile(r"^lt-w\d+-p\d+@example\.com$")


def test_users(db) -> list[User]:
    return [u for u in db.scalars(select(User).where(User.email.like("lt-w%-p%@example.com"))) if PATTERN.match(u.email)]


def remove_workspace(http: httpx.Client, pm: User, workspace_id: str, member_ids: list[str]) -> None:
    res = http.post(f"{API}/auth/login", json={"email": pm.email, "password": os.environ["LT_PASSWORD"]})
    res.raise_for_status()
    cookie = {"Cookie": f"session_token={res.cookies['session_token']}"}
    for member_id in member_ids:
        http.delete(f"{API}/members/{member_id}", headers=cookie).raise_for_status()
    http.delete(f"{API}/auth/me", headers={
        **cookie, "X-Withdrawal-Key": secrets.token_hex(32), "X-Withdrawal-Account-Id": pm.user_id,
    }).raise_for_status()


def main() -> int:
    with SessionLocal() as db, httpx.Client(timeout=30) as http:
        users = {u.user_id: u for u in test_users(db)}
        pm_rows = db.execute(
            select(Member.workspace_id, Member.user_id)
            .where(Member.user_id.in_(users), Member.role == MemberRole.PM, Member.is_deleted.is_(False))
        ).all()
        for workspace_id, pm_id in pm_rows:
            others = list(db.scalars(select(Member.member_id).where(
                Member.workspace_id == workspace_id, Member.is_deleted.is_(False), Member.user_id.is_distinct_from(pm_id),
            )))
            db.rollback()
            remove_workspace(http, users[pm_id], workspace_id, others)
            print(f"공간 {workspace_id} 삭제 요청, 팀원 {len(others)}명 제외")
        for user in test_users(db):
            user_id = user.user_id
            db.rollback()
            account_withdrawal.withdraw(db, user_id, secrets.token_hex(32))
        left_users = len(test_users(db))
        left_spaces = db.scalar(select(func.count()).select_from(Workspace).where(
            Workspace.name.like("부하 공간%"), Workspace.deleted_at.is_(None)))
    print(f"남은 테스트 계정 {left_users}개, 남은 부하 공간 {left_spaces}개")
    return 0 if left_users == 0 and left_spaces == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
