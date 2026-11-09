# 배포

EC2 한 대에 백엔드(API·DB 컨테이너), 프론트엔드 정적 파일, 녹음 봇·AI 워커(systemd)를 함께 올린다.

## 흐름

1. develop 에 push 되면 [deploy.yml](../.github/workflows/deploy.yml)이 같은 커밋으로 ai·backend·frontend CI 를 모두 돌린다. 하나라도 실패하면 배포하지 않는다.
2. 세 검사가 통과하면 SSM 으로 서버의 `/opt/mm` 을 그 커밋까지 fast-forward 하고 [ec2-deploy.sh](ec2-deploy.sh)를 실행한다.
3. 스크립트는 마지막으로 끝까지 성공한 배포(`.git/mm-deployed-sha`) 이후 바뀐 파트만 다시 올린다. 백엔드 컨테이너는 시작하면서 `alembic upgrade head` 를 먼저 한다.
4. 녹음 중이면 봇을 재시작하지 않고 기준 커밋을 그대로 둔다. 녹음이 끝난 뒤 Actions 에서 deploy 를 수동 실행하면 다시 올린다.

배포는 한 번에 하나씩 돈다. 대기 중인 배포가 있는데 새 push 가 오면 대기 중이던 것은 취소되고 새 커밋이 배포된다(새 커밋이 앞의 변경을 포함한다). 대기 중이던 수동 실행(mode=all)도 취소되고, 새 push 의 배포는 바뀐 파트만 올린다. 전체 재배포가 필요하면 그 배포가 끝난 뒤 수동 실행을 다시 한다.

## 녹음과 봇 재시작

스크립트는 녹음 중인지 확인할 때부터 봇을 다시 띄울 때까지 `ai/recordings/restart.lock` 을 쥔다. 60초 안에 못 잡으면 봇 재시작을 건너뛰고 다음 배포에 맡긴다.

봇이 새 녹음을 시작할 때 이 잠금을 확인해야 확인과 재시작 사이의 틈이 닫힌다. 봇 쪽은 아직 구현되지 않았다([요청](../backend/docs/requests/bot-restart-lock.md)). 그 전까지는 이 틈이 남지만, 배포 순서와 상관없이 지금보다 나빠지지는 않는다.

## 되돌리기

`mm-deployed-sha` 는 다음 배포의 비교 기준일 뿐이다. 서비스나 DB 를 이전 상태로 되돌리지 않는다.

### 코드만 되돌릴 때

문제 커밋을 develop 에서 `git revert` 하고 머지한다. CI 를 통과하면 자동으로 배포된다. 서버는 빌드 뒤 이름을 잃은 옛 이미지를 지우므로(`docker image prune -f`) 백엔드는 이전 이미지로 바로 바꾸지 못하고 다시 빌드한다.

### 마이그레이션이 들어간 커밋을 되돌릴 때

revert 만 하면 DB 는 코드에 없는 리비전에 남는다. 그러면 새 컨테이너의 `alembic upgrade head` 가 리비전을 찾지 못해 API 가 뜨지 않는다. 둘 중 하나로 한다.

- 권장: 되돌리는 내용을 새 마이그레이션으로 만들어 앞으로 배포한다. 리비전 순서가 끊기지 않는다.
- revert 가 꼭 필요하면 revert 를 머지하기 전에 서버에서 지금 이미지로 리비전을 내린다. 먼저 백업한다.

```bash
cd /opt/mm
docker compose -f backend/docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > ~/mm-backup-$(date +%F-%H%M).sql
docker compose -f backend/docker-compose.prod.yml run --rm api alembic downgrade <되돌릴 커밋 직전 리비전>
```

downgrade 와 revert 배포 사이에는 새 코드가 옛 스키마에서 돈다. 이 시간을 줄이려면 revert PR 을 먼저 열어 CI 를 통과시켜 두고, downgrade 직후 머지한다. 위 백업·downgrade 명령은 아직 운영에서 실행해 보지 않았다.

## 마이그레이션 호환 원칙

되돌리면 이전 코드가 새 스키마 위에서 돌 수 있다. downgrade 는 자동으로 실행하지 않으므로, 마이그레이션은 이전 코드와도 맞게 만든다.

- 컬럼·테이블 추가는 이전 코드가 몰라도 되게 한다. 새 컬럼은 nullable 이거나 서버 기본값을 둔다.
- 삭제와 이름 변경은 두 번에 나눈다. 먼저 코드가 더는 쓰지 않게 배포하고, 다음 배포에서 지운다.
- NOT NULL 은 값을 채우는 마이그레이션 뒤에 건다.
- backend-ci 의 migrations 잡이 빈 Postgres 에 `alembic upgrade head` 와 `alembic check`(모델과 마이그레이션 차이)를 확인한다. 기존 운영 데이터 위에서의 업그레이드는 검사하지 않는다.

