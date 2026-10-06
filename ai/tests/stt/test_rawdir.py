"""원자료 위치(stt/eval/rawdir.py). 실행별 전사와 추출 출력은 공개 레포에 들어가면 안 된다."""

import subprocess

import pytest

from stt.eval import rawdir as RD


def _repo(path, remote=None):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    if remote:
        subprocess.run(["git", "-C", str(path), "remote", "add", "origin", remote], check=True)
    return path


def test_default_is_eval_runs_next_to_the_golden_folder(tmp_path):
    out = tmp_path / "team" / "results" / "2026-09-26-units"
    got = RD.resolve(out, None, [tmp_path / "mm" / "golden"], env={})
    assert got == tmp_path / "mm" / "eval-runs" / "2026-09-26-units"


def test_environment_variable_is_the_base_folder_for_every_run(tmp_path):
    out = tmp_path / "results" / "2026-09-26-units"
    got = RD.resolve(out, None, [tmp_path / "mm" / "golden"], env={"MM_EVAL_RAW_DIR": str(tmp_path / "raw")})
    assert got == tmp_path / "raw" / "2026-09-26-units"


def test_explicit_option_wins(tmp_path):
    got = RD.resolve(tmp_path / "r" / "x", tmp_path / "here", [tmp_path / "g"], env={"MM_EVAL_RAW_DIR": "/elsewhere"})
    assert got == tmp_path / "here"


def test_no_location_at_all_is_an_error(tmp_path):
    with pytest.raises(RD.RawDirError):
        RD.resolve(tmp_path / "r" / "x", None, [], env={})


def test_a_path_inside_a_repo_that_can_be_pushed_is_refused(tmp_path):
    pub = _repo(tmp_path / "pub", remote="https://example.invalid/team.git")
    with pytest.raises(RD.RawDirError, match="레포"):
        RD.check(pub / "ai" / "results" / "x" / "raw", out=tmp_path / "elsewhere")


def test_a_path_in_the_same_repo_as_the_results_is_refused_even_without_a_remote(tmp_path):
    team = _repo(tmp_path / "team")
    with pytest.raises(RD.RawDirError):
        RD.check(team / "raw", out=team / "results" / "x")


def test_a_local_only_repo_elsewhere_is_allowed(tmp_path):
    """골든 폴더를 담은 로컬 전용 레포(원격 없음) 옆이 기본 위치다. 밖으로 나갈 길이 없어 허용한다."""
    team = _repo(tmp_path / "team", remote="https://example.invalid/team.git")
    mm = _repo(tmp_path / "mm")
    raw = mm / "eval-runs" / "x"
    assert RD.check(raw, out=team / "results" / "x") == raw


def test_a_path_outside_any_repo_is_allowed(tmp_path):
    assert RD.check(tmp_path / "raw", out=None) == tmp_path / "raw"
