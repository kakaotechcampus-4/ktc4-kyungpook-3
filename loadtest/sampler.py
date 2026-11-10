"""서버 수치를 CSV 로 stdout 에 계속 쓴다. 사용: python3 sampler.py <대상>...

대상: 컨테이너 이름(docker stats), unit:<systemd 서비스>(cgroup v2), host(/proc). 운영 서버에서는
`ssh <서버> python3 - <대상>... < sampler.py` 로 돌린다. 한 줄 = 시각(unix 초), 대상, CPU %(코어 하나 = 100), 메모리 MiB.
docker stats 한 번이 1~2초 걸려 그 간격이 곧 샘플 간격이다.
"""
import csv
import os
import subprocess
import sys
import time

UNITS = {"B": 1 / 2**20, "KiB": 1 / 1024, "MiB": 1, "GiB": 1024, "kB": 1e3 / 2**20, "MB": 1e6 / 2**20, "GB": 1e9 / 2**20}


def mib(text: str) -> float:
    number = text.rstrip("BKMGiak")
    return float(number) * UNITS[text[len(number):]]


def containers(names: list[str]) -> list[tuple[str, float, float]]:
    if not names:
        return []
    lines = subprocess.run(
        ["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}", *names],
        capture_output=True, text=True,
    ).stdout.splitlines()
    rows = []
    for line in lines:
        name, cpu, mem = line.split("\t")
        rows.append((name, float(cpu.rstrip("%")), mib(mem.split(" / ")[0])))
    return rows


def cpu_seconds(target: str) -> float:
    if target == "host":
        fields = open("/proc/stat").readline().split()[1:]
        busy = sum(map(int, fields)) - int(fields[3]) - int(fields[4])
        return busy / os.sysconf("SC_CLK_TCK")
    for line in open(f"/sys/fs/cgroup/system.slice/{target}.service/cpu.stat"):
        if line.startswith("usage_usec"):
            return int(line.split()[1]) / 1e6
    raise ValueError(target)


def memory_mib(target: str) -> float:
    if target == "host":
        info = {k: int(v.split()[0]) for k, v in (line.split(":", 1) for line in open("/proc/meminfo"))}
        return (info["MemTotal"] - info["MemAvailable"]) / 1024
    return int(open(f"/sys/fs/cgroup/system.slice/{target}.service/memory.current").read()) / 2**20


def main(targets: list[str]) -> None:
    docker = [t for t in targets if not t.startswith("unit:") and t != "host"]
    local = [t.removeprefix("unit:") for t in targets if t.startswith("unit:") or t == "host"]
    out = csv.writer(sys.stdout)
    out.writerow(["ts", "container", "cpu_pct", "mem_mib"])
    last = {t: (time.time(), cpu_seconds(t)) for t in local}
    while True:
        rows = containers(docker)
        if not docker:
            time.sleep(2)
        for t in local:
            now, used = time.time(), cpu_seconds(t)
            rows.append((t, (used - last[t][1]) / (now - last[t][0]) * 100, memory_mib(t)))
            last[t] = (now, used)
        ts = round(time.time(), 1)
        for name, cpu, mem in rows:
            out.writerow([ts, name, round(cpu, 1), round(mem, 1)])
        sys.stdout.flush()


if __name__ == "__main__":
    main(sys.argv[1:])
