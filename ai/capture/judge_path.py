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
_REQUIRED = (("TERRA_API_KEY", "terra_api_key"), ("TERRA_BASE_URL", "terra_base_url"),
             ("LUNA_API_KEY", "luna_api_key"), ("LUNA_BASE_URL", "luna_base_url"),
             ("BE_BASE_URL", "be_base_url"), ("BE_WORKSPACE_ID", "be_workspace_id"),
             ("BE_SERVICE_TOKEN", "be_service_token"))


def extract_path() -> str:
    """MM_EXTRACT_PATH. 없으면 legacy. 모르는 값이면 ValueError 다. 봇과 워커가 시작할 때 불러서 오타로 멈춘다."""
    path = os.environ.get("MM_EXTRACT_PATH", "").strip() or "legacy"
    if path not in EXTRACT_PATHS:
        raise ValueError(f"MM_EXTRACT_PATH 는 legacy 또는 judge 다. 받은 값: {path!r}")
    return path


@dataclass
class JudgeOutput:
    """판단 경로의 추출 결과. items 는 POST /extractions 의 항목 모양 그대로다."""

    items: list[dict] = field(default_factory=list)
    failures: list[dict] = field(default_factory=list)     # 판단하지 못한 finding [{"stage", "text"(요약 문장), "reason"}]


class JudgeAllFailed(RuntimeError):
    """등록할 항목이 하나도 없는데 판단하지 못한 finding 이 있다. 빈 추출로 닫지 않고 회의 전체의 실패로 본다."""


def missing_settings(cfg=None, *, run=None) -> list[str]:
    """판단 경로에 없는 설정의 이름. 비어 있으면 돌 수 있다. run 을 밖에서 끼웠으면 모듈은 확인하지 않는다."""
    if cfg is None:
        from shared.config import settings
        cfg = settings()
    if (getattr(cfg, "llm_mode", "") or "").lower() == "off":
        return ["PM_AGENT_LLM=off"]
    missing = [name for name, attr in _REQUIRED if not getattr(cfg, attr, "")]
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
    """판단 추출기 extract(transcript, speaker_names, today) -> JudgeOutput. 설정이 없으면 None.

    run 은 judge.pipeline.run, candidates 는 유사 task 검색(capture.handoff.BeClient)이다. 테스트가 바꿔 끼운다.
    """
    if cfg is None:
        from shared.config import settings
        cfg = settings()
    if missing_settings(cfg, run=run):
        return None
    if run is None:
        from judge.pipeline import run
    if candidates is None:
        from capture.handoff import BeClient
        candidates = BeClient(cfg.be_base_url, service_token=cfg.be_service_token)
    workspace_id = cfg.be_workspace_id

    def extract(transcript: Transcript, speaker_names: dict[str, str] | None, today: date) -> JudgeOutput:
        names = {str(k): v for k, v in (speaker_names or {}).items()}
        labels = speaker_labels(names)
        result = run(_relabel(transcript, labels), workspace_id=workspace_id, today=today, candidates=candidates)
        failures = [{"stage": f.stage, "text": f.finding_text, "reason": f.reason} for f in result.failures]
        if failures and not result.items:
            first = failures[0]
            raise JudgeAllFailed(f"등록할 항목이 없고 판단하지 못한 발화 {len(failures)}개만 남았다. "
                                 f"첫 실패({first['stage']}): {first['reason']}")
        speakers = {s.speaker for s in transcript.segments if s.speaker is not None}
        return JudgeOutput(items=_restore(result.items, labels, names, speakers), failures=failures)

    return extract
