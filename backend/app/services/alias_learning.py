"""승인 때 별칭 학습(#459)에 쓰는 상수와 글자 다듬기 함수 모음.

추출 항목을 승인할 때 사용자가 담당자를 직접 골랐다면, 발화에 적힌 담당자 표현("하은이가",
"BE 리더가")을 그 멤버의 별칭으로 저장해 다음 회의부터 자동으로 매칭되게 한다. 이 모듈은
저장할 글자를 다듬는 규칙과 학습 대상 판단에 쓰는 상수만 가지고, DB와 요청 처리 흐름은 모른다.
"""
import logging
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ApprovalRequest, ApprovalStatus, ApprovalType, ExtractionAction, ExtractionItem

logger = logging.getLogger(__name__)

# 추출 단계가 붙이는 담당자 표현 유형. 이 목록에 없는 값은 NULL 로 저장한다(storable_assignee_type).
KNOWN_ASSIGNEE_TYPES = frozenset(
    {"first", "second", "thirdname", "thirdpronoun", "thirdrole", "group", "none"}
)

# 별칭으로 배울 유형은 이름·역할처럼 그 사람을 가리키는 표현뿐이다. "나"·"너"·"그"·"우리"
# 같은 말은 말하는 사람과 문맥에 따라 가리키는 대상이 달라서 저장하면 엉뚱한 사람에 붙는다.
LEARNABLE_ASSIGNEE_TYPES = frozenset({"thirdname", "thirdrole"})

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

    새 task 를 만드는 항목인데 담당자를 못 찾았고, 표현이 이름·역할 지목일 때만 대상이다. 승인 상태는
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
    return texts
