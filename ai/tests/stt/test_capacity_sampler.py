"""서버 1초 기록기(stt/eval/capacity/sampler.py). /proc 는 파일 텍스트로 넣어 맥에서도 돈다."""

import json
import os
import signal
import subprocess

from stt.eval.capacity import sampler as S

MIB = 1024 * 1024

MEMINFO = """\
MemTotal:        3884136 kB
MemFree:          201234 kB
MemAvailable:    1534000 kB
Buffers:           12345 kB
Cached:           900000 kB
SwapCached:        10000 kB
SwapTotal:       4194300 kB
SwapFree:        4000000 kB
"""

# guest(9번째 칸)는 user 에 이미 들어 있다. 더하면 두 번 센다. cpu0 줄도 같이 있다.
STAT_A = """\
cpu  100 5 50 800 20 0 5 20 7 0
cpu0 50 2 25 400 10 0 3 10 0 0
cpu1 50 3 25 400 10 0 2 10 7 0
intr 12345 0 0
"""
STAT_B = """\
cpu  160 5 70 900 30 0 5 30 57 0
cpu0 80 2 35 450 15 0 3 15 25 0
cpu1 80 3 35 450 15 0 2 15 32 0
intr 22345 0 0
"""

# 첫 줄은 주소 머리줄이다(00:00 이 든다). 새 커널은 Pss_Anon 같은 Pss_ 칸을 뒤에 더 둔다.
SMAPS = """\
55d4c0000000-7ffd3c7f1000 ---p 00000000 00:00 0                          [rollup]
Rss:              204800 kB
Pss:              150000 kB
Pss_Dirty:         90000 kB
Pss_Anon:         100000 kB
Pss_File:          50000 kB
Pss_Shmem:             0 kB
Shared_Clean:      40000 kB
"""


def test_meminfo_keeps_four_fields_in_bytes():
    assert S.parse_meminfo(MEMINFO) == {
        "MemTotal": 3884136 * 1024,
        "MemAvailable": 1534000 * 1024,
        "SwapTotal": 4194300 * 1024,
        "SwapFree": 4000000 * 1024,
    }


def test_cpu_reads_only_the_total_line_and_eight_fields():
    assert S.parse_cpu(STAT_A) == {
        "user": 100, "nice": 5, "system": 50, "idle": 800,
        "iowait": 20, "irq": 0, "softirq": 5, "steal": 20,
    }


def test_cpu_percent_counts_everything_but_idle_and_iowait_as_busy():
    # 두 표본 사이 전체 200 틱. idle 100, iowait 10 을 빼면 바쁨 90(45%), steal 10(5%).
    got = S.cpu_percent(S.parse_cpu(STAT_A), S.parse_cpu(STAT_B), vcpus=2)
    assert got == {"cpu_busy_pct": 45.0, "cpu_steal_pct": 5.0, "busy_vcpus": 0.9}


def test_cpu_percent_is_zero_when_no_tick_passed():
    a = S.parse_cpu(STAT_A)
    assert S.cpu_percent(a, a, vcpus=2) == {"cpu_busy_pct": 0.0, "cpu_steal_pct": 0.0, "busy_vcpus": 0.0}


def test_smaps_rollup_takes_exact_rss_and_pss_in_bytes():
    assert S.parse_smaps_rollup(SMAPS) == {"rss": 204800 * 1024, "pss": 150000 * 1024}


def test_read_proc_returns_none_after_the_process_ended(tmp_path):
    (tmp_path / "123").mkdir()
    (tmp_path / "123" / "smaps_rollup").write_text(SMAPS)
    assert S.read_proc(123, tmp_path) == {"rss": 204800 * 1024, "pss": 150000 * 1024}
    assert S.read_proc(999, tmp_path) is None


def test_cgroup_values_are_bytes_and_missing_peak_is_none(tmp_path):
    full = tmp_path / "w1.scope"
    full.mkdir()
    (full / "memory.current").write_text("123456789\n")
    (full / "memory.peak").write_text("234567890\n")
    assert S.read_cgroup(full) == {"current": 123456789, "peak": 234567890}

    old = tmp_path / "old-kernel.scope"    # memory.peak 는 커널 5.19 부터 있다
    old.mkdir()
    (old / "memory.current").write_text("5\n")
    assert S.read_cgroup(old) == {"current": 5, "peak": None}

    assert S.read_cgroup(tmp_path / "gone.scope") == {"current": None, "peak": None}


