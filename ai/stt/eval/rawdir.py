"""측정 원자료를 둘 곳. 레포 안 결과 폴더에는 표(md)와 숫자만 든 요약만 두고, 실행별 전사·추출 출력·
전사 캐시·합성 회의 wav 같은 원자료는 레포 밖에 둔다.

팀 레포는 공개다. 원자료에는 회의 발언 전사와 LLM 출력이 들어 있고, 파일이 수백 개라 PR 을 덮고,
재측정할 때마다 레포가 불어난다.

위치를 정하는 순서:
  1. --raw-dir 로 준 경로
  2. 환경 변수 MM_EVAL_RAW_DIR 아래 <결과 폴더 이름>. 여러 실행이 한 폴더를 나눠 쓰지 않게 이름을 붙인다
  3. 첫 --golden-root 의 부모 아래 eval-runs/<결과 폴더 이름>. 골든셋 옆이다

정한 경로가 원격이 있는 git 레포 안이거나 결과 폴더와 같은 레포 안이면 멈춘다. 원격이 없는 로컬
레포(골든셋을 담은 레포 등)는 밖으로 나갈 길이 없어 허용한다.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

ENV = "MM_EVAL_RAW_DIR"


class RawDirError(SystemExit):
    """원자료 위치를 정할 수 없거나 레포 안이다. 명령을 멈춘다."""


def resolve(out: Path, raw: Path | None, golden_roots, env=None) -> Path:
    env = os.environ if env is None else env
    if raw is not None:
        return Path(raw).expanduser()
    if env.get(ENV):
        return Path(env[ENV]).expanduser() / out.name
    roots = [Path(g).expanduser() for g in golden_roots or []]
    if roots:
        return roots[0].parent / "eval-runs" / out.name
    raise RawDirError(f"원자료 위치를 모른다. --raw-dir, 환경 변수 {ENV}, --golden-root 중 하나를 준다")


def _repo(path: Path) -> tuple[Path, list[str]] | None:
    """path(없으면 가장 가까운 있는 조상)가 든 git 레포의 최상위와 원격 이름들."""
    p = Path(path).expanduser().absolute()
    while not p.exists():
        p = p.parent
    top = subprocess.run(["git", "-C", str(p), "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if top.returncode != 0:
        return None
    remotes = subprocess.run(["git", "-C", str(p), "remote"], capture_output=True, text=True).stdout.split()
    return Path(top.stdout.strip()).resolve(), remotes


def check(raw: Path, *, out: Path | None) -> Path:
    """raw 가 공개될 수 있는 레포 안이면 RawDirError. 아니면 raw 를 그대로 돌려준다."""
    info = _repo(raw)
    if info is None:
        return raw
    top, remotes = info
    same = out is not None and (_repo(out) or (None, []))[0] == top
    if remotes or same:
        why = f"원격 {', '.join(remotes)}" if remotes else "결과 폴더와 같은 레포"
        raise RawDirError(f"원자료 경로 {raw} 가 git 레포 {top} 안이다({why}). 레포 밖 경로를 --raw-dir 로 준다")
    return raw


def raw_for(out: Path, raw: Path | None, golden_roots) -> Path:
    """resolve 와 check 를 한 번에. 명령들이 쓰는 입구다."""
    return check(resolve(out, raw, golden_roots), out=out)
