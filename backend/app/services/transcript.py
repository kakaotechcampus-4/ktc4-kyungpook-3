"""전사 제목과 발화 줄 고치기. 커밋은 호출자가 한다.

제목은 그 자리에서 고치고 처음 제목을 옆에 둬서 제목을 읽는 곳은 그대로 고친 값을 본다. 발화 원문(Source.text)은 승인 근거 인용이
읽어서 건드리지 않고 고친 값을 text_edit 에 둔다. 어느 쪽도 담당자 별칭을 만들지 않는다.
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Meeting, Source
from app.services import meeting_deletion


def edit_title(db: Session, meeting_id: str, title: str | None) -> Meeting:
    """None 이나 처음 제목과 같은 값은 되돌리기다. 고친 적 없으면 None 은 아무것도 하지 않는다."""
    meeting = meeting_deletion.require_live_meeting(db, meeting_id, lock=True)
    original = meeting.title_original if meeting.title_edited_at is not None else meeting.title
    if title is None or title == original:
        meeting.title, meeting.title_original, meeting.title_edited_at = original, None, None
    else:
        if meeting.title_edited_at is None:
            meeting.title_original = meeting.title
        meeting.title = title
        meeting.title_edited_at = datetime.now(timezone.utc)
    db.flush()
    return meeting


def edit_line(db: Session, meeting_id: str, seq: int, text: str | None) -> Source:
    """None 이나 원문과 같은 값은 고친 값을 비운다."""
    meeting_deletion.require_live_meeting(db, meeting_id, lock=True)
    # Source.seq 는 PostgreSQL integer 라 그 밖의 번호로 찾으면 DB 가 500 을 낸다. 그런 줄은 없다
    source = db.scalar(select(Source).where(Source.meeting_id == meeting_id, Source.seq == seq)) if 0 <= seq < 2**31 else None
    if source is None:
        raise AppError(ErrorCode.TRANSCRIPT_LINE_NOT_FOUND, details={"meeting_id": meeting_id, "seq": seq})
    source.text_edit = None if text is None or text == source.text else text
    db.flush()
    return source
