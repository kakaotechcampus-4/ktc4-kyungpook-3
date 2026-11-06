# 세션 토큰 해시 저장과 만료 세션 정리

- 기록일: 2026-11-06
- 관련 마일스톤: M1(인증). 운영 확인은 머지 직전에 한다.
- 관련 이슈: #437 (설계 합의 2026-11-06)

## 문제와 제약

- `session` 표에 쿠키 값과 같은 원문 토큰(`session_token`)이 그대로 저장됐다. DB 덤프나 백업이 새면 그 안의 만료되지 않은 세션으로 바로 로그인할 수 있다. 비밀번호 재설정 토큰은 이미 sha256 해시만 저장한다.
- 만료된 세션 행을 지우는 곳이 없어 표가 계속 커진다. 만료 세션은 조회에서 401 이 되지만 행은 남는다.
- 쿠키 이름(`session_token`)·값(`token_urlsafe(32)` 원문)·HttpOnly·SameSite·Secure 속성·7일 만료·401 `UNAUTHENTICATED` 동작은 바꾸지 않는다. FE·AI 계약, 에러 코드, 권한은 바뀌지 않는다.
- 스키마 변경은 없고 데이터 변환 1건(되돌릴 수 없음)만 있다. 모델은 컬럼 이름·길이를 그대로 두고 주석만 더한다.
- `deploy/README.md` 의 "마이그레이션 호환 원칙"은 이름 변경을 두 배포로 나누게 한다. 되돌릴 때 옛 코드가 새 스키마에서도 돌아야 하기 때문이다.
- 열린 PR #454(카카오 로그인, `auth.py`·`models.py`·`tests/api/conftest.py` 수정, 마이그레이션 head 가 같음)와 #456(로그인 제한, `main.py`·`tests/conftest.py` 수정)이 같은 파일을 건드린다.

## 실제 검토한 선택지

설계 합의(2026-11-06)에서 사용자와 정한 네 가지다. 컬럼 결정은 최종 리뷰 뒤 사용자가 바꿨다(아래 표). 선택지는 설계 때 비교한 범위이며 그 밖의 안은 기록이 없다.

| 결정 | 선택지 | 결과 |
|---|---|---|
| 기존 세션 | 마이그레이션에서 원문을 해시로 변환(A) / 모든 세션 삭제 | A. 삭제하면 배포 순간 모든 사용자가 로그아웃된다. 원문은 이미 DB 에 있으므로 변환은 정보를 더 노출하지 않는다 |
| 컬럼 | `session_token` 이름을 유지하고 값만 해시(B, 최종) / `token_hash` 로 이름 변경(A, 처음 합의) | B. 처음에는 A 로 합의했으나 최종 리뷰 뒤 B 로 바꿨다. 이름 변경은 "마이그레이션 호환 원칙"상 두 배포로 나눠야 하는데, 한 번에 바꾸면 되돌릴 때 옛 코드가 없는 컬럼을 만나 500 이 난다. 이름을 유지하면 스키마가 그대로라 되돌려도 500 이 아니라 401(재로그인)이다. 대가는 이름이 원문처럼 보인다는 점이고, 모델 주석과 쓰는 곳마다 `hash_session_token` 을 직접 부르는 것으로 줄인다 |
| 테스트 | 픽스처가 `token_hash=hash_session_token("...")` 를 명시(A) / 모델 `synonym`·`@validates` 로 원문을 넣으면 해시 | A. 모델 세터는 스키마를 거치지 않는 쓰기까지 해시하지만 숨은 변환이라 원문과 해시가 섞여도 눈에 안 띈다. 테스트 픽스처 전반이 `session_token=hash_session_token("...")` 를 직접 쓴다 |
| 정리 | lifespan 워커(A) / 로그인할 때 만료 행 정리 | A. `upload_sweeper` 와 같은 형태이고 로그인 요청 지연에 쓸데없는 쓰기를 얹지 않는다. 로그인 시 정리는 하지 않는다 |

## 선택과 이유

