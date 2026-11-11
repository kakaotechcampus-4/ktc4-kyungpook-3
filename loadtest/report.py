"""k6 원자료(k6.json.gz)와 샘플러(server.csv)를 단계별 표(stages.md)와 서버 그래프(server.svg)로 묶는다.

사용: python3 report.py <결과 폴더>. 단계 = k6 시나리오(vus_NNN). 단계 구간은 그 시나리오 요청이 처음과 마지막으로 끝난 시각이다.
"""
import csv
import gzip
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path


def pct(values: list[float], p: float) -> float:
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


def load_requests(path: Path):
    stages = defaultdict(lambda: {"dur": [], "failed": 0, "t": [], "by_name": defaultdict(list)})
    with gzip.open(path, "rt") as f:
        for line in f:
            row = json.loads(line)
            if row.get("type") != "Point" or row["metric"] not in ("http_req_duration", "http_req_failed"):
                continue
            tags = row["data"]["tags"]
            stage = tags.get("scenario")
            if not stage or stage == "setup":
                continue
            s = stages[stage]
            if row["metric"] == "http_req_failed":
                s["failed"] += row["data"]["value"]
                continue
            value = row["data"]["value"]
            s["dur"].append(value)
            s["by_name"][tags.get("name", "?")].append(value)
            s["t"].append(datetime.fromisoformat(row["data"]["time"]).timestamp())
    return dict(sorted(stages.items()))


def load_server(path: Path):
    # 원격 샘플러의 시각은 서버 시계라 run.sh 가 잰 차이(초)를 더해 k6 시각에 맞춘다. server.csv 는 원자료 그대로 둔다
    offset_file = path.with_name("clock_offset_s.txt")
    offset = float(offset_file.read_text()) if offset_file.exists() else 0.0
    samples = defaultdict(list)
    with open(path) as f:
        for row in csv.DictReader(f):
            samples[row["container"]].append((float(row["ts"]) + offset, float(row["cpu_pct"]), float(row["mem_mib"])))
    return samples


def svg(server, windows, title: str) -> str:
    width, height, pad = 900, 420, 50
    t0 = min([t for rows in server.values() for t, _, _ in rows] + [a for a, _ in windows.values()])
    t1 = max([t for rows in server.values() for t, _, _ in rows] + [b for _, b in windows.values()])
    colors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea"]
    panels = [("CPU % (코어 하나 = 100)", 1), ("메모리 MiB", 2)]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height * 2}" font-family="sans-serif" font-size="12">',
             f'<rect width="100%" height="100%" fill="white"/><text x="{pad}" y="20" font-size="14">{title}</text>']
    for p, (label, col) in enumerate(panels):
        top = 40 + p * height
        h = height - 80
        top_value = max(r[col] for rows in server.values() for r in rows) * 1.1 or 1
        x = lambda t: pad + (t - t0) / max(t1 - t0, 1) * (width - 2 * pad)
        y = lambda v: top + h - v / top_value * h
        for name, (a, b) in windows.items():
            parts.append(f'<rect x="{x(a):.1f}" y="{top}" width="{x(b) - x(a):.1f}" height="{h}" fill="#f1f5f9"/>')
            parts.append(f'<text x="{x(a) + 2:.1f}" y="{top + 12}" fill="#475569">{name.replace("vus_", "").lstrip("0")} VU</text>')
        parts.append(f'<line x1="{pad}" y1="{top + h}" x2="{width - pad}" y2="{top + h}" stroke="#94a3b8"/>')
        parts.append(f'<text x="{pad}" y="{top - 6}">{label} · 축 최대 {top_value:.0f}</text>')
        for i, (name, rows) in enumerate(sorted(server.items())):
            points = " ".join(f"{x(t):.1f},{y(c if col == 1 else m):.1f}" for t, c, m in rows)
            parts.append(f'<polyline fill="none" stroke="{colors[i % 4]}" stroke-width="1.5" points="{points}"/>')
            parts.append(f'<text x="{width - pad - 180}" y="{top + 30 + i * 16}" fill="{colors[i % 4]}">{name}</text>')
        parts.append(f'<text x="{pad}" y="{top + h + 16}" fill="#475569">경과 초: 0 ~ {t1 - t0:.0f}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def main(out: Path) -> None:
    stages = load_requests(out / "k6.json.gz")
    server = load_server(out / "server.csv")
    windows = {name: (min(s["t"]), max(s["t"])) for name, s in stages.items() if s["t"]}
    lines = ["| 단계 | 요청 수 | 처리량 req/s | p50 ms | p95 ms | p99 ms | 실패율 | "
             + " | ".join(f"{c} CPU 최고 % | {c} 메모리 최고 MiB" for c in sorted(server)) + " |",
             "|" + "---|" * (7 + 2 * len(server))]
    for name, s in stages.items():
        a, b = windows[name]
        peaks = []
        for c in sorted(server):
            inside = [(cpu, mem) for t, cpu, mem in server[c] if a <= t <= b]
            peaks += [f"{max(v[0] for v in inside):.0f}", f"{max(v[1] for v in inside):.0f}"] if inside else ["-", "-"]
        n = len(s["dur"])
        lines.append(f"| {name.replace('vus_', '').lstrip('0')} VU | {n} | {n / max(b - a, 1):.1f} | {pct(s['dur'], 50):.1f} | "
                     f"{pct(s['dur'], 95):.1f} | {pct(s['dur'], 99):.1f} | {s['failed'] / n:.2%} | " + " | ".join(peaks) + " |")
    last = list(stages)[-1]
    lines += ["", f"마지막 단계({last}) 요청별", "", "| 요청 | 수 | p50 ms | p95 ms |", "|---|---|---|---|"]
    for name, values in sorted(stages[last]["by_name"].items(), key=lambda kv: -pct(kv[1], 95)):
        lines.append(f"| {name} | {len(values)} | {pct(values, 50):.1f} | {pct(values, 95):.1f} |")
    (out / "stages.md").write_text("\n".join(lines) + "\n")
    (out / "server.svg").write_text(svg(server, windows, out.name))
    print("\n".join(lines))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
