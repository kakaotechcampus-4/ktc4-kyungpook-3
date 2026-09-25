"""전사 차이가 추출에 주는 영향(stt/eval/extract_diff.py). LLM 은 가짜 전송으로 대신한다."""

import json
from types import SimpleNamespace

from extract.llm import ExtractionResult, RelevanceResult
from shared.schemas import ExtractedTask, Transcript, TranscriptSegment
from stt.eval import extract_diff as X


# ─────────────────────────────────────────── 요청 모양
def test_strict_schema_requires_every_field_and_forbids_extras():
    s = X.strict_schema(ExtractionResult)
    item = s["$defs"]["ExtractionItem"]
    assert item["additionalProperties"] is False
    assert set(item["required"]) == set(item["properties"])
    assert "default" not in item["properties"]["assignee_mention"]


class FakePost:
    def __init__(self, replies):
        self.replies = list(replies)
        self.bodies = []

    def __call__(self, url, headers=None, json=None, timeout=None):
        self.bodies.append(json)
        status, body = self.replies.pop(0)
        return SimpleNamespace(status_code=status, text=str(body), json=lambda: body)


def _ok(content, pt=10, ct=5):
    return 200, {"choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": pt, "completion_tokens": ct}}


def test_http_client_speaks_the_parse_protocol_and_records_usage():
    post = FakePost([(503, {"error": "busy"}), _ok('{"relevant_indices": [1, 2]}', 30, 7)])
    c = X.HttpChat("https://llm.example/v1", "k", post=post, retry_wait_s=0)
    r = c.chat.completions.parse(model="m", messages=[{"role": "user", "content": "x"}],
                                 response_format=RelevanceResult, temperature=0.0, max_completion_tokens=100)
    assert RelevanceResult.model_validate_json(r.choices[0].message.content).relevant_indices == [1, 2]
    body = post.bodies[-1]
    assert body["response_format"]["type"] == "json_schema" and body["response_format"]["json_schema"]["strict"]
    assert body["max_completion_tokens"] == 100 and body["temperature"] == 0.0
    assert c.usage == [{"model": "m", "prompt_tokens": 30, "completion_tokens": 7, "retries": 1,
                        "dt": c.usage[0]["dt"]}]


# ─────────────────────────────────────────── 할일 짝짓기
def _tr(*segs):
    return Transcript(segments=[TranscriptSegment(speaker=s, start=float(i), end=i + 0.9, text=t)
                                for i, (s, t) in enumerate(segs)])


def _task(task, src, typ="first", mention=None, resolved=None, due=None):
    return ExtractedTask(task=task, assignee_member_id=None, due_date=due, confidence=1.0, assignee_mention=mention,
                         source_sentence=src, assignee_type=typ, assignee_resolved=resolved)


def test_view_resolves_first_person_to_the_speaker_of_the_source_line():
    tr = _tr(("김환", "그래서 이번 주 안에 통과 기준표를 다시 정리해서 공유드릴게요."), ("유재환", "각자 마무리해 주세요."))
    v = X.view(_task("통과 기준표 정리", "통과 기준표를 다시 정리해서 공유드릴게요", due="2026-09-13"), tr)
    assert (v.speaker, v.assignee, v.due) == ("김환", "김환", "2026-09-13")
    g = X.view(_task("마무리", "각자 마무리해 주세요", typ="group"), tr)
    assert (g.speaker, g.assignee) == ("유재환", "group")


def test_compare_finds_missed_added_and_changed_fields():
    tr = _tr(("김환", "통과 기준표를 정리해서 공유드릴게요."), ("장원준", "데모 버전을 공유드릴게요."))
    ref = [X.view(_task("기준표 공유", "통과 기준표를 정리해서 공유드릴게요", due="2026-09-13"), tr),
           X.view(_task("데모 공유", "데모 버전을 공유드릴게요", due="2026-09-16"), tr)]
    hyp = [X.view(_task("기준표 공유", "통과 기준표를 정리해서 공유드릴게요", due=None), tr),
           X.view(_task("회의록 정리", "회의록을 정리하겠습니다"), tr)]
    got = X.compare(ref, hyp)
    assert (got["matched"], got["missed"], got["added"], got["due_changed"], got["assignee_changed"]) == (1, 1, 1, 1, 0)


def test_consensus_keeps_tasks_seen_in_two_of_three_runs_and_leave_one_out_measures_jitter():
    tr = _tr(("김환", "통과 기준표를 정리해서 공유드릴게요."), ("장원준", "데모 버전을 공유드릴게요."),
             ("최진호", "한 번 더 테스트해 보면 좋을 것 같아요."))
    a = X.view(_task("기준표", "통과 기준표를 정리해서 공유드릴게요"), tr)
    b = X.view(_task("데모", "데모 버전을 공유드릴게요"), tr)
    c = X.view(_task("테스트", "한 번 더 테스트해 보면 좋을 것 같아요", typ="group"), tr)
    runs = [[a, b], [a, b, c], [a]]
    ref = X.Reference(runs)
    assert len(ref.consensus) == 2 and len(ref.known) == 3
    jit = ref.jitter()
    assert max(j["missed"] for j in jit) == 1 and max(j["added"] for j in jit) == 1


