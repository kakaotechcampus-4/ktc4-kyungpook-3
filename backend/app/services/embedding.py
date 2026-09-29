"""task 제목 임베딩: 계산 클라이언트, 채우는 워커, 유사 task 검색.

AI 파트(ai/embedding.py)와 같은 모델(text-embedding-3-small)과 같은 환경변수를 쓰지만,
프로젝트가 따로라 import하지 않고 여기서 직접 호출한다(OpenAI 호환 /embeddings API).

저장: Task를 만들거나 제목을 바꾸면 `Task.embedding`을 NULL로 둔다(app/services/tasks.py).
요청 안에서 외부 API를 부르지 않으므로 임베딩 서버가 느리거나 죽어도 task 저장은 영향이 없다.
워커가 주기적으로 NULL인 task를 찾아 채우고, 실패하면 다음 주기에 다시 시도한다.
기존 task 백필도 같은 경로로 처리된다.

실패는 원인에 따라 다르게 다룬다.
- 입력 오류(400·413·422): 특정 task 제목 탓일 수 있어서 하나씩 다시 보내고, 거절된 task만 건너뛴다.
  한 task 때문에 같은 배치의 나머지가 계속 막히지 않게 하려는 것이다.
- 그 외(연결 실패·타임아웃·5xx·429 등): 다시 보내도 결과가 같으므로 하나씩 보내지 않는다.
  대신 연속 실패할수록 워커 대기 간격을 두 배씩 늘린다(최대 MAX_BACKOFF_SECONDS).
  401·403은 키 설정 문제라 바로 최대 간격으로 늘린다.

검색: pgvector의 코사인 거리로 같은 워크스페이스의 task를 찾는다(todo·in_progress·blocked·done).
임베딩이 아직 없는 task는 검색에서 빠진다. PostgreSQL 전용이다.
"""
import logging
import os
import threading

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import EMBEDDING_DIMENSIONS, Task, TaskStatus

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
TIMEOUT_SECONDS = 10.0
# 워커가 한 번에 채우는 task 수. 임베딩 API 한 번 호출에 묶어 보낸다.
BATCH_SIZE = 50
# 요청 내용이 거절된 경우. 특정 task 제목 탓일 수 있어 하나씩 다시 보낸다.
INPUT_ERROR_STATUSES = frozenset({400, 413, 422})
# 키가 틀렸거나 권한이 없는 경우. 다시 보내도 설정을 고치기 전에는 풀리지 않는다.
AUTH_ERROR_STATUSES = frozenset({401, 403})
# 연속 실패 시 워커 대기 간격의 상한(초)
MAX_BACKOFF_SECONDS = 300.0

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
    """임베딩 API 키가 없거나, 호출 또는 응답 해석에 실패했다.

    status_code는 임베딩 API가 HTTP 오류로 답했을 때만 있다(연결 실패·응답 형식 오류면 None).
    retry_after는 그 응답의 Retry-After 헤더(초)다.
    """

    def __init__(
        self, message: str, *, status_code: int | None = None, retry_after: float | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after

    @property
    def is_input_error(self) -> bool:
        return self.status_code in INPUT_ERROR_STATUSES

    @property
    def is_auth_error(self) -> bool:
        return self.status_code in AUTH_ERROR_STATUSES


def _api_key() -> str | None:
    return os.getenv("EMBEDDING_API_KEY") or None


def _base_url() -> str | None:
    return os.getenv("EMBEDDING_BASE_URL") or None


def is_configured() -> bool:
    return _api_key() is not None and _base_url() is not None


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """Retry-After가 초 단위 숫자면 그 값을 돌려준다. 없거나 날짜 형식이면 None."""
    try:
        seconds = float(response.headers["Retry-After"])
    except (KeyError, ValueError):
        return None
    return seconds if seconds >= 0 else None


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
        raise EmbeddingError(
            f"임베딩 API 오류 [{response.status_code}] {response.text[:200]}",
            status_code=response.status_code,
            retry_after=_retry_after_seconds(response),
        )

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

    제목이 비었거나 공백뿐인 task는 대상에서 뺀다. 서비스 경로(create_task·apply_task_updates)는
    이런 제목을 이미 거절하지만, 검증을 거치지 않고 들어온 행이 있으면 임베딩 API가 빈 입력을
    거절해서 같은 배치의 나머지 task까지 매번 함께 실패하기 때문이다.

    배치가 입력 오류로 거절되면 task를 하나씩 다시 보내서 거절된 task만 건너뛴다.
    그 외 실패는 EmbeddingError를 그대로 올린다. 그때까지 받은 벡터는 저장하므로
    다음 호출은 남은 task만 다시 시도한다.
    """
    rows = db.execute(
        select(Task.task_id, Task.title)
        .where(Task.embedding.is_(None), func.trim(Task.title) != "")
        .order_by(Task.created_at)
        .limit(limit)
    ).all()
    if not rows:
        return 0

    error: EmbeddingError | None = None
    try:
        pairs = list(zip(rows, embed_texts([title for _, title in rows], transport=transport)))
    except EmbeddingError as exc:
        if not exc.is_input_error:
            raise
        if len(rows) == 1:
            # 하나뿐이면 다시 보내도 같은 결과다.
            _log_rejected(rows[0].task_id, exc)
            pairs = []
        else:
            pairs, error = _embed_one_by_one(rows, transport=transport)

    filled = 0
    for (task_id, title), vector in pairs:
        # 계산하는 사이에 제목이 또 바뀌었으면 옛 제목의 벡터를 넣지 않는다(다음 주기에 새 제목으로).
        # 사용자 변경이 아니므로 updated_at은 그대로 둔다.
        result = db.execute(
            update(Task)
            .where(Task.task_id == task_id, Task.title == title, Task.embedding.is_(None))
            .values(embedding=vector, updated_at=Task.updated_at)
        )
        filled += result.rowcount
    db.commit()
    if error is not None:
        raise error
    return filled


def _embed_one_by_one(
    rows, *, transport: httpx.BaseTransport | None
) -> tuple[list, EmbeddingError | None]:
    """배치가 입력 오류로 거절됐을 때 task를 하나씩 다시 보낸다.

    입력 오류로 거절된 task는 건너뛴다. 도중에 입력 오류가 아닌 실패(장애·429 등)가 나면
    남은 task도 똑같이 실패할 것이라 거기서 멈추고, 그때까지 받은 벡터와 그 오류를 돌려준다.
    """
    pairs = []
    for row in rows:
        try:
            [vector] = embed_texts([row.title], transport=transport)
        except EmbeddingError as exc:
            if not exc.is_input_error:
                return pairs, exc
            _log_rejected(row.task_id, exc)
            continue
        pairs.append((row, vector))
    return pairs, None


def _log_rejected(task_id: str, exc: EmbeddingError) -> None:
    logger.warning("task 임베딩 입력이 거절되어 건너뜁니다 task_id=%s: %s", task_id, exc)


def retry_delay(interval: float, failures: int, exc: EmbeddingError) -> float:
    """연속 `failures`번 실패한 뒤 워커가 다음 시도까지 기다릴 시간(초).

    입력 오류는 거절된 task만 건너뛰고 나머지는 처리되므로 평소 간격 그대로다.
    키 설정 문제(401·403)는 기다려도 풀리지 않으니 바로 상한까지 늘린다.
    429 등에 Retry-After가 있으면 그 값을 따르되 평소 간격보다 짧거나 상한보다 길게는 두지 않는다.
    그 외에는 실패할 때마다 두 배로 늘린다(5초 → 10초 → 20초 … 최대 MAX_BACKOFF_SECONDS).
    """
    if exc.is_input_error:
        return interval
    if exc.is_auth_error:
        return MAX_BACKOFF_SECONDS
    if exc.retry_after is not None:
        return min(max(exc.retry_after, interval), MAX_BACKOFF_SECONDS)
    # 지수가 한없이 커지지 않게 막는다. 2**10배면 기본 간격에서도 이미 상한을 넘는다.
    return min(interval * 2 ** min(failures, 10), MAX_BACKOFF_SECONDS)


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
    failures = 0  # 임베딩 API 연속 실패 횟수. 한 번 성공하면 0으로 돌아간다.
    while not stop_event.is_set():
        delay = interval
        db = SessionLocal()
        try:
            process_missing_embeddings(db)
            failures = 0
        except EmbeddingError as exc:
            db.rollback()
            failures += 1
            delay = retry_delay(interval, failures, exc)
            if exc.is_auth_error:
                logger.error(
                    "task 임베딩 API 인증 실패. EMBEDDING_API_KEY를 확인하세요. %.0f초 뒤 다시 시도합니다: %s",
                    delay, exc,
                )
            else:
                logger.warning(
                    "task 임베딩 계산 실패(연속 %d회), %.0f초 뒤 다시 시도합니다: %s",
                    failures, delay, exc,
                )
        except Exception:
            logger.exception("task 임베딩 워커 오류")
            db.rollback()
        finally:
            db.close()
        stop_event.wait(delay)


def start_worker(interval: float) -> tuple[threading.Thread, threading.Event]:
    stop_event = threading.Event()
    thread = threading.Thread(
        target=run_worker, args=(stop_event, interval), name="task-embedding", daemon=True
    )
    thread.start()
    return thread, stop_event