## 수동 실행

Actions → deploy → Run workflow 에서 develop 을 고른다. mode 를 all 로 고르면 세 파트를 모두 다시 올린다. 수동 실행도 세 CI 를 먼저 통과해야 한다.

## 자동 회의 요약 (#560)

AI 또는 배포 실행 코드가 바뀌면 [enable-summary.py](enable-summary.py)가 실제 `mm-worker.service`를 검사한다. 유닛이 존재하고 active일 때만 `/etc/systemd/system/mm-worker.service.d/90-summary.conf`에 `MM_SUMMARY_LLM=luna`를 설치한다. `daemon-reload` 뒤 기존 워커를 재시작한다. 꺼진 워커를 켜지 않으며, 이 경우 `status=not-on`을 출력하고 성공 배포 SHA를 갱신하지 않는다. active 유닛은 부팅 시 자동 시작 여부와 무관하게 기존 배포 정책대로 재시작한다.

검사는 실제 MainPID의 Python 명령, 사용자, 작업 디렉터리, 환경을 사용한다. 현재 지원하는 실행 명령은 절대 경로 Python의 `-m capture.worker`다. 같은 사용자와 실행 환경에서 `summary_from_env()`를 생성하되 회의 claim·BE 요청·LLM 호출은 하지 않는다. 재시작 전에는 Luna를 선택할 때의 설정을 검사하고, 재시작 뒤에는 새 PID의 실제 selector와 runner, 해당 PID의 `[summary] runner ready model=luna` 로그를 함께 확인한다. 로그의 monotonic 시각은 systemd가 보고한 현재 main process 시작시각 이상이어야 한다. PID와 시작시각이 최종 확인까지 같아야 하며, 시작시각이 없으면 `worker-start-time-unavailable`로 실패한다. 로그는 selector, 설정 존재 여부, PID와 ready 여부만 공개한다. 키·URL·토큰과 journal 원문은 출력하지 않는다.

`ai/.env`는 기존 프로세스 환경에 없는 값만 채운다. systemd의 `EnvironmentFile` 등이 selector를 덮으면 실제 값 검사에서 `effective-selector-conflict`로 실패한다. `PM_AGENT_LLM=off`는 `global-llm-off`, Luna 키·URL 또는 BE URL·서비스 토큰 누락은 `required-settings-missing`으로 실패한다. 이 helper는 다른 기능의 전역 LLM 설정을 바꾸지 않는다. 실패하면 설치된 drop-in을 자동으로 되돌리지 않으며 성공 배포 SHA를 유지한다.

`status=on`은 새 운영 프로세스의 요약 runner 준비를 뜻한다. 공급사 인증·실제 요약 저장·품질 검증 결과는 별도다. 대기 중인 요약은 재시작 후 워커가 자연스럽게 처리하며, 이 배포는 과거 회의를 새로 backfill 등록하지 않는다.

요약을 끄려면 운영자가 해당 drop-in의 값을 빈 문자열로 바꾸고 `daemon-reload`와 워커 재시작을 수행한다. AI 또는 배포 코드의 다음 배포는 고정 Luna 값을 다시 설치하므로 지속적으로 끄려면 배포 정책도 함께 변경한다.

## 회의 삭제 활성화 (#576)

회의 삭제는 `MEETING_DELETION_ENABLED=false`가 기본이다. 자동 배포는 BE·FE 뒤에 AI를 반영하고 녹음 중 봇 재시작을 건너뛸 수 있다. 따라서 배포 성공만으로 삭제를 활성화하지 않는다. 새 DELETE API는 gate가 꺼져 있으면 503을 반환하며 UI도 삭제 CTA를 숨긴다.

기존 회의 ID와 태스크는 유지한다. 새 Discord 회의는 `X-Meeting-Lineage-Version: 1`을 보내는 AI 클라이언트가 만든 경우에만 삭제 준비 상태를 가진다. gate 활성화 후에는 구 클라이언트의 Discord 회의 생성을 거절한다. 수동 업로드와 chat은 실패 시 새 ID로 재생성하는 Discord 계보와 구분한다.

운영자가 다음 조건을 확인한 뒤 활성화한다. 아래 운영 절차는 이번 로컬 개발에서 실행하지 않았다.

