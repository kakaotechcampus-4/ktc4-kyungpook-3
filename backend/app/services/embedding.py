"""task 제목 임베딩: 계산 클라이언트, 채우는 워커, 유사 task 검색.

AI 파트(ai/embedding.py)와 같은 모델(text-embedding-3-small)과 같은 환경변수를 쓰지만,
프로젝트가 따로라 import하지 않고 여기서 직접 호출한다(OpenAI 호환 /embeddings API).

저장: Task를 만들거나 제목을 바꾸면 `Task.embedding`을 NULL로 둔다(app/services/tasks.py).
요청 안에서 외부 API를 부르지 않으므로 임베딩 서버가 느리거나 죽어도 task 저장은 영향이 없다.
워커가 주기적으로 NULL인 task를 찾아 채우고, 실패하면 다음 주기에 다시 시도한다.
기존 task 백필도 같은 경로로 처리된다.

검색: pgvector의 코사인 거리로 같은 워크스페이스의 task를 찾는다(todo·in_progress·blocked·done).
임베딩이 아직 없는 task는 검색에서 빠진다. PostgreSQL 전용이다.
"""
import logging
import os
import threading

import httpx
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import EMBEDDING_DIMENSIONS, Task, TaskStatus

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
TIMEOUT_SECONDS = 10.0
# 워커가 한 번에 채우는 task 수. 임베딩 API 한 번 호출에 묶어 보낸다.
BATCH_SIZE = 50

# done task도 후보에 넣는다. "버그 때문에 다시 작업 들어가야 할 것 같다"처럼 끝난 task를
# 다시 진행 상태로 되돌리는 발화도 AI가 기존 task 수정(action=update)으로 판단할 수 있어야 한다.
SEARCHABLE_STATUSES = (
    str(TaskStatus.TODO),
    str(TaskStatus.IN_PROGRESS),
    str(TaskStatus.BLOCKED),
    str(TaskStatus.DONE),
)
# decision_log 0010: 명확한 불일치 최고점 0.33, 명확한 매치 최저점 0.42
DEFAULT_MIN_SIMILARITY = 0.4
DEFAULT_K = 3


class EmbeddingError(Exception):
    """임베딩 API 키가 없거나, 호출 또는 응답 해석에 실패했다."""


def _api_key() -> str | None:
    return os.getenv("EMBEDDING_API_KEY") or None


def _base_url() -> str | None:
    return os.getenv("EMBEDDING_BASE_URL") or None


def is_configured() -> bool:
    return _api_key() is not None and _base_url() is not None


def embed_texts(
    texts: list[str], *, transport: httpx.BaseTransport | None = None
) -> list[list[float]]:
    """문장 목록을 한 번의 API 호출로 벡터 목록으로 바꾼다. 순서는 입력과 같다."""
    if not texts:
        return []
    if not is_configured():
        raise EmbeddingError("EMBEDDING_API_KEY 또는 EMBEDDING_BASE_URL이 설정되지 않았습니다.")

    url = _base_url().rstrip("/") + "/embeddings"
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS, transport=transport) as client:
            response = client.post(
                url,
                headers={"Authorization": f"Bearer {_api_key()}"},
                json={"model": EMBEDDING_MODEL, "input": texts},
            )
    except httpx.HTTPError as exc:
        raise EmbeddingError(f"임베딩 API 호출 실패: {type(exc).__name__}: {exc}") from exc

    if response.status_code >= 400:
        raise EmbeddingError(f"임베딩 API 오류 [{response.status_code}] {response.text[:200]}")

    try:
        data = sorted(response.json()["data"], key=lambda d: d["index"])
        vectors = [list(map(float, d["embedding"])) for d in data]
    except (ValueError, KeyError, TypeError) as exc:
        raise EmbeddingError(f"임베딩 API 응답 형식이 올바르지 않습니다: {exc}") from exc

    if len(vectors) != len(texts):
        raise EmbeddingError(f"요청 {len(texts)}개에 벡터 {len(vectors)}개가 돌아왔습니다.")
    if any(len(v) != EMBEDDING_DIMENSIONS for v in vectors):
        raise EmbeddingError(f"벡터 차원이 {EMBEDDING_DIMENSIONS}이 아닙니다.")
    return vectors


def process_missing_embeddings(
    db: Session,
    *,
    transport: httpx.BaseTransport | None = None,
    limit: int = BATCH_SIZE,
) -> int:
    """임베딩이 없는 task를 최대 `limit`개 채우고, 실제로 채운 개수를 돌려준다.

    임베딩 API가 실패하면 EmbeddingError를 그대로 올린다. 아무것도 저장하지 않으므로
    다음 호출이 같은 task를 다시 시도한다.
    """
    rows = db.execute(
        select(Task.task_id, Task.title)
        .where(Task.embedding.is_(None))
        .order_by(Task.created_at)
        .limit(limit)
    ).all()
    if not rows:
        return 0

    vectors = embed_texts([title for _, title in rows], transport=transport)

    filled = 0
    for (task_id, title), vector in zip(rows, vectors):
        # 계산하는 사이에 제목이 또 바뀌었으면 옛 제목의 벡터를 넣지 않는다(다음 주기에 새 제목으로).
        # 사용자 변경이 아니므로 updated_at은 그대로 둔다.
        result = db.execute(
            update(Task)
            .where(Task.task_id == task_id, Task.title == title, Task.embedding.is_(None))
            .values(embedding=vector, updated_at=Task.updated_at)
        )
        filled += result.rowcount
    db.commit()
    return filled


def search_similar_tasks(
    db: Session,
    workspace_id: str,
    query_vector: list[float],
    *,
    k: int = DEFAULT_K,
    min_similarity: float = DEFAULT_MIN_SIMILARITY,
) -> list[tuple[Task, float]]:
    """코사인 유사도가 높은 순으로 최대 k개의 (task, 유사도)를 돌려준다.

    todo·in_progress·blocked·done task가 대상이다. min_similarity 미만인 후보는 뺀다.
    남는 게 없으면 빈 목록이다.
    """
    distance = Task.embedding.cosine_distance(query_vector)
    rows = db.execute(
        select(Task, distance.label("distance"))
        .where(
            Task.workspace_id == workspace_id,
            Task.status.in_(SEARCHABLE_STATUSES),
            Task.embedding.is_not(None),
            distance <= 1 - min_similarity,
        )
        .order_by(distance)
        .limit(k)
    ).all()
    return [(task, 1 - float(dist)) for task, dist in rows]


def run_worker(stop_event: threading.Event, interval: float) -> None:
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            process_missing_embeddings(db)
        except EmbeddingError as exc:
            logger.warning("task 임베딩 계산 실패, 다음 주기에 다시 시도합니다: %s", exc)
            db.rollback()
        except Exception:
            logger.exception("task 임베딩 워커 오류")
            db.rollback()
        finally:
            db.close()
        stop_event.wait(interval)


def start_worker(interval: float) -> tuple[threading.Thread, threading.Event]:
    stop_event = threading.Event()
    thread = threading.Thread(
        target=run_worker, args=(stop_event, interval), name="task-embedding", daemon=True
    )
    thread.start()
    return thread, stop_event