- 모델 `Session.session_token` 은 develop 과 같은 정의(String(255), 유일 인덱스 `ix_session_session_token`)이고 쿠키 원문이 아닌 sha256 hex 가 들어간다는 한 줄 주석만 더했다. 모델 세터·`@validates` 는 두지 않는다.
- `app/services/sessions.py` 에 세션 발급·조회·삭제·정리를 모았다. `hash_session_token` 은 `password_reset.hash_token`(sha256 hex, `surrogatepass`)을 재사용해 해시 규칙을 하나로 둔다. 쿠키에 짝 잃은 서로게이트가 들어와도 예외 없이 못 찾는다(None).
- `create_session` 은 원문을 반환하고 DB 에는 해시만 저장한다. `find_session`(쿠키 값을 해시해 조회)·`delete_session`(그 행 하나)·`sweep_expired_sessions`(`expires_at < now` 를 DELETE 한 문장으로, 여러 번 돌려도 같다)가 있다. 해시 값을 쿠키로 보내면 찾지 못한다.
- 조회는 만료된 세션이면 401 을 주고 행은 지우지 않는다. 지우는 일은 워커 몫이다.
- 로그아웃은 해당 행 하나만 지운다. 비밀번호 재설정 confirm 은 기존대로 `user_id` 로 그 계정의 세션을 모두 지운다.
- `auth._create_session` 시그니처는 유지한다. #454 의 카카오 로그인이 이 함수를 부르므로 그쪽 코드를 고칠 필요가 없다.
- 워커는 `app/main.py` lifespan 에서 `SESSION_SWEEP_INTERVAL_SECONDS`(기본 3600, 0 이하면 끔)로 돌고 `upload_sweeper` 와 같은 시작·종료 방식을 쓴다.
- 마이그레이션 `3c9a1f7d2b64`(down_revision `b0d32ee4abcb`, #345 의 reply judgment 뒤)는 데이터만 바꾼다. 기존 행을 Python 루프로 sha256 hex 로 바꿔 1000건씩 UPDATE 하고, 컬럼·인덱스는 건드리지 않는다. 해시는 앱을 import 하지 않고 마이그레이션 안에 복제했다(앱 코드가 바뀌어도 이 마이그레이션은 그대로여야 해서, 이메일 정규화 마이그레이션과 같은 이유).

## 장단점과 감수한 제약

- 되돌릴 수 없다. 해시에서 원문을 복원할 수 없어 downgrade 는 `DELETE FROM session` 만 한다(스키마는 그대로, 모든 사용자가 다시 로그인한다).
- 배포 순서와 영향. `deploy/ec2-deploy.sh` 102행의 `docker compose up -d --build` 는 옛 컨테이너를 멈추고 새 컨테이너를 띄우며, 새 컨테이너가 시작하면서 마이그레이션을 돌린다. 옛 코드와 새 코드가 겹쳐 도는 구간이 없고, 마이그레이션과 부팅 동안 API 가 잠깐 멈춘다.
- 마이그레이션이 실패하면 트랜잭션이 롤백되고 api 컨테이너가 `restart: unless-stopped` 로 계속 재시작되어 API 가 내려간다. 스키마 변경이 없는 데이터 UPDATE 라 가능성은 낮지만 실패하면 원인을 고치기 전까지 API 가 내려간 상태다.
- 코드만 되돌리면 옛 코드가 쿠키 원문을 저장된 해시와 비교해 일치하지 않으므로 401 이 되고 모든 사용자가 다시 로그인한다. 스키마가 같아 500 은 나지 않는다.
- 컬럼 이름 `session_token` 이 원문처럼 읽힌다. 모델 주석과 쓰는 곳마다 `hash_session_token` 을 명시해 줄이며, 모델 세터로 숨기지 않는다.
- 해시는 한 번에 계산하므로 느린 키 파생(bcrypt 등)이 아니다. 토큰이 32바이트 난수라 추측이 불가능해 sha256 으로 충분하다고 본다(비밀번호 재설정 토큰과 같은 판단).
- 워커 주기(기본 1시간)만큼 만료 행이 남는다. 만료 세션은 조회에서 401 이라 기능에는 영향이 없다.
- 픽스처를 모두 `session_token=hash_session_token(...)` 으로 고쳤다. #454·#456 의 새 테스트가 원문을 `session_token` 에 그대로 넣으면 로그인이 안 되므로 같은 형태로 맞춘다.

## 영향 범위와 재검토 조건

- 코드: `app/services/sessions.py`(신규), `app/models/models.py`(`Session.session_token` 주석만), `app/api/auth.py`(발급·로그아웃), `app/api/deps.py`(조회), `app/main.py`(워커), 마이그레이션 `3c9a1f7d2b64`, 테스트 픽스처 전반. 엔드포인트·응답·쿠키·에러 코드는 바뀌지 않는다.
- 머지 순서: #345 는 머지되어 이 마이그레이션은 `b0d32ee4abcb` 뒤에 이었다. #454(head `d2f6b81c4e07`, 부모 `537911f267dc`)와 #456 은 아직 열려 있고, 나중에 머지되는 쪽이 `down_revision` 을 다시 잇는다. 컬럼 이름이 그대로라 #454 의 픽스처는 해시 방식(`session_token=hash_session_token(...)`)만 맞추면 되고 이름을 바꿀 일은 없다.
- 머지 직전 운영 확인(읽기 전용, 토큰 값은 출력하지 않는다). 저장소 루트에서 실행한다. 출력의 `rows` 는 변환될 세션 수, `max length` 는 원문 최대 길이다(해시는 항상 64자라 길이와 무관하게 들어간다).

```
docker compose -f backend/docker-compose.prod.yml exec api python -c 'import os,sqlalchemy as sa;c=sa.create_engine(os.environ["DATABASE_URL"]).connect();print("rows:",c.execute(sa.text("select count(*) from session")).scalar(),"max length:",c.execute(sa.text("select max(length(session_token)) from session")).scalar())'
```

  - 발급 코드는 43자 토큰만 만든다. `max length` 가 43 을 넘으면 다른 경로로 만들어진 행이 있다는 뜻이니 참고로 본다. DDL 이 없어 이 값이 마이그레이션을 막지는 않는다.
- CI 의 migrations 잡은 빈 DB 에서 도므로 변환 경로를 지나지 않는다. 그 경로는 `tests/test_migration_hash_session_token.py` 가 임시 DB 로 확인하고, PostgreSQL 매개변수는 `TEST_DATABASE_URL` 이 없으면 skip 된다.
- 재검토: 무중단 배포가 필요해지거나 세션 행이 많아 변환이 오래 걸리면 다시 본다. 정리 주기가 부담이면 환경변수로 조정한다.
- 확인 상태: 코드·테스트는 구현됐다(DB 에 붙인 alembic 실행은 하지 않았고 임시 DB 테스트로 확인). 운영 확인은 아직 하지 않았고 머지 직전 사용자가 한다.

## 근거와 관련 문서

- #437 설계 합의
- [백엔드 README 세션 토큰](../../../../README.md#세션-토큰)
- [이메일 정규화 결정 기록](2026-11-06-email-normalization.md)
- 코드: `app/services/sessions.py`, 마이그레이션 `migrations/versions/3c9a1f7d2b64_hash_session_token.py`
- 테스트: `tests/services/test_sessions.py`, `tests/api/test_session_hash_api.py`, `tests/test_migration_hash_session_token.py`
