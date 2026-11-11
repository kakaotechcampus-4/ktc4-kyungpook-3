# 사람이 확인할 항목

저장소의 코드·설정·CI·PR 기록으로는 확인할 수 없어 문서에 "확인 필요" 표시를 남겨 둔 항목이다. 확인한 사람이 해당 문서의 표시를 값으로 바꾸고 이 표에서 줄을 지운다.

- 기준: 2026-11-11, 브랜치 `docs/confirm-needed-cleanup`. 줄 번호는 이 브랜치 기준이다.
- 남은 표시: 16건(아래 1~3절 표 10줄로 묶음). #708 을 병합한 뒤 다시 센 수다. #708 이 표시를 지우거나 값을 채운 13건은 이 표에서 뺐다. `docs/user/review-approve.md:17` 은 화면 흐름도의 "확인 필요" 상태 이름이라 대상이 아니다.
- 명령어에 비밀값을 넣지 않는다. 서버 명령은 운영 EC2 에서 실행한다.
- "명령 없음"은 저장소에서 실행 가능한 명령을 확인하지 못했다는 뜻이다.

## 1. 운영 서버 값

저장소 값 대조 결과(2026-11-11):

| 변수 | 코드 기본값 | 예시 파일 | compose·배포 설정 |
|---|---|---|---|
| `AUTO_CREATE_ENABLED` | 켜짐. `os.getenv("AUTO_CREATE_ENABLED", "true")`, 모르는 값은 꺼짐(`backend/app/api/extractions.py:82-94`) | `backend/.env.example:117` 에 `true` | `backend/docker-compose.prod.yml:32` 가 `env_file: .env` 로 넘긴다. compose·`deploy/ec2-deploy.sh`·`.github/workflows/deploy.yml` 에 이 변수를 직접 정한 곳은 없다 |
| `MM_EXTRACT_PATH` | `legacy`. 비면 legacy, 모르는 값은 `ValueError`(`ai/capture/judge_path.py:43-46`) | `ai/.env.example:85` 에 빈 값 | 저장소의 systemd 유닛·배포 스크립트에 이 변수를 직접 정한 곳은 없다 |
| `MM_GPU_FAILOVER` | 꺼짐. 비었거나 `off` 면 전환 없음(`ai/capture/worker.py:203-218`) | `ai/.env.example:26` 에 빈 값, drop-in 예시는 `manual`(`ai/deploy/gpu-stt/mm-worker-gpu.conf.example:7`) | 서버의 drop-in 에서 정한다(`ai/deploy/gpu-stt/README.md`) |

문서의 기본값 설명은 위와 일치해 고치지 않았다. 운영 서버의 실제 값만 남았다.

| 파일:줄 | 확인할 것 | 확인 방법(명령어) |
|---|---|---|
| `docs/dev/env.md:19`, `docs/design/ai/evidence-check.md:108`, `docs/design/ai/index.md:69`, `docs/design/ai/judge-pipeline.md:108`, `docs/design/ai/asr-check.md:159`, `docs/design/backend/gate-matching.md:126` | 운영 `AUTO_CREATE_ENABLED` 실제 값. 비어 있으면 기본값(켜짐) | `docker compose -f /opt/mm/backend/docker-compose.prod.yml exec -T api printenv AUTO_CREATE_ENABLED` (출처: `deploy/monitoring/README.md` 11절. 그 문서의 기록란에도 적는다) |
| `docs/dev/env.md:22`, `docs/design/ai/judge-pipeline.md:72` | 운영 워커의 `MM_EXTRACT_PATH` 실제 값. 줄이 없거나 비면 `legacy` | `sudo systemctl show mm-worker -p Environment -p EnvironmentFiles` 로 유닛이 정한 값과 읽는 파일을 보고, `sudo grep -n '^MM_EXTRACT_PATH' /opt/mm/ai/.env` 로 파일 값을 본다. 유닛 환경이 `ai/.env` 보다 먼저다(`deploy/README.md` 의 "`ai/.env` 는 기존 프로세스 환경에 없는 값만 채운다") |
| `docs/design/backend/notion-sync.md:105` | 운영에서 실제 Notion 연결이 동작하는지 | 명령 없음. 운영 웹에서 워크스페이스에 Notion 을 연결하고 태스크 하나가 Notion 에 반영되는지 본 뒤 날짜와 결과를 적는다 |
| `docs/design/backend/security.md:110` | 운영 `SERVICE_TOKEN`·`OAUTH_STATE_SECRET` 교체 주기 | 명령 없음. 운영 담당자에게 마지막 교체일과 주기를 묻는다. 값 자체는 문서에 적지 않는다 |
| `docs/design/backend/reminder-scheduler.md:146` | 72시간 막힘이 운영에서 걸린 횟수 | 명령 없음. 집계 쿼리를 저장소에서 확인하지 못했다. BE 담당자가 운영 DB 나 API 로그에서 센다 |

