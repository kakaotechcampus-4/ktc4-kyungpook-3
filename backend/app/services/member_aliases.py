"""팀원 이름과 디스코드 닉네임에서 담당자 별칭을 자동으로 만든다 (#459).

이름 별칭은 source=display_name, verified=True, confidence=1.0 이다. 닉네임 별칭은 source=discord_profile,
alias_type=nickname, verified=False, confidence=0.8 이고 한글만으로 된 서버 별명·표시 이름만 쓴다. 사람이 정한(manual·learned)
별칭과 같은 글자는 자동으로 넣지 않는다. 자동끼리 겹치면 둘 다 넣어 매칭이 ambiguous 가 되게 한다.
"""
import logging
import os
import re

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import AliasSource, AliasType, Integration, Member, MemberAlias
from app.services import discord

logger = logging.getLogger(__name__)

NAME_ALIAS_CONFIDENCE = 1.0
# 디스코드 닉네임은 사람이 확인하지 않은 값이라 이름 별칭보다 낮게 둔다.
NICKNAME_ALIAS_CONFIDENCE = 0.8
# 팀원 등록 요청 안에서 Discord 를 부르므로 오래 기다리지 않는다.
DISCORD_LOOKUP_TIMEOUT = 3.0

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


def sync_name_aliases(
    db: Session,
    member: Member,
    old_display_name: str | None = None,
    only_texts: set[str] | None = None,
) -> None:
    """팀원 이름에 맞춰 source=display_name 별칭을 맞춘다. 커밋도 flush 도 하지 않는다.

    old_display_name 이 있으면 이름이 바뀐 것이므로 새 꼴에 없는 display_name 별칭을 지운다. 새 별칭은
    member.aliases 에 붙여 팀원과 한 커밋으로 들어가게 한다. 새 팀원을 먼저 flush 하면 디스코드 계정 유일
    위반이 호출한 쪽의 409 처리 밖에서 터진다. manual·learned·discord_profile 별칭은 건드리지 않는다.

    only_texts 가 있으면 이름 꼴 중 그 글자만 채운다. 이름은 그대로인데 닉네임 별칭만 지운 경우, 닉네임과 겹쳐
    건너뛴 꼴만 채우고 PM 이 지운 다른 이름 별칭은 되살리지 않기 위해서다.
    """
    # 조회 autoflush 가 대기 중인 팀원 변경을 먼저 내보내지 않게 한다(위 설명 참고).
    with db.no_autoflush:
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
            if only_texts is not None and text not in only_texts:
                continue
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


def pick_discord_nickname(guild_member: dict) -> str | None:
    """디스코드 서버 사용자 정보에서 별칭으로 쓸 닉네임을 고른다. 한글만으로 된 첫 값, 없으면 None.

    서버 별명(nick) → 계정 표시 이름(global_name) 순으로 본다. 사용자 이름(username)은 보지 않는다.
    """
    user = guild_member.get("user")
    candidates = [guild_member.get("nick"), user.get("global_name") if isinstance(user, dict) else None]
    for value in candidates:
        if isinstance(value, str) and re.fullmatch(r"[가-힣]+", value.strip()):
            return value.strip()
    return None


def remove_discord_profile_aliases(db: Session, member: Member) -> set[str]:
    """팀원의 discord_profile 별칭을 모두 지우고 지운 글자의 집합을 돌려준다. 디스코드 계정이 바뀌거나 풀릴 때 쓴다.
    커밋하지 않는다.

    지운 행을 바로 flush 한다. 앱 세션은 autoflush 가 꺼져 있어, 안 하면 뒤따르는 sync_name_aliases 가 이미 지워질
    행을 아직 있는 것으로 보고 같은 글자의 이름 별칭을 건너뛴다. 값을 바꾸기 전이라 flush 되는 것은 삭제뿐이다.
    """
    rows = db.execute(
        select(MemberAlias).where(
            MemberAlias.member_id == member.member_id,
            MemberAlias.source == str(AliasSource.DISCORD_PROFILE),
        )
    ).scalars()
    removed: set[str] = set()
    for alias in list(rows):
        removed.add(alias.alias_text)
        db.delete(alias)
    db.flush()
    return removed


def add_discord_nickname_alias(
    db: Session, workspace_id: str, member_id: str, discord_user_id: str
) -> None:
    """디스코드 서버 닉네임을 팀원의 별칭으로 넣는다. 팀원 커밋 뒤에 부르며 모든 실패를 삼킨다.

    Discord 를 부르는 동안 DB 트랜잭션을 잡지 않도록 서버 ID 를 읽고 커밋해 트랜잭션을 닫은 뒤 부른다.
    토큰·주소는 로그에 남기지 않는다.
    """
    token = os.getenv("DISCORD_BOT_TOKEN", "")
    if not token:
        logger.warning("DISCORD_BOT_TOKEN이 없어 디스코드 닉네임 별칭을 넣지 못했습니다 (workspace_id=%s)", workspace_id)
        return
    guild_id = db.execute(
        select(Integration.provider_channel_id).where(
            Integration.workspace_id == workspace_id, Integration.provider == "discord"
        )
    ).scalar_one_or_none()
    db.commit()
    if not guild_id:
        logger.warning("Discord 서버가 연결되지 않아 닉네임 별칭을 넣지 못했습니다 (workspace_id=%s)", workspace_id)
        return

    try:
        guild_member = discord.get_guild_member(
            token, guild_id, discord_user_id, timeout=DISCORD_LOOKUP_TIMEOUT
        )
    except discord.DiscordApiError as exc:
        logger.warning(
            "디스코드 닉네임을 읽지 못했습니다 (workspace_id=%s, status=%s)", workspace_id, exc.status_code
        )
        return

    nickname = pick_discord_nickname(guild_member)
    if nickname is None:
        return
    # Discord 를 기다리는 동안 다른 요청이 계정을 바꾸거나 팀원을 지웠을 수 있다. 지금도 그 계정이면 넣는다.
    still_linked = db.execute(
        select(Member.member_id).where(
            Member.member_id == member_id,
            Member.discord_user_id == discord_user_id,
            Member.is_deleted.is_(False),
        )
    ).first()
    if still_linked is None:
        return
    held = db.execute(
        select(MemberAlias.alias_id).where(
            MemberAlias.member_id == member_id, MemberAlias.alias_text == nickname
        ).limit(1)
    ).first()
    if held is not None or _taken_by_other(db, workspace_id, member_id, nickname):
        return
    db.add(
        MemberAlias(
            workspace_id=workspace_id,
            member_id=member_id,
            alias_text=nickname,
            alias_type=AliasType.NICKNAME,
            source=AliasSource.DISCORD_PROFILE,
            confidence=NICKNAME_ALIAS_CONFIDENCE,
            verified=False,
        )
    )
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.warning("디스코드 닉네임 별칭을 저장하지 못했습니다 (workspace_id=%s)", workspace_id)
