# 온보딩에서 공간을 바꾸면 이전 공간의 확인 결과로 다른 공간의 단계를 완료함

- 구분: FE 수정 필요 (검증에서 발견, 심각도 중간)
- 상태: 수정함(2026-10-13, 커밋 전). 회귀 테스트 추가. 서버의 온보딩 완료 저장이 실제 연결 여부를 검사하지 않는 점은 BE 요청 후보로 남긴다.
- 발견: 2026-10-12 브랜치 검증(Codex `gpt-6.1-sol`, 읽기 전용). 실제 `useIntegrationStep`·`useOnboardingSave`와 React·TanStack Query를 jsdom에서 실행해 재현했다. 실제 서버로 PATCH를 보내 확인하지는 않았다.

## 현상

1. 공간 A의 Notion OAuth 복귀 확인이 `connecting`이라 다시 조회하는 중이다.
2. 사용자가 미완료 공간 B의 같은 단계(`connect_notion`)로 앱 안에서 이동한다.
3. A의 확인 반복은 멈추지 않고 계속 A를 조회한다. B의 확인은 시작되지 않는다.
4. A가 `connected`가 되면 기존 작업이 완료 저장을 부르는데, 그 저장이 **B 공간의 Notion 단계 완료**로 나간다.

재현 결과(A 응답: `connecting` → 보류 → `connected`, 중간에 공간을 B로 바꿈):

```json
{"calls":["A","A"],"saves":[{"id":"B","step":"connect_notion","action":"complete"}],"workspaceB":{"verifying":false,"status":"not_connected"},"oldCache":"connected"}
```

B는 연결되지 않았는데 B의 단계 완료 저장이 시도됐다. 백엔드가 이 요청을 받아들이는지는 확인하지 않았다.

## 원인

- `frontend/src/pages/onboarding-step/ui/OnboardingStepPage.tsx`가 `IntegrationStep`의 key를 `"discord"`/`"notion"`으로 고정한다. 공간이 바뀌어도 같은 컴포넌트가 재사용된다. 온보딩 경로에는 일반 워크스페이스 화면처럼 공간별로 다시 그리는 key가 없다.
- `useIntegrationStep`의 화면 존재 표시(`present`)는 공간이 바뀌어도 true로 남는다. 복귀 처리 여부(`handled`)도 true라 B의 확인은 시작되지 않는다.
- 완료 저장(`useOnboardingSave`의 `mutateAsync`)은 다시 그릴 때 대상 공간이 B로 바뀐다. 그래서 A의 작업이 끝날 때 부른 저장이 B로 간다.

## 범위

고정 key, `handled`, 저장 훅의 조합은 develop에도 있었다. 이번 다시 조회 반복(#204)으로 A의 확인이 길게 살아 있게 되면서, 그 사이 공간을 바꿀 수 있는 시간이 생겼다.

## 해결 방안

두 겹으로 막았다. 각 겹이 막는 것이 다르다.

| 수정 | 위치 | 막는 것 |
|---|---|---|
| 연결 단계의 React `key`에 공간 ID를 넣음(`` `${workspace.id}:notion` ``) | `OnboardingStepPage.tsx` | 공간이 바뀌면 단계 화면을 새로 그린다. 이전 공간의 확인 중·준비 중 표시, 안내 문구, 「복귀 처리함」 표시가 새 공간으로 넘어가지 않는다. 일반 화면의 `WorkspaceLayout`(`<Fragment key={workspaceId}>`)과 같은 규칙이다 |
| 훅 안에서 확인을 시작한 공간·제공자와 지금 그리는 공간·제공자를 대조 | `useIntegrationStep.ts` | 컴포넌트가 재사용되더라도 이전 공간의 확인이 다음 조회·결과 처리·완료 저장으로 이어지지 않는다 |

[늦은 응답 문제](2026-10-12-onboarding-late-check-rewrites-cache.md)의 세션 확인과 같은 중단 조건(`stillMine`)에 묶었다.

**검증:** `src/app/onboardingIntegrations.test.tsx`의 「준비 중 확인 사이 다른 공간의 같은 단계로 가면, 이전 공간이 연결돼도 새 공간을 완료로 저장하지 않는다」. 수정 전에는 PATCH 1건이 나가 실패했다. 각 겹을 하나씩 빼고 돌려 본 결과는 다음과 같다.

- `key`만 있을 때: 통과
- 훅 대조만 있을 때: 완료 저장은 막히지만, 새 공간 화면에 이전 공간의 「노션을 준비하고 있어요」가 남아 실패
- 둘 다 없을 때: 실패

**남은 것:** BE의 온보딩 완료 저장(`backend/app/api/workspaces.py`의 `update_onboarding`)은 PM 여부와 단계 값만 검사하고, 그 공간에 실제로 연결됐는지는 확인하지 않는다. 서버에서도 막으려면 BE 보완이 필요하다.