1. 삭제 gate를 끈 상태로 새 스키마·API·AI 코드를 배포한다. 실제로 사용하는 봇·워커·소급 저장 프로세스를 식별하고 구 버전 writer를 중지한다. 녹음 중 재시작을 건너뛴 상태를 완료로 보지 않는다.
2. 과거 Discord 회의는 AI recordings 디렉터리의 manifest를 읽기 전용으로 연결해 `python -m app.cli.reconcile_meeting_lineages`로 대조한다. 기본 dry-run에서 DB가 바뀌지 않는지와 출력 계획을 확인한다. 실행 인자는 해당 명령의 `--help`에 있다.
3. 모든 과거 Discord 행이 설명되고 손상·임시·ID 누락 manifest, 순환·분기·다른 공간·출처·기존 연결 충돌이 없는 경우에만 `--apply`로 계보와 삭제 준비 상태를 원자적으로 반영한다. 태스크·본문·상태·ID는 바꾸지 않는다. 반복 실행은 변경 0건이어야 한다.
4. manifest가 부족하면 임의의 관계를 만들거나 일부 과거 회의를 준비 완료로 바꾸지 않는다. 과거 데이터 복구는 보류한다. 새 버전 클라이언트로 생성한 검증된 회의는 별도로 사용할 수 있다.
5. 새 AI 프로세스 가동과 구 writer 중단을 확인하고 `backend/.env`의 `MEETING_DELETION_ENABLED=true`를 명시적으로 적용한다. `docker compose -f backend/docker-compose.prod.yml up -d`로 API 컨테이너를 다시 만든다. 단순 restart는 변경된 환경 파일을 반영하지 않는다.
6. 별도 테스트 회의에서 PM 삭제, 보존 태스크, 오래된 링크410과 receipt의 pending→complete를 확인한다. 파일 정리 중에는 실제 삭제 완료로 보고하지 않는다.

gate를 다시 꺼도 이미 접수한 파일 정리와 receipt 조회는 계속된다. AI purge는 다른 회의가 녹음·처리 중이면 잠금을 기다려 완료를 보류할 수 있다. 과거 공유 이름의 STT 트랙 cache는 다른 회의와 소유권이 겹칠 수 있어 삭제 때 함께 무효화될 수 있다. 세션별 새 출력과 다른 회의의 통합 전사는 유지한다.

이미 스키마를 반영한 API 이미지와 실행 중인 DB가 있을 때 EC2의 `/opt/mm`에서 다음 dry-run을 사용한다. 원본 recordings mount는 읽기 전용이다.

```bash
docker compose -f backend/docker-compose.prod.yml run --rm --no-deps \
  --entrypoint python -v /opt/mm/ai/recordings:/var/mm-recordings:ro api \
  -m app.cli.reconcile_meeting_lineages --recordings-dir /var/mm-recordings
```

출력 계획을 확인하고 writer를 실제로 중지한 뒤에만 같은 명령에 `--apply --writers-stopped`를 추가한다. `--writers-stopped`는 운영자의 확인 표시이며 프로세스 중단을 검사하거나 실행하는 옵션이 아니다. CLI는 적용 전 manifest 목록·해시와 DB 관계를 재검증하고 하나의 트랜잭션으로 반영한다.

