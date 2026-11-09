"""로그인한 사용자의 계정 정보 변경. 지금은 아이디만 바꾼다(#610)."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import user_response
from app.api.deps import get_current_user_for_update
from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import User
from app.schemas.auth import UsernameUpdateRequest, UserResponse

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
