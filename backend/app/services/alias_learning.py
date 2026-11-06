"""승인 때 별칭 학습(#459)에 쓰는 규칙과 조회·저장 함수 모음.

추출 항목을 승인할 때 사용자가 담당자를 직접 골랐다면, 발화에 적힌 담당자 표현("하은이가",
STT 가 잘못 받아 적은 "화은이가")을 그 멤버의 별칭으로 저장해 다음 회의부터 자동으로 매칭되게 한다. 이 모듈에는
저장할 글자를 다듬고 학습 대상을 가리는 규칙(상수·trim_alias_text·learnable_alias_text)과,
승인 응답에 후보를 채우려고 DB 를 읽는 함수(approval_alias_texts·taken_alias_texts), 승인하며
별칭을 저장하는 함수(learn_alias)가 함께 있다. 요청 처리 흐름과 권한 확인은 API 쪽이 맡는다.
"""
import logging
from collections.abc import Collection, Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    AliasSource,
    AliasType,
    ApprovalRequest,
    ApprovalStatus,
    ApprovalType,
    ExtractionAction,
    ExtractionItem,
    Member,
    MemberAlias,
)

logger = logging.getLogger(__name__)

# 추출 단계가 붙이는 담당자 표현 유형. 이 목록에 없는 값은 NULL 로 저장한다(storable_assignee_type).
KNOWN_ASSIGNEE_TYPES = frozenset(
    {"first", "second", "thirdname", "thirdpronoun", "thirdrole", "group", "none"}
)

# 별칭으로 배울 유형은 이름처럼 그 사람을 가리키는 표현뿐이다. "나"·"너"·"그"·"우리"
# 같은 말은 말하는 사람과 문맥에 따라 가리키는 대상이 달라서 저장하면 엉뚱한 사람에 붙는다.
# 역할 지목(thirdrole)은 #459 에서 배우기로 했지만 지금은 뺀다. AI 가 역할 원문("BE 리더가")은 빼고 문맥으로
# 추측한 이름("환")이 있으면 그것을 assignee_raw 로 보내는데(ai/capture/handoff.py, ai/judge/pipeline.py),
# BE 는 원문과 추측을 구분할 수 없어 추측한 이름이 확인된 별칭이 될 수 있다(#464 리뷰). AI 가 역할 원문을
# 보내고 추측 이름을 보내지 않게 되면 다시 넣는다.
LEARNABLE_ASSIGNEE_TYPES = frozenset({"thirdname"})

# 사용자가 승인하며 확인한 별칭이라 자동 추정(AI·규칙)보다 높게 두되, 1.0 은 남겨 둔다.
LEARNED_CONFIDENCE = 0.9

# 긴 것부터 비교해 첫 일치만 뗀다("이가"를 "가"보다 먼저). "은"은 "하은"처럼 이름 끝 글자와
# 같아서 떼면 이름이 깨지므로 목록에 두지 않는다.
_TRAILING_PARTICLES = ("께서", "한테", "에게", "이가", "가", "이", "는", "을", "를", "께")
_HONORIFIC = "님"


def trim_alias_text(raw: str | None) -> str | None:
    """발화에 적힌 담당자 표현에서 끝 조사와 "님"을 떼어 별칭으로 저장할 글자를 만든다.

    순서는 앞뒤 공백, 끝 조사 한 번, 끝 "님" 한 번, 연속 공백 정리다. 남는 글자가 없으면 None.
    """
    if raw is None:
        return None
    text = raw.strip()
    for particle in _TRAILING_PARTICLES:
        if text.endswith(particle):
            text = text[: -len(particle)]
            break
    text = text.strip()
    if text.endswith(_HONORIFIC):
        text = text[: -len(_HONORIFIC)]
    text = " ".join(text.split())
    return text or None


def storable_assignee_type(value: str | None) -> str | None:
    """추출 항목에 저장할 담당자 종류. 알려진 값이 아니면 None 으로 저장한다.

    AI 가 새 종류를 보내거나 값이 이상해도 추출 등록은 받아야 해서(봇이 재시도하다 회의 전체가 반영되지
    않는다) 요청을 거절하지 않고, 학습 대상이 아닌 항목으로 남긴다. 버린 값은 경고로 남긴다.
    """
    if value is None:
        return None
    if value in KNOWN_ASSIGNEE_TYPES:
        return value
    logger.warning("알 수 없는 assignee_type 이라 저장하지 않습니다. value=%.40r", value)
    return None


