"""승인 때 별칭을 학습하는 서비스(#459)의 글자 다듬기·상수 규칙."""
import pytest

from app.models import ExtractionAction, ExtractionItem
from app.services import alias_learning


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("하은이가", "하은"),
        ("지민님이", "지민"),
        ("BE 리더가", "BE 리더"),
        # "은"은 떼지 않는다. 이름 끝 글자인 경우가 많아 "하은"을 "하"로 만들 수 있다
        ("하은은", "하은은"),
        ("선생님께서", "선생"),
        # 조사는 한 번만 뗀다
        ("하은이가가", "하은이가"),
        (" 지민 님 ", "지민"),
        ("BE  리더", "BE 리더"),
        ("민이", "민"),
        ("지민님", "지민"),
        ("하은한테", "하은"),
        ("하은을", "하은"),
        # 떼고 나면 남는 글자가 없는 것은 별칭이 될 수 없다
        ("님", None),
        ("이", None),
        ("", None),
        ("   ", None),
        (None, None),
    ],
)
def test_trim_alias_text(raw, expected):
    assert alias_learning.trim_alias_text(raw) == expected


def test_learning_constants():
    assert alias_learning.LEARNED_CONFIDENCE == 0.9
    assert alias_learning.LEARNABLE_ASSIGNEE_TYPES == frozenset({"thirdname", "thirdrole"})
    assert alias_learning.KNOWN_ASSIGNEE_TYPES == frozenset(
        {"first", "second", "thirdname", "thirdpronoun", "thirdrole", "group", "none"}
    )
    assert alias_learning.LEARNABLE_ASSIGNEE_TYPES <= alias_learning.KNOWN_ASSIGNEE_TYPES


def _item(**fields) -> ExtractionItem:
    base = {"action": ExtractionAction.CREATE, "assignee_type": "thirdname", "assignee_raw": "하은이가",
            "assignee_member_id": None}
    return ExtractionItem(**{**base, **fields})


def test_learnable_alias_text_for_unmatched_name():
    assert alias_learning.learnable_alias_text(_item()) == "하은"


@pytest.mark.parametrize(
    "fields",
    [
        {"assignee_member_id": "member-1"},
        {"assignee_type": "first"},
        {"assignee_type": "second"},
        {"assignee_type": "thirdpronoun"},
        {"assignee_type": "group"},
        {"assignee_type": "none"},
        {"assignee_type": None},
        {"action": ExtractionAction.UPDATE},
        {"assignee_raw": "님"},
        {"assignee_raw": None},
        # AI 가 1인칭을 thirdname 으로 잘못 분류해도 "제가"→"제" 같은 글자는 배우지 않는다(#502)
        {"assignee_raw": "제가"},
        {"assignee_raw": "저는"},
        {"assignee_raw": "나는"},
        {"assignee_raw": "내가"},
        {"assignee_raw": "저희가"},
        {"assignee_raw": "우리"},
        {"assignee_raw": "본인이"},
        # "도"·"들"이 붙은 꼴도 막는다. 다듬은 글자는 "저도"·"저희들"로 남는다
        {"assignee_raw": "저도"},
        {"assignee_raw": "나도"},
        {"assignee_raw": "저희도"},
        {"assignee_raw": "우리도"},
        {"assignee_raw": "본인도"},
        {"assignee_raw": "저희들이"},
        {"assignee_raw": "우리들이"},
        {"assignee_raw": "저희들도"},
        # 이름 끝 "은"은 조사로 떼지 않아("하은"·"나은") "본인은"은 목록에 직접 둔다
        {"assignee_raw": "본인은"},
    ],
)
def test_learnable_alias_text_is_none_when_not_learnable(fields):
    assert alias_learning.learnable_alias_text(_item(**fields)) is None


