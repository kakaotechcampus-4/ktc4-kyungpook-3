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
    # Grafana Cloud 는 대시보드를 열 때 여러 서버에서 접속을 한꺼번에 연다. 3 이면 패널 일부가
    # "too many connections for role" 로 깨졌다(2026-11-11 설치). 다시 실행해도 10 으로 남아야 한다.
    assert re.search(r"CONNECTION\s+LIMIT\s+10\b", sql), "CONNECTION LIMIT 10"
    # 비밀번호는 psql 변수로만 받는다
    assert ":'pw'" in sql
    # ALTER ROLE 이 실패하면 뒤의 GRANT 로 넘어가지 않고 멈춘다
    assert re.search(r"^\\set\s+ON_ERROR_STOP\s+on\s*$", sql, re.M)
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
        "--tmpfs /home/pdc/.ssh",
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


def test_run_pdc_success_path_keeps_token_out_of_argv(tmp_path):
    """조건이 맞으면 docker run 을 부른다. 토큰은 인자가 아니라 환경 변수로만 넘긴다(ps 에 안 보이게)."""
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    trace = tmp_path / "docker-argv"
    # 인자를 한 줄에 하나씩 기록하고, 토큰이 환경 변수로 들어왔는지도 남긴다
    docker = fake_bin / "docker"
    docker.write_text(
        "#!/bin/sh\n"
        'echo "CALL $1" >> "' + str(trace) + '"\n'
        'for a in "$@"; do echo "ARG $a" >> "' + str(trace) + '"; done\n'
        'echo "ENVTOKEN=$GCLOUD_PDC_SIGNING_TOKEN" >> "' + str(trace) + '"\n'
    )
    docker.chmod(0o755)
    fake_id = fake_bin / "id"
    fake_id.write_text("#!/bin/sh\necho 0\n")
    fake_id.chmod(0o755)
    env_file = tmp_path / "pdc.env"
    env_file.write_text(
        "GCLOUD_PDC_SIGNING_TOKEN=test-token-value\n"
        "GCLOUD_PDC_CLUSTER=test-cluster\n"
        "GCLOUD_HOSTED_GRAFANA_ID=12345\n"
    )
    env_file.chmod(0o600)

    result = subprocess.run(
        ["env", "-i", f"PATH={fake_bin}:/usr/bin:/bin", f"PDC_ENV_FILE={env_file}", "bash", str(RUN_PDC)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    lines = trace.read_text().splitlines()
    run_start = lines.index("CALL run")
    run_args = []
    for line in lines[run_start:]:
        if line.startswith("ARG "):
            run_args.append(line[4:])
        elif line.startswith("CALL ") and line != "CALL run":
            break
    joined = " ".join(run_args)
    assert run_args[0] == "run"
    assert "--network mm-prod_default" in joined
    assert "--read-only" in run_args
    # --read-only 이면 에이전트가 키를 만들 곳이 없어 "mkdir /home/pdc/.ssh/: read-only file system" 으로 멈춘다(2026-11-11)
    tmpfs = [run_args[i + 1] for i, a in enumerate(run_args) if a == "--tmpfs"]
    assert "/home/pdc/.ssh" in tmpfs, tmpfs
    assert "--cap-drop ALL" in joined
    assert re.search(r"grafana/pdc-agent:[0-9][^\s]*", joined)
    # 토큰 값은 docker 인자에 없어야 한다(ps 로 다른 사용자가 읽을 수 있다). 이름만 --env 로 넘기면 docker 가 값을 환경에서 읽는다.
    assert "test-token-value" not in joined
    assert "-token" not in run_args
    for name in ("GCLOUD_PDC_SIGNING_TOKEN", "GCLOUD_PDC_CLUSTER", "GCLOUD_HOSTED_GRAFANA_ID"):
        i = run_args.index(name)
        assert run_args[i - 1] == "--env", name
    # docker 프로세스의 환경에는 값이 들어 있어 --env NAME 이 값을 가져갈 수 있다
    assert "ENVTOKEN=test-token-value" in lines


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
        if p.is_file() and (p.name.endswith(".example") or p.suffix in {".alloy", ".sh", ".sql", ".conf", ".json"})
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


def test_alloy_override_runs_as_root_with_memory_cap():
    # alloy 사용자로는 cadvisor 의 docker 수집이 containerd 소켓(root 전용)을 못 열어 api·db 컨테이너 지표가 빈다(2026-11-11).
    text = _read("alloy/override.conf")
    service = text.split("[Service]", 1)[1]
    assert re.search(r"^User=root\s*$", service, re.M)
    assert "MemoryMax=200M" in service
    assert "EnvironmentFile=/etc/mm-monitoring/alloy.env" in service
    # root 로 돌면 docker 그룹은 필요 없다
    assert "SupplementaryGroups" not in service


DASHBOARDS = MON / "dashboards"


def _dashboard(name: str) -> dict:
    import json

    return json.loads((DASHBOARDS / name).read_text(encoding="utf-8"))


def _datasource_uids(node):
    if isinstance(node, dict):
        ds = node.get("datasource")
        if isinstance(ds, dict) and "uid" in ds:
            yield ds["uid"]
        for value in node.values():
            yield from _datasource_uids(value)
    elif isinstance(node, list):
        for value in node:
            yield from _datasource_uids(value)


def _raw_sqls(node):
    if isinstance(node, dict):
        if isinstance(node.get("rawSql"), str):
            yield node["rawSql"]
        for value in node.values():
            yield from _raw_sqls(value)
    elif isinstance(node, list):
        for value in node:
            yield from _raw_sqls(value)


def test_dashboards_are_importable_without_stack_specific_values():
    """대시보드 JSON 은 Import 때 데이터 소스를 고르게 둔다. 스택 고유 uid·주소가 들어 있으면 다른 스택에 못 옮긴다."""
    for name in ("mm-server.json", "mm-kpi.json"):
        board = _dashboard(name)
        text = (DASHBOARDS / name).read_text(encoding="utf-8")
        inputs = {i["name"] for i in board["__inputs"]}
        uids = set(_datasource_uids(board))
        assert uids, name
        assert all(u.startswith("${") and u[2:-1] in inputs for u in uids), (name, uids)
        assert not re.search(r"https?://", text), name
        assert "grafana.net" not in text, name


def test_kpi_dashboard_reads_only_kpi_views():
    board = _dashboard("mm-kpi.json")
    sqls = list(_raw_sqls(board))
    assert sqls
    for sql in sqls:
        tables = re.findall(r"\b(?:FROM|JOIN)\s+([a-z_][\w.]*)", sql, re.I)
        assert tables and all(t.startswith("kpi.") and t != "kpi.excluded_workspace" for t in tables), (tables, sql)


def test_kpi_dashboard_processing_time_skips_backdated_meetings():
    """시드처럼 시작 시각을 옛날로 만든 회의는 처리 시간이 며칠로 잡힌다. 처리 시간 패널은 하루 넘는 값을 뺀다."""
    board = _dashboard("mm-kpi.json")
    processing = [sql for sql in _raw_sqls(board) if "processing_seconds" in sql and "meeting_fact" in sql]
    assert processing
    for sql in processing:
        assert "processing_seconds < 86400" in sql, sql


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
