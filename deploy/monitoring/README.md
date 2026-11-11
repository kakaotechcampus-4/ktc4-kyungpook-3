# 모니터링 (Grafana Cloud, #675)

서버 상태와 KPI 를 Grafana Cloud 무료 스택 한 곳에서 본다. 이 폴더의 설치는 **자동 배포에 포함되지 않는다.** 서버에서 사람이 한 번 한다. 서버에는 Alloy(지표 수집)와 PDC 에이전트(DB 연결)만 더 올라간다.

## 개요

| 보고 싶은 것 | 어디서 | 어떻게 |
|---|---|---|
| 서버 CPU·메모리·디스크, mm-bot·mm-worker·mm-chat-poll 상태, api·db 컨테이너 | Grafana Cloud Prometheus | Alloy 가 서버에서 읽어 보낸다(`alloy/`) |
| API 가 살아 있는지 | Synthetic Monitoring | `GET /api/v1/health/ready` 를 바깥에서 주기적으로 부른다 |
| 처리 시간·실패율·자동 반영·승인·수정·반려·응답 시간 | PostgreSQL 데이터 소스 | 읽기 계정 `kpi_reader` 가 `kpi` view 3개를 읽는다(`sql/`, `pdc/`) |

- DB 는 호스트에 포트를 열지 않는다. Grafana Cloud 는 PDC 에이전트(`mm-prod_default` 네트워크의 컨테이너)를 거쳐 `db:5432` 로 들어온다.
- 사용 한도는 무료 플랜 기준이다(활성 시계열 10,000개, 사용자 3명). 로그인은 담당자 한 명만 한다. 대시보드는 전부 공개 링크로 공유한다(아래 "공개 링크 전 점검").
- Discord·메일로 보내는 알림은 없다. 서버 대시보드의 숫자 칸이 같은 기준으로 초록·주황·빨강으로 바뀌고, 서버가 통째로 죽은 것은 Synthetic 체크의 실패 알림(화면 표시)이 잡는다. 알림 규칙은 따로 만들지 않았다(9단계).
- 2026-11-11 운영 서버에 이 순서대로 설치했다. 문서와 다르게 해야 했던 곳은 각 단계에 적었다.
- 서버는 t3.medium(4GB)이고 AWS 실습 계정은 2026-11-20 에 끝난다. 이전 순서는 맨 아래에 있다.

## 설치 순서

1. Grafana Cloud 스택을 만든다.
2. 서버에 Alloy 를 설치한다.
3. PDC 에이전트를 띄운다.
4. DB 에 읽기 계정을 만든다.
5. (선택) 시드 워크스페이스를 KPI 에서 뺀다. 지금은 빼지 않는다.
6. Grafana 에 PostgreSQL 데이터 소스를 추가한다.
7. 대시보드 두 개를 Import 한다.
8. Synthetic Monitoring 체크를 만든다.
9. (선택) 알림 규칙을 만든다. 지금은 만들지 않았다.
10. 공개 링크 전 점검을 하고 공유한다.

## 1. Grafana Cloud 스택

1. 무료 스택을 만든다. 로그인 계정은 담당자 한 명만 쓴다.
2. 스택의 Prometheus 상세 화면에서 원격 쓰기 URL 과 사용자 ID 를 적어 둔다(파일에 쓰는 값은 아래 Alloy 단계에서만 쓴다).
3. Access Policy 를 만들어 `metrics:write` 만 준 토큰을 발급한다. Alloy 에만 쓴다.
4. PDC 용 토큰은 스택의 Grafana 화면 Connections → Private data source connections 에서 따로 만든다. 스택을 만들면 기본 네트워크 `pdc-<스택 이름>-default` 가 이미 있으니 그것을 열어 Configuration Details 에서 토큰을 만들고, 실행 예시(Docker)에 나오는 `-cluster`·`-gcloud-hosted-grafana-id` 값을 함께 적어 둔다. 무료 스택에서도 된다(2026-11-11 확인).

토큰은 저장소·문서·채팅에 붙이지 않는다. 한 번 보인 토큰이 노출되면 폐기하고 다시 발급한다.

## 2. Alloy 설치