def test_guard_stops_only_past_the_swap_limit():
    ok = {"swap_used": 768 * MIB, "mem_available": 1000 * MIB}
    assert S.guard_reason(ok, swap_mb=768, avail_mb=200) is None
    over = {"swap_used": 768 * MIB + 1, "mem_available": 1000 * MIB}
    assert "스왑" in S.guard_reason(over, swap_mb=768, avail_mb=200)


def test_guard_counts_only_swap_growth_since_the_start():
    # 리눅스는 메모리가 풀려도 스왑에 나간 페이지를 다시 들이지 않는다. 절대값으로 보면 시작 전부터 쓰던 스왑이나
    # 앞 시나리오가 남긴 스왑 때문에 뒤 시나리오가 첫 표본에서 꺼진다
    base = 900 * MIB
    grown = {"swap_used": base + 768 * MIB, "mem_available": 1000 * MIB}
    assert S.guard_reason(grown, swap_mb=768, avail_mb=200, swap_base=base) is None
    over = {"swap_used": base + 768 * MIB + 1, "mem_available": 1000 * MIB}
    assert "늘어" in S.guard_reason(over, swap_mb=768, avail_mb=200, swap_base=base)


def test_guard_stops_only_below_the_available_limit():
    ok = {"swap_used": 0, "mem_available": 200 * MIB}
    assert S.guard_reason(ok, swap_mb=768, avail_mb=200) is None
    low = {"swap_used": 0, "mem_available": 200 * MIB - 1}
    assert "남은 메모리" in S.guard_reason(low, swap_mb=768, avail_mb=200)


# main 은 /proc 대신 tmp_path 의 가짜 트리를 읽는다. 쉬는 자리에서 표본 사이 상태를 바꾸고,
# 정한 횟수가 차면 main 이 건 신호 처리기를 직접 불러 끝낸다. pytest 에 신호를 보내지 않는다.


def _proc_tree(root, meminfo=MEMINFO, smaps_pids=()):
    root.mkdir()
    (root / "meminfo").write_text(meminfo)
    (root / "stat").write_text(STAT_A)
    for pid in smaps_pids:
        (root / str(pid)).mkdir()
        (root / str(pid) / "smaps_rollup").write_text(SMAPS)
    return root


def _fake_sleep(monkeypatch, stop_after, sig, between=lambda n: None):
    slept = []

    def sleep(sec):
        slept.append(sec)
        between(len(slept))
        if len(slept) == stop_after:
            signal.getsignal(sig)(sig, None)

    monkeypatch.setattr(S.time, "sleep", sleep)
    return slept


def _lines(path):
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]


def test_main_writes_one_line_per_sample_and_ends_on_sigterm(tmp_path, monkeypatch):
    proc = _proc_tree(tmp_path / "proc", smaps_pids=[4242])
    monkeypatch.setattr(S, "PROC", proc)
    pids = tmp_path / "pids"
    pids.write_text("4242\n")
    cg = tmp_path / "w1.scope"
    cg.mkdir()
    (cg / "memory.current").write_text("100\n")
    (cg / "memory.peak").write_text("200\n")
    out = tmp_path / "s.jsonl"

    def between(n):
        if n == 1:    # 두 번째 표본 전에 CPU 틱이 흐르고 pids 파일에 새 프로세스가 붙는다
            (proc / "stat").write_text(STAT_B)
            pids.write_text("4242\n\n5151\n")

    before = (signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT))
    slept = _fake_sleep(monkeypatch, 2, signal.SIGTERM, between)
    assert S.main(["--out", str(out), "--pids-file", str(pids), "--cgroup", str(cg), "--vcpus", "2"]) == 0

    a, b = _lines(out)
    assert a["mem_total"] == 3884136 * 1024
    assert a["mem_available"] == 1534000 * 1024
    assert a["swap_used"] == (4194300 - 4000000) * 1024
    assert a["cpu_busy_pct"] is None and a["busy_vcpus"] is None    # 첫 표본은 앞 표본이 없다
    assert a["procs"] == {"4242": {"rss": 204800 * 1024, "pss": 150000 * 1024}}
    assert a["cgroups"] == {str(cg): {"current": 100, "peak": 200}}
    assert isinstance(a["ts"], float) and isinstance(a["mono"], float)
    assert (b["cpu_busy_pct"], b["cpu_steal_pct"], b["busy_vcpus"]) == (45.0, 5.0, 0.9)
    assert b["procs"]["5151"] is None    # smaps_rollup 이 없는 pid 는 끝난 프로세스로 적는다
    assert all(0 <= s <= 1.0 for s in slept)    # 표본 사이는 interval 에서 작업 시간을 뺀 만큼 쉰다
    assert (signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT)) == before


