"""컨테이너 CPU·메모리를 docker stats 로 계속 적는다. 사용: python3 sampler.py <out.csv> <컨테이너>...

한 줄 = 시각(unix 초), 컨테이너, CPU %(코어 하나 = 100), 메모리 MiB. docker stats 한 번이 1~2초 걸려 그 간격이 곧 샘플 간격이다.
"""
import csv
import subprocess
import sys
import time

UNITS = {"B": 1 / 2**20, "KiB": 1 / 1024, "MiB": 1, "GiB": 1024, "kB": 1e3 / 2**20, "MB": 1e6 / 2**20, "GB": 1e9 / 2**20}


def mib(text: str) -> float:
    number = text.rstrip("BKMGiak")
    return float(number) * UNITS[text[len(number):]]


def main(path: str, containers: list[str]) -> None:
    with open(path, "w", newline="") as f:
        out = csv.writer(f)
        out.writerow(["ts", "container", "cpu_pct", "mem_mib"])
        while True:
            lines = subprocess.run(
                ["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}", *containers],
                capture_output=True, text=True,
            ).stdout.splitlines()
            now = round(time.time(), 1)
            for line in lines:
                name, cpu, mem = line.split("\t")
                out.writerow([now, name, cpu.rstrip("%"), round(mib(mem.split(" / ")[0]), 1)])
            f.flush()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
