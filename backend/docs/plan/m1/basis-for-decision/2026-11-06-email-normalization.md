# 이메일 정규화: 규칙·저장값 변환·기존 데이터 처리

- 기록일: 2026-11-06
- 관련 마일스톤: M1(인증). 운영 확인은 머지 직전에 한다.
- 관련 이슈: #434 (설계 확정 댓글 2026-11-06)
- 대체하는 결정: [비밀번호 재설정 결정 기록](2026-11-05-password-reset.md)의 "이메일 찾기: 정확 일치(로그인과 같음)". 그 기록은 그대로 두고 이 기록이 대체한다.

## 문제와 제약

- 가입은 `Kim@Example.com` 과 `kim@example.com` 을 다른 이메일로 받아 같은 사람이 계정 둘을 만들 수 있었다. 로그인·재설정은 정확히 일치해야 찾아서, 가입 때와 다르게 입력하면 계정이 없다고 나왔다.
- 초대(`app/schemas/invitation.py`)만 앞뒤 공백을 지우고 소문자로 바꿔 비교했다. 같은 이메일이 기능마다 다르게 다뤄졌다.
- 이미 운영 DB 에 대소문자만 다른 계정이 있을 수 있다. `user.email` 의 유일 인덱스(`ix_user_email`)는 대소문자를 구분한다.
- 비밀번호 재설정 때 정확 일치로 정했던 이유는 "재설정만 대소문자를 무시하면 로그인에서 막힌다"였다. 셋을 함께 바꾸면 그 이유가 사라진다.
- 응답 값(`user.email`, `accepted_user.email`, `email_masked`)이 소문자로 바뀌는 것과 데이터 마이그레이션 1건(되돌릴 수 없음)은 사용자가 허락했다(2026-11-06). 모델 변경은 없다.

## 실제 검토한 선택지

설계 초안과 사용자 확정(2026-11-06)에서 비교한 것이다.

| 결정 | 선택지 | 결과 |
|---|---|---|
| 규칙 | 초대와 같은 규칙(`strip().lower()`, `@` 앞부분 포함) / 도메인만 소문자 | 초대와 같은 규칙. 규칙이 둘이면 같은 이메일이 기능마다 갈린다 |
| 저장 | 저장값을 소문자로 바꾼다(A) / 저장은 그대로 두고 비교만 대소문자 무시(B) / `lower(email)` 함수 유일 인덱스(C) | A. B 는 기존 중복에서 `scalar_one_or_none` 이 아무 계정이나 잡고 새 중복을 DB 가 막지 못한다. C 는 sqlite·PostgreSQL 의 `lower` 가 Python 과 달라 같은 이메일로 보는 기준이 어긋나고, 모델과 스키마 마이그레이션이 필요하다 |
| 기존 중복 | 마이그레이션 실패 / 자동 병합 / 건너뛰기 | 실패. 병합은 `user` 를 가리키는 FK 가 6개 이상이고 같은 워크스페이스에 `Member` 가 겹치면 충돌해 위험하다. 건너뛰면 그 계정이 대문자 이메일로는 로그인할 수 없는데 아무도 모른다 |
| 동시 가입 | 사전 검사만 / commit 의 `IntegrityError` 를 409 로 | 409. 사전 검사 뒤 commit 사이에 같은 이메일이 들어오면 500 이 됐다 |
| 배포 전 확인 | SQL 두 개 / 마이그레이션과 같은 규칙의 Python 확인 | 구현에서 정했다. 아래 "구현에서 정한 것" 참고 |
| FE 전달 | 계약 문서 수정 / PR 본문 | PR 본문. `ai/`·`frontend/` 는 BE 에서 고치지 않는다 |

## 선택과 이유

