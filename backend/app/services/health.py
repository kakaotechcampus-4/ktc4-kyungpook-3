"""health ready 가 DB 연결을 확인하는 로직(#675). 실패는 SQLAlchemyError 그대로 올린다."""
from sqlalchemy import text
from sqlalchemy.orm import Session


def check_database(db: Session) -> None:
    db.execute(text("SELECT 1"))