API 형식과 오류는 [FE 계약](../frontend/docs/contracts/frontend-api-contract.md#회의-삭제와-보존-태스크-576-2026-11-09), 봇 파일 정리는 [BE·AI 계약](../backend/docs/contracts/backend-ai-contract.md#명시적-회의-삭제와-재처리-계보-576-2026-11-09)에 있다.

## 계정 탈퇴와 정리 작업 (#575)

계정 탈퇴는 계정·세션 삭제와 파일·AI 정리 확인을 분리한다. AI가 중단돼 있으면 계정 이용은 종료되지만 화면은 `개인정보 정리 중`이다. backend와 AI가 모두 확인한 뒤 `탈퇴 완료`가 된다. 재가입은 정리 대기 중에도 새 계정으로 허용하며 이전 역할·초대를 복원하지 않는다.

`MEETING_DELETION_ENABLED`는 일반 회의 삭제의 gate이며 계정 탈퇴의 조건이 아니다. 계정 탈퇴에는 별도 기본 off 플래그를 추가하지 않았다. BE와 AI를 같은 개인정보 정리 계약으로 배포하고, 녹음 중 재시작을 건너뛴 경우에는 새 AI 워커가 실제 가동했는지 확인한다. 이전 AI는 세대가 바뀐 공간에 쓸 수 없고, 새 정리 워커가 없으면 AI 완료가 대기한다.

backend 파일 재시도는 `MEETING_PURGE_INTERVAL_SECONDS`의 기존 워커가 수행한다. 기본값은 10초이며 0 이하는 정지다. AI는 `/bot/privacy-cleanups`의 120초 임대로 실제 파일·캐시를 정리한 뒤 ack한다. 상태 확인 때 `privacy_cleanup`의 backend_done_at·ai_done_at·attempts·lease_until·last_error_code와 AI 워커 로그를 함께 본다. backend 저장소 오류는 다음 주기에 재시도하며, AI 소유 관계가 불명확한 legacy 자료는 추정 삭제하거나 완료로 바꾸지 않는다. 다른 활성 manifest writer 때문에 AI 정리가 대기할 수도 있다.

처리 중·완료 작업에서 원문 토큰·이름·개인 Discord ID를 운영 로그나 정리 큐에 추가하지 않는다. guild ID는 과거 녹음 탐색용 공동 리소스 selector이며 AI 확인 후 제거한다. 원격 호스팅 diarizer 보관·삭제와 이미 게시된 Notion·Discord 결과 처리는 별도 확인 범위다.

탈퇴로 지운 계정과 단독 공간 데이터는 스키마 downgrade로 복구되지 않는다. 최초 탈퇴 이후에는 개인정보 세대·삭제 표식을 무시하는 옛 BE·AI writer로 되돌리지 않는다. 되돌림이 필요하면 같은 정리 계약과 표식을 이해하는 호환 버전을 사용하고 대기 작업을 유지한다. 이 절의 운영 배포·되돌림·실제 계정 삭제는 이번 로컬 검증에서 실행하지 않았다.

## 채팅 폴링 타이머 (#599)

디스코드 채팅은 실시간으로 받지 않는다. `mm-chat-poll.timer` 가 매일 09:00 KST 에 `mm-chat-poll.service` 를 한 번 띄워, 연결된 채널(`GET /bot/chat-channels`)마다 새 메시지를 읽어 채팅 회의로 넘긴다. 유닛 파일은 [ai/deploy/systemd](../ai/deploy/systemd/)에 있다.

배포 스크립트는 첫 설치를 하지 않는다. 이미 `/etc/systemd/system/mm-chat-poll.timer` 가 있는 서버에서 두 유닛 파일이 바뀐 배포(또는 mode=all)일 때만 저장소 판으로 덮어쓰고 `daemon-reload` 한다. 타이머가 켜져 있으면 다시 걸고, 꺼져 있으면 켜지 않는다. 실행 중인 폴링은 끊지 않는다. 설치되지 않은 서버에서는 Actions 화면에 경고만 띄우고 배포는 정상 완료로 처리한다.

저장소 유닛은 `User=mm` 이지만 운영의 봇·워커는 다른 계정으로 돈다. 폴러는 `ai/.env` 를 읽고 `ai/runs` 에 쓰므로 워커와 같은 계정이어야 한다. 그래서 계정은 drop-in `mm-chat-poll.service.d/10-user.conf` 로 덮는다. 배포는 이 파일이 없을 때만 `mm-worker` 의 계정으로 만들고, 있으면 그대로 둔다.

### 첫 설치

서버에서 ubuntu 로 한 번 한다.

```bash
cd /opt/mm
U=$(systemctl show -p User --value mm-worker); U=${U:-ubuntu}; echo "User=$U"
sudo install -m 0644 ai/deploy/systemd/mm-chat-poll.service ai/deploy/systemd/mm-chat-poll.timer /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/mm-chat-poll.service.d
printf '[Service]\nUser=%s\n' "$U" | sudo tee /etc/systemd/system/mm-chat-poll.service.d/10-user.conf
sudo systemctl daemon-reload
systemctl show -p User --value mm-chat-poll.service   # 위의 $U 와 같아야 한다
sudo systemctl enable --now mm-chat-poll.timer        # 서비스가 아니라 타이머를 켠다
systemctl list-timers mm-chat-poll.timer              # NEXT 가 다음 09:00 KST
```

### 손으로 한 번 돌리기

```bash
sudo systemctl start mm-chat-poll.service   # oneshot 이라 끝날 때까지 기다린다
journalctl -u mm-chat-poll.service -n 80 --no-pager
```

채팅 회의가 아직 없는 워크스페이스는 최근 24시간(`CHAT_POLL_INITIAL_HOURS`)만 읽는다. 그보다 오래된 대화를 한 번만 더 읽으려면 그 워크스페이스만 따로 돌린다. 이미 채팅 회의가 있으면 그 시각부터 이어 읽으므로 이 값은 소용없다.

```bash
sudo -u "$U" sh -c 'cd /opt/mm/ai && CHAT_POLL_INITIAL_HOURS=48 /usr/bin/flock -n /run/lock/mm-chat-poll.lock .venv/bin/python -m capture.chat_poll --workspace <워크스페이스 ID>'
```

서비스의 `TimeoutStartSec` 를 7시간 이상으로 올리면 BE 의 채팅 회의 정리 기준(`chat_stalled`, 7시간)도 함께 올린다([봇 계약](../backend/docs/contracts/backend-ai-contract.md)).