@pytest.mark.parametrize(
    "raw, expected",
    [("BE 리더가", "BE 리더"), ("환", "환"), ("팀장이", "팀장"), ("팀장은", "팀장은"), ("디자이너분이", "디자이너분")],
)
def test_learnable_alias_text_for_thirdrole(raw, expected):
    """역할 지목은 AI 가 역할 원문을 assignee_raw 로 보내므로(#522) 이름처럼 배운다. 다듬기는 이름과 같다.

    "은"·"분"은 떼지 않는다(저장은 좁게, #607 리뷰). "팀장은"은 다음에 "팀장이"로 오면 "팀장"을 한 번 더 배워 메워진다."""
    assert alias_learning.learnable_alias_text(_item(assignee_type="thirdrole", assignee_raw=raw)) == expected


@pytest.mark.parametrize("raw", ["화은", "하은", "옥분", "김하은", "지은이가"])
def test_thirdrole_trims_like_names_so_misclassified_names_are_not_cut(raw):
    """역할로 잘못 분류된 이름(또는 배포 전 옛 카드의 추측 이름)도 이름처럼 다듬는다. "화은" → "화" 처럼 자르지 않는다."""
    as_role = alias_learning.learnable_alias_text(_item(assignee_type="thirdrole", assignee_raw=raw))
    as_name = alias_learning.learnable_alias_text(_item(assignee_type="thirdname", assignee_raw=raw))
    assert as_role == as_name
    assert as_role is not None and len(as_role) > 1


def test_role_learned_in_eun_form_is_completed_by_the_next_form():
    """"팀장은"으로 배운 뒤 "팀장이"로 오면 못 찾지만, 그 표현은 다시 학습 후보가 되어 "팀장"을 배운다.

    "팀장이"의 찾기 후보에 "팀장은"이 없어 이미 찾히는 표현이 아니기 때문이다(alias_lookup_forms)."""
    from app.services.matching import name_candidates

    learned = alias_learning.learnable_alias_text(_item(assignee_type="thirdrole", assignee_raw="팀장은"))
    assert learned == "팀장은"
    assert learned not in name_candidates("팀장이")
    assert learned not in alias_learning.alias_lookup_forms("팀장이", "팀장")
    assert alias_learning.learnable_alias_text(_item(assignee_type="thirdrole", assignee_raw="팀장이")) == "팀장"
    # 둘 다 배운 뒤에는 어느 꼴로 와도 찾힌다
    for later in ["팀장은", "팀장이", "팀장님", "팀장께서"]:
        assert {"팀장은", "팀장"} & set(name_candidates(later))


@pytest.mark.parametrize("later", ["디자이너분이", "디자이너분", "디자이너님이", "디자이너가"])
def test_role_alias_is_found_with_bun_honorific(later):
    """"디자이너가"에서 배운 "디자이너"는 "분"을 붙인 꼴로도 찾힌다. "분"은 찾기 후보의 호칭이다(찾기는 넓게)."""
    from app.services.matching import name_candidates

    learned = alias_learning.learnable_alias_text(_item(assignee_type="thirdrole", assignee_raw="디자이너가"))
    assert learned == "디자이너"
    assert learned in name_candidates(later)


def test_learnable_alias_text_keeps_names_that_only_contain_self_reference_letters():
    """거르는 것은 다듬은 글자가 통째로 1인칭 지칭어일 때뿐이다. "제인", "나리"는 이름일 수 있다."""
    assert alias_learning.learnable_alias_text(_item(assignee_raw="제인이가")) == "제인"
    assert alias_learning.learnable_alias_text(_item(assignee_raw="나리")) == "나리"


@pytest.mark.parametrize(
    "raw",
    ["하은이가", "지민님이", "환 님이", "화은 님이", "화은  님이", "화은님", "민이", "하은은", "선생님께서",
     "하은이가가", " 지민 님 ", "BE  리더가", "지민이는"],
)
def test_trimmed_text_is_always_one_of_the_matching_candidates(raw):
    """저장할 글자는 담당자 찾기(#463 name_candidates)가 만드는 후보 안에 있어야 다음 회의에서 찾힌다."""
    from app.services.matching import name_candidates

    assert alias_learning.trim_alias_text(raw) in name_candidates(raw)


