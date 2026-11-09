"""로그인한 사용자의 계정 정보 변경(지금은 아이디만, #610)과 초대할 가입자 찾기(#628)."""
from fastapi import APIRouter, Depends
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import user_response
from app.api.deps import get_current_pm, get_current_user_for_update
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Member, User
from app.schemas.auth import UsernameUpdateRequest, UserResponse
from app.schemas.invitation import UserSearchResponse, UserSummary
from app.schemas.username import validate_username

router = APIRouter(prefix="/users", tags=["users"])


@router.patch("/me", response_model=Envelope[UserResponse])
def update_me(payload: UsernameUpdateRequest, user: User = Depends(get_current_user_for_update), db: Session = Depends(get_db)):
    if payload.username != user.username:
        if db.scalar(select(User.user_id).where(User.username == payload.username)) is not None:
            raise AppError(ErrorCode.USERNAME_TAKEN)
        user.username = payload.username
        try:
            db.commit()
        except IntegrityError:
            # 사전 조회 뒤 다른 계정이 같은 아이디를 먼저 가져갔다.
            db.rollback()
            raise AppError(ErrorCode.USERNAME_TAKEN) from None
    return success(user_response(user).model_dump(mode="json"))


@router.get("/search", response_model=Envelope[UserSearchResponse])
def search_users(workspace_id: str, q: str, _pm: Member = Depends(get_current_pm), db: Session = Depends(get_db)):
    """그 공간의 PM 이 초대할 가입자를 아이디로 찾는다. 대소문자만 빼고 아이디가 같아야 하고, 이 공간의 팀원은 뺀다.
    누구나 공간을 만들어 PM 이 될 수 있어서 앞부분·이름으로는 찾지 않는다(사용자 목록을 훑는 길이 된다)."""
    try:
        username = validate_username(q)
    except ValueError:
        return success(UserSearchResponse(items=[]).model_dump())
    in_workspace = exists().where(
        Member.workspace_id == workspace_id, Member.user_id == User.user_id, Member.is_deleted.is_(False)
    )
    rows = db.execute(select(User.user_id, User.username, User.name).where(User.username == username, ~in_workspace))
    return success(UserSearchResponse(items=[UserSummary(**row._mapping) for row in rows]).model_dump())
