"""judge 새 항목의 auto 막는 이유(auto_blockers)에서 유사 검색이 못 보는 후보 신호."""
from app.models import EvidenceStatus
from app.services.matching import AutoSignals, auto_blockers


def _blockers(**signal_fields) -> list[str]:
    signals = AutoSignals(
        **{
            "task_status": EvidenceStatus.CERTAIN,
            "due_status": EvidenceStatus.CERTAIN,
            "similar_count": 0,
            **signal_fields,
        }
    )
    return auto_blockers(signals, assignee_type="none", assignee=None, has_due_date=True)


def test_no_signals_means_no_blockers():
    assert _blockers() == []


def test_unsearched_pending_alone_blocks_auto():
    assert _blockers(unsearched_pending_exist=True) == ["unsearched_pending_exists"]


def test_similar_task_found_hides_unsearched_reasons():
    assert _blockers(similar_count=1, unsearched_tasks_exist=True, unsearched_pending_exist=True) == [
        "similar_task_found"
    ]


def test_both_unsearched_signals_are_reported_independently():
    assert _blockers(unsearched_tasks_exist=True, unsearched_pending_exist=True) == [
        "unsearched_task_exists",
        "unsearched_pending_exists",
    ]
