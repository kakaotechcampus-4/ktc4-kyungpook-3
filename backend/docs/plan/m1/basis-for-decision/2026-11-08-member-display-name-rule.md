# 팀원 표시명 검증: 가입 이름 규칙 공유와 PATCH null 처리

- 기록일: 2026-11-08
- 관련 마일스톤: M1(인증·워크스페이스·온보딩·권한)
- 관련 이슈: #447 (설계 확정 댓글 2026-11-08). 앞선 결정은 [가입 이름 검증](2026-11-06-signup-name-rule.md)

## 문제와 제약

- [가입 이름 결정](2026-11-06-signup-name-rule.md)에서 팀원 표시명은 후속 이슈(#447)로 나눴다.
- `POST /api/v1/members` 의 `display_name` 은 `Field(min_length=1, max_length=100)` 만 검사했다. 공백만 있거나 줄바꿈·글자 방향 제어 문자가 든 값이 그대로 저장됐고, 길이는 공백을 지우기 전 값으로 셌다.
- `PATCH /api/v1/members/{id}` 의 `display_name` 은 검사가 없었다. `null` 을 보내면 NOT NULL 칸(`members.display_name`)에 `None` 이 들어가 커밋에서 IntegrityError 가 나고 500 이 됐다(코드를 읽고 판단했고, 구현 전 새 테스트가 이 경로에서 실패하는 것을 확인).
- 표시명은 PM 소개 문구, 회의 참석자, 이름 별칭의 원본이라 가입 이름과 같은 이유로 깨진 값이 문제가 된다.
- FE 팀원 연결 화면은 디스코드 표시 이름을 `trim()` 해서 보내고 빈 값은 보내지 않는다. `null` 은 보내지 않는다(`MemberUpdateDto.display_name?: string`).

## 실제 검토한 선택지

설계 초안과 사용자 확정(2026-11-08, 모든 질문을 추천안으로)에서 비교한 것이다.

| 결정 | 선택지 | 결과 |
|---|---|---|
| 규칙 위치 | 공용 모듈 `app/schemas/name.py` 의 `NameStr` / `auth.py` 에 두고 가져다 씀 / `member.py` 에 `field_validator` | 공용 모듈. `app/schemas/email.py` 의 `NormalizedEmail` 과 같은 모양이고, 팀원 스키마가 인증 스키마에 기대지 않는다. #445 리뷰에서 제안된 방향이다 |
| PATCH `display_name: null` | 400 `INVALID_REQUEST` / `role` 처럼 무시 / 그대로(500) | 400. 표시명은 비울 수 없는 칸이고, 무시하면 클라이언트 실수를 숨긴다 |
| 워크스페이스 생성 때 PM 팀원 자동 생성(`user.name` 복사) | 같이 검사 / 그대로 | 그대로. 새 가입자 이름은 이미 같은 규칙을 통과했고, 기존 빈 이름 계정에 쓸 이름을 지어낼 근거가 없다 |
| 이미 저장된 규칙 밖 표시명 | 그대로 둠 / 데이터 정리 | 그대로 둠. 가입 이름 결정과 같다. 이름을 보내지 않는 수정과 조회는 계속 동작한다 |
| 오류 문구 | 가입 이름 문구 공유 / 표시명 전용 문구 | 공유. 필드는 `details.fields[].loc` 로 구분된다 |

## 선택과 이유

- `NameStr = Annotated[str, AfterValidator(validate_name)]` 를 가입 이름(`SignupRequest.name`)과 팀원 표시명(`MemberCreateRequest.display_name`, `MemberUpdateRequest.display_name`)이 같이 쓴다. 규칙 원본은 `validate_name` 하나다.
- 생성 요청의 `Field(min_length, max_length)` 는 뺐다. 남기면 공백을 지우기 전에 길이를 재서, 앞뒤 공백이 붙은 100자 이름이 막힌다.
- 수정 요청은 키를 생략하면 이름을 바꾸지 않고, `null` 을 명시하면 `mode="before"` 검사에서 거절한다.
- 라우터는 바꾸지 않았다. 스키마가 지운 값을 넘기므로 이름 변경 판정과 이름 별칭 동기화가 지운 값 기준으로 맞는다. 공백만 다른 같은 이름으로 수정하면 이름이 바뀌지 않은 것으로 본다.

## 장단점과 감수한 제약

- 예전에 201·200 이던 입력 일부가 400 이 된다. 디스코드 표시 이름에 제어문자나 방향 제어 문자가 있는 드문 경우 FE 팀원 연결 화면이 400 을 받는다.
- 가입 이름 결정의 한계(한글 채움 문자 통과, NFC 정규화 없음)를 그대로 물려받는다.
- 기존 빈 이름 계정이 워크스페이스를 만들면 빈 표시명의 PM 이 생길 수 있다. 운영 DB 에 그런 계정이 있는지는 조회하지 않아 모른다.
- OpenAPI 에서 수정 요청의 `display_name` 은 nullable 로 보이지만 실제로는 `null` 을 거절한다.
- 생성 요청 `display_name` 의 OpenAPI `minLength`/`maxLength` 가 사라진다. `AfterValidator` 는 JSON 스키마에 나타나지 않기 때문이다. FE 는 OpenAPI 로 타입을 생성하지 않아 깨지는 것은 없다.

## 영향 범위와 재검토 조건

- 코드: `app/schemas/name.py`(신규), `app/schemas/auth.py`, `app/schemas/member.py`. 모델·마이그레이션·라우터 변경 없음.
- 계약: 경로·필드·오류 코드는 그대로다. 응답 `display_name` 은 앞뒤 공백을 지운 값이고, PATCH `display_name: null` 은 500 에서 400 이 된다. FE 계약 문서 반영은 FE 몫이다.
- 재검토: 카카오 가입(#427)이나 다른 외부 경로가 팀원 행을 만들게 되면 그 경로에서도 `validate_name` 을 부를지 정한다. 기존 위반 이름을 정리하기로 하면 운영 DB 를 먼저 조회한다.

## 근거와 관련 문서

- #447 설계 확정 댓글
- [가입 이름 검증 결정](2026-11-06-signup-name-rule.md)
- [백엔드 README 팀원 표시명 규칙](../../../../README.md#팀원-표시명-규칙)
- 테스트: `tests/api/test_member_display_name_rule.py`, `tests/api/test_auth_name_rule.py`
