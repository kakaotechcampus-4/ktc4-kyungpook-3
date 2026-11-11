# 모니터링 운영 설치에서 바꾼 것: 시드 포함, Alloy root 실행, 알림 규칙 생략

- 기록일: 2026-11-11
- 관련 마일스톤: M7
- 관련 이슈: #675
- 이전 결정: [운영 모니터링을 Grafana Cloud 무료 플랜과 DB 집계 view 로 본다](2026-11-10-grafana-cloud-monitoring.md)

## 문제와 제약

2026-11-11 운영 서버에 [모니터링 문서](../../../../../deploy/monitoring/README.md)대로 설치하면서, 설계(2026-11-10)와 다르게 해야 했거나 사용자가 다시 정한 것이 생겼다.

- 운영에 심사용 시드(#621)를 일부러 넣었다. 시드 회의는 시작 시각을 며칠 전(10:00 KST)으로 합성하고 처리는 실행한 순간에 끝나서, 처리 시간이 최대 384시간으로 잡혔다. 이때 운영의 처리 완료 회의(채팅 제외)는 시드 6개뿐이었다.
- Alloy 를 패키지 기본(`alloy` 사용자)과 docker 그룹으로 돌리자 cadvisor 가 `docker container factory failed ... containerd.sock: permission denied` 로 api·db 컨테이너 지표를 못 모았다.
- PDC 에이전트를 `--read-only` 로 띄우자 `mkdir /home/pdc/.ssh/: read-only file system` 으로 멈췄다.
- KPI 대시보드를 처음 열자 패널 일부가 `too many connections for role "kpi_reader"` 로 깨졌다(읽기 계정 접속 제한 3).
- 알림은 보내지 않기로 이미 정했다(이전 결정).

## 실제 검토한 선택지

시드

1. 이전 결정대로 시드 공간을 `kpi.excluded_workspace` 로 뺀다.
2. 시드를 KPI 에 남기고 처리 시간 패널만 하루 넘는 값을 뺀다.

Alloy 컨테이너 수집

1. Alloy 를 root 로 돌린다.
2. containerd 소켓 권한을 바꾼다.
3. api·db 컨테이너 지표를 포기한다.

알림 규칙 4개(디스크·메모리·봇·워커 비활성·재시작)

1. 설계대로 Grafana Alerting 에 화면 표시용 규칙을 만든다.
2. 만들지 않는다.

## 선택과 이유

- **시드를 남기고 처리 시간 패널만 하루(86400초) 넘는 값을 뺀다.** 시드는 시연용으로 일부러 넣은 데이터이고(사용자 결정), 빼면 회의 패널이 거의 비었다. 실제 처리 시간이 하루를 넘을 일은 없으므로 하루 넘는 값은 시드나 오래된 녹음을 다시 처리한 회의로 본다. view 는 바꾸지 않고 대시보드 쿼리에서만 거른다. `kpi.excluded_workspace` 와 `exclude-workspace.sql` 은 나중에 빼고 싶을 때를 위해 남긴다.
- **Alloy 를 root 로 돌린다**(`override.conf` 의 `User=root`). 이전 결정에서 준 docker 그룹도 root 와 같은 권한이라 보안 차이가 거의 없다. 소켓 권한을 바꾸는 방법은 containerd 가 다시 뜨면 되돌아가고, 컨테이너 지표를 포기하면 "api 메모리"를 볼 수 없다.
- **PDC 는 `/home/pdc/.ssh` 를 tmpfs 로 연다.** `--read-only`·`--cap-drop ALL` 은 그대로 두고 에이전트가 키를 쓰는 자리만 연다. 컨테이너가 다시 뜰 때마다 키와 인증서를 새로 받는다.
- **읽기 계정 접속 제한을 10 으로, Grafana 데이터 소스는 Max open 2 로 둔다.** Grafana Cloud 가 여러 서버에서 한꺼번에 접속해 Grafana 쪽 제한만으로는 부족했다. 읽기 전용이고 쿼리는 5초에 끊겨 DB 부담이 작다.
- **알림 규칙은 만들지 않는다.** 보낼 곳이 없어서 규칙도 결국 화면 표시인데, 서버 대시보드의 숫자 칸이 같은 기준으로 색이 바뀌고 재시작 패널도 있다. 서버가 통째로 죽은 것은 Synthetic 체크의 실패 알림이 잡는다. 식은 문서에 남겨 두어 알림이 필요해지면 바로 만든다.

## 장단점과 감수한 제약

- 처리 시간 패널은 정말로 하루 넘게 걸린 회의를 보여 주지 않는다. 그런 회의는 보통 실패로 끝나 회의 실패율에 잡힌다.
- 시드가 섞인 패널(게이트 분포, 승인 결과, 롤백률 등)은 실제 사용 지표가 아니다. 지금 운영 데이터는 시드와 팀 테스트뿐이다.
- Alloy 가 뚫리면 서버 전체가 위험하다(이전 결정과 같다).

## 영향 범위와 재검토 조건

- 바뀐 파일: `deploy/monitoring/alloy/override.conf`, `deploy/monitoring/pdc/run-pdc.sh`, `deploy/monitoring/sql/kpi-reader.sql`, `deploy/monitoring/README.md`, 대시보드 JSON 두 개(`deploy/monitoring/dashboards/`), `docs/techspec/metrics.md`.
- 다시 볼 때: 실제 사용자 데이터가 쌓여 시드가 수치를 왜곡할 때(그때 시드를 뺀다), 메일·Discord 알림이 필요해질 때, 서버를 옮길 때(11/20).

## 근거와 관련 문서

- 운영 설치 기록: [모니터링 문서](../../../../../deploy/monitoring/README.md)의 각 단계와 기록란
- 이전 결정: [2026-11-10 Grafana Cloud 모니터링](2026-11-10-grafana-cloud-monitoring.md)
- 이슈 #675, PR #684·#706