def test_alias_lookup_forms_include_matching_candidates_and_saved_text():
    forms = alias_learning.alias_lookup_forms("하은은", "하은은")
    assert forms == {"하은은", "하은"}
    assert alias_learning.alias_lookup_forms("화은 님이", "화은") == {"화은 님이", "화은 님", "화은"}


@pytest.mark.parametrize("raw, expected", [("제인", "제인"), ("나연", "나연"), ("나은", "나은"), ("제인이가", "제인")])
def test_names_that_start_with_self_reference_letters_are_still_learned(raw, expected):
    """통째로 일치할 때만 거르므로 "제"·"나"로 시작하는 이름은 배운다. startswith 로 바꾸면 이 이름들이 막힌다."""
    assert alias_learning.learnable_alias_text(_item(assignee_raw=raw)) == expected


@pytest.mark.parametrize("raw", ["제이", "제이가", "나이", "나이가"])
def test_names_that_trim_to_self_reference_are_not_learned(raw):
    """받아들인 제약: 조사 "이"를 떼면 "제"·"나"가 되는 이름은 배우지 않는다. 못 배우는 쪽이라 해가 없고 PM 이
    별칭을 직접 등록할 수 있다(#464 리뷰)."""
    assert alias_learning.learnable_alias_text(_item(assignee_raw=raw)) is None


def _self_reference_forms():
    """1인칭 거르기가 막는 꼴을 규칙대로 만든다: 어간 × 복수 들 × 주어 표지(도·만·은).

    "들"은 저희·우리·본인에만 붙는다("저들"은 3인칭). "은"은 받침 있는 말(본인, 들) 뒤에서만 붙는다. 받침 없는
    어간은 "는"이라 "나은"(이름)은 막지 않는다. 이·가·는·를 같은 격조사는 다듬기(trim_alias_text)가 먼저 뗀다.
    """
    for stem in ("제", "저", "나", "내"):
        yield from (stem, stem + "도", stem + "만")
    for stem in ("저희", "우리"):
        yield from (stem, stem + "도", stem + "만")
        plural = stem + "들"
        yield from (plural, plural + "도", plural + "만", plural + "은")
    for stem in ("본인", "본인들"):
        yield from (stem, stem + "도", stem + "만", stem + "은")


@pytest.mark.parametrize("raw", sorted(_self_reference_forms()))
def test_every_form_the_self_reference_rule_describes_is_blocked(raw):
    assert alias_learning.learnable_alias_text(_item(assignee_raw=raw)) is None


@pytest.mark.parametrize("raw", ["저희 모두", "우리끼리", "우리까지", "제가요", "저희끼리", "저들"])
def test_forms_outside_the_self_reference_rule_are_not_blocked(raw):
    """규칙 밖의 꼴은 막지 않는다: 주어 표지가 아닌 부사어·구·끝말, 그리고 3인칭 "저들". 새는 경우는 PM 동의, 한 글자
    확인 필요(#463), 별칭 삭제, AI 오분류 개선이 받는다(#464 리뷰)."""
    assert alias_learning.learnable_alias_text(_item(assignee_raw=raw)) is not None


@pytest.mark.parametrize(
    "payload",
    [None, "", "{깨진", "[1, 2]", '"문자열"', "{}"],
    ids=["none", "empty", "bad-json", "list", "string", "no-ids"],
)
def test_card_assignee_item_is_none_for_unusable_payload(payload):
    # 저장 쪽도 담당 항목을 못 찾으면 배우지 않으므로 후보도 내지 않는다
    assert alias_learning.card_assignee_item(payload) is None


def test_card_assignee_item_prefers_assignee_item_id():
    assert alias_learning.card_assignee_item('{"extraction_item_id": "a", "assignee_item_id": "b"}') == "b"
    assert alias_learning.card_assignee_item('{"extraction_item_id": "a"}') == "a"
