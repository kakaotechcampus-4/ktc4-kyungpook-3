# 부하테스트 (k6)

BE API 에 부하를 단계별로 올려 응답 시간, 실패율, 서버 CPU·메모리를 잰다. 레포 루트에서 돌린다. k6(`brew install k6`), Docker, Chrome 이 필요하다.

```
loadtest/run.sh up        # 로컬 스택을 띄우고 공간 5개를 심사 시드로 채운다
loadtest/run.sh web       # 시나리오 1: 웹 사용자
loadtest/run.sh handoff   # 시나리오 2: 봇 인계
loadtest/run.sh down      # 스택과 테스트 데이터를 지운다
```

부하 단계는 `LT_LEVELS=5,10,15,20`, 단계 길이(초)는 `LT_STAGE_SECONDS=60` 으로 바꾼다. 단계마다 k6 시나리오 하나(`vus_NNN`)라 단계별 수치가 따로 남는다.

## 시나리오

| 파일 | 한 바퀴 | 기본 단계 |
|---|---|---|
| `web.js` | PM 이 대시보드를 연다. 요청 10개를 브라우저처럼 동시에(`http.batch`) 보내고 회의 상세를 본다. 다섯 바퀴에 한 번 태스크 상태를 바꾼다. 바퀴 사이 3 ~ 7초 쉰다 | 10, 25, 50, 100, 200 VU |
| `handoff.js` | 봇이 회의 하나를 넘긴다. `POST /meetings` → `PATCH /end` → `POST /sources` → 항목마다 `POST /tasks/similar` → `POST /extractions`. 쉬지 않는다 | 동시 회의 1, 2, 5, 10, 20 |

요청 묶음은 `frontend/src/widgets/dashboard/model/useDashboardData.ts` 와 `ai/capture/handoff.py` 를 따랐다. 회의 내용은 심사 시드(`backend/app/cli/demo_seed/meetings.json`)를 돌려 쓴다.

## 로컬 스택

`compose.yml` 은 운영 이미지(`backend/Dockerfile`, `uvicorn --workers 1`)를 그대로 띄우고 api 에 운영 서버(t3.medium)와 같은 vCPU 2개 상한을 둔다. 임베딩 API 는 0원 대역(`embedding_stub.py`)으로 바꿔 유사 task 검색의 BE 쪽 비용만 잰다. 볼륨이 개발 DB 와 따로라 `down` 으로 테스트 데이터가 모두 지워진다. 서비스 토큰과 테스트 비밀번호는 실행마다 만들어 `secrets/loadtest-local.sh` 에 두고 화면에 찍지 않는다.

## 결과물

`LT_OUT`(기본 `mm/eval-runs/loadtest/<시각>-<시나리오>/`, 레포 밖)에 남는다.

| 파일 | 내용 |
|---|---|
| `stages.md` | 단계별 요청 수, 처리량, p50·p95·p99, 실패율, 컨테이너별 CPU·메모리 최고값. 마지막 단계의 요청별 p50·p95 |
| `report.html`, `report.png` | k6 웹 대시보드와 그 캡처 |
| `server.svg`, `server.png` | 컨테이너 CPU·메모리 그래프. 회색 띠가 부하 단계 |
| `server.csv`, `k6.json.gz`, `summary.json` | 원자료 |

## 운영 서버

운영은 팀에 알린 뒤 한가한 시간에 낮은 단계만 짧게 친다. 봇 전용 API 는 Caddy 가 밖에서 막으므로 운영에서는 `web.js` 만 친다. 테스트 계정은 서버에서 심사 시드로 만들고 정리는 `cleanup.py` 로 한다(PM 이 팀원을 빼고 탈퇴해 공간이 지워지는 제품 경로).

```
BASE_URL=https://<운영 주소> LT_WORKSPACES=1 LT_READONLY=1 LT_LEVELS=1,3,5 LT_STAGE_SECONDS=30 \
  LT_SSH=ktc-server LT_TARGETS="mm-prod-api-1 mm-prod-db-1 unit:mm-worker unit:mm-bot host" loadtest/run.sh web
```

`LT_READONLY` 는 태스크 상태 변경을 빼고, `LT_SSH` 는 샘플러를 서버에서 돌려 컨테이너, systemd 서비스(cgroup), 호스트 메모리를 함께 적는다. 서버 시계는 이 기계와 어긋날 수 있어(2026-11-11 운영 서버는 36초 늦었다) 실행 전에 차이를 재 `clock_offset_s.txt` 에 남기고, `report.py` 가 그만큼 서버 샘플 시각을 옮겨 단계에 맞춘다. `server.csv` 는 서버 시각 그대로다. 동시 요청이 40개를 넘으면 BE 가 멈추므로(#701) 운영에서는 5 VU 를 넘기지 않는다.

## 결과

2026-11-11 로컬 측정은 [진행 로그](../ai/docs/basis_for_decision/ai/2026-11-11-k6-load-test.md)와 `results/` 의 캡처에 있다.
