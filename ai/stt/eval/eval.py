"""Phase 0 평가 — 전사 정확도(WER/CER) 계산 + 크로스토크 체크리스트 → eval_report.md 생성.

사용 순서 (ai/ 디렉토리 안에서)
  1) python stt/eval/eval.py --init
       recordings/session_*.json 을 읽어 ground_truth/eval_config.json 스켈레톤 생성
       (세션별 scenario, 화자별 정답 스크립트 파일명, 크로스토크 체크 항목을 손으로 채우면 됨)
  2) python stt/eval/eval.py
       transcripts/*.json 을 모두 평가해 eval_report.md 작성 (콘솔에도 요약 출력)

eval_config.json 형식
{
  "speakers": {                       # 전 세션 공통 매핑 (user_id 또는 표시 이름 → 정답 파일)
    "123456789012345678": "speaker1_script.txt",
    "홍길동": "speaker2_script.txt"
  },
  "sessions": {
    "1725000000": {                   # 파일명의 timestamp = 세션 ID
      "scenario": "reading",          # reading(정독) | conversation(대화)
      "speakers": { "123456789012345678": "conv_speaker1.txt" },   # 세션별 override (선택)
      "crosstalk": {                  # 사람이 들으며 체크: true = 문제 있음, false = 문제 없음, null = 미확인
        "다른 화자 목소리가 섞여 들림": false, ...
      }
    }
  }
}
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]  # ai/ 자체 (독립 프로젝트 루트)
RECORDINGS_DIR = BASE_DIR / "recordings"
TRANSCRIPTS_DIR = BASE_DIR / "transcripts"
GROUND_TRUTH_DIR = Path(__file__).resolve().parent / "ground_truth"
CONFIG_PATH = GROUND_TRUTH_DIR / "eval_config.json"
REPORT_PATH = BASE_DIR / "eval_report.md"

# 통과 기준 (계획서 4장). 한국어는 띄어쓰기 관습 때문에 어절 단위 WER 이 체감보다 높게 나오므로
# PASS/FAIL 은 공백 무시 CER 로 판정하고, WER 은 참고용으로만 나란히 표시한다.
CER_THRESHOLDS = {"reading": 0.05, "conversation": 0.10}
MAX_SEC_PER_AUDIO_MIN = 30.0
SCENARIO_LABEL = {"reading": "정독", "conversation": "대화"}

CROSSTALK_ITEMS = [
    "이 화자 파일에 다른 화자의 목소리가 섞여 들리는가 (크로스토크)",
    "말 안 할 때(침묵 구간)에 다른 사람 소리가 새어 들어오는가",
    "여러 명이 동시에 말한 구간에서 자기 트랙에 다른 목소리가 잡히는가",
    "녹음 시작/끝에 소리 끊김이나 씹힘이 있는가",
]

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+")


# ---------------------------------------------------------------- 텍스트 처리
def normalize(text: str) -> str:
    """문장부호 제거 + 공백 정리. 어절 단위 WER(정규화)용."""
    text = _PUNCT_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


def nospace(text: str) -> str:
    """공백까지 제거. 한국어 띄어쓰기 차이를 무시한 CER용."""
    return _WS_RE.sub("", normalize(text))


def token_diff(ref: str, hyp: str) -> str:
    """어절 단위 diff 를 한 줄로: [-정답-]{+결과+}"""
    r, h = normalize(ref).split(), normalize(hyp).split()
    out: list[str] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=r, b=h, autojunk=False).get_opcodes():
        if tag == "equal":
            out.extend(r[i1:i2])
        elif tag == "delete":
            out.append("[-" + " ".join(r[i1:i2]) + "-]")
        elif tag == "insert":
            out.append("{+" + " ".join(h[j1:j2]) + "+}")
        else:  # replace
            out.append("[-" + " ".join(r[i1:i2]) + "-]{+" + " ".join(h[j1:j2]) + "+}")
    return " ".join(out)


def score(ref: str, hyp: str) -> dict:
    import jiwer

    ref_n, hyp_n = normalize(ref), normalize(hyp)
    result = {
        "wer_raw": jiwer.wer(ref, hyp) if ref.strip() else None,
        "wer_norm": jiwer.wer(ref_n, hyp_n) if ref_n else None,
        "cer_nospace": jiwer.cer(nospace(ref), nospace(hyp)) if nospace(ref) else None,
    }
    if ref_n:
        m = jiwer.process_words(ref_n, hyp_n)
        result.update(
            {"ref_words": len(ref_n.split()), "sub": m.substitutions, "del": m.deletions, "ins": m.insertions}
        )
    return result


# ---------------------------------------------------------------- 데이터 로드
def load_manifests() -> dict[str, dict]:
    sessions: dict[str, dict] = {}
    for mp in sorted(RECORDINGS_DIR.glob("session_*.json")):
        try:
            data = json.loads(mp.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        sessions[str(data.get("session", mp.stem.split("_", 1)[-1]))] = data
    return sessions


def display_names(manifests: dict[str, dict]) -> dict[str, str]:
    names: dict[str, str] = {}
    for m in manifests.values():
        for sp in m.get("speakers", []):
            names[str(sp["user_id"])] = sp.get("display_name") or str(sp["user_id"])
    return names


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {"speakers": {}, "sessions": {}}
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    cfg.setdefault("speakers", {})
    cfg.setdefault("sessions", {})
    return cfg


def parse_transcript_name(stem: str) -> tuple[str, str, str]:
    """'{user_id}_{ts}__{model}' → (user_id, ts, model)"""
    base, _, model = stem.partition("__")
    user_id, _, ts = base.partition("_")
    return user_id, ts, model or "?"


def resolve_ground_truth(cfg: dict, session: str, user_id: str, name: str) -> Path | None:
    mapping = dict(cfg.get("speakers", {}))
    mapping.update(cfg.get("sessions", {}).get(session, {}).get("speakers", {}))
    fname = mapping.get(user_id) or mapping.get(name)
    if not fname:
        return None
    p = Path(fname)
    return p if p.is_absolute() else GROUND_TRUTH_DIR / p


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


# ---------------------------------------------------------------- --init
def init_config(force: bool) -> int:
    manifests = load_manifests()
    if not manifests:
        print("recordings/session_*.json 이 없습니다. 먼저 봇으로 녹음하세요.", file=sys.stderr)
        return 1
    if CONFIG_PATH.exists() and not force:
        print(f"{CONFIG_PATH} 가 이미 있습니다. 덮어쓰려면 --force 를 붙이세요.", file=sys.stderr)
        return 1

    cfg = {
        "_help": "speakers: user_id(또는 표시 이름) → ground_truth/ 안의 정답 파일명. "
        "sessions[ts].scenario: reading | conversation. crosstalk: true=문제 있음 / false=없음 / null=미확인",
        "speakers": {},
        "sessions": {},
    }
    for ts, m in manifests.items():
        for sp in m.get("speakers", []):
            cfg["speakers"].setdefault(str(sp["user_id"]), "")
        cfg["sessions"][ts] = {
            "recorded_at": m.get("recorded_at"),
            "participants": [f"{sp.get('display_name')} ({sp['user_id']})" for sp in m.get("speakers", [])],
            "scenario": "reading",
            "speakers": {},
            "crosstalk": {item: None for item in CROSSTALK_ITEMS},
        }

    GROUND_TRUTH_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"생성: {CONFIG_PATH}")
    print("→ speakers 의 정답 파일명, 세션별 scenario, crosstalk 항목(true/false)을 채운 뒤 `python stt/eval/eval.py` 를 실행하세요.")
    return 0


# ---------------------------------------------------------------- 평가
def pct(v: float | None) -> str:
    return "-" if v is None else f"{v * 100:.1f}%"


def evaluate(args) -> int:
    try:
        import jiwer  # noqa: F401
    except ImportError:
        print("jiwer 가 없습니다:  pip install jiwer", file=sys.stderr)
        return 1

    cfg = load_config()
    manifests = load_manifests()
    names = display_names(manifests)
    transcripts = sorted(p for p in Path(args.transcripts).glob("*.json") if "__" in p.stem)
    if not transcripts:
        print(f"{args.transcripts} 에 전사 결과(.json)가 없습니다. stt/transcribe.py 를 먼저 실행하세요.", file=sys.stderr)
        return 1

    rows: list[dict] = []
    missing: list[str] = []
    for tp in transcripts:
        data = json.loads(tp.read_text(encoding="utf-8"))
        user_id, ts, model = parse_transcript_name(tp.stem)
        name = data.get("speaker") or names.get(user_id, user_id)
        scenario = cfg["sessions"].get(ts, {}).get("scenario") or args.scenario
        gt_path = resolve_ground_truth(cfg, ts, user_id, name)
        if gt_path is None or not gt_path.exists():
            missing.append(f"{tp.name} (화자 {name}, 세션 {ts})")
            continue

        ref, hyp = read_text(gt_path), data.get("text", "")
        s = score(ref, hyp)
        threshold = CER_THRESHOLDS.get(scenario, CER_THRESHOLDS["reading"])
        per_min = data.get("sec_per_audio_min")
        rows.append(
            {
                "session": ts,
                "speaker": name,
                "file": data.get("audio_file", tp.stem),
                "model": model,
                "scenario": scenario,
                "threshold": threshold,
                "audio_sec": data.get("audio_duration_sec"),
                "per_min": per_min,
                "time_pass": None if per_min is None else per_min <= MAX_SEC_PER_AUDIO_MIN,
                "cer_pass": None if s["cer_nospace"] is None else s["cer_nospace"] <= threshold,
                "ref": ref,
                "hyp": hyp,
                "gt_file": gt_path.name,
                **s,
            }
        )

    report = build_report(rows, cfg, manifests, missing)
    Path(args.report).write_text(report, encoding="utf-8")
    print(report)
    print(f"\n보고서 저장: {args.report}")
    return 0


def build_report(rows: list[dict], cfg: dict, manifests: dict, missing: list[str]) -> str:
    L: list[str] = []
    L.append("# STT·화자분리 검증 결과\n")

    # 1. 전사 정확도
    L.append("## 1. 전사 정확도\n")
    L.append("WER(정규화) = 문장부호 제거 후 어절 단위 오류율. CER(공백 제거) = 띄어쓰기 차이를 무시한 글자 단위 오류율. "
             "한국어는 띄어쓰기 관습 때문에 WER 이 체감보다 높게 나오므로, PASS/FAIL 은 CER 기준으로 판정하고 WER 은 참고용으로 나란히 봅니다.\n")
    L.append("| 세션 | 화자 | 모델 | 시나리오 | WER(원본) | WER(정규화) | CER(공백제거) | 기준 | CER 판정 | 전사 s/1분 | 시간 판정 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(rows, key=lambda x: (x["session"], x["speaker"], x["model"])):
        per_min = "-" if r["per_min"] is None else f"{r['per_min']:.1f}"
        L.append(
            f"| {r['session']} | {r['speaker']} | {r['model']} | {SCENARIO_LABEL.get(r['scenario'], r['scenario'])} "
            f"| {pct(r['wer_raw'])} | {pct(r['wer_norm'])} | {pct(r['cer_nospace'])} | ≤{pct(r['threshold'])} "
            f"| {verdict(r['cer_pass'])} | {per_min} | {verdict(r['time_pass'])} |"
        )
    if not rows:
        L.append("| (평가 가능한 전사 결과 없음) | | | | | | | | | | |")
    if missing:
        L.append("\n정답 스크립트가 지정되지 않아 건너뛴 파일:")
        L.extend(f"- {m}" for m in missing)
        L.append("\n→ `ground_truth/eval_config.json` 의 `speakers` 에 정답 파일명을 채워 주세요.")
    L.append("")

    # 2. 크로스토크 체크리스트
    L.append("## 2. 화자 분리 품질 (크로스토크 체크리스트, 수동)\n")
    L.append("각 화자 wav 를 직접 들으며 판단. 통과 기준: 4개 항목 모두 **아니오**.\n")
    sessions = sorted(set(list(cfg.get("sessions", {}).keys()) + list(manifests.keys())))
    if not sessions:
        L.append("(세션 정보 없음. `python stt/eval/eval.py --init` 로 설정 파일을 만든 뒤 채워 주세요.)\n")
    for ts in sessions:
        sc = cfg.get("sessions", {}).get(ts, {})
        m = manifests.get(ts, {})
        participants = ", ".join(sp.get("display_name", sp["user_id"]) for sp in m.get("speakers", [])) or "-"
        scenario = SCENARIO_LABEL.get(sc.get("scenario"), sc.get("scenario") or "-")
        L.append(f"### 세션 {ts} — {scenario} / 참가자: {participants}\n")
        L.append("| 항목 | 문제 있음? | 결과 |")
        L.append("|---|---|---|")
        answers = sc.get("crosstalk", {})
        for item in CROSSTALK_ITEMS:
            a = answers.get(item)
            if a is None:
                L.append(f"| {item} | ☐ 미확인 | - |")
            elif a:
                L.append(f"| {item} | 예 | ❌ FAIL |")
            else:
                L.append(f"| {item} | 아니오 | ✅ |")
        L.append(f"\n**세션 판정:** {verdict(crosstalk_state(answers))}\n")

    # 3. 통과 기준 대비 요약
    L.append("## 3. 통과 기준 대비 요약\n")
    L.append("| 항목 | 목표 | 결과 | 판정 |")
    L.append("|---|---|---|---|")
    for scenario, th in CER_THRESHOLDS.items():
        sub = [r for r in rows if r["scenario"] == scenario and r["cer_nospace"] is not None]
        if sub:
            worst = max(r["cer_nospace"] for r in sub)
            mean = sum(r["cer_nospace"] for r in sub) / len(sub)
            L.append(
                f"| {SCENARIO_LABEL[scenario]} 시나리오 CER(공백제거) | {pct(th)} 이하 "
                f"| 평균 {pct(mean)}, 최대 {pct(worst)} ({len(sub)}건) | {verdict(worst <= th)} |"
            )
        else:
            L.append(f"| {SCENARIO_LABEL[scenario]} 시나리오 CER(공백제거) | {pct(th)} 이하 | 데이터 없음 | - |")

    ct_states = [crosstalk_state(cfg.get("sessions", {}).get(ts, {}).get("crosstalk", {})) for ts in sessions]
    if ct_states:
        ct = False if False in ct_states else (None if None in ct_states else True)
        L.append(f"| 크로스토크 | 4개 항목 모두 아니오 | 세션 {len(ct_states)}개 중 통과 {sum(1 for s in ct_states if s is True)}개 | {verdict(ct)} |")
    else:
        L.append("| 크로스토크 | 4개 항목 모두 아니오 | 데이터 없음 | - |")

    timed = [r for r in rows if r["per_min"] is not None]
    if timed:
        worst_t = max(r["per_min"] for r in timed)
        L.append(f"| 처리 시간 | 오디오 1분당 {MAX_SEC_PER_AUDIO_MIN:.0f}초 이내 | 최대 {worst_t:.1f}초/1분 | {verdict(worst_t <= MAX_SEC_PER_AUDIO_MIN)} |")
    else:
        L.append(f"| 처리 시간 | 오디오 1분당 {MAX_SEC_PER_AUDIO_MIN:.0f}초 이내 | 데이터 없음 | - |")
    L.append("")

    # 4. 정성 비교
    L.append("## 4. 정답 vs 전사 나란히 비교 (정성 평가)\n")
    L.append("표기: `[-정답에만 있음-]` `{+전사에만 있음+}`\n")
    for r in sorted(rows, key=lambda x: (x["session"], x["speaker"], x["model"])):
        L.append(f"### {r['speaker']} / {r['model']} / 세션 {r['session']} (정답: {r['gt_file']})\n")
        if r.get("ref_words"):
            L.append(f"어절 {r['ref_words']}개 중 대체 {r['sub']} · 누락 {r['del']} · 삽입 {r['ins']}\n")
        L.append("**정답**\n")
        L.append("> " + r["ref"].replace("\n", "\n> ") + "\n")
        L.append("**전사**\n")
        L.append("> " + (r["hyp"] or "(빈 결과)").replace("\n", "\n> ") + "\n")
        L.append("**diff**\n")
        L.append("```\n" + token_diff(r["ref"], r["hyp"]) + "\n```\n")

    return "\n".join(L)


def crosstalk_state(answers: dict) -> bool | None:
    """4개 항목 → 세션 판정. 하나라도 '문제 있음(true)'이면 False, 미확인(null)이 남아 있으면 None, 모두 false 면 True."""
    vals = [answers.get(item) for item in CROSSTALK_ITEMS]
    if any(v is True for v in vals):
        return False
    if any(v is None for v in vals):
        return None
    return True


def verdict(ok: bool | None) -> str:
    if ok is None:
        return "미확인"
    return "✅ PASS" if ok else "❌ FAIL"


def main() -> int:
    ap = argparse.ArgumentParser(description="WER/CER 계산 + 크로스토크 체크리스트 보고서")
    ap.add_argument("--init", action="store_true", help="ground_truth/eval_config.json 스켈레톤 생성")
    ap.add_argument("--force", action="store_true", help="--init 시 기존 설정 덮어쓰기")
    ap.add_argument("--transcripts", default=str(TRANSCRIPTS_DIR))
    ap.add_argument("--scenario", default="reading", choices=list(CER_THRESHOLDS), help="설정 파일에 시나리오가 없을 때 기본값")
    ap.add_argument("--report", default=str(REPORT_PATH))
    args = ap.parse_args()
    if args.init:
        return init_config(args.force)
    return evaluate(args)


if __name__ == "__main__":
    sys.exit(main())
