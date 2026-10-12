# `boundaries/dependencies`가 실제로는 아무것도 못 잡던 문제

- 날짜: 2026-09-21
- 상태: 결정

## 고민

코드 리뷰에서 `boundaries/dependencies`가 `error`로 켜져 있고 `settings['boundaries/elements']`도 맞게 설정돼 있는데도, `src/entities/task/lib/`에서 `import type { Member } from '@/entities/member'`도 `'../../member/model/types'`(확장자 없는 상대 경로)도 에러를 내지 않는다는 사실이 드러났다. `'../../member/model/types.ts'`처럼 확장자를 직접 쓴 경우에만 잡혔다. `shared → entities` 같은 다른 방향의 위반도 똑같이 조용히 통과했다.

`ESLINT_PLUGIN_BOUNDARIES_DEBUG=1`로 확인하니 원인은 `settings['import/resolver']`가 없다는 것이었다. `node_modules`에는 `eslint-import-resolver-node`만 있는데, 이 resolver는 `@/*` alias 를 모르고 확장자 없는 `.ts` 상대 경로도 기본적으로 풀지 못한다. `boundaries` 플러그인은 import 대상 파일을 resolver로 실제 경로까지 풀어야 `to` element를 분류하는데, resolve 가 실패하면 그 import 자체를 조용히 건너뛴다. 결과적으로 사양서(§3-2, §12)가 "entities → entities는 boundaries가 이미 막는다"고 단언한 부분이 거짓이었다 — alias·확장자 생략 경로를 쓰는 한 사실상 아무것도 막지 못했다.

사양서 §12는 DTO import 차단을 `@typescript-eslint/no-restricted-imports` 패턴 매칭으로 이미 강제하고 있어서, 같은 접근(경로 문자열 패턴 금지 규칙 추가)으로 이 문제도 덮을 수 있어 보였다.

## 고른 길

`eslint-import-resolver-typescript`를 `devDependencies`에 추가하고, `frontend/eslint.config.js`의 `settings`에 다음을 더했다.

```js
settings: {
  'import/resolver': {
    typescript: { project: './tsconfig.json' },
  },
  'boundaries/elements': [ /* 기존 그대로 */ ],
},
```

`policies` 배열이나 `boundaries/elements` 자체는 손대지 않았다. resolver가 alias와 확장자 생략 경로를 실제 파일로 풀어주자, 기존에 짜여 있던 정책만으로 `entities → entities`, `shared → entities` 위반이 정상적으로 잡히기 시작했다. `npx eslint .`로 전수 재검사한 결과 기존 코드에서 새로 드러난 위반은 없었다(151개 파일, 0 에러) — M1 코드가 규칙이 죽어 있는 동안에도 우연히 계층을 지켜서 짜여 있었다는 뜻이다.

## 왜

두 가지 후보가 있었다.

1. **`no-restricted-imports`로 개별 경로 패턴을 추가 금지한다.** §12의 DTO 차단과 같은 방식이라 일관성은 있지만, `entities/*` 각각이 서로를 막으려면 엔티티 개수만큼 패턴 조합을 손으로 유지해야 하고, `app → entities` 허용처럼 계층별로 다른 규칙도 별도로 손봐야 한다. 새 엔티티가 추가될 때마다(현재 9개, §3-3) 이 목록도 같이 늘어나야 해서 깨지기 쉽다.
2. **resolver를 추가해 `boundaries` 본연의 기능을 복구한다.** `boundaries/elements`에 이미 6계층(app/pages/widgets/features/entities/shared) 전체가 정의돼 있고 `policies`도 계층 간 허용 방향을 전부 표현하고 있다. resolver 하나만 고치면 이 6계층 전체가 한 번에 복구된다. 설정을 추가로 유지할 필요가 없고, `boundaries`가 원래 하려던 일을 그대로 하게 만드는 것이므로 사양서 §3-2·§12의 전제("entities → entities는 boundaries가 막는다")도 다시 참이 된다.

resolver를 골랐다. `no-restricted-imports`로 우회하면 경로 문자열을 추가로 계속 관리해야 하고, `boundaries`가 이미 죽은 채로 남아있어 §3-2·§12의 서술과 실제 동작이 계속 어긋난다.

## 다시 고민할 때

- `tsconfig.json`이 project reference 구조로 바뀌어 `paths`가 다른 파일로 이동하면 `import/resolver.typescript.project` 값을 그 파일로 맞춘다.
- `boundaries` 또는 `eslint-import-resolver-typescript`의 메이저 업그레이드로 설정 키가 바뀌면 `npx eslint --print-config`와 `ESLINT_PLUGIN_BOUNDARIES_DEBUG=1`로 다시 검증한다.
