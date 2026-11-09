"""로그인한 사용자의 이용약관·개인정보처리방침 동의 조회와 저장(#564). 가입·카카오 첫 로그인·문서 버전 변경을 같은 두 API 로 처리한다."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import Envelope, success
from app.models import User
from app.schemas.consent import ConsentAgreeRequest, ConsentStatusResponse
from app.services import consents

router = APIRouter(prefix="/consents", tags=["consents"])


def _data(db: Session, user: User) -> dict:
    return ConsentStatusResponse.model_validate(consents.status(db, user.user_id)).model_dump(mode="json")


@router.get("/me", response_model=Envelope[ConsentStatusResponse])
def get_my_consents(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return success(_data(db, user))


@router.post("", response_model=Envelope[ConsentStatusResponse])
def agree_consents(
    payload: ConsentAgreeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    versions = {consents.TERMS: payload.terms_version, consents.PRIVACY: payload.privacy_version}
    consents.agree(db, user.user_id, versions)
    data = _data(db, user)
    db.commit()
    return success(data)