- 규칙은 `app/schemas/email.py` 의 `normalize_email`(`strip().lower()`) 한 곳이다. `NormalizedEmail` 은 `EmailStr` 검사를 통과한 값에 이 함수를 적용하는 타입이고, `LoginRequest`·`SignupRequest`·`PasswordResetRequest`·`InvitationCreateRequest` 가 모두 쓴다. `User` 모델의 `@validates("email")` 도 같은 함수를 불러, 스키마를 거치지 않는 쓰기 경로도 정규화된 값을 저장한다(PR #441 리뷰, hwnv). SQL 직접 실행과 `update()` 는 이 보장을 지나지 않는다.
- 서비스 코드(가입·로그인·재설정 조회·초대 수락)는 이미 정규화된 값으로 정확 일치 비교를 한다. 저장값은 모델이 보장하므로 초대 쪽의 읽을 때 재정규화는 뺐다. 기존 `ix_user_email` 유일 인덱스가 그대로 새 중복을 막는다.
- 마이그레이션 `537911f267dc`(down_revision `fe08fcbd6dc6`, #383·#432 머지 뒤 다시 이음)는 `user_id, email` 을 읽어 마이그레이션 안에 복제한 함수(`strip().lower()`)로 묶는다. 앱 코드가 나중에 바뀌어도 마이그레이션은 그대로여야 해서 import 하지 않고 복제했고, "`normalize_email` 과 같아야 한다"는 주석을 남겼다.
  - 중복이 있으면 아무 행도 바꾸지 않고 `RuntimeError` 로 멈춘다. 오류에는 `user_id` 묶음만 담고 이메일 주소는 넣지 않는다. 검사를 모두 끝낸 뒤에만 UPDATE 를 시작하므로 DDL 트랜잭션이 없는 sqlite 에서도 부분 변경이 남지 않는다.
  - 바뀔 행만 UPDATE 한다. `downgrade` 는 원래 대소문자를 저장하지 않아 아무것도 하지 않는다.
- 동시 가입은 `signup` 의 commit 에서 `IntegrityError` 를 잡아 rollback 하고 409 `EMAIL_ALREADY_EXISTS` 를 준다.
- 머지 직전에 사용자가 운영 서버에서 배포 전 확인(아래)을 SSM 으로 돌리고, 결과 개수만 PR 에 적는다. 이메일·`user_id` 는 출력하지 않는다.

### 구현에서 정한 것: 배포 전 확인은 Python 한 줄이 주 방법이다

설계 단계에서는 읽기 전용 SQL 두 개를 확인 방법으로 정했다. 구현·리뷰에서 바꿨다. PostgreSQL `btrim` 은 공백만 지우고 Python `strip()` 은 탭·줄바꿈 등 모든 공백을 지운다. PostgreSQL `lower` 는 DB 로케일에 따라 Python `str.lower()` 와 비 ASCII 문자에서 다를 수 있다. 그래서 SQL 이 0 이어도 마이그레이션이 중복을 찾아 컨테이너 시작 때 멈출 수 있고, 그때는 자동으로 되돌릴 방법이 없다.

주 확인은 API 컨테이너 안에서 마이그레이션과 같은 규칙(`strip().lower()`)으로 센다. 저장소 루트에서 실행한다. `duplicate groups` 가 0 이어야 컨테이너 시작 때 멈추지 않고, `rows to change` 는 바뀔 행 수다.

```
docker compose -f backend/docker-compose.prod.yml exec api python -c 'import os,collections,sqlalchemy as sa;c=sa.create_engine(os.environ["DATABASE_URL"]).connect();g=collections.Counter();r=c.execute(sa.select(sa.table("user", sa.column("email")))).all();[g.update([m.strip().lower()]) for (m,) in r];print("duplicate groups:",sum(v>1 for v in g.values()),"rows to change:",sum(m.strip().lower()!=m for (m,) in r))'
```

보조로 SQL 두 개를 쓸 수 있으나 ASCII·공백만 다루는 근사치다. 0 이 아니면 확실히 문제지만 0 이어도 위 Python 확인이 0 이 아닐 수 있다.

```sql
SELECT count(*) FROM (SELECT lower(btrim(email)) FROM "user" GROUP BY 1 HAVING count(*) > 1) d;
SELECT count(*) FROM "user" WHERE email <> lower(btrim(email));
```

(위 Python 확인 명령은 마이그레이션 파일 설명의 명령과 같다.)

## 장단점과 감수한 제약

- 되돌릴 수 없다. 원래 대소문자를 저장하지 않으므로 롤백해도 소문자로 남는다.
- CI 의 migrations 잡은 빈 DB 에서 도므로 변환·중복 중단 경로를 지나지 않는다. 그 경로는 `tests/test_migration_normalize_user_email.py` 가 임시 DB 로 확인한다. 이 테스트의 PostgreSQL 매개변수는 로컬에 PostgreSQL 이 없으면 skip 된다.
- 중복이 있으면 컨테이너가 시작 때 멈춘다. 그래서 머지 전에 운영 확인이 필요하고, 중복이 나오면 사람이 해당 계정을 정리한 뒤 머지한다.
- 응답 이메일이 소문자가 되어 가입 때 대문자로 입력한 사용자가 화면에서 소문자 이메일을 본다. FE 의 MSW auth 핸들러가 정확 일치로 비교하는 부분과 FE 계약 문서의 해당 문장은 FE 가 고친다(PR 본문으로 알린다).
- `@` 앞부분(로컬 파트)까지 소문자로 바꾼다. RFC 상 로컬 파트는 대소문자를 구분할 수 있지만, 실제 메일 서비스는 구분하지 않고 초대가 이미 그렇게 해 왔다.

## 영향 범위와 재검토 조건

- 코드: `app/schemas/email.py`, `app/schemas/auth.py`, `app/schemas/invitation.py`, `app/api/auth.py`(동시 가입 409), 마이그레이션 `537911f267dc`. `app/api/invitations.py`·`app/services/password_reset.py` 는 정규화된 값을 쓸 뿐 바뀌지 않았다. 모델 변경은 없다.
- 이슈 #427 이 따를 규칙: 이메일을 받는 요청 스키마는 `NormalizedEmail` 을 쓴다(코드 발송 스키마 포함). 카카오 같은 외부에서 받은 이메일은 스키마를 거치지 않아도 `User` 모델이 저장할 때 정규화한다. 다만 저장 전에 같은 계정을 찾는 조회에는 서비스에서 `normalize_email` 을 직접 불러야 한다. 처음에는 저장도 서비스가 직접 부르기로 했는데, 호출을 빠뜨리면 그 계정을 로그인·재설정에서 찾지 못해 모델로 옮겼다.
- 재검토: 운영 확인에서 중복이 나오면 자동 병합 여부를 다시 정한다. 로컬 파트의 대소문자를 구분해야 하는 서비스와 연동하게 되면 규칙을 다시 본다.
- 확인 상태: 코드·테스트는 구현됐다. 운영 확인은 아직 하지 않았고 머지 직전 사용자가 한다.

## 근거와 관련 문서

- #434 설계 확정 댓글
- [백엔드 README 이메일 정규화](../../../../README.md#이메일-정규화)
- [비밀번호 재설정 결정 기록](2026-11-05-password-reset.md)
- 테스트: `tests/api/test_auth_email_case.py`, `tests/test_migration_normalize_user_email.py`
