# 사람이 확인할 항목

저장소의 코드·설정·CI·PR 기록으로는 확인할 수 없어 문서에 "확인 필요" 표시를 남겨 둔 항목이다. 확인한 사람이 해당 문서의 표시를 값으로 바꾸고 이 표에서 줄을 지운다.

- 기준: 2026-11-11, 브랜치 `docs/confirm-needed-cleanup`. 줄 번호는 이 브랜치 기준이다.
- 남은 표시: 29건(아래 표 19줄로 묶음). `docs/user/review-approve.md:17` 은 화면 흐름도의 "확인 필요" 상태 이름이라 대상이 아니다.
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
| `docs/dev/env.md:19`, `docs/design/ai/evidence-check.md:108`, `docs/design/ai/index.md:69`, `docs/design/ai/judge-pipeline.md:108`, `docs/design/ai/asr-check.md:159`, `docs/design/backend/gate-matching.md:126`, `docs/techspec/test-strategy.md:62`, `docs/techspec/requirements-risks.md:41` | 운영 `AUTO_CREATE_ENABLED` 실제 값. 비어 있으면 기본값(켜짐) | `docker compose -f /opt/mm/backend/docker-compose.prod.yml exec -T api printenv AUTO_CREATE_ENABLED` (출처: `deploy/monitoring/README.md` 11절. 그 문서의 기록란에도 적는다) |
| `docs/dev/env.md:22`, `docs/design/ai/judge-pipeline.md:72`, `docs/techspec/agent-design.md:103` | 운영 워커의 `MM_EXTRACT_PATH` 실제 값. 줄이 없거나 비면 `legacy` | `sudo systemctl show mm-worker -p Environment -p EnvironmentFiles` 로 유닛이 정한 값과 읽는 파일을 보고, `sudo grep -n '^MM_EXTRACT_PATH' /opt/mm/ai/.env` 로 파일 값을 본다. 유닛 환경이 `ai/.env` 보다 먼저다(`deploy/README.md` 의 "`ai/.env` 는 기존 프로세스 환경에 없는 값만 채운다") |
| `docs/techspec/architecture.md:134` | GPU 전환 운영 모드가 `manual` 인지 `auto` 인지 | `sudo grep '"failover"' /opt/mm/ai/recordings/.worker/heartbeat.json` (출처: `ai/deploy/gpu-stt/README.md`) |
| `docs/design/backend/notion-sync.md:105` | 운영에서 실제 Notion 연결이 동작하는지 | 명령 없음. 운영 웹에서 워크스페이스에 Notion 을 연결하고 태스크 하나가 Notion 에 반영되는지 본 뒤 날짜와 결과를 적는다 |
| `docs/design/backend/security.md:110` | 운영 `SERVICE_TOKEN`·`OAUTH_STATE_SECRET` 교체 주기 | 명령 없음. 운영 담당자에게 마지막 교체일과 주기를 묻는다. 값 자체는 문서에 적지 않는다 |
| `docs/design/backend/reminder-scheduler.md:146` | 72시간 막힘이 운영에서 걸린 횟수 | 명령 없음. 집계 쿼리를 저장소에서 확인하지 못했다. BE 담당자가 운영 DB 나 API 로그에서 센다 |

## 2. 측정·재실행이 필요한 값

| 파일:줄 | 확인할 것 | 확인 방법(명령어) |
|---|---|---|
| `docs/techspec/test-strategy.md:23` | 제출 시점의 세 파트 테스트 재실행 결과 | `docs/dev/testing.md` 의 파트별 실행 명령으로 다시 돌리고 통과·실패 수와 날짜를 적는다 |
| `docs/dev/testing.md:112` | 2026-11-07 표의 BE(파일 71·함수 1,316)와 FE 수치를 어떤 범위로 셌는지 | 다시 세기: `git ls-files 'backend/**/test_*.py' \| wc -l` 과 `git grep -h -E '^\s*(async )?def test_' -- 'backend/**/*.py' \| wc -l`. 2026-11-07 마지막 develop 커밋(`41b554fc`)은 이 방법으로 87·1,583 이다. 원래 집계한 사람에게 범위를 묻거나, 제출 직전 수치로 표를 바꾼다 |
| `docs/design/ai/stt.md:72` | 업로드 음성 화자 분리 정확도(DER). 잰 적이 없다 | 명령 없음. 측정 스크립트를 저장소에서 확인하지 못했다. 재지 않기로 하면 표시를 "재지 않았다"로 확정한다 |
| `docs/design/ai/evidence-check.md:116` | Jev 호출 단가 | 명령 없음. 공급사 요금표나 청구 내역에서 확인한다 |
| `docs/collab/ai-agent-rules.md:123` | 도구별 실제 사용 비율. 커밋의 `Co-Authored-By` 표시만으로는 알 수 없다 | 참고 집계: `git log --no-merges -n 2000 --format=%b develop \| grep -c 'Co-Authored-By: Claude'`. 비율은 팀원에게 물어야 한다. 확인할 방법이 없으면 "단정할 수 없다"로 확정한다 |

## 3. 팀 기록·외부 자료

| 파일:줄 | 확인할 것 | 확인 방법(명령어) |
|---|---|---|
| `docs/collab/index.md:7`, `docs/collab/ground-rules.md:16` | 공식 역할표가 있는지, 커밋·PR 로 추정한 파트 배치가 맞는지 | 명령 없음. 팀원 전원에게 문서의 파트 배치를 확인받는다 |
| `docs/collab/ground-rules.md:103` | 정기 회의 일정·방식 | 명령 없음. 팀 채널의 회의 공지를 본다 |
| `docs/collab/branch-strategy.md:41` | main PR 제목의 주차 번호가 2 → 7, 11 → 13 으로 건너뛴 이유. `main` 대상 PR 이 9건뿐인 것은 확인했다 | 목록 재확인: `gh pr list --base main --state all --limit 60 --json number,title,mergedAt`. 이유는 PR 을 올린 팀원에게 묻는다 |
| `docs/collab/ai-agent-rules.md:101` | #246 을 #250 에서 되돌린 이유. #250 본문은 "Reverts #246" 한 줄이고 코멘트·리뷰가 없다 | `gh pr view 250 --json body,comments,reviews` 로 재확인. 이유는 #250 작성자(Y-Jimin)에게 묻는다 |
| `docs/collab/ai-agent-rules.md:102` | `mm-harness` 플러그인의 원본 위치와 설치 방법 | 명령 없음. 플러그인을 쓰는 팀원의 Claude Code `/plugin` 화면에서 마켓플레이스 출처를 본다 |
| `docs/collab/conventions.md:80` | `convention-check` 가 검사하는 항목. 스크립트가 외부 저장소(`kakaotechcampus-4/pr-pipeline` 의 `workflows/scripts/p2/convention-notice.sh`)에 있다 | `gh api repos/kakaotechcampus-4/pr-pipeline/contents/workflows/scripts/p2/convention-notice.sh -H "Accept: application/vnd.github.raw"`. 권한이 없으면 운영진에게 묻는다 |
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
