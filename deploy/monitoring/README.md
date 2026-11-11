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
- Discord·메일로 보내는 알림은 없다. 알림 규칙은 Grafana 의 Alerting 화면에서 상태를 보려고만 만든다.
- 서버는 t3.medium(4GB)이고 AWS 실습 계정은 2026-11-20 에 끝난다. 이전 순서는 맨 아래에 있다.

## 설치 순서

1. Grafana Cloud 스택을 만든다.
2. 서버에 Alloy 를 설치한다.
3. PDC 에이전트를 띄운다.
4. DB 에 읽기 계정을 만든다.
5. 시드 워크스페이스를 KPI 에서 뺀다.
6. Grafana 에 PostgreSQL 데이터 소스를 추가한다.
7. 패널을 만든다.
8. Synthetic Monitoring 체크를 만든다.
9. 알림 규칙을 만든다.
10. 공개 링크 전 점검을 하고 공유한다.

## 1. Grafana Cloud 스택

1. 무료 스택을 만든다. 로그인 계정은 담당자 한 명만 쓴다.
2. 스택의 Prometheus 상세 화면에서 원격 쓰기 URL 과 사용자 ID 를 적어 둔다(파일에 쓰는 값은 아래 Alloy 단계에서만 쓴다).
3. Access Policy 를 만들어 `metrics:write` 만 준 토큰을 발급한다. Alloy 에만 쓴다.
4. PDC 용 토큰은 Connections 의 Private data source connect 화면에서 따로 만든다.

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

4. `config.alloy` 의 `// 설치 때 확인:` 주석 항목을 하나씩 확인한다. 특히 cadvisor 가 `mm-worker`·`mm-bot` 서비스와 `api`·`db` 컨테이너를 지표에 싣는지 본다(Grafana Explore 에서 `container_memory_working_set_bytes`).

`override.conf` 가 하는 일:

