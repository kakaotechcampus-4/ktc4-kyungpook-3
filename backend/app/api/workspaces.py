from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, Envelope, ErrorCode, success
from app.models import Workspace
from app.schemas.workspace import (
    WorkspaceCreateRequest,
    WorkspaceListResponse,
    WorkspaceResponse,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.post("", status_code=201, response_model=Envelope[WorkspaceResponse])
def create_workspace(
    payload: WorkspaceCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    workspace = Workspace(name=payload.name)
    db.add(workspace)
    db.commit()
    db.refresh(workspace)
    return success(WorkspaceResponse.model_validate(workspace).model_dump(mode="json"))


@router.get("", response_model=Envelope[WorkspaceListResponse])
def list_workspaces(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        select(Workspace).order_by(Workspace.created_at.desc())
    ).scalars().all()
    total = db.execute(select(func.count()).select_from(Workspace)).scalar() or 0

    return success(
        WorkspaceListResponse(
            items=[WorkspaceResponse.model_validate(r) for r in rows],
            total=total,
        ).model_dump(mode="json")
    )


@router.get("/{workspace_id}", response_model=Envelope[WorkspaceResponse])
def get_workspace(workspace_id: str, db: Session = Depends(get_db)) -> dict:
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        raise AppError(
            ErrorCode.WORKSPACE_NOT_FOUND, details={"workspace_id": workspace_id}
        )
    return success(WorkspaceResponse.model_validate(workspace).model_dump(mode="json"))
