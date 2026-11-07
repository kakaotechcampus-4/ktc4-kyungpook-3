# 계획 — 온보딩에서 기존 PM 멤버를 선택해 Discord 중복 멤버 생성 방지 (#228)

- 작성일: 2026-10-14
- 상태: 구현 전 계획. 완료 판정과 테스트 성공 기록은 포함하지 않는다.
- 근거: 이슈 #228(관련 #212), 현재 작업 트리의 코드, 사용자 지시(2026-10-14: `plan/refactor/plan-<slug>.md`에 작성).
- 위치: [전체 계획](../frontend-plan.md)의 M0~M8 번호에 속하지 않는 수정 계획이다. 온보딩 원 구현은 [M4 계획](../m4/plan.md)이다. 전체 계획은 수정하지 않는다.

## 목표와 배경

워크스페이스 생성 시 로그인 계정 이름으로 PM 멤버가 먼저 만들어진다. 팀원 연결 화면은 입력한 이름이 기존 멤버의 `displayName`과 정확히 같을 때만 그 멤버를 재사용하고, 다르면 새 멤버를 만든다. 그래서 PM이 `길동`, `홍 길동`처럼 적으면 기존 PM에는 디스코드가 연결되지 않고 별도 멤버가 생긴다.

팀원 연결 화면에서 디스코드 사용자에 연결할 기존 PM 멤버를 **멤버 ID로** 선택할 수 있게 한다. 나머지 줄은 지금처럼 이름으로 연결·생성한다.

## 현재 구현과 차이

| 경계 | 현재 | 필요한 변경 |
|---|---|---|
| 줄 모델 | `MappingRow`는 `discordUserId`·`username`·`name`뿐이다 ([memberMapping.ts](../../../src/features/onboarding/model/memberMapping.ts)) | 선택한 PM 멤버 ID를 담는 필드 추가 |
| 저장 계획 | `planRow`는 이름으로만 기존 멤버를 찾는다 | PM이 선택된 줄은 이름이 아니라 멤버 ID로 `link` |
| 검증 | `findMappingIssues`는 이름 중복·타 계정 연결(`duplicated`·`taken`)만 본다 | 같은 PM의 중복 선택과 PM 이름 가로채기 차단 |
| 화면 | 줄마다 이름 입력만 있다 ([MembersStep.tsx](../../../src/widgets/onboarding/ui/MembersStep.tsx)) | 줄마다 PM 선택 입력 |
| 백엔드 | `PATCH /members/{id}`가 `discord_user_id`를 바꾸고, 같은 디스코드 계정을 다른 멤버가 쓰면 409 | 변경 없음 예상. 착수 시 `backend/app/api/members.py` PATCH 경로를 끝까지 확인 |

## 범위

- 포함: 모델·검증·화면 변경, 단위·MSW·스토리·E2E 회귀 테스트.
- 제외: 백엔드·API 형식 변경, Discord OAuth 변경, PM이 아닌 멤버를 ID로 고르는 기능, 일괄 저장 API.

## 작업 순서

1. **모델.** `MappingRow`에 PM 멤버 ID 필드(`pmMemberId: string | null`)를 추가한다. 값이 있으면 이름보다 우선한다. 화면 스키마(zod)와 `buildMappingRows`를 맞춘다.
2. **계획 규칙.** `planRow`에서 PM이 선택된 줄을 먼저 처리한다.
   - 그 PM이 이미 이 줄의 디스코드 사용자에 연결돼 있으면 `null`.
   - 아니면 `link`(PATCH `discordUserId`). 이름·`role`·로그인 계정 연결은 보내지 않는다.
   - 이 줄의 디스코드 사용자가 다른 멤버에 연결돼 있으면 `unlink`를 먼저 보낸다. `MAX_STEPS_PER_ROW`(3) 안에서 처리되는지 확인한다.
3. **검증.** `findMappingIssues`에 사유를 추가한다.
   - 같은 PM을 두 줄에서 선택: 두 줄 모두 막는다.
   - 다른 줄에 선택된 PM의 이름을 직접 입력: 이름 기반 재사용이 PM을 가로채지 못하게 막는다.
   - 기존 디스코드 1:1 제약과 `reusableMember` 동작은 유지한다.