- `MemoryMax=200M`: Alloy 가 이 이상 쓰면 Alloy 만 죽는다. 서버에는 워커가 `MemoryMax 3G` 까지 쓰므로 수집기가 메모리를 먹지 않게 한다.
- `EnvironmentFile`: 접속 값은 위 600 파일에서만 읽는다.
- `SupplementaryGroups=docker`: 컨테이너 이름을 읽으려고 docker 소켓에 닿게 한다. **docker 그룹은 root 와 같은 권한이다.** Alloy 가 뚫리면 서버 전체가 뚫린 것과 같다. 이 권한을 원하지 않으면 이 줄을 빼고 `config.alloy` 에서 `prometheus.exporter.cadvisor` 의 컨테이너 이름 대상을 포기한다(서비스 cgroup 지표는 남을 것으로 보지만 설치 때 확인한다).

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
- `--read-only`·`--cap-drop ALL` 로 뜨는지는 공식 문서에 없는 설정이다. 안 뜨면 `docker logs pdc-agent` 로 원인을 보고 필요한 것만 푼다.
- 서버를 다시 켜도 `--restart unless-stopped` 로 컨테이너가 다시 뜬다(docker 가 켜져 있으면).
- 토큰은 컨테이너 인자가 아니라 환경 변수(`--env GCLOUD_PDC_SIGNING_TOKEN`)로 넘긴다. 에이전트가 세 값을 환경 변수로 받는 것은 [PDC agent CLI 레퍼런스](https://grafana.com/docs/grafana-cloud/connect-externally-hosted/private-data-source-connect/pdc-agent-cli-reference/)에 있다. 호스트 `ps` 에는 값이 보이지 않는다. 컨테이너 환경에는 남으므로 `docker inspect` 에는 보이지만, docker 권한이 있는 사람은 어차피 root 와 같으므로 이 서버에서는 받아들인다.

## 4. 읽기 계정 SQL

`kpi` view 는 마이그레이션이 만든다([backend README](../../backend/README.md#kpi-view)). 읽기 계정은 view 3개에만 SELECT 를 받는다. `kpi.excluded_workspace` 와 원본 표는 못 본다. 접속은 3개, 쿼리는 5초, 쓰기는 막는다.

```bash
read -rs PW
docker compose -f /opt/mm/backend/docker-compose.prod.yml exec -T db \
  psql -U <POSTGRES_USER> -d <POSTGRES_DB> -v ON_ERROR_STOP=1 -v pw="$PW" < /opt/mm/deploy/monitoring/sql/kpi-reader.sql
unset PW
```

- `<POSTGRES_USER>`·`<POSTGRES_DB>` 는 `backend/.env` 의 값이다.
- 파일에 비밀번호가 없다. psql 변수 `pw` 로만 받는다. 다시 실행하면 비밀번호를 바꾸고 권한을 다시 준다.
- **view 를 다시 만드는 마이그레이션이 배포된 뒤에는 이 파일을 다시 실행한다.** view 를 DROP 하면 GRANT 가 같이 사라져 Grafana 가 "permission denied" 를 낸다.

## 5. 시드 공간 제외

심사용 시드(#621) 워크스페이스는 실제 사용이 아니므로 KPI 에서 뺀다. 팀 워크스페이스는 뺀 적이 없다. 시드는 회의 시작 시각을 며칠 전으로 합성하므로, 빼지 않으면 처리 시간이 며칠로 잡혀 p95 와 10분 초과 건수가 망가진다.

1. DB 에서 시드 워크스페이스 ID 를 찾는다(`workspace` 의 이름·생성 시각으로 알아본다).
2. [exclude-workspace.sql](sql/exclude-workspace.sql)의 `<시드 워크스페이스 ID>` 를 그 값으로 바꿔 슈퍼유저로 실행한다.
3. 세 view 의 행 수가 줄었는지 확인한다.

## 6. 데이터 소스

Grafana Cloud 의 Connections 에서 PostgreSQL 을 추가한다.

| 항목 | 값 |
|---|---|
| Host URL | `db:5432` |
| Database | `<POSTGRES_DB>` |
| User / Password | `kpi_reader` / 4단계에서 정한 비밀번호 |
| TLS/SSL Mode | `disable` (같은 docker 네트워크 안이다) |
| Private data source connect | 3단계 PDC 연결을 고른다 |

Save & test 가 성공하면 된다. 실패하면 PDC 컨테이너 로그와 `kpi_reader` 권한을 먼저 본다.

## 7. 패널 SQL

Grafana PostgreSQL 데이터 소스에서 쓴다. 날짜 묶음은 KST 로 한다. 아래 식을 `week` 대신 `day` 로 바꾸면 일별이다.

```sql
date_trunc('week', t AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
```

| 패널 | 읽는 view | 조건과 값 |
|---|---|---|
| auto 롤백률(주별, 5% 기준선) | `extraction_item_fact` | `gate='auto' AND action='create'` 의 `avg(reverted::int)`. 항목을 만든 주 기준이라 최근 주는 낮게 나온다 |
| 처리 시간 p50·p95, 10분 초과 | `meeting_fact` | `status='done' AND source IN ('discord','manual_upload')`. 값은 `processing_seconds - coalesce(speaker_wait_seconds,0)`. `percentile_cont`, `count(*) FILTER (WHERE … > 600)`. 채팅은 뺀다. 디스코드 회의는 마지막 발화 끝부터 재서 큐 대기가 들어간다(단 `ended_at` 을 넘지 않게 자른다) |
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
        AND processing_seconds IS NOT NULL AND $__timeFilter(ended_at)) t
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
- HTTP 체크를 만든다. URL 은 `https://<도메인>/api/v1/health/ready`, 기대 상태 코드 200. 주기는 1분 안팎으로 하되 무료 한도(체크 실행 수)를 넘지 않게 프로브 수를 적게 둔다.
- "api 가 이상" 알림은 이 체크가 연속으로 실패하는 것으로 대신한다. 컨테이너 상태를 따로 수집하지 않는다.

## 9. 알림 규칙 (화면 표시용)

Grafana Alerting 에 규칙만 만든다. 연락 지점(Discord·메일)은 연결하지 않는다. 상태는 Alerting 화면에서 본다.

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

운영에서는 켜 둔다. 꺼져 있으면 auto 항목이 없어 롤백률 패널이 0 으로 나온다. 값은 서버에서 컨테이너로 본다.

```bash
docker compose -f /opt/mm/backend/docker-compose.prod.yml exec -T api printenv AUTO_CREATE_ENABLED
```

비어 있으면 기본값(켜짐)이다. `false`·`0`·`off`·`no` 면 꺼져 있다. 그 밖의 모르는 값도 꺼짐으로 읽는다(`backend/app/api/extractions.py` 가 경고만 남기고 끈다, [환경 변수](../../docs/dev/env.md)). 확인한 값을 아래 기록란에 적는다.

## 기록란

설치 뒤 서버에서 재서 적는다. 비워 두면 한도 판단을 못 한다.

| 항목 | 값 | 날짜 |
|---|---|---|
| Alloy 메모리(`systemctl status alloy` 의 Memory) | | |
| PDC 컨테이너 메모리(`docker stats --no-stream pdc-agent`) | | |
| 활성 시계열 수(무료 한도 10,000) | | |
| 회의 처리 중 서버 최대 메모리(`MemoryMax` 3G 의 워커 포함) | | |
| 운영 `AUTO_CREATE_ENABLED` | | |
| 깨진 payload 때문에 view 에서 빠진 행 수 | | |

## 서버 이전 (11/20)

AWS 실습 계정이 끝나므로 서버를 옮길 때 다시 설치한다. Alloy 와 PDC 는 자동 배포에 없으므로 새 서버에서 직접 한다.

1. 새 서버에 배포를 끝낸다(백엔드 컨테이너가 떠 있고 `mm-prod_default` 네트워크가 있다). DB 를 옮겼다면 `alembic upgrade head` 로 `kpi` view 가 만들어졌는지 확인한다.
2. 옛 서버의 `alloy` 를 멈춘다(`sudo systemctl disable --now alloy`). `instance` 가 같은 값으로 고정이라 두 서버가 함께 보내면 시계열이 섞인다.
3. 4단계의 `kpi-reader.sql` 을 실행한다. 비밀번호는 바꿔도 된다(바꾸면 Grafana 데이터 소스도 고친다).
4. 시드 워크스페이스 ID 가 같으면 `exclude-workspace.sql` 을 다시 실행한다(DB 를 옮기지 않았다면 필요하다).
5. 2단계 순서로 Alloy 를 설치한다(`alloy.env`, `config.alloy`, `override.conf`).
6. 옛 서버의 `pdc-agent` 를 멈추고(`docker rm -f pdc-agent`) 새 서버에서 3단계로 PDC 를 띄운다. 토큰은 같은 것을 쓰거나 새로 만든다.
7. Grafana 데이터 소스 `db:5432` 가 새 DB 에 붙는지 Save & test 로 확인한다(주소는 그대로다).
8. 도메인이 바뀌면 Synthetic 체크 URL 을 고친다. 바뀌는 즉시 8단계의 `curl` 확인을 새 서버에서 다시 한다.
9. 10단계 점검을 한 번 더 한다(도메인이 바뀌어 라벨이 달라질 수 있다).
