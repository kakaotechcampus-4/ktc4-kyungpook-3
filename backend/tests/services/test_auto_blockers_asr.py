"""auto_blockers 의 전사 오인식 사유(asr_suspect). 다른 사유와 독립이고 기본값은 막지 않는다."""
import pytest

from app.models import EvidenceStatus
from app.services.matching import AutoSignals, auto_blockers


def _signals(**kw) -> AutoSignals:
    base = {"task_status": EvidenceStatus.CERTAIN, "due_status": EvidenceStatus.MISSING, "similar_count": 0}
    return AutoSignals(**{**base, **kw})


def test_default_signals_have_no_asr_reason():
    assert auto_blockers(_signals(), assignee_type="none", assignee=None, has_due_date=False) == []


@pytest.mark.parametrize("count", [1, 3])
def test_any_suspect_blocks(count):
    assert auto_blockers(_signals(asr_suspect_count=count), assignee_type="none", assignee=None,
                         has_due_date=False) == ["asr_suspect"]


def test_asr_reason_is_added_next_to_other_reasons():
    reasons = auto_blockers(_signals(task_status=EvidenceStatus.INFERRED, similar_count=2, asr_suspect_count=1),
                            assignee_type="none", assignee=None, has_due_date=False)
    assert reasons == ["task_not_certain", "similar_task_found", "asr_suspect"]
