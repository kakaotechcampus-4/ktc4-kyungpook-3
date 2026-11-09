"""승인 때 별칭 학습(#459)에 쓰는 규칙과 조회·저장 함수 모음.

추출 항목을 승인할 때 사용자가 담당자를 직접 골랐다면, 발화에 적힌 담당자 표현("하은이가",
STT 가 잘못 받아 적은 "화은이가")을 그 멤버의 별칭으로 저장해 다음 회의부터 자동으로 매칭되게 한다. 이 모듈에는
저장할 글자를 다듬고 학습 대상을 가리는 규칙(상수·trim_alias_text·learnable_alias_text)과,
승인 응답에 후보를 채우려고 DB 를 읽는 함수(approval_alias_texts·taken_alias_texts), 승인하며
별칭을 저장하는 함수(learn_alias)가 함께 있다. 요청 처리 흐름과 권한 확인은 API 쪽이 맡는다.
"""
import json
import logging
import re
from collections.abc import Collection, Iterable, Sequence

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
from app.services.matching import name_candidates
from app.services.pending_merge import assignee_item_of

logger = logging.getLogger(__name__)

# 추출 단계가 붙이는 담당자 표현 유형. 이 목록에 없는 값은 NULL 로 저장한다(storable_assignee_type).
KNOWN_ASSIGNEE_TYPES = frozenset(
    {"first", "second", "thirdname", "thirdpronoun", "thirdrole", "group", "none"}
)

# 별칭으로 배울 유형은 이름처럼 그 사람을 가리키는 표현뿐이다. "나"·"너"·"그"·"우리"
# 같은 말은 말하는 사람과 문맥에 따라 가리키는 대상이 달라서 저장하면 엉뚱한 사람에 붙는다.
# 역할 지목(thirdrole)도 배운다(#459, #522). AI 가 새 할 일(create·merge) 항목에 역할 원문("BE 리더가")을 assignee_raw 로
# 보내고 추측한 이름은 보내지 않는다. 역할은 맡은 사람이 바뀔 수 있어 새 항목은 auto 가 아니라 PM 검토로 내린다
# (api/extractions.py). 이 배포 전에 저장된 옛 thirdrole 대기 카드는 raw 가 추측한 이름일 수 있지만 따로 거르지 않는다
# (사용자 결정). 저장할 글자는 승인 전에 PM 에게 보이고, 잘못 저장된 별칭은 PM 이 지울 수 있다.
LEARNABLE_ASSIGNEE_TYPES = frozenset({"thirdname", "thirdrole"})

