"""팀원 이름에서 담당자 별칭을 자동으로 만든다 (#459).

이름 별칭은 source=display_name, verified=True, confidence=1.0 이다. 사람이 정한(manual·learned)
별칭과 같은 글자는 자동으로 넣지 않는다. 자동끼리 겹치면 둘 다 넣어 매칭이 ambiguous 가 되게 한다.
"""
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AliasSource, AliasType, Member, MemberAlias

NAME_ALIAS_CONFIDENCE = 1.0

# 같은 글자를 이 출처가 다른 팀원에게 있으면 자동 별칭을 넣지 않는다.
AUTO_SOURCES_BLOCKED_BY = (AliasSource.MANUAL, AliasSource.LEARNED)


def name_alias_forms(display_name: str | None) -> list[str]:
    """팀원 이름에서 별칭으로 넣을 꼴을 [전체 이름, 성 뗀 이름] 로 돌려준다.

    ai/stt/backend.py 의 member_forms 와 같은 규칙이다(님 꼴은 넣지 않는다). 한글 두 글자 이상인 이름만 쓰고,
    네 글자는 앞 두 글자를, 그 외에는 첫 글자를 성으로 뗀다. 한글이 아니면 빈 목록이다.
    """
    name = (display_name or "").strip()
    if not re.fullmatch(r"[가-힣]{2,}", name):
        return []
    given = name[2:] if len(name) == 4 else name[1:]
    return [name, given]


def _taken_by_other(db: Session, workspace_id: str, member_id: str | None, text: str) -> bool:
    """탈퇴하지 않은 다른 팀원이 사람이 정한(manual·learned) 같은 글자의 별칭을 갖고 있는가."""
    stmt = (
        select(MemberAlias.alias_id)
        .join(Member, Member.member_id == MemberAlias.member_id)
        .where(
            MemberAlias.workspace_id == workspace_id,
            MemberAlias.alias_text == text,
            MemberAlias.source.in_([str(s) for s in AUTO_SOURCES_BLOCKED_BY]),
            Member.is_deleted.is_(False),
        )
    )
    if member_id is not None:
        stmt = stmt.where(MemberAlias.member_id != member_id)
    return db.execute(stmt.limit(1)).first() is not None


def sync_name_aliases(db: Session, member: Member, old_display_name: str | None = None) -> None:
    """팀원 이름에 맞춰 source=display_name 별칭을 맞춘다. 커밋도 flush 도 하지 않는다.

    old_display_name 이 있으면 이름이 바뀐 것이므로 새 꼴에 없는 display_name 별칭을 지운다. 새 별칭은
    member.aliases 에 붙여 팀원과 한 커밋으로 들어가게 한다. 새 팀원을 먼저 flush 하면 디스코드 계정 유일
    위반이 호출한 쪽의 409 처리 밖에서 터진다. manual·learned·discord_profile 별칭은 건드리지 않는다.
    """
    forms = name_alias_forms(member.display_name)

    existing: list[MemberAlias] = []
    if member.member_id is not None:
        existing = list(
            db.execute(select(MemberAlias).where(MemberAlias.member_id == member.member_id)).scalars()
        )
    if old_display_name is not None:
        for alias in existing:
            if alias.source == AliasSource.DISPLAY_NAME and alias.alias_text not in forms:
                db.delete(alias)
    own_texts = {alias.alias_text for alias in existing}

    for text in forms:
        if text in own_texts or _taken_by_other(db, member.workspace_id, member.member_id, text):
            continue
        member.aliases.append(
            MemberAlias(
                workspace_id=member.workspace_id,
                alias_text=text,
                alias_type=AliasType.REALNAME,
                source=AliasSource.DISPLAY_NAME,
                confidence=NAME_ALIAS_CONFIDENCE,
                verified=True,
            )
        )
