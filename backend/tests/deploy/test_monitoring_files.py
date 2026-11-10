"""deploy/monitoring 의 설정·스크립트·SQL 이 안전한 모양인지 본다(#675).

Alloy·PDC·Grafana 가 실제로 도는지는 재지 않는다. 비밀 값이 저장소에 없는지, 읽기 계정이 view 에만 권한을 받는지,
PDC 스크립트가 조건이 틀리면 docker 를 부르기 전에 멈추는지만 본다.
"""
import os
import re
import stat
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MON = ROOT / "deploy" / "monitoring"
RUN_PDC = MON / "pdc" / "run-pdc.sh"


def _read(rel: str) -> str:
    return (MON / rel).read_text(encoding="utf-8")


def _strip_sql_comments(sql: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def test_kpi_reader_grants_only_views():
    sql = _strip_sql_comments(_read("sql/kpi-reader.sql"))
    for view in ("meeting_fact", "extraction_item_fact", "approval_fact"):
        assert re.search(rf"GRANT\s+SELECT\s+ON\s+kpi\.{view}\b", sql, re.I), view
    assert "excluded_workspace" not in sql
    assert not re.search(r"ALL\s+TABLES", sql, re.I)
    for setting in ("default_transaction_read_only", "statement_timeout", "CONNECTION LIMIT"):
        assert setting in sql, setting
    # 비밀번호는 psql 변수로만 받는다
    assert ":'pw'" in sql
    assert not re.search(r"PASSWORD\s+'(?!:)", sql, re.I)


def test_exclude_workspace_sql_uses_placeholder():
    sql = _read("sql/exclude-workspace.sql")
    assert "kpi.excluded_workspace" in sql
    assert "<" in sql


def test_run_pdc_script_safety(tmp_path):
    text = RUN_PDC.read_text(encoding="utf-8")
    assert os.access(RUN_PDC, os.X_OK) or RUN_PDC.stat().st_mode & stat.S_IXUSR
    assert "set -euo pipefail" in text
    for needle in (
        "--network mm-prod_default",
        "--read-only",
        "--cap-drop ALL",
        "--restart unless-stopped",
        "/etc/mm-monitoring/pdc.env",
        "PDC_ENV_FILE",
    ):
        assert needle in text, needle
    image = re.search(r"grafana/pdc-agent:(\S+)", text)
    assert image, "이미지 태그가 있어야 한다"
    assert image.group(1).strip("\"'") != "latest"

    assert subprocess.run(["bash", "-n", str(RUN_PDC)]).returncode == 0

    # 가짜 docker: 불리면 흔적 파일을 남긴다
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    trace = tmp_path / "docker-called"
    docker = fake_bin / "docker"
    docker.write_text(f'#!/bin/sh\necho "$@" >> "{trace}"\n')
    docker.chmod(0o755)
    # root 확인도 통과시키는 가짜 id (root 가 아닌 개발 PC 에서도 env 파일 검사까지 가게)
    fake_id = fake_bin / "id"
    fake_id.write_text('#!/bin/sh\necho 0\n')
    fake_id.chmod(0o755)

    def run(env_file: Path):
        return subprocess.run(
            ["env", "-i", f"PATH={fake_bin}:/usr/bin:/bin", f"PDC_ENV_FILE={env_file}", "bash", str(RUN_PDC)],
            capture_output=True,
            text=True,
        )

    # 파일 없음
    result = run(tmp_path / "없는-파일.env")
    assert result.returncode != 0
    assert not trace.exists()

    # 권한이 600 이 아님
    loose = tmp_path / "loose.env"
    loose.write_text("GCLOUD_HOSTED_GRAFANA_ID=x\n")
    loose.chmod(0o644)
    result = run(loose)
    assert result.returncode != 0
    assert not trace.exists()


def test_run_pdc_requires_root(tmp_path):
    """root 가 아니면 docker 를 부르지 않고 끝난다."""
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    trace = tmp_path / "docker-called"
    docker = fake_bin / "docker"
    docker.write_text(f'#!/bin/sh\necho "$@" >> "{trace}"\n')
    docker.chmod(0o755)
    fake_id = fake_bin / "id"
    fake_id.write_text('#!/bin/sh\necho 1000\n')
    fake_id.chmod(0o755)
    good = tmp_path / "pdc.env"
    good.write_text("GCLOUD_HOSTED_GRAFANA_ID=x\n")
    good.chmod(0o600)
    result = subprocess.run(
        ["env", "-i", f"PATH={fake_bin}:/usr/bin:/bin", f"PDC_ENV_FILE={good}", "bash", str(RUN_PDC)],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert not trace.exists()


def test_examples_have_no_secrets():
    files = [
        p
        for p in MON.rglob("*")
        if p.is_file() and (p.name.endswith(".example") or p.suffix in {".alloy", ".sh", ".sql", ".conf"})
    ]
    assert files, "deploy/monitoring 파일이 없다"
    for path in files:
        text = path.read_text(encoding="utf-8")
        assert "glc_" not in text, path
        assert "glsa_" not in text, path
        # 비밀번호는 값을 직접 적지 않고 sys.env(...) 나 psql 변수로만 받는다
        for line in text.splitlines():
            if re.search(r"password\s*=", line, re.I):
                assert "sys.env(" in line, (path, line)
        assert "grafana.net" not in text, path
        assert not re.search(r"https?://", text), path
    # 예시 파일은 자리표시(<...>)로 값을 비워 둔다
    for rel in ("alloy/alloy.env.example", "pdc/pdc.env.example"):
        assert "<" in _read(rel), rel


def test_alloy_config_targets_units():
    text = _read("alloy/config.alloy")
    for needle in (
        "mm-bot",
        "mm-worker",
        "mm-chat-poll",
        "prometheus.exporter.unix",
        "prometheus.exporter.cadvisor",
        "prometheus.remote_write",
    ):
        assert needle in text, needle
    # 접속 값은 환경 변수로만 읽는다
    assert "sys.env(" in text
    for line in text.splitlines():
        code = line.split("//", 1)[0]
        if re.search(r"\b(url|username|password|bearer_token)\s*=", code):
            assert "sys.env(" in code, line


def test_alloy_override_limits_memory_and_docker_group():
    text = _read("alloy/override.conf")
    assert "MemoryMax=200M" in text
    assert "SupplementaryGroups=docker" in text
    assert "EnvironmentFile=" in text


def test_readme_covers_required_sections():
    text = _read("README.md")
    for needle in (
        "/api/v1/health/ready",
        "docker 그룹",
        "kpi-reader.sql",
        "exclude-workspace.sql",
        "db:5432",
        "AUTO_CREATE_ENABLED",
        "11/20",
        "공개 링크",
    ):
        assert needle in text, needle
