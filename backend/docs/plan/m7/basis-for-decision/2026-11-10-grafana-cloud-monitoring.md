# 운영 모니터링을 Grafana Cloud 무료 플랜과 DB 집계 view 로 본다

- 기록일: 2026-11-11 (논의·설계 확정은 2026-11-10)
- 관련 마일스톤: M7
- 관련 이슈: #675

## 문제와 제약

- 운영 서버는 죽으면 다시 띄우기만 하고 사람에게 알리지 않는다(docker `restart: unless-stopped`, systemd `Restart=always`). 루트 `/health` 는 DB 가 죽어도 `ok` 를 돌려준다.
- `docs/techspec/metrics.md` 의 운영 KPI 가 "운영에서 수집 예정"으로 남아 있고, 멘토 리뷰(PR #17·#78·#230·#382)가 운영에서 재 보라고 한 지표(auto 롤백률 5%, 처리 시간 p95·10분 초과, 회의 처리 중 최대 메모리, `asr_suspect` 막힘별 PM 수정 비율)를 볼 곳이 없다.
- 서버는 t3.medium 한 대(2 vCPU, 4GB)에 DB·API·봇·워커·FE 가 함께 돌고 사양 변경·서버 추가가 안 된다. AWS 실습 환경은 2026-11-20 에 끝난다.
- DB 포트는 호스트에 열지 않는다(`backend/docker-compose.prod.yml`). Caddy 는 `/api` 만 백엔드로 보낸다고 문서에 적혀 있어 바깥의 `/health` 는 프론트 HTML 이 응답할 수 있다(서버에서 미확인).
- 대시보드는 공개 링크로 팀에 보이고, 알림은 보내지 않으며 담당자만 로그인한다(사용자 결정).

## 실제 검토한 선택지

모니터링 도구

1. 같은 EC2 에 Prometheus·Grafana 를 직접 띄운다.
2. CloudWatch 에 모으고 Grafana 가 CloudWatch 를 읽는다.
3. Grafana Cloud 무료 플랜 + 서버에 수집기 Grafana Alloy 하나.

KPI view 모양

1. 회의·추출 항목·승인 카드마다 한 줄(행 단위 fact view).
2. 날짜별 합계 view.
3. materialized view 와 갱신 작업.

Grafana 가 DB 에 닿는 방법(PDC 에이전트)

1. compose 밖에서 `docker run --network mm-prod_default` 스크립트로 띄운다.
2. `docker-compose.prod.yml` 에 서비스로 넣는다.
3. DB 포트를 `127.0.0.1` 에 열고 호스트에서 돌린다.

바깥 확인 경로

1. `/api/v1/health/ready` 를 새로 만든다.
2. Caddy 에 `/health` 경로를 더한다.

## 선택과 이유

- **Grafana Cloud 무료 + Alloy.** 1번은 4GB 서버에서 수백 MB 를 더 쓰고 서버가 죽으면 모니터링도 같이 죽는다. 2번은 메모리·디스크·로그를 보려면 어차피 서버에 에이전트를 설치해야 하고 실습 계정 IAM 권한이 필요하며 11/20 이후 다시 설정해야 한다. 3번은 서버에 수집기 하나만 두고, 서버를 옮겨도 대시보드가 남는다.
- **행 단위 fact view(`kpi.meeting_fact`, `kpi.extraction_item_fact`, `kpi.approval_fact`).** 고른 기간의 p50·p95 를 정확히 내려면 한 건 단위가 필요하다. ID·이름·제목·본문·payload 는 넣지 않고 시각·코드값·소요 초만 둔다. 읽기 전용 계정 `kpi_reader` 는 이 view 3개만 읽는다. 집계는 서비스 전체만 보고 공간별로 나누지 않는다(공개 링크라 공간 정보를 내보내지 않는다).
- **심사용 시드(#621) 공간만 `kpi.excluded_workspace` 로 뺀다.** 실제 사용자는 팀뿐이라 팀 공간은 모두 넣고, 몇 초 만에 재생된 시드 회의만 뺀다.
- **PDC 는 compose 밖 스크립트(`deploy/monitoring/pdc/run-pdc.sh`).** 2번은 토큰이 `backend/.env` 를 거쳐 api 컨테이너 환경에도 들어가고, 3번은 compose 를 바꿔 배포 때 DB·api 가 다시 만들어진다.
- **`GET /api/v1/health/ready`.** Caddy 를 손대지 않고 바깥에서 닿으며 DB 까지 확인한다. 실패하면 503 `DATABASE_UNAVAILABLE` 이고 예외 원문은 내보내지 않는다. 컨테이너 healthcheck 는 지금처럼 루트 `/health` 를 쓴다. "api 이상" 알림도 이 경로의 연속 실패로 대신한다.
- `asr_suspect` 막힘별 PM 제목 수정 비율은 payload 형식이 2026-11-07 이후 일정해 view 에 넣었다. auto 탈락 사유 분포는 DB 에 저장되지 않아 이번에 넣지 않고 로그 수집 단계로 넘겼다.

## 장단점과 감수한 제약

- Grafana Cloud 무료 한도(활성 시계열 10,000개, 로그 월 50GB, 보관 14일, 사용자 월 3명)에 맞춰 Alloy 의 수집 지표를 `keep` 으로 줄였다. 한도와 PDC 의 무료 제한은 가입 때 다시 확인한다.
- Alloy 에 docker 그룹 권한을 준다. 컨테이너 이름 라벨에 필요하지만 root 와 같은 권한이다.
- 대시보드를 모두 공개 링크로 연다. 공개 전에 IP·호스트 이름·토큰·URL 라벨을 지운다. `instance` 라벨은 `mm-prod` 로 고정했다.
- 알림을 보내지 않으므로 누가 들어가 보기 전까지 장애를 모른다.
- view 가 쓰는 컬럼은 PostgreSQL 이 DROP·타입 변경을 막는다. 그 컬럼을 바꾸는 마이그레이션은 view 를 다시 만들어야 한다(`backend/README.md` "KPI view"). 새 상태값·실패 단계는 `other` 로 들어간다.
- auto 되돌리기 비율은 되돌리기 제한(버전 1, 대기 카드 없음) 때문에 하한값이다.

## 영향 범위와 재검토 조건

- 마이그레이션 `c4f7a2d91e3b` 가 `kpi` 스키마를 만든다. `models.py` 와 FE·AI 계약은 바뀌지 않는다. AI 의 systemd 유닛 이름이나 `failed_stage` 값이 바뀌면 Alloy 설정과 view 를 함께 고친다.
- 다시 볼 때: 무료 한도를 넘을 때, 실제 사용자가 생겨 공간별 KPI 나 알림이 필요할 때, 11/20 서버 이전 뒤 같은 방식이 맞지 않을 때, 로그 수집(Loki)을 붙일 때.
- 이 기록 시점에 서버 설치·Grafana 연결·Synthetic 확인은 하지 않았다. 코드와 테스트(로컬 PostgreSQL 포함) 검증만 했다.

## 근거와 관련 문서

- 이슈 #675 본문과 설계 확정 댓글
- [KPI view 마이그레이션](../../../../migrations/versions/c4f7a2d91e3b_add_kpi_views.py), [ready 엔드포인트](../../../../app/api/health.py)
- [모니터링 설치·운영 문서](../../../../../deploy/monitoring/README.md)
- [추가 지표](../../../../../docs/techspec/metrics.md)
- [배포 CI 게이트 결정](2026-10-09-deploy-ci-gate.md)
