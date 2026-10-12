# 온보딩 복귀 확인의 늦은 응답이 비운 캐시를 다시 씀

- 구분: FE 수정 필요 (검증에서 발견, 심각도 중간)
- 상태: 수정함(2026-10-13, `bc400cd`). 회귀 테스트 추가.
- 발견: 2026-10-12 브랜치 검증(Codex `gpt-6.1-sol`, 읽기 전용). 브라우저에서 로그아웃까지 거친 재현은 하지 않았고, 실제 훅·함수와 TanStack QueryClient로 메모리에서 재현했다.

## 현상

온보딩 Discord·Notion 단계에서 OAuth 복귀를 확인하는 동안 로그아웃하거나, 세션이 만료되거나, 화면을 떠날 수 있다. 그 뒤 확인 조회의 응답이 늦게 도착하면, 이미 비운 연동 상태 캐시에 이전 세션의 값이 다시 쓰인다.

수정 전 재현 결과(응답을 붙잡아 둔 채 화면 이탈과 `queryClient.clear()` 뒤 응답을 풂): `result: null, cacheRecreated: true, cachedWrites: 1`. 확인 반복은 멈췄지만 캐시는 다시 생겼다.

## 원인

`frontend/src/features/onboarding/model/useIntegrationStep.ts`의 복귀 확인은 공유 Query를 거치지 않고 직접 조회한 뒤 캐시에 쓴다.

1. `fetchIntegrations(workspaceId)`를 취소 신호 없이 Query 밖에서 부른다. 그래서 세션을 끝낼 때의 `cancelQueries`·`clear`가 이 요청을 끊지 못한다.
2. 응답을 받으면 `setQueryData`부터 하고, 그 뒤에야 `waitWhileConnecting`이 그만둘지(`shouldStop`) 검사한다.
3. `shouldStop`은 화면이 남아 있는지만 본다. 세션 세대는 확인하지 않는다.

설정 화면의 같은 확인(`useNotionConnection`)은 `captureSession`과 `fetchFresh`를 써서 이 문제가 없다. `fetchFresh`는 공유 Query로 묻고, 세션이 끝났으면 답을 쓰지 않는다.

## 범위

직접 조회 후 바로 캐시에 쓰는 구조는 develop에도 있었다. 이번에 `connecting`일 때 다시 조회하는 반복(#204)이 생기면서, 조회할 때마다 같은 위험이 생기고 위험한 시간도 길어졌다.

## 해결 방안

온보딩 복귀 확인을 설정 화면과 같은 방식으로 맞췄다(`useIntegrationStep.ts`).

1. 직접 조회 후 `setQueryData` 대신 `fetchFresh`로 공유 Query를 거쳐 묻는다. 요청이 Query 객체에 묶이므로 세션을 끝낼 때의 `cancelQueries`·`clear`가 요청을 거두고(`AbortController`), 늦은 답은 캐시에서 빠진 Query 객체에만 쓰여 캐시에 다시 나타나지 않는다. `fetchFresh`는 답을 받은 뒤 세션 세대도 한 번 더 확인한다.
2. 확인 반복의 중단 조건에 세션 확인(`captureSession`)을 더했다. 화면이 내려갔거나 세션이 끝났으면 다음 조회를 하지 않고, 결과 처리·완료 저장도 하지 않는다.

**대가:** 개발 모드의 StrictMode에서는 시험 재마운트가 첫 조회를 취소해 `fetchFresh`가 한 번 더 묻는다. 그래서 StrictMode 테스트의 연동 조회 수 기대값을 1에서 2로 바꿨다. 시험 재마운트가 없는 실제 실행에서는 한 번이다.

**검증:** `src/app/onboardingIntegrations.test.tsx`의 「확인 응답을 기다리는 사이 세션이 끝나면 늦게 온 답이 비운 연동 캐시를 다시 만들지 않는다」. 수정 전 코드에서 실패(캐시 다시 생김)하고 수정 뒤 통과하는 것을 확인했다.