def learnable_alias_text(item: ExtractionItem) -> str | None:
    """이 항목의 담당자 표현을 별칭으로 배울 수 있으면 저장될 글자, 아니면 None.

    새 task 를 만드는 항목인데 담당자를 못 찾았고, 표현이 이름 지목일 때만 대상이다(LEARNABLE_ASSIGNEE_TYPES). 승인 상태는
    보지 않는다. pending 인지는 호출하는 쪽이 이미 가진 승인 상태로 거른다.
    """
    if (
        item.action != ExtractionAction.CREATE
        or item.assignee_member_id is not None
        or item.assignee_type not in LEARNABLE_ASSIGNEE_TYPES
    ):
        return None
    return trim_alias_text(item.assignee_raw)


def approval_alias_texts(db: Session, approvals: Sequence[ApprovalRequest]) -> dict[str, str]:
    """pending 생성 승인 중 별칭을 배울 수 있는 것의 {approval_id: 저장될 글자}.

    승인 목록 응답에 alias_candidate 를 채우려고 쓴다. 항목은 approval_id 로 한 번에 읽어 승인마다 쿼리하지 않는다.
    """
    pending_ids = [
        a.approval_id
        for a in approvals
        if a.status == str(ApprovalStatus.PENDING) and a.type == str(ApprovalType.TASK_CREATE)
    ]
    if not pending_ids:
        return {}
    items = db.execute(select(ExtractionItem).where(ExtractionItem.approval_id.in_(pending_ids))).scalars()
    texts: dict[str, str] = {}
    for item in items:
        text = learnable_alias_text(item)
        if text is not None:
            texts[item.approval_id] = text
    if not texts:
        return {}
    # 이미 누군가 가진 글자는 묻지 않는다. 워크스페이스마다 한 번씩만 조회한다
    workspace_of = {a.approval_id: a.workspace_id for a in approvals}
    texts_by_workspace: dict[str, set[str]] = {}
    for approval_id, text in texts.items():
        texts_by_workspace.setdefault(workspace_of[approval_id], set()).add(text)
    taken = {
        (workspace_id, text)
        for workspace_id, workspace_texts in texts_by_workspace.items()
        for text in taken_alias_texts(db, workspace_id, workspace_texts)
    }
    return {
        approval_id: text for approval_id, text in texts.items() if (workspace_of[approval_id], text) not in taken
    }


def taken_alias_texts(db: Session, workspace_id: str, texts: Collection[str]) -> set[str]:
    """texts 중 이 워크스페이스에서 탈퇴하지 않은 누군가가 이미 별칭으로 가진 글자들.

    다른 팀원이 가진 글자를 또 배우면 두 사람이 같은 글자를 갖게 되어, resolve_assignee 가 AMBIGUOUS 로
    판정해 원래 팀원 항목까지 hold 로 떨어진다. 탈퇴한 팀원의 별칭은 세지 않는다. 담당자를 찾을 때도(#463
    resolve_assignee) 보지 않으므로, 세면 그 글자는 PM 이 탈퇴자 별칭을 지울 때까지 배울 수 없다(#464 리뷰).
    탈퇴자 별칭은 지우지 않고 두며, PM 이 별칭 관리(DELETE /members/aliases/{id})에서 지울 수 있다.
    """
    if not texts:
        return set()
    return set(db.scalars(
        select(MemberAlias.alias_text)
        .join(Member, Member.member_id == MemberAlias.member_id)
        .where(
            MemberAlias.workspace_id == workspace_id,
            MemberAlias.alias_text.in_(texts),
            Member.is_deleted.is_(False),
        )
    ))


def _alias_taken(db: Session, workspace_id: str, alias_text: str) -> bool:
    return bool(taken_alias_texts(db, workspace_id, [alias_text]))


def learn_alias(db: Session, *, workspace_id: str, member_id: str, alias_text: str) -> bool:
    """승인하며 고른 담당자에게 별칭을 저장한다. 저장했으면 True, 이미 누가 가진 글자라 넘어가면 False.

    같은 글자를 다른 팀원이 가졌으면 저장하지 않는다(taken_alias_texts). 이 별칭은 덤이라 실패해도 승인을 막으면 안 된다. 같은 별칭이 동시에 들어와 유니크 제약에 걸리면
    savepoint 만 되돌리고 넘어간다. savepoint 앞에서 flush 하는 이유는, 그 전에 남은 task·이력 flush 오류가
    아래 IntegrityError 와 섞여 별칭 중복으로 잘못 삼켜지지 않게 하려는 것이다.
    """
    if _alias_taken(db, workspace_id, alias_text):
        return False
    db.flush()
    try:
        with db.begin_nested():
            db.add(MemberAlias(
                workspace_id=workspace_id,
                member_id=member_id,
                alias_text=alias_text,
                alias_type=AliasType.NICKNAME,
                source=AliasSource.LEARNED,
                confidence=LEARNED_CONFIDENCE,
                verified=True,
            ))
            db.flush()
    except IntegrityError:
        return False
    logger.info("승인으로 별칭을 학습했습니다. workspace=%s member=%s", workspace_id, member_id)
    return True