## 2. 측정·재실행이 필요한 값

| 파일:줄 | 확인할 것 | 확인 방법(명령어) |
|---|---|---|
| `docs/dev/testing.md:112` | 2026-11-07 표의 BE(파일 71·함수 1,316)와 FE 수치를 어떤 범위로 셌는지 | 다시 세기: `git ls-files 'backend/**/test_*.py' \| wc -l` 과 `git grep -h -E '^\s*(async )?def test_' -- 'backend/**/*.py' \| wc -l`. 2026-11-07 마지막 develop 커밋(`41b554fc`)은 이 방법으로 87·1,583 이다. 원래 집계한 사람에게 범위를 묻거나, 제출 직전 수치로 표를 바꾼다 |
| `docs/design/ai/stt.md:74` | 업로드 음성 화자 분리 정확도(DER). 잰 적이 없다 | 명령 없음. 측정 스크립트를 저장소에서 확인하지 못했다. 재지 않기로 하면 표시를 "재지 않았다"로 확정한다 |
| `docs/design/ai/evidence-check.md:116` | Jev 호출 단가 | 명령 없음. 공급사 요금표나 청구 내역에서 확인한다 |

## 3. 외부 자료

| 파일:줄 | 확인할 것 | 확인 방법(명령어) |
|---|---|---|
| `docs/user/faq.md:11` | Discord 채널 권한의 "애플리케이션 명령 사용"이 꺼지면 슬래시 명령이 막히는지 | 명령 없음. 시험 서버에서 그 권한을 끄고 봇 슬래시 명령이 보이는지 본다 |
| `docs/user/quick-guide.md:63` | 15행의 Discord 도움말 링크가 설명과 맞는 문서를 가리키는지 | 명령 없음. 15행의 링크를 브라우저로 열어 본다 |

## 4. 테스트 계정과 샘플 데이터 (#606)

결정(2026-11-11): 테스트 계정의 로그인 이메일·비밀번호, 샘플 음성 파일, 테스트용 Discord 서버는 공개 저장소에 적지 않고 심사 운영진에게 Notion 으로 따로 전달한다. 전달하는 계정은 PM 과 팀원 한 명이다(시드가 비밀번호를 정하는 계정이 이 둘이다, `backend/app/cli/seed_demo.py:206, 225`). README 와 사용자 가이드에는 "따로 전달한다"고만 적었다. 이메일과 비밀번호는 시드를 실행할 때 정한다(`backend/app/cli/seed_demo.py:627-633, 646, 678-679`).

| 파일:줄 | 확인할 것 | 확인 방법(명령어) |
|---|---|---|
| `docs/user/getting-started.md:13-14` | 운영 서비스에 시드를 실행했는지. #654 는 `--today 2026-11-19` 로 11/18 회의 시각 이후에 실행한다고 적고 있다 | 운영 서버에서 `docker compose -f /opt/mm/backend/docker-compose.prod.yml exec -e DEMO_PM_PASSWORD -e DEMO_MEMBER_PASSWORD api python -m app.cli.seed_demo --base-url http://localhost:8000 --email-pattern '<팀메일>+demo-{n}@gmail.com' --today 2026-11-19 --dry-run` 으로 이미 있는 계정·회의 수를 본다(출처: `backend/README.md` "심사용 시드") |
| `docs/user/getting-started.md:31, 33` | 추천 순서 4번(샘플 음성 올리기)과 6번(팀원 계정으로 로그인)이 Notion 으로 전달하는 내용과 맞는지 | 명령 없음. 전달 내용을 정한 뒤 순서를 다시 읽고 맞춘다 |

## 5. README 대표 GIF 촬영 시나리오 (#654)

`README.md:31` 의 자리 주석은 그대로 두었다. 파일 경로는 주석에 적힌 `docs/assets/readme-hero.gif` 다. 운영 시드를 실행한 뒤 PM 계정으로 찍는다.