def test_missing_pids_file_tracks_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "PROC", _proc_tree(tmp_path / "proc"))
    out = tmp_path / "s.jsonl"
    _fake_sleep(monkeypatch, 1, signal.SIGINT)
    assert S.main(["--out", str(out), "--pids-file", str(tmp_path / "none")]) == 0
    assert _lines(out)[0]["procs"] == {}


def test_guard_writes_one_stop_line_and_sends_sigterm_once(tmp_path, monkeypatch):
    swapped = MEMINFO.replace("SwapFree:        4000000 kB", "SwapFree:        3000000 kB")    # 약 977MB 늘어남
    proc = _proc_tree(tmp_path / "proc")
    monkeypatch.setattr(S, "PROC", proc)
    child = subprocess.Popen(["sleep", "30"])
    try:
        pids = tmp_path / "pids"
        pids.write_text(f"{child.pid}\n")
        out = tmp_path / "s.jsonl"
        kills = []
        real_kill = os.kill

        def kill(pid, sig):
            kills.append((pid, sig))
            real_kill(pid, sig)

        monkeypatch.setattr(S.os, "kill", kill)
        _fake_sleep(monkeypatch, 3, signal.SIGINT, lambda n: n == 1 and (proc / "meminfo").write_text(swapped))
        assert S.main(["--out", str(out), "--pids-file", str(pids)]) == 0

        assert child.wait(timeout=5) == -signal.SIGTERM
        assert kills == [(child.pid, signal.SIGTERM)]    # 세 번째 표본도 기준을 넘지만 다시 보내지 않는다
        stops = [x for x in _lines(out) if x.get("event") == "guard_stop"]
        assert len(stops) == 1
        assert "스왑" in stops[0]["reason"] and stops[0]["pids"] == [child.pid]
        assert len(_lines(out)) == 4    # 표본 3줄과 멈춤 1줄
    finally:
        child.kill()
        child.wait()


def test_guard_protects_each_new_scenario_and_skips_when_nothing_is_tracked(tmp_path, monkeypatch):
    # night.sh 는 시나리오가 끝날 때마다 pids 파일을 비우고 다음 시나리오가 새 pid 를 쓴다.
    # 멈춤이 밤 전체에 한 번뿐이면 첫 멈춤 뒤의 시나리오는 보호를 받지 못한다.
    swapped = MEMINFO.replace("SwapFree:        4000000 kB", "SwapFree:        3000000 kB")    # 약 977MB 늘어남
    proc = _proc_tree(tmp_path / "proc")
    monkeypatch.setattr(S, "PROC", proc)
    a, b = subprocess.Popen(["sleep", "30"]), subprocess.Popen(["sleep", "30"])
    try:
        pids = tmp_path / "pids"
        pids.write_text("")    # 유휴 구간. 따라가는 프로세스가 없다
        out = tmp_path / "s.jsonl"
        kills = []
        real_kill = os.kill

        def kill(pid, sig):
            kills.append((pid, sig))
            real_kill(pid, sig)

        def between(n):
            if n == 1:
                (proc / "meminfo").write_text(swapped)
                pids.write_text(f"{a.pid}\n")
            elif n == 2:
                pids.write_text(f"{b.pid}\n")

        monkeypatch.setattr(S.os, "kill", kill)
        _fake_sleep(monkeypatch, 3, signal.SIGINT, between)
        assert S.main(["--out", str(out), "--pids-file", str(pids)]) == 0

        assert kills == [(a.pid, signal.SIGTERM), (b.pid, signal.SIGTERM)]
        stops = [x for x in _lines(out) if x.get("event") == "guard_stop"]
        assert [x["pids"] for x in stops] == [[a.pid], [b.pid]]
        assert a.wait(timeout=5) == -signal.SIGTERM and b.wait(timeout=5) == -signal.SIGTERM
    finally:
        for c in (a, b):
            c.kill()
            c.wait()


def test_swap_already_in_use_at_the_start_does_not_stop_anything(tmp_path, monkeypatch):
    swapped = MEMINFO.replace("SwapFree:        4000000 kB", "SwapFree:        3000000 kB")
    monkeypatch.setattr(S, "PROC", _proc_tree(tmp_path / "proc", meminfo=swapped))
    child = subprocess.Popen(["sleep", "30"])
    try:
        pids = tmp_path / "pids"
        pids.write_text(f"{child.pid}\n")
        out = tmp_path / "s.jsonl"
        _fake_sleep(monkeypatch, 3, signal.SIGINT)
        assert S.main(["--out", str(out), "--pids-file", str(pids)]) == 0
        assert [x for x in _lines(out) if x.get("event") == "guard_stop"] == []
        assert child.poll() is None
    finally:
        child.kill()
        child.wait()