# AI 가 1인칭을 thirdname 으로 잘못 분류한 기록이 있다(#502). "제가"→"제", "우리가"→"우리"처럼 다듬은 글자가
# 확인된 별칭이 되면 오분류된 말이 그 팀원으로 채워진다. 그래서 1인칭이 할 일의 주어로 쓰인 꼴을 규칙 하나로 막는다.
# 규칙은 어간 × 복수 "들" × 주어 표지다. 이·가·는·를 같은 격조사는 다듬기(trim_alias_text)가 먼저 떼므로 여기서는
# 다듬기가 안 떼는 도·만·은과 복수 들을 본다.
#   - 어간: 제·저·나·내 / 저희·우리 / 본인. "들"은 저희·우리·본인에만 붙는다("저들"은 3인칭이라 막지 않는다).
#   - "은"은 받침 있는 말(본인, 들) 뒤에서만 붙는다. 받침 없는 어간은 "는"이라 "나은"(이름)은 막지 않는다.
#   - 규칙 밖(끼리·까지·모두 같은 부사어·구, 문장 끝 "요")은 주어 표지가 아니라 막지 않는다. 새는 경우는 PM 동의,
#     한 글자 확인 필요(#463), 별칭 삭제, AI 오분류 개선이 받는다. 새 꼴이 거론되면 "이 규칙이 만드는 조합인가"로
#     판단한다. 안이면 버그고, 밖이면 문서에 남긴다. 규칙이 만드는 조합은 tests/services/test_alias_learning.py 가 전부 돈다.
#   - 통째로 일치할 때만 막으므로 "제인"·"나연"은 배운다. 대신 조사 "이"를 떼면 "제"·"나"가 되는 "제이"·"나이"는
#     배우지 않는다(못 배우는 쪽이라 해가 없고 PM 이 직접 등록한다).
_SELF_REFERENCE = re.compile(
    r"(?:제|저|나|내)(?:도|만)?"
    r"|(?:저희|우리)(?:도|만|들(?:도|만|은)?)?"
    r"|본인(?:들)?(?:도|만|은)?"
)

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

    새 task 를 만들거나 대기 카드에 합쳐지는 항목인데 담당자를 못 찾았고, 표현이 이름 지목일 때만 대상이다(LEARNABLE_ASSIGNEE_TYPES).
    1인칭이 주어로 쓰인 꼴(_SELF_REFERENCE)로 다듬어지면 AI 오분류로 보고 대상이 아니다. 승인 상태는 보지 않는다.
    pending 인지는 호출하는 쪽이 이미 가진 승인 상태로 거른다.
    """
    if (
        item.action not in (ExtractionAction.CREATE, ExtractionAction.MERGE)
        or item.assignee_member_id is not None
        or item.assignee_type not in LEARNABLE_ASSIGNEE_TYPES
    ):
        return None
    text = trim_alias_text(item.assignee_raw)
    if text is None or _is_self_reference(text):
        return None
    return text


def _is_self_reference(text: str) -> bool:
    """다듬은 글자가 1인칭이 주어로 쓰인 꼴인가(_SELF_REFERENCE 규칙). 저장 글자는 바꾸지 않는다."""
    return _SELF_REFERENCE.fullmatch(text) is not None


def alias_lookup_forms(raw: str | None, text: str) -> set[str]:
    """이 표현이 담당자 찾기에서 걸릴 글자들: 님·조사를 뗀 후보(#463 name_candidates)와 저장할 글자.

    이 중 하나라도 탈퇴하지 않은 팀원이 별칭으로 가졌으면 이미 찾히거나 애매한 표현이라 배우지 않는다.
    저장할 글자만 보면 "하은은"(후보 하은은·하은, "하은"은 두 팀원)이 아무도 안 가진 글자로 보여 저장되고,
    이후 "하은은"이 그 팀원으로 항상 확정된다(#464 리뷰).
    """
    return set(name_candidates(raw)) | {text}


def learnable_alias_texts(
    db: Session, workspace_id: str, items: Iterable[ExtractionItem]
) -> dict[str, str]:
    """items 중 별칭을 배울 수 있는 것의 {item_id: 저장될 글자}. 이미 찾히는 표현은 뺀다.

    표현의 찾기 후보(alias_lookup_forms) 중 하나라도 탈퇴하지 않은 팀원이 가졌으면 뺀다. 조회는 한 번(IN)만 한다.
    """
    candidates: dict[str, tuple[str, set[str]]] = {}
    for item in items:
        text = learnable_alias_text(item)
        if text is not None:
            candidates[item.item_id] = (text, alias_lookup_forms(item.assignee_raw, text))
    if not candidates:
        return {}
    held = taken_alias_texts(db, workspace_id, set().union(*(forms for _, forms in candidates.values())))
    return {item_id: text for item_id, (text, forms) in candidates.items() if not (forms & held)}


def card_assignee_item(payload: str | None) -> str | None:
    """카드 payload(JSON 글자)에서 담당자를 정한 항목 id. 읽을 수 없으면 None.

    승인 때 저장하는 쪽(approvals._apply_approval)과 같은 규칙(assignee_item_of)이라 보이는 후보가 저장될 글자와 같다.
    합쳐진 카드는 여러 항목이 연결되는데 별칭은 담당자를 정한 항목에서만 배우므로, 후보도 그 항목만 낸다.
    """
    try:
        data = json.loads(payload) if payload else None
    except (TypeError, ValueError):
        return None
    return assignee_item_of(data) if isinstance(data, dict) else None


def approval_alias_texts(db: Session, approvals: Sequence[ApprovalRequest]) -> dict[str, str]:
    """pending 생성 승인 중 별칭을 배울 수 있는 것의 {approval_id: 저장될 글자}.

    승인 목록 응답에 alias_candidate 를 채우려고 쓴다. 항목은 approval_id 로 한 번에 읽어 승인마다 쿼리하지 않는다.
    """
    pending = [
        a for a in approvals
        if a.status == str(ApprovalStatus.PENDING) and a.type == str(ApprovalType.TASK_CREATE)
    ]
    workspace_of = {a.approval_id: a.workspace_id for a in pending}
    if not workspace_of:
        return {}
    assignee_item_of_card = {a.approval_id: card_assignee_item(a.payload) for a in pending}
    # 합쳐진 카드에 연결된 다른 항목의 표현은 저장되지 않으므로 담당 항목만 후보로 남긴다
    items = [
        item for item in db.execute(
            select(ExtractionItem).where(ExtractionItem.approval_id.in_(list(workspace_of)))
        ).scalars()
        if item.item_id == assignee_item_of_card[item.approval_id]
    ]
    # 워크스페이스마다 한 번씩만 조회한다
    items_by_workspace: dict[str, list[ExtractionItem]] = {}
    for item in items:
        items_by_workspace.setdefault(workspace_of[item.approval_id], []).append(item)
    approval_of = {item.item_id: item.approval_id for item in items}
    texts: dict[str, str] = {}
    for workspace_id, workspace_items in items_by_workspace.items():
        for item_id, text in learnable_alias_texts(db, workspace_id, workspace_items).items():
            texts[approval_of[item_id]] = text
    return texts


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


def _alias_taken(db: Session, workspace_id: str, forms: Collection[str]) -> bool:
    return bool(taken_alias_texts(db, workspace_id, forms))


def learn_alias(
    db: Session,
    *,
    workspace_id: str,
    member_id: str,
    alias_text: str,
    lookup_forms: Collection[str] = (),
) -> bool:
    """승인하며 고른 담당자에게 별칭을 저장한다. 저장했으면 True, 이미 누가 가진 글자라 넘어가면 False.

    저장할 글자나 lookup_forms(찾기 후보)를 탈퇴하지 않은 팀원이 이미 가졌으면 저장하지 않는다(taken_alias_texts).
    이 별칭은 덤이라 실패해도 승인을 막으면 안 된다. 같은 별칭이 동시에 들어와 유니크 제약에 걸리면 savepoint 만
    되돌리고 넘어간다. savepoint 앞에서 flush 하는 이유는, 그 전에 남은 task·이력 flush 오류가 아래
    IntegrityError 와 섞여 별칭 중복으로 잘못 삼켜지지 않게 하려는 것이다.
    """
    if _alias_taken(db, workspace_id, {alias_text, *lookup_forms}):
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
