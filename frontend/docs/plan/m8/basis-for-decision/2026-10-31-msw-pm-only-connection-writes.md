# MSW의 연동 해제·팀원 생성과 수정·모의 OAuth 완료를 PM 전용으로 맞추는 선택

- 기록일: 2026-10-31 (커밋 37dd43c는 2026-10-30)
- 관련 마일스톤: M8-B(#244) B-1 구현 순서 1, AC-B-01

## 문제와 제약

- B-1 전의 MSW는 연동 `DELETE`, `POST`·`PATCH /members`, 모의 OAuth 완료(`settleMockOAuth`)에서 `requireMember`만 확인했다. 그래서 일반 팀원도 이 쓰기를 할 수 있었다([계획](../plan.md) B 「MSW·테스트·Storybook」).
- 백엔드는 같은 쓰기를 PM에게만 허용한다(정적 확인, 실행하지 않음).
  - [integrations.py](../../../../../backend/app/api/integrations.py)
    - `delete_integration`은 `Depends(get_current_pm)`이다.
    - 연결 시작(`_start_connection`)은 요청자가 PM이 아니면 제공자 화면 대신 `failed`로 돌려보낸다.
    - 콜백도 PM이 아니면 `not_pm`으로 실패 처리한다.
  - [members.py](../../../../../backend/app/api/members.py)
    - `create_member`는 공간을 찾은 뒤 `require_pm`을 본다.
    - `update_member`는 `_get_member(..., pm=True)`다. 대상 팀원이 없으면 404를 먼저 내고, 그다음 권한을 검사한다.
- B-1의 화면은 PM에게만 연결 버튼을 보인다. 계획은 "서버 권한을 프론트 분기가 대신하지 않는다. MSW도 같은 거부를 재현해야 한다"고 정했다(「권한 분기」).
- 결정 5(설정·팀의 항목 범위와 권한)는 아직 열려 있다. 계획은 이 PM 제한을 제품 결정이 아니라 서버 제약으로 구분했다(B-1 범위의 근거 문장).

## 실제 검토한 선택지

대안을 비교한 기록은 없다. 계획 1단계가 이 변경을 정했고, 구현은 그 범위를 따랐다. 구현 중 확인된 세부 선택은 PM 검사 함수다.

- 기존 `requirePm`은 PM 여부와 함께 기록용 세션 팀원 ID도 정한다. 세션 팀원 대응(`sessions.ts`)이 없는 공간은 403이다.
- 새 `requirePmRole`은 인증·소속·그 공간의 `role === 'pm'`만 본다([auth-guard.ts](../../../../src/shared/mock/auth-guard.ts)).

## 선택과 이유

- 세 쓰기를 `requirePmRole`로 막았다.
  - [integration.ts](../../../../src/shared/mock/handlers/integration.ts)의 `DELETE`
  - [member.ts](../../../../src/shared/mock/handlers/member.ts)의 `POST`·`PATCH`
  - [mockOAuth.ts](../../../../src/shared/mock/oauth/mockOAuth.ts)의 성공 결과
- 일반 팀원의 `DELETE`·`POST`·`PATCH`는 403이고 데이터가 바뀌지 않는다. 모의 OAuth 성공 시도는 `failed`로 돌아간다. 취소·실패 결과는 그대로 돌려준다.
- 검사 순서는 백엔드를 따랐다. `POST /members`는 공간 확인 뒤, `PATCH /members/:id`는 대상 팀원을 찾은 뒤 PM을 검사한다. 그래서 없는 대상은 404가 먼저다.
- `requirePm` 대신 `requirePmRole`을 쓴 이유는 함수 주석에 있다. 이 쓰기들은 변경자를 기록하지 않는다. 또 새로 만든 공간(예: `ws_03`)은 세션 팀원 대응이 없어도 PM이면 온보딩을 마칠 수 있어야 한다.
- 조회(`GET /integrations`, `GET /members`)는 바꾸지 않았다. 백엔드도 소속 팀원이면 조회할 수 있다.

## 장단점과 감수한 제약

- MSW 모드에서도 일반 팀원은 버튼을 우회한 직접 호출로 연결·매핑을 바꿀 수 없다. 프론트의 버튼 숨김과 서버(모의) 거부를 따로 검증할 수 있다([connectionWrites.test.ts](../../../../src/shared/mock/connectionWrites.test.ts), [settingsConnections.test.tsx](../../../../src/app/settingsConnections.test.tsx)의 일반 팀원 우회 실패).
- 이 제한은 결정 5의 일반 팀원 화면 노출 범위를 정한 것이 아니다. 노출 범위는 B-2에서 결정 뒤 정한다.
- [MSW 안내](../../../msw-guide.md) 「실 백엔드와 다른 점」은 `members`에 인증을 일부러 붙이지 않았다고 적고 있다. 이번 변경으로 `POST`·`PATCH /members`는 그 예외가 됐다. 안내에는 M8-B 절에 이 규칙을 추가했고, 기존 문장은 고치지 않았다.
- 실제 서버의 거부와 프론트 안내가 맞는지는 실행하지 않았다(미검증 연동 과제).

## 영향 범위와 재검토 조건

- 백엔드의 연동·팀원 쓰기 권한이 바뀌면 MSW도 함께 바꾼다.
- 결정 5에서 일반 팀원의 매핑 쓰기를 허용하기로 정해도, 서버가 바뀌기 전에는 MSW만 먼저 풀지 않는다.

## 근거와 관련 문서

- [M8 계획](../plan.md) B 「구현 순서」 1·「권한 분기」·AC-B-01
- [B 결과](../result-b.md)
- 커밋 37dd43c
- V2 리뷰 「3. 권한과 서버 제약」(저장소 밖 보고서)
