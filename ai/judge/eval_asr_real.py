"""전사 오인식 검사(judge/asr_check.py)를 실제 STT 오류로 잰다 — AI Hub 회의 음성(KconfSpeech) + 운영 STT(Elice) + Jev.

정답 대본이 있는 실제 회의 발화를 운영 STT 로 전사하고, 전사의 명사 중 정답에 없는 것을 실제로 틀린 명사로 본다.
AI Hub 에는 태스크 제목이 없어 발화의 명사를 제목 대신 본다(제목은 명사가 더 적어 의심 단어도 더 적다).
- 용어 목록: 운영과 같은 기본 목록(분석기 빈도 상위 명사 + 업무 용어 파일) + "지난 회의"(이번에 재지 않은 회의의
  정답 대본에서 두 사람 이상이 말한 명사, BE 의 워크스페이스 용어 대신)
- 1단계: 목록에 없는 명사 = 의심 단어. 2단계: 발화마다 Jev 한 번에 의심 단어별 "맞게 적힌 말인가?"(운영과 같은 질문)
- 잰 값: 명사가 틀린 발화 중 막은 비율(잡음), 명사가 맞는 발화 중 막은 비율(괜히 막음)을 기준값별로. Jev 없이 의심
  단어를 전부 막을 때(1단계 상한)도 같이 낸다.

AI Hub 원문은 재배포하지 않는다. 전사·결과(--out)는 레포 밖에 둔다(stt/eval/rawdir.py 가 레포 안이면 멈춘다).
Elice 단가 ₩6/분이라 120분이면 약 720원이다. --yes 없이는 고른 발화 수와 견적만 찍는다.
같은 --out 으로 다시 돌리면 이미 받은 전사·Jev 답은 다시 보내지 않는다(stt.jsonl, jev.jsonl).

데이터 모양: 라벨 zip([라벨]KconfSpeech_*_label_*.zip, 풀지 않는다) 안에 회의마다 <회의>.json(dialogs: speaker,
audioPath, textPath)과 발화별 txt 가 있고, 원천 zip 을 푼 폴더에 발화별 wav 가 같은 상대 경로(D20/G02/S000314/000000.wav)로
있다. wav 가 있는 발화만 쓴다(원천을 일부만 받아도 된다).

실행 (ai/ 안에서, .env 에 ELICE_API_KEY·ELICE_STT_BASE_URL·JEV_API_KEY):
    .venv/bin/python -m judge.eval_asr_real --labels <라벨 zip 폴더> --audio <원천 wav 를 푼 폴더> --out <레포 밖 폴더>
    ... --yes            # 실제로 전사하고 Jev 에 묻고 잰다
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import shared.config  # noqa: F401 - 가져오면 .env 를 읽는다(ELICE_API_KEY·ELICE_STT_BASE_URL·JEV_API_KEY)
from judge import asr_check
from judge.evidence import _state

SR = 16_000
MIN_S, MAX_S = 0.5, 28.0   # 운영 묶음 상한(28초)보다 긴 발화는 뺀다

# ── 전사 표기(KsponSpeech 규칙) → 정답 문자열. (철자)/(발음) 은 철자 쪽(STT 가 적는 쪽), "n/"·"o/" 같은 잡음 표시와
# "어/" 같은 간투어, "+" 가 붙은 더듬은 말은 뺀다. 알아듣지 못함(u/, *)과 가린 이름(@)이 있으면 쓰지 않는다
_PAIR = re.compile(r"\(([^()]*)\)/\(([^()]*)\)")


def clean_form(text: str) -> str | None:
    if re.search(r"(^|\s)u/|\*|@", text):
        return None
    s = _PAIR.sub(lambda m: m.group(1), text)
    s = re.sub(r"(?<![가-힣A-Za-z])[a-z]/", " ", s)     # 잡음 표시
    s = re.sub(r"[가-힣]+/(?=[\s.,?!]|$)", " ", s)      # 간투어("어/"). 뒤에 글자가 붙은 "가계/가게" 는 풀지 않는다
    s = " ".join(w for w in s.split() if "+" not in w)
    if re.search(r"[()/]", s):
        return None
    return " ".join(s.split()) or None


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def load_meetings(labels: Path, audio: Path) -> list[dict]:
    """라벨 zip 의 회의 json 마다, 푼 wav 가 있는 쓸 수 있는 발화만 남긴다. 발화 시각은 wav 길이를 이어 붙인 값이다."""
    import zipfile

    import soundfile as sf

    out = []
    for zp in sorted(labels.glob("*label*.zip")):   # 같은 폴더의 원천 zip(받는 중이면 빈 파일)은 건너뛴다
        z = zipfile.ZipFile(zp)
        for name in z.namelist():
            if not name.endswith(".json"):
                continue
            dialogs = json.loads(z.read(name))["dataSet"]["dialogs"]
            utts, t = [], 0.0
            for d in dialogs:
                rel = d["audioPath"].removeprefix("KconfSpeech/")
                wav = audio / rel
                txt = d["textPath"].removeprefix("KconfSpeech/")
                if not wav.exists() or txt not in z.NameToInfo:
                    continue
                dur = sf.info(str(wav)).duration
                ref = clean_form(z.read(txt).decode("utf-8"))
                if ref and MIN_S <= dur <= MAX_S:
                    utts.append({"start": t, "end": t + dur, "ref": ref, "speaker": str(d.get("speaker") or "") or None,
                                 "wav": str(wav)})
                t += dur
            if utts:
                out.append({"title": Path(name).stem, "utts": utts})
    return out


def pick(meetings: list[dict], minutes: float, seed: int) -> list[dict]:
    """회의를 통째로 섞어 골라 발화 길이 합이 minutes 를 넘을 때까지 담는다."""
    pool = meetings[:]
    random.Random(seed).shuffle(pool)
    chosen, total = [], 0.0
    for m in pool:
        if total >= minutes * 60:
            break
        chosen.append(m)
        total += sum(u["end"] - u["start"] for u in m["utts"])
    return chosen


def transcribe_all(chosen: list[dict], cache_path: Path, workers: int) -> dict[str, str]:
    import soundfile as sf

    from stt.elice import EliceStt

    done: dict[str, str] = {}
    if cache_path.exists():
        for line in cache_path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            done[row["key"]] = row["hyp"]
    stt = EliceStt()
    with cache_path.open("a", encoding="utf-8") as f:
        for m in chosen:
            todo = [(i, u) for i, u in enumerate(m["utts"]) if f"{m['title']}#{i}" not in done]
            if not todo:
                continue

            def one(iu):
                i, u = iu
                clip, sr = sf.read(u["wav"], dtype="float32")
                if sr != SR or clip.ndim != 1:
                    raise ValueError(f"16kHz 모노 wav 가 아니다: {u['wav']} ({sr}Hz, {clip.shape})")
                try:
                    return i, stt.transcribe(clip, SR).text.strip()
                except Exception as e:  # noqa: BLE001 - 한 발화 실패로 전체를 멈추지 않는다. 다음 실행에서 다시 보낸다
                    print(f"[stt] {m['title']}#{i} 실패: {type(e).__name__}: {e}", flush=True)
                    return i, None

            with ThreadPoolExecutor(workers) as pool:
                for i, hyp in pool.map(one, todo):
                    if hyp is not None:
                        key = f"{m['title']}#{i}"
                        done[key] = hyp
                        f.write(json.dumps({"key": key, "hyp": hyp}, ensure_ascii=False) + "\n")
                        f.flush()
            print(f"[stt] {m['title']} {len(m['utts'])}발화", flush=True)
    return done


THRESHOLDS = (0.5, 0.6, 0.7, 0.8, 0.9)


def past_terms(past: list[dict]) -> set[str]:
    """지난 회의 정답 대본에서 두 사람 이상이 말한 명사. BE 의 워크스페이스 용어 대신 쓴다."""
    return asr_check.team_nouns(((m["title"], u["speaker"]), u["ref"]) for m in past for u in m["utts"])


def ask_jev(chosen: list[dict], hyps: dict[str, str], vocab: set[str], cache_path: Path, workers: int,
            jev=None) -> dict[str, dict]:
    """의심 단어가 있는 발화마다 Jev 한 번. {발화 키: {"sus": [...], "p_yes": {단어: 확률|None}}}. 받은 답은 쌓아 둔다."""
    if jev is None:
        from jev import get_jev
        jev = get_jev()
    done: dict[str, dict] = {}
    if cache_path.exists():
        for line in cache_path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            done[row.pop("key")] = row
    jobs = []
    for m in chosen:
        for i, u in enumerate(m["utts"]):
            key, hyp = f"{m['title']}#{i}", hyps.get(f"{m['title']}#{i}")
            sus = sorted(asr_check.nouns(hyp) - vocab) if hyp else []
            if sus and key not in done:
                ctx = [x for x in (hyps.get(f"{m['title']}#{i - 1}"), hyp, hyps.get(f"{m['title']}#{i + 1}")) if x]
                jobs.append((key, hyp, ctx, sus))
    lock = threading.Lock()

    def one(job):
        key, hyp, ctx, sus = job
        words = {w: asr_check.candidates(w, vocab) for w in sus}
        ans = jev.decide(_state(ctx, hyp, None, None, date.today()), asr_check.questions(words))
        p = {}
        for k, w in enumerate(sus):
            try:
                p[w] = float(ans[f"asr{k}"]["probabilities"]["yes"])
            except (KeyError, TypeError, ValueError):
                p[w] = None
        row = {"sus": sus, "p_yes": p}
        with lock, cache_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"key": key, **row}, ensure_ascii=False) + "\n")
        return key, row

    with ThreadPoolExecutor(workers) as pool:
        for n, (key, row) in enumerate(pool.map(one, jobs), 1):
            done[key] = row
            if n % 100 == 0:
                print(f"[jev] {n}/{len(jobs)}", flush=True)
    return done


def evaluate(chosen: list[dict], hyps: dict[str, str], vocab: set[str], answers: dict[str, dict]) -> tuple[list, dict]:
    rows = []
    for m in chosen:
        for i, u in enumerate(m["utts"]):
            key, hyp = f"{m['title']}#{i}", hyps.get(f"{m['title']}#{i}")
            if hyp is None:
                continue
            hn = asr_check.nouns(hyp)
            a = answers.get(key) or {"sus": [], "p_yes": {}}
            rows.append({"key": key, "ref": u["ref"], "hyp": hyp, "wrong": sorted(hn - asr_check.nouns(u["ref"])),
                         "sus": a["sus"], "p_yes": a["p_yes"]})
    return rows, summarize(rows)


def _blocked(r: dict, t: float | None) -> bool:
    """t 가 None 이면 1단계 상한(의심 단어가 있으면 막음). 답이 없는 단어는 막는다(check_failed 와 같은 쪽)."""
    return any(t is None or r["p_yes"].get(w) is None or r["p_yes"][w] < t for w in r["sus"])


def _hit(r: dict, t: float | None) -> bool:
    return any(w in r["wrong"] and (t is None or r["p_yes"].get(w) is None or r["p_yes"][w] < t) for w in r["sus"])


def summarize(rows: list[dict]) -> dict:
    def rate(k, n):
        lo, hi = wilson(k, n)
        return {"k": k, "n": n, "rate": round(k / n, 4) if n else None, "ci95": [round(lo, 4), round(hi, 4)]}

    err = [r for r in rows if r["wrong"]]
    ok = [r for r in rows if not r["wrong"]]
    out = {"utterances": len(rows), "noun_error_utterances": len(err), "jev_utterances": sum(1 for r in rows if r["sus"]),
           "jev_missing_answers": sum(1 for r in rows for w in r["sus"] if r["p_yes"].get(w) is None)}
    for t in (None, *THRESHOLDS):
        out["stage1_only" if t is None else f"threshold_{t}"] = {
            "caught": rate(sum(1 for r in err if _hit(r, t)), len(err)),
            "blocked_clean": rate(sum(1 for r in ok if _blocked(r, t)), len(ok)),
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--audio", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True, help="레포 밖 폴더. 전사 캐시와 결과가 쌓인다")
    ap.add_argument("--minutes", type=float, default=120)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--yes", action="store_true", help="실제로 Elice 를 부른다(과금)")
    args = ap.parse_args()

    from stt.eval import rawdir
    from stt.elice import whisper_krw

    out = rawdir.check(args.out.resolve(), out=None)
    meetings = load_meetings(args.labels, args.audio)
    chosen = pick(meetings, args.minutes, args.seed)
    secs = sum(u["end"] - u["start"] for m in chosen for u in m["utts"])
    no_speaker = sum(1 for m in chosen for u in m["utts"] if u["speaker"] is None)
    print(f"짝지은 회의 {len(meetings)}개 중 {len(chosen)}개, 발화 {sum(len(m['utts']) for m in chosen)}개, "
          f"{secs / 60:.1f}분, 견적 약 {whisper_krw(secs):.0f}원. 화자 없는 발화 {no_speaker}개")
    if chosen:
        u = chosen[0]["utts"][0]
        print(f"예: {chosen[0]['title']} {u['start']:.1f}~{u['end']:.1f}초 화자={u['speaker']} 정답={u['ref']}")
    if not args.yes:
        print("--yes 를 붙이면 전사하고 잰다.")
        return 0
    out.mkdir(parents=True, exist_ok=True)
    hyps = transcribe_all(chosen, out / "stt.jsonl", args.workers)
    chosen_ids = {m["title"] for m in chosen}
    vocab = asr_check.base_vocab() | past_terms([m for m in meetings if m["title"] not in chosen_ids])
    answers = ask_jev(chosen, hyps, vocab, out / "jev.jsonl", args.workers)
    rows, summary = evaluate(chosen, hyps, vocab, answers)
    (out / "rows.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