4. **화면.** 줄마다 PM 선택 입력을 둔다. 선택지는 `role === 'pm'`인 멤버다. 다른 줄에서 고른 PM은 선택할 수 없게 표시한다. PM을 고른 줄은 이름 입력을 비활성화하고 PM 이름을 보여 준다. 오류 문구를 `ISSUE_MESSAGES`에 추가한다. `@/shared/ui`의 기존 선택 컴포넌트 유무를 먼저 확인한다.
5. **재시도·재진입.** 저장 성공 시 캐시가 갱신돼 재계획 결과가 `null`이 되는지, 응답 유실 시 기존 `invalidateQueries` 경로가 그대로 동작하는지 확인한다. 재진입 시에는 `buildMappingRows`가 줄에 연결된 멤버가 `role === 'pm'`이면 `pmMemberId`를 그 멤버로 채워 PM 본인을 미리 선택하고 이름 입력을 잠근다(결정 기록 참고). 이름을 바꾸려면 PM 선택을 해제해 이름 칸을 풀어야 한다.
6. **테스트.**
   - Vitest([onboardingModel.test.ts](../../../src/features/onboarding/model/onboardingModel.test.ts)): PM 이름과 다른 입력(`길동`, `홍 길동`)에서 PM 선택 시 POST 없이 PATCH 한 번, 일반 팀원 저장, 같은 PM 중복 선택, PM 이름 가로채기, 실패 후 재시도.
   - MSW·스토리([OnboardingSteps.stories.tsx](../../../src/widgets/onboarding/ui/OnboardingSteps.stories.tsx))·E2E: PM 선택 저장, 부분 실패 재시도, 재진입.
7. **실행 환경.** 이슈에 기존 Vitest가 worker 시작 시간 초과로 끝나지 않았다는 기록이 있다. 실행 실패가 환경 문제인지 코드 문제인지 구분해 기록한다.

## 완료조건과 검증

| ID | 조건 | 검증 |
|---|---|---|
| AC-01 | 이름이 달라도 PM을 선택해 저장하면 기존 PM 멤버 1명에 `discordUserId`가 저장되고 새 멤버가 생기지 않는다. | 모델 단위 테스트, MSW 통합 |
| AC-02 | 연결 후에도 멤버 ID·`role=pm`·로그인 계정 연결이 유지되고, 같은 PM 계정으로 워크스페이스 접근·PM 작업이 가능하다. | PATCH 본문이 `discordUserId`만 담는지 확인, 연결 전후 멤버 목록 비교, E2E |
| AC-03 | PM을 고르지 않은 줄은 이름 입력, 빈 줄 건너뛰기, 기존 멤버 재사용, 새 멤버 생성이 이전과 같다. | 기존 매핑 테스트 무수정 통과 |
| AC-04 | 같은 PM·같은 디스코드 사용자의 중복 매핑이 저장 전에 차단되고 디스코드 1:1 연결 제약이 유지된다. | 단위 테스트, 화면 오류 문구 |
| AC-05 | 저장 실패 후 재시도와 온보딩 재진입에서 멤버가 늘지 않는다. | 실패 주입 테스트, E2E 재진입 |

## 미결 사항

없음.

## 결정 기록

- 2026-10-14, 사용자 결정: 재진입(저장 후 다시 열기·새로고침·`이전 단계` 왕복) 시 이미 PM이 연결된 줄은 "PM 본인"으로 미리 선택하고 이름 칸을 잠근다. 근거: 서버는 `member.discord_user_id` 컬럼 외에 "이 디스코드 사용자가 PM"이라는 정보를 갖지 않고(`backend/app/api/workspaces.py` PM 생성 시 `discord_user_id`는 비어 있음), 줄의 PM 여부는 멤버 목록의 `discordUserId`와 `role`로만 알 수 있다. 이름만 채우면 이름 칸 수정이 `rename`으로 PM `displayName`을 바꾼다.

- 2026-10-14, 사용자 결정: PM이 선택된 줄의 디스코드 사용자가 이미 다른 멤버에 연결돼 있으면 그 연결을 먼저 풀고 PM을 연결한다(덮어쓰기). 저장을 막지 않는다. 작업 순서 2의 `unlink` 선행이 이 동작이다.
- 2026-10-14, 사용자 결정: 구현 결과는 이 폴더의 `result-onboarding-pm-discord-link.md`에 기록한다. 구현과 검증 전에는 빈 결과를 만들지 않으므로 파일은 작업 후 생성한다.
