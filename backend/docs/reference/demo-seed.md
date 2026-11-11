# 심사용 시드

[Backend README](../../README.md)로 돌아가기

심사 시연용으로 계정 6개, 공간 하나, 팀원 자리, 온보딩 단계, 지난 회의를 채우는 명령이다(#606).

## 채우는 방식

계정·공간·자리는 DB에 직접 만들고, 지난 회의는 AI 봇과 같은 서비스 토큰 API로 재생한다(회의 데이터를 DB에 직접 넣지 않는다). 기본 데이터는 승인 완료된 회의 5개와 승인 대기 시연 회의 1개이고, 시드 데이터는 `app/cli/demo_seed/meetings.json`이다. 같은 명령을 다시 실행해도 계정·회의를 중복 생성하지 않고 기존 승인과 요약을 보존한다.

## 준비물

- API 서버에 `EMBEDDING_API_KEY`가 있어야 한다. 없으면 임베딩이 안 채워져 회의 사이에서 멈춘다.
- API 서버의 `AUTO_CREATE_ENABLED`가 켜져 있어야 한다.
- 명령을 돌리는 환경에 `SERVICE_TOKEN`이 있어야 한다. 컨테이너에는 `env_file`로 이미 들어 있다.
- 승인 완료로 선언한 새 회의는 `DEMO_PM_PASSWORD`로 실제 PM 로그인과 승인 API를 호출한다. 기존 PM 계정을 재사용하면 그 계정의 현재 비밀번호가 필요하다.

## 실행

운영에서는 비밀번호가 셸 기록에 남지 않게 `read -rs DEMO_PM_PASSWORD && export DEMO_PM_PASSWORD`처럼 입력해 두고(`DEMO_MEMBER_PASSWORD`도 같다) 아래를 실행한다. 이메일은 자리표시자이고, 실제 주소를 문서나 셸 기록에 남기지 않는다.

```bash
docker compose -f docker-compose.prod.yml exec -e DEMO_PM_PASSWORD -e DEMO_MEMBER_PASSWORD api \
  python -m app.cli.seed_demo --base-url http://localhost:8000 --email-pattern '<팀메일>+demo-{n}@gmail.com' --today 2026-11-11
```

로컬 리허설은 API를 띄운 뒤 `python -m app.cli.seed_demo --email-pattern 'demo+{n}@example.com'`로 돌린다. 비밀번호를 환경변수로 넘기지 않고 입력받으려면 터미널(TTY)이 필요하다(`docker compose exec`는 기본으로 붙고, 원격에서 명령 한 줄로 돌릴 때는 `ssh -t`).

`--today`(KST 기준일)는 가장 늦은 회의 시작(기준일 − 가장 작은 `days_ago`, 10:00 KST)이 지난 뒤에만 끝까지 돈다. 서버가 미래 `started_at`을 400으로 거절해서, 그 전이면 쓰기 전에 종료 코드 2로 멈춘다. 재실행은 같은 기준일로 해야 이어 가고, 다르면 종료 코드 2와 원래 기준일 안내가 나온다. 옵션 없이 처음 돌린 시드도 같고 `--allow-existing`으로 넘길 수 없다.

`--dry-run`은 DB를 읽기만 해서 이미 있는 계정 수, 재사용할 공간과 그 공간의 활성 자리·회의 수, 기준일, 재생할 회의의 날짜와 제목을 출력한다. 쓰지 않고 HTTP도 부르지 않는다. `SERVICE_TOKEN`은 필요 없지만 비밀번호 검사는 하므로 비밀번호 환경변수는 필요하다. 실제 실행이 멈출 상황이면 이유를 stderr에 적고 종료 코드 2로 끝난다.

## 옵션

| 옵션·환경변수 | 뜻 |
|---|---|
| `--email-pattern` | 필수. `{n}`이 1~6으로 바뀐다. 1번이 PM, 2번이 팀원2 |
| `--base-url` | API 호스트 루트(기본 `http://localhost:8000`). `/api/v1`은 명령이 붙인다 |
| `--workspace-name` | 공간 이름. 기본은 시드 데이터 값 |
| `--today` | 회의 날짜의 기준일. `YYYY-MM-DD`(KST), 기본은 실행일 |
| `--embed-timeout` | 회의마다 임베딩을 기다리는 초(기본 120) |
| `--reset-passwords` | 이미 있는 계정의 비밀번호도 다시 정하고 그 계정의 로그인 세션을 지운다 |
| `--allow-existing` | 시드가 아닌 기존 데이터가 있어도 재사용한다 |
| `DEMO_PM_PASSWORD`, `DEMO_MEMBER_PASSWORD` | PM·팀원2 비밀번호. 없으면 터미널일 때만 입력받고, 아니면 아무것도 쓰지 않고 종료 코드 2 |
| `SERVICE_TOKEN` | 서비스 토큰 API 호출용. 없으면 종료 코드 2 |

회의 시작은 기준일 − `days_ago`의 10:00 KST, 항목 마감은 회의일 + `due_in_days`이고 `--dry-run`에도 같은 검사를 한다. `--allow-existing`이 없으면 이름이 시드 인물과 다른 기존 계정, 찾은 공간의 시드 인물이 아닌 자리, 시드가 만들지 않은 회의가 하나라도 있을 때 아무것도 쓰지 않고 종료 코드 2로 멈춘다.

## 출력과 종료 코드

stdout에 JSON 한 줄을 낸다. 키는 `workspace_id`, `usernames`(계정별 아이디, 인물 키 p1~p6), `done`(끝난 회의 수), `gates`(auto·review·hold 별 항목 수), `processing`, `unembedded`, `summaries_written`, `summaries_skipped`다.

| 종료 코드 | 뜻 |
|---|---|
| 0 | 성공 |
| 1 | 시드 실패(데이터·API·PM 로그인·임베딩 대기 오류). stderr에 한 줄 |
| 2 | 입력·환경 부족, 기존 데이터 재사용 거절, 기준일 검사 실패. 아무것도 쓰지 않았다 |
| 3 | 데이터는 다 썼지만 gate 분포에 auto·review·hold 중 0건이 있다. JSON은 그대로, stderr에 경고 |

- 1이면 다시 실행해 기존 승인을 보존하며 원문·추출 단계부터 이어 간다. 기존 추출의 요약 복구 제한은 [알아 둘 점](#알아-둘-점)을 본다.
- 2의 입력·환경 부족은 비밀번호, 이메일 패턴, `SERVICE_TOKEN`, 옵션이다. 기준일 검사 실패는 회의 시작이 지금보다 늦거나 이미 있는 회의의 날짜가 이번 기준일과 다를 때다.

## 알아 둘 점

- 임베딩 대기 시간 초과는 `EMBEDDING_API_KEY` 미설정이거나, 임베딩 API가 제목을 거절한 행(`embedding_rejected_title`)일 수 있다.
- `approval_state`가 `approved`인 회의는 이번 실행에서 새로 만든 추출의 카드만 PM API로 승인한 뒤 고정 요약을 쓴다. 이 회의의 항목은 `action: create`만 허용한다. 필드가 없거나 `pending`이면 자동 승인·요약하지 않는다. 기본 6번째 회의에는 review·hold 카드가 하나씩 남는다.
- 기존 추출은 사람이 보류·반려·수정한 것과 중단된 시드를 구분할 수 없어 자동 승인하지 않는다. 요약이 없어도 고정 시드 요약을 다시 주입하지 않고, 승인 완료로 선언한 회의 제목을 `summaries_skipped`에 적는다. PM이 승인 상태를 확인해 정상 요약 워커로 처리하거나 새 공간에서 다시 시드한다. 기존 태스크와 저장된 요약은 덮어쓰지 않는다.
- 운영 요약 워커(AI mm-worker, `MM_SUMMARY_LLM`)가 시드와 동시에 돌면 워커가 먼저 잡은 회의의 요약은 `summaries_skipped`에 들어가고, 그 임대 15분 동안 같은 공간의 뒤 회의들도 건너뛸 수 있다. 재실행해도 기존 추출의 고정 요약은 복구되지 않는다.
- 시드 항목의 `similar_count`는 모두 0이라 gate 분포는 유사 검색 결과로 바뀌지 않는다. `gates`의 auto가 0건이면 API 서버의 `AUTO_CREATE_ENABLED`가 꺼졌거나(auto가 review로 내려간다), 재생 중 임베딩이 아직 없는 task·승인 대기 카드가 남아 있던 경우다(서버 로그의 `unsearched_task_exists`·`unsearched_pending_exists`).
- 회의의 처리 완료 시각(`ended_at`)은 시드를 실행한 시각으로 남는다. 시작 시각만 며칠 전으로 합성하며 `--today`와는 무관하다.
- 팀원2 자리는 초대·수락 시연용으로 비워 둔다. PM이 초대할 때는 출력 JSON의 `usernames.p2`를 정확히 입력해 찾는다. 동의 기록은 넣지 않아 첫 로그인 때 동의 화면이 뜬다.
- 다시 시드하려면 새 `--workspace-name`과 새 이메일을 쓴다. 지우는 기능은 없다.