화면과 순서는 사용자 가이드의 추천 순서(`docs/user/getting-started.md` "테스트 계정으로 바로 써 보기")와 회의록·승인 설명(`docs/user/review-approve.md` 1~2절)에서 가져왔다. 길이는 제안이다.

| 순서 | 화면 | 보여 줄 것 | 길이(제안) |
|---|---|---|---|
| 1 | 대시보드 | 확인 대기·기한 지남 숫자 | 3초 |
| 2 | 회의록 목록 | 샘플 회의 6개, **심사 준비 - 승인 대기 시연** 을 고른다 | 3초 |
| 3 | 회의록 > 요약 탭 → 추출된 일 탭 | **반영된 것** 과 **확인이 필요한 일** 두 칸, **확인 필요**·**보류** 배지와 까닭 | 6초 |
| 4 | 태스크 > 확인 필요 탭의 승인 카드(회의록에서는 **확인하기** 버튼) | 근거 원문, 칸 하나를 고쳐 승인 | 8초 |
| 5 | 회의록 > 추출된 일 탭으로 돌아오기 | 방금 승인한 일이 **반영된 것** 으로 옮겨진 모습 | 3초 |

- 전체 20~25초, 가로 1280px 안팎, 반복 재생. 용량이 크면 README 가 느리게 뜨므로 10MB 를 넘지 않게 줄인다(제안).
- 찍기 전에 확인할 것: 5번에서 승인한 일이 실제로 **반영된 것** 칸으로 옮겨 보이는지는 화면에서 확인하지 않았다. 다르게 보이면 5번을 빼거나 바꾼다.
- 계정 이메일이 화면에 보이면 가린다.
- 넣은 뒤 `README.md:31` 의 주석을 `![대표 화면](./docs/assets/readme-hero.gif)` 로 바꾼다.

## 6. 환경 구성과 배포 (작업 3)

`docs/dev/deploy.md` 의 "환경 분리 현황" 표는 설정 파일이 정한 내용이다. 아래는 저장소로 확인할 수 없거나 팀이 정해야 하는 것이다.

| 파일:줄 | 확인할 것 | 확인 방법(명령어) |
|---|---|---|
| `docs/dev/deploy.md` "환경 분리 현황" 표의 운영 열 | 운영 서버가 실제로 표와 같은 구성으로 떠 있는지(컨테이너 둘, systemd 유닛 셋, 프록시) | 운영 서버에서 `docker compose -f /opt/mm/backend/docker-compose.prod.yml ps`, `systemctl is-active mm-bot mm-worker mm-chat-poll.timer caddy`, `cat /opt/mm/.git/mm-deployed-sha` |
| 같은 표의 "시크릿 보관 위치" | 서버의 시크릿 파일이 표에 적은 위치에 있고 다른 사용자가 읽지 못하는지 | 운영 서버에서 `ls -l /opt/mm/backend/.env /opt/mm/ai/.env /etc/mm/ /etc/mm-monitoring/`. 값은 출력하지 않는다 |
| 같은 표의 "롤백 방법", `docs/dev/deploy.md` "되돌리기와 복구" | 백업·`alembic downgrade` 절차를 운영에서 한 번도 실행해 보지 않았다(#359). 정기 DB 백업 설정도 저장소에 없다 | `deploy/README.md` "마이그레이션이 들어간 커밋을 되돌릴 때"의 `pg_dump` 명령으로 백업이 만들어지는지 먼저 본다. downgrade 리허설을 제출 전에 할지 팀이 정한다 |
| `docs/dev/deploy.md` "스테이징 없이 배포를 지키는 방법" | `develop` 에 브랜치 보호 규칙이 없어 PR 의 CI 가 필수 체크가 아니다. 이대로 둘지 | `gh api repos/kakaotechcampus-4/ktc4-kyungpook-3/rules/branches/develop` (빈 배열이면 규칙 없음). 필수 체크를 걸지는 팀이 정한다 |
| `docs/dev/deploy.md` "환경 분리 현황"의 예정 항목 | 11/20 서버 이전 뒤 도메인·서버 경로·시크릿 위치가 바뀌는지 | 이전 뒤 `deploy/caddy/Caddyfile` 과 Actions 변수(`gh variable list`)를 보고 표를 다시 맞춘다 |