def test_expected_check_reads_assignee_and_due_from_the_labelled_intent():
    tr = _tr(("김환", "그래서 이번 주 안에"), ("김환", "통과 기준표를 다시 정리해서 공유드릴게요."))
    t = _task("통과 기준표 정리", "통과 기준표를 다시 정리해서 공유드릴게요", due="2026-09-13")
    t.due_raw = "이번 주 안에"
    got = X.check_expected([{"speaker": "김환", "key": "통과 기준표", "assignee": "김환", "due_raw": "이번 주 안에"}],
                           [X.view(t, tr)])
    assert got == {"expected": 1, "found": 1, "assignee_ok": 1, "due_ok": 1}


def _dump(path, segs, tasks):
    path.write_text(json.dumps({"segments": [s.to_dict() for s in segs], "tasks": [t.to_dict() for t in tasks],
                                "usage": [{"model": "gemini-2.5-flash-lite", "prompt_tokens": 1000,
                                           "completion_tokens": 500}]}, ensure_ascii=False), encoding="utf-8")


def test_report_puts_the_llm_band_first_and_each_transcript_after(tmp_path):
    d = tmp_path / "extract" / "rearr-x"
    d.mkdir(parents=True)
    tr = _tr(("김환", "그래서 이번 주 안에 통과 기준표를 정리해서 공유드릴게요."))
    t = _task("기준표", "통과 기준표를 정리해서 공유드릴게요", due="2026-09-13")
    t.due_raw = "이번 주 안에"
    for k in range(3):
        _dump(d / f"truth__r{k}.json", tr.segments, [t])
    _dump(d / "local-large-v3-turbo__TURN_GAP_S=1__r0.json", tr.segments, [])
    (d / "expected_tasks.json").write_text(json.dumps([{"speaker": "김환", "key": "통과 기준표", "assignee": "김환",
                                                         "due_raw": "이번 주 안에"}], ensure_ascii=False), encoding="utf-8")
    rows = X.report(tmp_path)
    assert rows[0]["전사"] == "정답 (흔들림 폭)" and rows[0]["놓침"] == 0 and rows[0]["의도"] == "1·1·1/1/1·1·1/1/1·1·1/1"
    assert rows[1]["전사"] == "local-large-v3-turbo/TURN_GAP_S=1" and rows[1]["놓침"] == "1" and rows[1]["의도"] == "0·0·0/1"
    c = X.cost(tmp_path)
    assert c["extractions"] == 4 and c["tokens_in"] == 4000 and c["krw"] == round(4 * (1000 * 0.1 + 500 * 0.4) / 1e6 * 1400, 2)


def test_view_strips_a_bare_speaker_prefix_and_finds_the_speaker_inside_a_long_turn():
    long_turn = ("저는 승인 화면 쪽 얘기를 짧게 드리겠습니다. 이번 주에 PM이 할 일 초안을 승인하거나 반려하는 화면의 "
                 "와이어프레임을 그렸고, 백엔드 API 명세가 나오면 바로 연결할 수 있게 목 데이터로 먼저 만들어 두겠습니다.")
    tr = _tr(("장원준", long_turn), ("유재환", "각자 마무리해 주세요."))
    v = X.view(_task("목 데이터 만들기", "장원준: 백엔드 API 명세가 나오면 바로 연결할 수 있게 목데이터로 먼저 만들어"), tr)
    assert (v.source.startswith("백엔드"), v.speaker, v.assignee) == (True, "장원준", "장원준")


def test_report_adds_a_band_from_transcripts_that_differ_only_by_inaudible_noise(tmp_path):
    d = tmp_path / "extract" / "m1"
    d.mkdir(parents=True)
    tr = _tr(("김환", "통과 기준표를 정리해서 공유드릴게요."), ("장원준", "데모 버전을 공유드릴게요."))
    a = _task("기준표", "통과 기준표를 정리해서 공유드릴게요")
    b = _task("데모", "데모 버전을 공유드릴게요")
    for k in range(3):
        _dump(d / f"truth__r{k}.json", tr.segments, [a, b])
    _dump(d / "local-large-v3-turbo__dither1__r0.json", tr.segments, [a, b])
    _dump(d / "local-large-v3-turbo__dither2__r0.json", tr.segments, [a])
    rows = X.report(tmp_path)
    band = [r for r in rows if r["전사"].startswith("디더")]
    assert len(band) == 1 and band[0]["놓침"] == 1 and band[0]["회"] == 2


def test_expected_check_accepts_a_paraphrased_deadline_and_picks_the_best_candidate():
    tr = _tr(("장원준", "데모 가능한 버전을 공유 드릴게요. 다음 주 수요일까지는"),
             ("김환", "그래서 이번 주 안에 통과 기준표를 다시 정리해서 공유해 드릴게요."))
    no_due = _task("데모 가능한 버전 공유하기", "데모 가능한 버전을 공유 드릴게요")
    with_due = _task("데모 가능한 버전 공유하기", "다음 주 수요일까지는", due="2026-09-16")
    with_due.due_raw = "다음 주 수요일까지"
    kim = _task("통과 기준표 공유", "그래서 이번 주 안에 통과 기준표를 다시 정리해서 공유해 드릴게요", due="2026-09-13")
    kim.due_raw = "이번 주 안으로"
    views = [X.view(t, tr) for t in (no_due, with_due, kim)]
    views[1].speaker = "장원준"
    exp = [{"speaker": "장원준", "key": "데모", "assignee": "장원준", "due_raw": "다음 주 수요일까지"},
           {"speaker": "김환", "key": "통과 기준표", "assignee": "김환", "due_raw": "이번 주 안에"}]
    assert X.check_expected(exp, views) == {"expected": 2, "found": 2, "assignee_ok": 2, "due_ok": 2}
