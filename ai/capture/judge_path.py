"""판단 파이프라인(judge/pipeline.py)을 추출 단계의 추출기로 끼우는 자리.

추출 경로는 환경 변수 MM_EXTRACT_PATH 로 고른다. legacy(기본)는 extract.llm.extract_tasks, judge 는 이 모듈이
감싼 judge.pipeline.run 이다. recorder.build_extractor 가 이 값을 보고 고르고, 봇과 워커가 같은 팩토리를
쓰므로 두 모드가 같이 바뀐다.

여기서 하는 일은 셋이다. 판단은 하지 않는다.

  설정 확인   Terra·Luna 키와 주소, BE 주소·워크스페이스·서비스 토큰, 파이프라인 모듈. 하나라도 없으면 추출기를
              만들지 않는다(None). 단계는 "설정 없음" 으로 건너뛰고 옛 경로로 넘어가지 않는다. 넘어가면 같은
              회의에서 다른 모양의 결과가 말없이 나온다
  화자 표기   1단계는 전사본의 speaker 를 그대로 LLM 에 보여 준다. 전사 계약의 speaker 는 uid 라 "너가",
              "그분" 을 이름으로 풀 재료가 없다. 이름으로 바꿔 넣고, 돌아온 항목의 evidence_speaker 는 uid 로
              되돌린다. BE 는 1인칭 담당자를 uid 로 찾는다. 이름은 추출 단계가 넘겨준 것(지금은 매니페스트의
              표시 이름)을 쓴다
  결과 분류   등록할 항목이 하나도 없는데 판단하지 못한 finding 이 있으면 예외로 바꾼다. finding 은 1단계가 고른
              결정이나 진척 보고 하나이고(근거 줄 하나나 여러 줄과 요약 문장), 유사 검색과 판단과 초안은 finding
              마다 돈다. BE 가 꺼졌거나 토큰이 틀리면 finding 이 모두 유사 검색에서 실패하는데 파이프라인은 예외
              없이 빈 결과를 돌려준다. 그대로 등록하면 빈 추출로 회의가 닫히고, BE 는 회의 하나에 추출을 한 번만
              받는다. 다른 finding 이 "바꿀 것 없음" 으로 판단돼 항목이 0개인 경우도 같다. 판단 실패가 "결정 없는
              회의" 로 저장되면 안 된다

finding 몇 개만 실패한 결과를 언제 인계할지는 recorder.extract_after_transcription 이 정한다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from datetime import date

from shared.schemas import Transcript

EXTRACT_PATHS = ("legacy", "judge")
# 설정 이름과 Settings 의 칸. 빠진 것을 이 순서로 말한다
_REQUIRED_LLM = (("TERRA_API_KEY", "terra_api_key"), ("TERRA_BASE_URL", "terra_base_url"),
                 ("LUNA_API_KEY", "luna_api_key"), ("LUNA_BASE_URL", "luna_base_url"))
# 유사 task 검색(BeClient)에만 쓴다. 검색을 밖에서 끼우면(candidates) 보지 않는다
_REQUIRED_BE = (("BE_BASE_URL", "be_base_url"), ("BE_SERVICE_TOKEN", "be_service_token"))


def extract_path() -> str:
    """MM_EXTRACT_PATH. 없으면 legacy. 모르는 값이면 ValueError 다. 봇과 워커가 시작할 때 불러서 오타로 멈춘다."""
    path = os.environ.get("MM_EXTRACT_PATH", "").strip() or "legacy"
    if path not in EXTRACT_PATHS:
        raise ValueError(f"MM_EXTRACT_PATH 는 legacy 또는 judge 다. 받은 값: {path!r}")
    return path


@dataclass
class JudgeOutput:
    """판단 경로의 추출 결과. finding 하나마다 결과 하나다(#217). 항목은 POST /extractions 의 항목 모양 그대로다.

    outcomes 의 하나는 {"indices": 근거 문장 번호, "kind": "item" | "skip" | "failure", "item": 항목 또는 None,
    "failure": {"stage", "text"(요약 문장), "reason"} 또는 None} 이다. skip 은 의미 없음이거나 바뀌는 것 없는 수정이다.
    """

    outcomes: list[dict] = field(default_factory=list)
    dropped: dict = field(default_factory=dict)            # 1단계에서 검증에 탈락한 항목 기록(PipelineResult.dropped, #186)

    @property
    def items(self) -> list[dict]:
        return [o["item"] for o in self.outcomes if o["kind"] == "item"]

    @property
    def failures(self) -> list[dict]:
        return [o["failure"] for o in self.outcomes if o["kind"] == "failure"]


def merge_runs(runs: list[list[dict]]) -> tuple[list[dict], list[dict]]:
    """다시 돌린 판단 실행들의 finding 별 결과를 얘기 단위로 합쳐 (항목, 판단하지 못한 finding) 을 돌려준다(#217).

    1단계는 실행마다 발화를 다르게 묶고 요약 문장도 다시 쓴다. 근거 문장 번호는 같은 전사를 가리키므로, 번호가
    하나라도 겹치는 finding 은 실행이 달라도 같은 얘기로 묶는다. 얘기마다 이렇게 정한다.
      한 번이라도 항목이 나왔으면 항목을 남긴다. 같은 카드가 두 장 서지 않게 실행 하나의 것만 쓴다(실패 없이 끝난
      실행, 항목이 많은 실행, 먼저 돈 실행 순). 실행마다 판단이 엇갈려도 남겨서 PM 이 본다
      어느 실행에서든 실패 없이 끝났으면 실패로 세지 않는다. 모든 실행이 실패했을 때만 실패로 남긴다
    finding 이 하나도 없는 실행(1단계가 응답을 이상하게 준 경우)은 아무것도 바꾸지 않는다. 항목은 근거 문장 순서다.
    """
    nodes = [(r, o) for r, run in enumerate(runs) for o in run]
    parent = list(range(len(nodes)))

    def root(i: int) -> int:
        while parent[i] != i:
            i = parent[i]
        return i

    for i, (run_i, a) in enumerate(nodes):
        for j in range(i):
            run_j, b = nodes[j]
            if run_i != run_j and set(a["indices"]) & set(b["indices"]):
                parent[root(i)] = root(j)
    stories: dict[int, list[int]] = {}
    for i in range(len(nodes)):
        stories.setdefault(root(i), []).append(i)

    items: list[dict] = []
    failures: list[dict] = []
    for members in sorted(stories.values(), key=lambda m: min(min(nodes[i][1]["indices"]) for i in m)):
        by_run: dict[int, list[dict]] = {}
        for i in members:
            by_run.setdefault(nodes[i][0], []).append(nodes[i][1])

        def count(r: int, kind: str) -> int:
            return sum(o["kind"] == kind for o in by_run[r])

        clean = [r for r in by_run if not count(r, "failure")]
        with_items = [r for r in by_run if count(r, "item")]
        if with_items:
            pick = min(with_items, key=lambda r: (count(r, "failure") > 0, -count(r, "item"), r))
        elif not clean:
            pick = min(by_run, key=lambda r: (count(r, "failure"), r))
        else:
            continue                                   # 실패 없이 모두 건너뛴 얘기
        items += [o["item"] for o in by_run[pick] if o["kind"] == "item"]
        if not clean:
            failures += [o["failure"] for o in by_run[pick] if o["kind"] == "failure"]
    return items, failures


class JudgeAllFailed(RuntimeError):
    """등록할 항목이 하나도 없는데 판단하지 못한 finding 이 있다. 빈 추출로 닫지 않고 회의 전체의 실패로 본다."""


def missing_settings(cfg=None, *, run=None, candidates=None) -> list[str]:
    """판단 경로에 없는 설정의 이름. 비어 있으면 돌 수 있다. run 을 밖에서 끼웠으면 모듈은 확인하지 않는다.

    candidates(유사 task 검색)를 밖에서 끼웠으면 BE 설정은 확인하지 않는다. BE 없이 판단만 돌리는 채팅 폴링 검증
    (capture/chat_poll.py)이 그렇다. 봇과 워커는 끼우지 않으므로 지금처럼 BE 설정까지 요구한다.
    """
    if cfg is None:
        from shared.config import settings
        cfg = settings()
    if (getattr(cfg, "llm_mode", "") or "").lower() == "off":
        return ["PM_AGENT_LLM=off"]
    required = _REQUIRED_LLM + (_REQUIRED_BE if candidates is None else ())
    missing = [name for name, attr in required if not getattr(cfg, attr, "")]
    if run is None:
        try:
            import judge.pipeline  # noqa: F401
        except ImportError:
            missing.append("judge.pipeline 모듈")
        try:
            import openai  # noqa: F401 - 없으면 Terra·Luna 클라이언트가 꺼진 채로 만들어진다
        except ImportError:
            missing.append("openai 패키지")
    return missing


def speaker_labels(names: dict[str, str]) -> dict[str, str]:
    """uid → 파이프라인에 보일 이름. 같은 이름이 또 나오면 "이름(2)" 로 갈라 uid 로 되돌릴 수 있게 한다."""
    labels: dict[str, str] = {}
    taken: set[str] = set()
    for uid, name in names.items():
        base = (name or "").strip() or str(uid)
        label, n = base, 1
        while label in taken:
            n += 1
            label = f"{base}({n})"
        taken.add(label)
        labels[str(uid)] = label
    return labels


def _relabel(transcript: Transcript, labels: dict[str, str]) -> Transcript:
    return Transcript(segments=[replace(s, speaker=labels.get(s.speaker, s.speaker)) for s in transcript.segments],
                      source=transcript.source)


def _restore(items: list[dict], labels: dict[str, str], names: dict[str, str], speakers: set[str]) -> list[dict]:
    """항목의 화자를 uid 로 되돌린다. 되돌릴 수 없는 값은 비운다(BE 가 담당 미정으로 PM 에게 보낸다).

    이름이 겹쳐 붙였던 꼬리표는 PM 이 읽는 글에서 뗀다. 담당자 이름(BE 는 그 값으로 별칭을 찾는다), 제목, 설명
    문장이다. "민수(2)님" 처럼 호칭이 붙어 돌아오기도 해서 통째로 같은지가 아니라 들어 있는지를 본다.
    """
    uid_of = {label: uid for uid, label in labels.items()}
    tagged = {label: (names.get(uid) or "").strip() for uid, label in labels.items()
              if label != ((names.get(uid) or "").strip() or uid)}
    out = []
    for item in items:
        item = dict(item)
        speaker = item.get("evidence_speaker")
        if speaker in uid_of:
            item["evidence_speaker"] = uid_of[speaker]
        elif speaker not in speakers:          # 이름이 없어 uid 로 나간 화자는 그대로 돌아온다. 그 밖의 값은 모르는 화자다
            item["evidence_speaker"] = None
        for key in ("assignee_raw", "task_title", "doc_text"):
            value = item.get(key)
            if isinstance(value, str):
                for label, name in tagged.items():
                    value = value.replace(label, name)
                item[key] = value
        out.append(item)
    return out


def build_extractor(*, run=None, candidates=None, cfg=None):
    """판단 추출기 extract(transcript, speaker_names, today, workspace_id) -> JudgeOutput. 설정이 없으면 None.

    workspace_id 는 회의의 워크스페이스다(매니페스트, #199). 유사 task 검색이 그 워크스페이스에서 찾는다.

    run 은 judge.pipeline.run, candidates 는 유사 task 검색(capture.handoff.BeClient)이다. 테스트가 바꿔 끼운다.
    """
    if cfg is None:
        from shared.config import settings
        cfg = settings()
    if missing_settings(cfg, run=run, candidates=candidates):
        return None
    if run is None:
        from judge.pipeline import run
    if candidates is None:
        from capture.handoff import BeClient
        candidates = BeClient(cfg.be_base_url, service_token=cfg.be_service_token)

    def extract(transcript: Transcript, speaker_names: dict[str, str] | None, today: date,
                workspace_id: str | None = None, *, context: Transcript | None = None,
                dates: dict[int, date] | None = None) -> JudgeOutput:
        if not workspace_id:
            # 없으면 유사 검색이 /workspaces/None/... 로 가서 엉뚱한 404 나 판단 실패로 보인다
            raise ValueError("유사 task 검색에 쓸 워크스페이스가 없다(매니페스트 workspace_id)")
        names = {str(k): v for k, v in (speaker_names or {}).items()}
        labels = speaker_labels(names)
        extra: dict = {}  # 없으면 넘기지 않는다 — 음성 회의 경로와 예전 run 은 그대로
        if context is not None:
            extra["context"] = _relabel(context, labels)
        if dates is not None:
            extra["dates"] = dates
        result = run(_relabel(transcript, labels), workspace_id=workspace_id, today=today, candidates=candidates, **extra)
        failures = {id(f): {"stage": f.stage, "text": f.finding_text, "reason": f.reason} for f in result.failures}
        if failures and not result.items:
            first = next(iter(failures.values()))
            raise JudgeAllFailed(f"등록할 항목이 없고 판단하지 못한 발화 {len(failures)}개만 남았다. "
                                 f"첫 실패({first['stage']}): {first['reason']}")
        speakers = {s.speaker for s in transcript.segments if s.speaker is not None}
        items = dict(zip(map(id, result.items), _restore(result.items, labels, names, speakers)))
        outcomes = [{"indices": list(o.indices), "kind": o.kind,
                     "item": items[id(o.item)] if o.kind == "item" else None,
                     "failure": failures[id(o.failure)] if o.kind == "failure" else None} for o in result.outcomes]
        return JudgeOutput(outcomes=outcomes, dropped=result.dropped)

    return extract


def reply_judger(cfg=None):
    """봇의 답장 판단기 judger(item) -> 판단 본문(judge.reply.judge_reply). 설정이 없으면 None 이라 답장 루프를 띄우지 않는다.

    Jev 는 보지 않는다. 없으면 근거가 모두 inferred 라 자동 반영이 없고, 후보가 둘 이상이면 대상을 확인하지 못해 PM 이 고른다.
    """
    if missing_settings(cfg):
        return None
    from judge.reply import judge_reply
    return judge_reply
