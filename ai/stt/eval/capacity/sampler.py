"""서버 1초 기록기. 메모리, 스왑, CPU, 따라가는 프로세스의 PSS·RSS, cgroup 메모리를 JSONL 로 남긴다.

프로세스 RSS 는 더하지 않는다. DB 공유 메모리가 겹쳐 세진다. 서버 전체는 MemTotal-MemAvailable,
프로세스는 PSS, 워커 상한 판단은 cgroup 의 memory.peak 로 본다.

같은 서버에 BE·DB 가 돈다. 스왑을 기준보다 많이 쓰거나 남은 메모리가 기준 밑이면 측정 프로세스를 멈춰 BE·DB 를 지킨다.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path

PROC = Path("/proc")
MIB = 1024 * 1024
MEMINFO_KEYS = ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree")
# guest·guest_nice 는 user·nice 에 이미 들어 있어 뺀다.
CPU_FIELDS = ("user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal")


def _kb_fields(text: str, keys) -> dict:
    """'Key:   123 kB' 줄에서 keys 만 바이트로. 키는 정확히 맞춘다(Pss 와 Pss_Anon 은 다른 칸이다)."""
    out = {}
    for line in text.splitlines():
        key, _, rest = line.partition(":")
        if key in keys:
            out[key] = int(rest.split()[0]) * 1024
    return out


def parse_meminfo(text: str) -> dict:
    return _kb_fields(text, MEMINFO_KEYS)


def parse_cpu(text: str) -> dict:
    """/proc/stat 의 전체 합 줄("cpu ")의 누적 틱. cpu0 같은 코어별 줄은 쓰지 않는다."""
    for line in text.splitlines():
        if line.startswith("cpu "):
            return dict(zip(CPU_FIELDS, (int(v) for v in line.split()[1:])))
    raise ValueError("/proc/stat 에 cpu 줄이 없다")


def cpu_percent(prev: dict, cur: dict, vcpus: int) -> dict:
    """두 표본 사이 바쁨 %와 steal %(전체 CPU 대비 0~100), 바쁜 vCPU 수.

    바쁨은 idle·iowait 를 뺀 나머지라 steal 이 들어 있다. steal 은 따로도 적는다.
    """
    d = {k: cur[k] - prev[k] for k in CPU_FIELDS}
    total = sum(d.values())
    if total <= 0:
        return {"cpu_busy_pct": 0.0, "cpu_steal_pct": 0.0, "busy_vcpus": 0.0}
    busy = 100 * (total - d["idle"] - d["iowait"]) / total
    return {"cpu_busy_pct": busy, "cpu_steal_pct": 100 * d["steal"] / total, "busy_vcpus": busy * vcpus / 100}


def parse_smaps_rollup(text: str) -> dict:
    f = _kb_fields(text, ("Rss", "Pss"))
    return {"rss": f["Rss"], "pss": f["Pss"]}


def read_proc(pid: int, root: Path = PROC) -> dict | None:
    """프로세스의 RSS·PSS. 끝난 프로세스는 None. 끝나는 중에 읽으면 ProcessLookupError 가 난다."""
    try:
        text = (Path(root) / str(pid) / "smaps_rollup").read_text()
    except (FileNotFoundError, ProcessLookupError):
        return None
    return parse_smaps_rollup(text)


def read_cgroup(path) -> dict:
    """cgroup v2 의 memory.current·memory.peak(바이트). 파일이 없으면 None. memory.peak 는 커널 5.19 부터."""
    out = {}
    for key in ("current", "peak"):
        try:
            out[key] = int((Path(path) / f"memory.{key}").read_text().strip())
        except FileNotFoundError:
            out[key] = None
    return out


def guard_reason(record: dict, swap_mb: float, avail_mb: float, swap_base: int = 0) -> str | None:
    """표본 한 줄(swap_used, mem_available 바이트)이 멈춤 기준을 넘었으면 이유. MB 는 MiB 다.

    스왑은 기록을 시작할 때(swap_base)보다 늘어난 양으로 본다. 리눅스는 메모리가 풀려도 스왑에 나간 페이지를
    다시 들이지 않아서, 절대값으로 보면 앞 시나리오가 남긴 스왑 때문에 뒤 시나리오가 첫 표본에서 꺼진다.
    """
    grown = record["swap_used"] - swap_base
    if grown > swap_mb * MIB:
        return f"스왑이 시작할 때보다 {grown / MIB:.0f}MB 늘어 기준 {swap_mb:g}MB 를 넘었다"
    if record["mem_available"] < avail_mb * MIB:
        return f"남은 메모리 {record['mem_available'] / MIB:.0f}MB 가 기준 {avail_mb:g}MB 밑이다"
    return None


def _read_pids(path) -> list[int]:
    """night.sh 가 쓰는 중일 수 있어 빈 줄과 숫자가 아닌 줄은 건너뛴다. 파일이 없으면 따라갈 프로세스가 없다."""
    if path is None:
        return []
    try:
        lines = Path(path).read_text().splitlines()
    except FileNotFoundError:
        return []
    return [int(x) for x in (line.strip() for line in lines) if x.isdigit()]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="서버 1초 기록기. 멈춤 기준을 넘으면 pids 파일의 프로세스마다 SIGTERM 을 한 번 보낸다")
    ap.add_argument("--out", type=Path, required=True, help="JSONL. 있으면 뒤에 이어 쓴다")
    ap.add_argument("--interval", type=float, default=1.0, help="표본 사이 초. 기록에 걸린 시간을 빼고 쉰다")
    ap.add_argument("--pids-file", type=Path, help="따라갈 pid 를 한 줄에 하나. 표본마다 다시 읽는다")
    ap.add_argument("--cgroup", action="append", default=[], help="memory.current·memory.peak 를 읽을 cgroup 폴더. 여러 번 준다")
    ap.add_argument("--guard-swap-mb", type=float, default=768, help="스왑 사용이 이 값(MiB)을 넘으면 멈춘다")
    ap.add_argument("--guard-avail-mb", type=float, default=200, help="남은 메모리가 이 값(MiB) 밑이면 멈춘다")
    ap.add_argument("--vcpus", type=int, default=os.cpu_count(), help="바쁜 vCPU 수를 셀 때 쓴다")
    a = ap.parse_args(argv)

    # 신호는 표시만 하고 표본 한 줄을 다 쓴 뒤 끝낸다. 줄 중간에 끊기지 않는다.
    stop = []
    old = {s: signal.signal(s, lambda signum, frame: stop.append(signum)) for s in (signal.SIGTERM, signal.SIGINT)}
    prev_cpu = None
    # 프로세스마다 한 번만 보낸다. 시나리오가 바뀌어 새 pid 가 오면 그 프로세스도 지킨다
    signaled: set[int] = set()
    try:
        # 줄마다 내보낸다. 멈춤 직전 기록이 가장 중요하고, 그때 기록기가 같이 죽을 수 있다.
        swap_base = None    # 첫 표본의 스왑 사용량. 멈춤 기준은 여기서 늘어난 양이다
        with open(a.out, "a", buffering=1, encoding="utf-8") as f:
            while not stop:
                t0 = time.monotonic()
                mem = parse_meminfo((PROC / "meminfo").read_text())
                cpu = parse_cpu((PROC / "stat").read_text())
                pids = _read_pids(a.pids_file)
                rec = {
                    "ts": time.time(),
                    "mono": t0,
                    "mem_total": mem["MemTotal"],
                    "mem_available": mem["MemAvailable"],
                    "swap_used": mem["SwapTotal"] - mem["SwapFree"],
                    **(cpu_percent(prev_cpu, cpu, a.vcpus) if prev_cpu
                       else dict.fromkeys(("cpu_busy_pct", "cpu_steal_pct", "busy_vcpus"))),
                    "procs": {str(p): read_proc(p, PROC) for p in pids},
                    "cgroups": {c: read_cgroup(c) for c in a.cgroup},
                }
                prev_cpu = cpu
                if swap_base is None:
                    swap_base = rec["swap_used"]
                rec["swap_base"] = swap_base
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                new = [p for p in pids if p not in signaled]
                reason = guard_reason(rec, a.guard_swap_mb, a.guard_avail_mb, swap_base) if new else None
                if reason:
                    signaled.update(new)
                    f.write(json.dumps({"event": "guard_stop", "reason": reason, "pids": new}, ensure_ascii=False) + "\n")
                    for p in new:
                        try:
                            os.kill(p, signal.SIGTERM)
                        except (ProcessLookupError, PermissionError):
                            pass    # 이미 끝났거나 남의 프로세스다. 기록기가 죽으면 밤 측정 전체를 잃는다
                time.sleep(max(0.0, a.interval - (time.monotonic() - t0)))
    finally:
        for s, h in old.items():
            signal.signal(s, h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