서버에서 ubuntu 로 한다. 저장소는 `/opt/mm` 에 있다.

1. 공식 설치 안내대로 apt 저장소를 추가하고 설치한다.

   ```bash
   sudo mkdir -p /etc/apt/keyrings
   sudo wget -O /etc/apt/keyrings/grafana.asc https://apt.grafana.com/gpg-full.key
   sudo chmod 644 /etc/apt/keyrings/grafana.asc
   echo "deb [signed-by=/etc/apt/keyrings/grafana.asc] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
   sudo apt-get update && sudo apt-get install alloy
   ```

   `apt-get update` 가 `File has unexpected size ... Mirror sync in progress?` 로 Grafana 저장소만 실패하면 저장소가 갱신 중인 것이다. 몇 분에서 수십 분 기다리거나, GitHub 릴리스의 .deb 를 체크섬을 확인해 설치한다(2026-11-11 설치는 이 방법으로 v1.21.3 을 깔았다). 버전은 [릴리스 목록](https://github.com/grafana/alloy/releases)에서 고른다.

   ```bash
   V=1.21.3
   cd /tmp
   wget -q https://github.com/grafana/alloy/releases/download/v$V/alloy-$V-1.amd64.deb
   wget -q https://github.com/grafana/alloy/releases/download/v$V/SHA256SUMS
   grep " alloy-$V-1.amd64.deb\$" SHA256SUMS | sha256sum -c -     # OK 가 아니면 설치하지 않는다
   sudo apt-get install -y ./alloy-$V-1.amd64.deb
   ```

   패키지를 깔면 기본 설정으로 Alloy 가 켜질 수 있다. 3번에서 설정을 넣기 전이면 `sudo systemctl stop alloy` 로 꺼 둔다.

2. 접속 값 파일을 만든다. 값을 채운 뒤 권한이 600 인지 확인한다.

   ```bash
   sudo install -d -m 0755 /etc/mm-monitoring
   sudo install -m 0600 -o root -g root /opt/mm/deploy/monitoring/alloy/alloy.env.example /etc/mm-monitoring/alloy.env
   sudo nano /etc/mm-monitoring/alloy.env
   sudo stat -c '%a %U' /etc/mm-monitoring/alloy.env    # 600 root
   ```

3. 설정과 drop-in 을 둔다.

   ```bash
   sudo install -m 0644 /opt/mm/deploy/monitoring/alloy/config.alloy /etc/alloy/config.alloy
   sudo install -d /etc/systemd/system/alloy.service.d
   sudo install -m 0644 /opt/mm/deploy/monitoring/alloy/override.conf /etc/systemd/system/alloy.service.d/override.conf
   sudo systemctl daemon-reload
   sudo systemctl enable --now alloy
   systemctl status alloy --no-pager
   journalctl -u alloy -n 50 --no-pager     # config.alloy 의 오류와 "설치 때 확인:" 항목이 여기 나온다
   ```

4. `config.alloy` 의 `// 설치 때 확인:` 주석 항목을 하나씩 확인한다. 특히 cadvisor 가 `mm-worker`·`mm-bot` 서비스와 `api`·`db` 컨테이너를 지표에 싣는지 본다. Grafana Explore 에서 `count by (name, id) (container_memory_working_set_bytes)` 를 돌려 `mm-prod-api-1`·`mm-prod-db-1`·`mm-worker.service`·`mm-bot.service` 네 줄이 나오면 된다(2026-11-11 확인). 로그에 `Registration of the docker container factory successfully` 가 있어야 한다. `crio`·`containerd` 등록 실패 info 로그는 무시한다.

`override.conf` 가 하는 일:

- `MemoryMax=200M`: Alloy 가 이 이상 쓰면 Alloy 만 죽는다. 서버에는 워커가 `MemoryMax 3G` 까지 쓰므로 수집기가 메모리를 먹지 않게 한다.
- `EnvironmentFile`: 접속 값은 위 600 파일에서만 읽는다.
- `User=root`: Alloy 를 root 로 돌린다. 패키지 기본(`alloy` 사용자)과 docker 그룹만으로는 cadvisor 가 containerd 소켓(`/run/containerd/containerd.sock`, root 전용)을 못 열어 `docker container factory failed ... permission denied` 가 나고 api·db 컨테이너 지표가 빈다(2026-11-11 확인). 처음 설계의 docker 그룹도 root 와 같은 권한이라 보안 차이는 거의 없다. **Alloy 가 뚫리면 서버 전체가 뚫린 것과 같다.** 이 권한을 원하지 않으면 이 줄을 빼고 api·db 컨테이너 지표를 포기한다.
- 2026-11-11 운영 서버에는 예전 `override.conf`(docker 그룹)에 `User=root` 만 담은 `10-root.conf` 를 따로 더했다. 이 `override.conf` 로 다시 깔면 `10-root.conf` 는 지워도 된다.

`config.alloy` 는 시계열을 아끼려고 필요한 지표만 남기고 `instance` 라벨을 `mm-prod` 로 고정한다(호스트 이름이 공개 링크로 새지 않게). 대신 서버가 둘이 동시에 보내면 시계열이 섞이니 이전할 때는 옛 서버를 먼저 멈춘다.

## 3. PDC 에이전트

PDC 는 서버 안에서 Grafana Cloud 쪽으로 터널을 건다. 바깥에서 DB 로 들어오는 포트는 없다.

1. Grafana Cloud 에서 PDC 토큰을 만든 뒤, 접속 값 파일을 둔다.

   ```bash
   sudo install -m 0600 -o root -g root /opt/mm/deploy/monitoring/pdc/pdc.env.example /etc/mm-monitoring/pdc.env
   sudo nano /etc/mm-monitoring/pdc.env
   ```

2. 실행한다. `mm-prod_default` 네트워크가 있어야 하므로 백엔드 컨테이너가 떠 있는 서버에서 한다.

   ```bash
   sudo /opt/mm/deploy/monitoring/pdc/run-pdc.sh
   docker logs pdc-agent --tail 30
   ```

- 스크립트는 root 가 아니거나 env 파일이 없거나 권한이 600 이 아니면 docker 를 부르기 전에 멈춘다. 파일 위치는 `PDC_ENV_FILE` 로 바꿀 수 있다(기본 `/etc/mm-monitoring/pdc.env`).
- 이미 `pdc-agent` 컨테이너가 있으면 지우고 새로 만든다. 이미지 태그는 고정값이다. 올릴 때는 Docker Hub 의 `grafana/pdc-agent` 태그를 확인하고 스크립트를 고친다.
- `--read-only`·`--cap-drop ALL` 로 띄운다. 에이전트는 시작할 때 `/home/pdc/.ssh` 에 키를 만들므로 그 자리와 `/tmp` 만 tmpfs 로 연다. 이 자리가 없으면 `mkdir /home/pdc/.ssh/: read-only file system` 으로 멈춘다(2026-11-11 확인). 로그에 `Authenticated to private-datasource-connect-...` 와 `This is Grafana Private Datasource Connect!` 가 나오면 붙은 것이다. `-connect-timeout must be used with -use-gossh` 경고는 무시한다.
- 2026-11-11 운영 서버는 tmpfs 를 더한 `/tmp` 의 복사본으로 띄웠다. 이 스크립트로 다시 띄워도 같은 옵션이다.
- 서버를 다시 켜도 `--restart unless-stopped` 로 컨테이너가 다시 뜬다(docker 가 켜져 있으면).
- 토큰은 컨테이너 인자가 아니라 환경 변수(`--env GCLOUD_PDC_SIGNING_TOKEN`)로 넘긴다. 에이전트가 세 값을 환경 변수로 받는 것은 [PDC agent CLI 레퍼런스](https://grafana.com/docs/grafana-cloud/connect-externally-hosted/private-data-source-connect/pdc-agent-cli-reference/)에 있다. 호스트 `ps` 에는 값이 보이지 않는다. 컨테이너 환경에는 남으므로 `docker inspect` 에는 보이지만, docker 권한이 있는 사람은 어차피 root 와 같으므로 이 서버에서는 받아들인다.

## 4. 읽기 계정 SQL

`kpi` view 는 마이그레이션이 만든다([backend README](../../backend/README.md#kpi-view)). 읽기 계정은 view 3개에만 SELECT 를 받는다. `kpi.excluded_workspace` 와 원본 표는 못 본다. 접속은 10개, 쿼리는 5초, 쓰기는 막는다.

```bash
read -rs PW     # 화면에 안 보인다. 비밀번호를 붙여 넣고 Enter
docker compose -f /opt/mm/backend/docker-compose.prod.yml exec -T -e PW="$PW" db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v pw="$PW"' \
  < /opt/mm/deploy/monitoring/sql/kpi-reader.sql
unset PW
```

- DB 사용자·이름은 db 컨테이너의 환경 변수(`POSTGRES_USER`·`POSTGRES_DB`)를 그대로 쓴다.
- 권한 확인(비밀번호 없이 본다). `t|f|f`(view 는 읽음, 원본 표와 제외 목록은 못 읽음)가 나와야 한다.

  ```bash
  docker compose -f /opt/mm/backend/docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT has_table_privilege('"'"'kpi_reader'"'"','"'"'kpi.meeting_fact'"'"','"'"'SELECT'"'"'), has_table_privilege('"'"'kpi_reader'"'"','"'"'public.meeting'"'"','"'"'SELECT'"'"'), has_table_privilege('"'"'kpi_reader'"'"','"'"'kpi.excluded_workspace'"'"','"'"'SELECT'"'"')"'
  ```

- 접속을 10개로 둔 이유: Grafana Cloud 는 대시보드를 열 때 여러 서버에서 접속을 한꺼번에 연다. 3개였을 때 패널 일부가 `too many connections for role "kpi_reader"` 로 깨졌다(2026-11-11).
- 파일에 비밀번호가 없다. psql 변수 `pw` 로만 받는다. 다시 실행하면 비밀번호를 바꾸고 권한을 다시 준다.
- **view 를 다시 만드는 마이그레이션이 배포된 뒤에는 이 파일을 다시 실행한다.** view 를 DROP 하면 GRANT 가 같이 사라져 Grafana 가 "permission denied" 를 낸다.

## 5. 시드 공간 제외 (선택, 지금은 하지 않는다)

심사용 시드(#621)는 시연에 쓰려고 운영에 일부러 넣었으므로 **KPI 에 남긴다**(2026-11-11 결정. 처음 설계는 빼는 것이었다). 지금 운영의 처리 완료 회의는 시드 회의뿐이라, 빼면 회의 패널이 대부분 비게 된다.

시드는 회의 시작 시각을 며칠 전(10:00 KST)으로 합성하고 처리는 실행한 순간에 끝나므로, 처리 시간이 며칠로 잡힌다. 그래서 KPI 대시보드의 처리 시간 패널은 **하루(86400초) 넘게 잡힌 회의를 뺀다**(7단계). 오래된 녹음을 나중에 다시 처리한 회의도 같은 이유로 빠진다.

나중에 시드를 빼기로 하면:

1. DB 에서 시드 워크스페이스 ID 를 찾는다(`workspace` 의 이름·생성 시각으로 알아본다. 시드 회의는 시작이 정확히 01:00:00 UTC 이고 처리 시각이 몇 초 간격으로 몰려 있다).
2. [exclude-workspace.sql](sql/exclude-workspace.sql)의 `<시드 워크스페이스 ID>` 를 그 값으로 바꿔 슈퍼유저로 실행한다.
3. 세 view 의 행 수가 줄었는지 확인한다.

## 6. 데이터 소스

Grafana Cloud 의 Connections 에서 PostgreSQL 을 추가한다.

| 항목 | 값 |
|---|---|
| Name | `MM KPI` |
| Host URL | `db:5432` |
| Database | db 컨테이너의 `POSTGRES_DB` 값(`docker compose -f /opt/mm/backend/docker-compose.prod.yml exec -T db printenv POSTGRES_DB`) |
| User / Password | `kpi_reader` / 4단계에서 정한 비밀번호 |
| TLS/SSL Mode | `disable` (같은 docker 네트워크 안이다) |
| Private data source connect | 3단계 PDC 네트워크(`pdc-<스택 이름>-default`)를 고른다 |
| Connection limits | Max open `2`, Auto max idle 끔, Max idle `2` |

Save & test 가 `Database Connection OK` 면 된다. 실패하면 PDC 컨테이너 로그와 `kpi_reader` 권한을 먼저 본다. Connection limits 를 기본값으로 두면 대시보드를 처음 열 때 패널 일부가 접속 제한에 걸린다(4단계).

## 7. 대시보드

[dashboards/](dashboards/)의 JSON 두 개를 Import 한다. Grafana 의 Dashboards → New → Import 에 파일 내용을 붙여 넣고 Load 한 뒤, 데이터 소스를 고르고 Import 한다. 같은 대시보드가 있으면 Overwrite 한다.

| 파일 | 대시보드 | 고를 데이터 소스 |
|---|---|---|
| [mm-server.json](dashboards/mm-server.json) | MM 서버 상태: 메모리·디스크·봇·워커 상태, CPU, 서버·프로그램별 메모리, 네트워크, 재시작 | Prometheus(`grafanacloud-<스택>-prom`) |
| [mm-kpi.json](dashboards/mm-kpi.json) | MM KPI: 롤백률, 처리 시간, 실패율, 승인 결과, PM 응답 시간, 게이트 분포, 오인식 비교, 회의 처리 중 메모리 | PostgreSQL(`MM KPI`)과 Prometheus |

- 패널 제목의 (i) 에 패널의 뜻을 적어 두었다.
- JSON 에는 스택 고유 값(데이터 소스 uid·주소)이 없다. Import 할 때 데이터 소스를 고르므로 다른 스택에도 그대로 넣는다.
- 대시보드를 Grafana 에서 고쳤으면 Export(JSON) 해서 이 파일을 갱신한다.

### 패널 SQL

KPI 대시보드가 쓰는 식의 바탕이다. Grafana PostgreSQL 데이터 소스에서 쓴다. 날짜 묶음은 KST 로 한다. 아래 식을 `week` 대신 `day` 로 바꾸면 일별이다.

```sql
date_trunc('week', t AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
```

| 패널 | 읽는 view | 조건과 값 |
|---|---|---|
| auto 롤백률(주별, 5% 기준선) | `extraction_item_fact` | `gate='auto' AND action='create'` 의 `avg(reverted::int)`. 항목을 만든 주 기준이라 최근 주는 낮게 나온다 |
| 처리 시간 p50·p95, 10분 초과 | `meeting_fact` | `status='done' AND source IN ('discord','manual_upload') AND processing_seconds < 86400`(하루 넘게 잡힌 시드·재처리 회의를 뺀다, 5단계). 값은 `processing_seconds - coalesce(speaker_wait_seconds,0)`. `percentile_cont`, `count(*) FILTER (WHERE … > 600)`. 채팅은 뺀다. 디스코드 회의는 마지막 발화 끝부터 재서 큐 대기가 들어간다(단 `ended_at` 을 넘지 않게 자른다) |
| 실패율·단계 | `meeting_fact` | `status IN ('done','failed')` 중 failed 비율, `failed_stage` 별, `replaced` 로 다시 시도해 회복했는지 가른다 |
| 게이트 분포 | `extraction_item_fact` | `gate` 별 개수 |
| 승인·수정·반려 | `approval_fact` | `outcome` 별 개수 |
| PM 응답 시간 | `approval_fact` | `outcome IN ('approved','approved_edited','rejected')` 의 `response_seconds` p50·p95 |
| asr 비교 | `approval_fact` | `asr_flag IS NOT NULL AND outcome <> 'pending'` 에서 `asr_flag` 별 `avg(title_edited::int)` |
| 메모리 주석 | `meeting_fact` | 회의 처리 구간을 서버 메모리 그래프 위에 겹쳐 보는 주석 |

`source` 값은 `discord`, `manual_upload`, `chat` 이다. 아래 SQL 은 시작점이다. 운영 데이터로 값과 시간을 확인한 뒤 조정한다.

```sql
-- auto 롤백률(주별)
SELECT date_trunc('week', created_at AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS time,
       avg(reverted::int) AS rollback_rate
FROM kpi.extraction_item_fact
WHERE $__timeFilter(created_at) AND gate = 'auto' AND action = 'create'
GROUP BY 1 ORDER BY 1;

-- 처리 시간 p50·p95, 10분 초과(주별)
SELECT date_trunc('week', ended_at AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS time,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY v) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY v) AS p95,
       count(*) FILTER (WHERE v > 600) AS over_10min
FROM (SELECT ended_at, processing_seconds - coalesce(speaker_wait_seconds, 0) AS v
      FROM kpi.meeting_fact
      WHERE status = 'done' AND source IN ('discord', 'manual_upload')
        AND processing_seconds IS NOT NULL AND processing_seconds < 86400 AND $__timeFilter(ended_at)) t
GROUP BY 1 ORDER BY 1;

-- 실패율(주별)과 단계별 실패
SELECT date_trunc('week', ended_at AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS time,
       avg((status = 'failed')::int) AS fail_rate
FROM kpi.meeting_fact
WHERE status IN ('done', 'failed') AND $__timeFilter(ended_at)
GROUP BY 1 ORDER BY 1;

SELECT failed_stage,
       count(*) FILTER (WHERE NOT replaced) AS not_recovered,
       count(*) FILTER (WHERE replaced)     AS recovered
FROM kpi.meeting_fact
WHERE status = 'failed' AND $__timeFilter(ended_at)
GROUP BY 1 ORDER BY 2 DESC;

-- 게이트 분포
SELECT gate, count(*) AS items
FROM kpi.extraction_item_fact
WHERE $__timeFilter(created_at)
GROUP BY 1;

-- 승인·수정·반려
SELECT outcome, count(*) AS requests
FROM kpi.approval_fact
WHERE $__timeFilter(created_at)
GROUP BY 1;

-- PM 응답 시간(주별)
SELECT date_trunc('week', resolved_at AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS time,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY response_seconds) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY response_seconds) AS p95
FROM kpi.approval_fact
WHERE outcome IN ('approved', 'approved_edited', 'rejected')
  AND response_seconds IS NOT NULL AND $__timeFilter(resolved_at)
GROUP BY 1 ORDER BY 1;

-- asr 비교: 제목 수정 비율
SELECT asr_flag, count(*) AS cards, avg(title_edited::int) AS title_edit_rate
FROM kpi.approval_fact
WHERE asr_flag IS NOT NULL AND outcome <> 'pending' AND $__timeFilter(created_at)
GROUP BY 1;

-- 메모리 주석(Annotations 쿼리. 회의 처리 구간). 디스코드 회의의 ended_at 은 워커가 처리를 시작한 시각이다
SELECT ended_at AS time, extracted_at AS timeend
FROM kpi.meeting_fact
WHERE $__timeFilter(ended_at) AND extracted_at IS NOT NULL;
```

읽는 법:

- 롤백률은 하한값이다. 되돌리기에는 제한이 있어 되돌리지 못한 경우는 세지 않는다.
- 삭제한 회의와 탈퇴로 정리된 회의는 소급해서 빠진다. 지난 값이 나중에 바뀔 수 있다.
- 운영의 `AUTO_CREATE_ENABLED` 가 꺼져 있으면 auto 는 0 이다(아래 확인).
- 수정(`approved_edited`)은 2026-11-04 이후 요청부터 구분된다. `asr_flag` 는 2026-11-07 이후 카드부터 채워진다.

## 8. Synthetic Monitoring

바깥에서 API 를 주기적으로 불러 살아 있는지 본다. 대상은 DB 까지 확인하는 `GET /api/v1/health/ready` 이다(인증 없음, 정상이면 200, DB 에 못 닿으면 503).

체크를 만들기 전에 **서버에서 먼저** 본다. 리버스 프록시(Caddy)가 `/api` 만 백엔드로 넘기므로 `/health` 는 프론트 HTML 을 돌려줄 수 있다.

```bash
curl -si https://<도메인>/api/v1/health/ready | head -n 12   # 200 과 {"data":{"status":"ok"},...} 이어야 한다
curl -si https://<도메인>/health | head -n 12                # HTML 이 오면 정상이다. 바깥 확인 대상이 아니다
```

- 첫 응답이 200 이 아니거나 JSON 이 아니면(HTML 등) 체크를 만들지 않는다. 경로나 프록시 설정을 먼저 바로잡는다.
- Testing & synthetics → Synthetics → Checks 에서 API Endpoint(HTTP) 체크를 만든다(2026-11-11 설정).

  | 항목 | 값 |
  |---|---|
  | Job name | `mm-api-ready` |
  | URL | `https://<도메인>/api/v1/health/ready`, GET |
  | Probe | 1곳(서울, 없으면 도쿄) |
  | 주기 | 1분 |
  | 기대 상태 코드 | 200. 본문 정규식을 쓸 수 있으면 `"status":"ok"` |
  | Alerting | Failed Checks 켜고 "5분 동안 5번 중 2번 실패", 메일 주소는 비운다 |

- 무료 한도는 API 체크 실행 월 10만 회다. 1곳·1분이면 월 약 4만 3천 회다.
- "api 가 이상" 알림은 이 체크의 실패로 대신한다. 보낼 곳이 없어 Alerting 화면에만 보인다. 컨테이너 상태를 따로 수집하지 않는다.

## 9. 알림 규칙 (선택, 지금은 만들지 않았다)

알림을 보내지 않기로 했으므로 규칙을 만들어도 결국 화면에서 보는 것과 같다. 서버 대시보드의 숫자 칸(메모리·디스크·봇·워커)이 같은 기준으로 색이 바뀌고, 재시작 횟수 패널이 있어서 2026-11-11 설치에서는 만들지 않았다. 서버가 통째로 죽은 것은 8단계 Synthetic 체크가 잡는다. 메일·Discord 로 받아야 하면 아래 식으로 Grafana Alerting 규칙과 연락 지점을 만든다.

| 규칙 | 식(PromQL) | 지속 |
|---|---|---|
| ready 연속 실패 | Synthetic 체크의 `probe_success` 가 0 | 3분 |
| 디스크 80% | `1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} > 0.8` | 5분 |
| 사용 가능 메모리 10% 미만 | `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.10` | 5분 |
| mm-bot·mm-worker 비활성 | `node_systemd_unit_state{name=~"mm-(bot\|worker)\\.service", state="active"} == 0` | 2분 |
| 10분 안 재시작 3회 초과 | `increase(node_systemd_service_restart_total{name=~"mm-(bot\|worker)\\.service"}[10m]) > 3` | 즉시 |

- `mm-chat-poll` 은 oneshot 이라 평소 `inactive` 이다. 비활성 규칙에서 뺐다.
- 식과 라벨은 Explore 에서 실제 값을 확인한 뒤 쓴다(표의 `\|` 는 표 안에서 막대를 쓰려고 붙인 것이다. 식에는 `|` 만 쓴다).

## 10. 공개 링크 전 점검

서버 대시보드와 KPI 대시보드를 모두 공개 링크로 공유한다. **공유하기 전에** 아래를 하나씩 확인하고, 하나라도 걸리면 고친 뒤 다시 본다.

- [ ] 패널 제목·범례·테이블·툴팁에 IP 주소가 없다.
- [ ] 호스트 이름이 없다(`instance` 라벨은 `mm-prod` 로 고정돼 있어야 한다. 다른 값이 보이면 `config.alloy` 의 relabel 을 확인한다).
- [ ] 토큰·비밀번호·API 키가 어느 패널·변수·주석에도 없다.
- [ ] 도메인·URL 이 라벨에 들어 있지 않다(Synthetic 의 `url` 라벨, Alloy 의 `instance` 등).
- [ ] 컨테이너 환경 변수가 라벨로 새지 않는다(`store_container_labels = false`).
- [ ] KPI 패널에 사람 이름·이메일·회의 제목이 없다(view 에는 그런 컬럼이 없다. 쿼리를 새로 쓰지 않았는지 확인한다).
- [ ] 공개 링크를 시크릿 창에서 열어 위 항목을 다시 본다.

## 11. 운영 `AUTO_CREATE_ENABLED` 확인

2026-11-11 확인: 값이 없다(기본값, 켜짐). 꺼져 있으면 auto 항목이 없어 롤백률 패널이 0 으로 나온다. 서버에서 컨테이너의 값을 본다.

```bash
docker compose -f /opt/mm/backend/docker-compose.prod.yml exec -T api printenv AUTO_CREATE_ENABLED
```

비어 있으면 기본값(켜짐)이다. `false`·`0`·`off`·`no` 면 꺼져 있다. 그 밖의 모르는 값도 꺼짐으로 읽는다(`backend/app/api/extractions.py` 가 경고만 남기고 끈다, [환경 변수](../../docs/dev/env.md)). 확인한 값을 아래 기록란에 적는다.

## 기록란

설치 뒤 서버에서 재서 적는다. 비워 두면 한도 판단을 못 한다.

| 항목 | 값 | 날짜 |
|---|---|---|
| 설치 전 서버 메모리(`free -m` 의 available, 회의 처리 없음) | 2789MB / 전체 3832MB | 2026-11-11 |
| Alloy 버전 | v1.21.3 (GitHub .deb, SHA256 확인) | 2026-11-11 |
| PDC 에이전트 이미지 | `grafana/pdc-agent:0.0.67` | 2026-11-11 |
| 컨테이너 이름 | `mm-prod-api-1`, `mm-prod-db-1` (config.alloy 와 같음) | 2026-11-11 |
| 운영 `AUTO_CREATE_ENABLED` | 미설정(켜짐) | 2026-11-11 |
| Alloy 메모리(`systemctl status alloy` 의 Memory) | 미측정 | |
| PDC 컨테이너 메모리(`docker stats --no-stream pdc-agent`) | 미측정 | |
| 활성 시계열 수(무료 한도 10,000) | 미측정 | |
| 회의 처리 중 서버 최대 메모리(`MemoryMax` 3G 의 워커 포함) | 미측정(KPI 대시보드 "회의 처리 중 메모리") | |
| 깨진 payload 때문에 view 에서 빠진 행 수 | 미측정 | |

## 서버 이전 (11/20)

AWS 실습 계정이 끝나므로 서버를 옮길 때 다시 설치한다. Alloy 와 PDC 는 자동 배포에 없으므로 새 서버에서 직접 한다.

1. 새 서버에 배포를 끝낸다(백엔드 컨테이너가 떠 있고 `mm-prod_default` 네트워크가 있다). DB 를 옮겼다면 `alembic upgrade head` 로 `kpi` view 가 만들어졌는지 확인한다.
2. 옛 서버의 `alloy` 를 멈춘다(`sudo systemctl disable --now alloy`). `instance` 가 같은 값으로 고정이라 두 서버가 함께 보내면 시계열이 섞인다.
3. 4단계의 `kpi-reader.sql` 을 실행한다. 비밀번호는 바꿔도 된다(바꾸면 Grafana 데이터 소스도 고친다).
4. 5단계에서 시드를 빼기로 했다면 `exclude-workspace.sql` 을 다시 실행한다(DB 를 옮겼다면 새 DB 에 다시 넣어야 한다).
5. 2단계 순서로 Alloy 를 설치한다(`alloy.env`, `config.alloy`, `override.conf`). 새 서버의 컨테이너 이름이 `mm-prod-api-1`·`mm-prod-db-1` 과 다르면 `config.alloy` 를 고친다.
6. 옛 서버의 `pdc-agent` 를 멈추고(`docker rm -f pdc-agent`) 새 서버에서 3단계로 PDC 를 띄운다. 토큰은 같은 것을 쓰거나 새로 만든다.
7. Grafana 데이터 소스 `db:5432` 가 새 DB 에 붙는지 Save & test 로 확인한다(주소는 그대로다).
8. 도메인이 바뀌면 Synthetic 체크 URL 을 고친다. 바뀌는 즉시 8단계의 `curl` 확인을 새 서버에서 다시 한다.
9. 10단계 점검을 한 번 더 한다(도메인이 바뀌어 라벨이 달라질 수 있다).
