# M1 구현 사양 — 도메인 모델 · MSW

> **이 문서만 읽고 구현할 수 있도록 작성했다.** 결정 기록(`../decision/frontend-decisions.md`, 약 2,000줄)을
> 다시 열 필요가 없다.
> **값이 충돌하면 API 계약(`../api/frontend-api-contract-draft.md`)과 결정 기록이 우선한다.** 이 문서는 거기서 파생된 실행 지시다.
> 관련 이슈 #54 · 브랜치 `feature/54-m1-domain-model-and-msw` · 커밋 타입 `feat(frontend):`
> 기준 커밋 `origin/develop` `063f7fb` (PR #52 병합 이후)

이 문서의 모든 DTO 필드는 계약 문서 §1~§4 에서 그대로 가져왔고, 계약 §2 는 `backend/app` 을 읽고 적은 사실이다.
**필드 이름이 의심스러우면 계약 문서의 해당 절을 열어 확인한다.** 절 번호를 값마다 달아 두었다.

근거가 없어 이 문서가 새로 정한 것에는 **`제안`** 을 붙였다. 그대로 확정하지 말고 §3 의 근거를 읽고 판단한다.

---

## 0. 목표와 완료 기준

### M1-A 는 이미 끝났다

개발 계획의 M1 은 A·B·C 세 덩어리인데 **M1-A(가정 명세)는 PR #52 로 끝났다.**
산출물은 `frontend/docs/api/frontend-api-contract-draft.md`(827줄)이고, 백엔드 요청 목록도 그 문서 §4 로 통합됐다(D-160).

**이 문서가 다루는 것은 M1-B 와 M1-C 뿐이다.** 계약을 다시 쓰지 않는다.

### 끝난 상태

| | 산출물 |
|---|---|
| DTO 타입 | `src/shared/types/api/*.ts` — 백엔드 응답 모양 그대로(`snake_case`) |
| 도메인 타입 | `src/entities/<9개>/model/types.ts` — 화면이 쓰는 모양(`camelCase`) |
| 변환 | `src/entities/<9개>/model/mapper.ts` + 단위 테스트 |
| 파생 함수 | `src/entities/<x>/lib/*.ts` — overdue·탭 필터·조인 등 (§7) |
| 봉투 유틸 | `src/shared/api/envelope.ts`, `src/shared/api/errors.ts` |
| MSW | `src/shared/mock/` — handler·픽스처·메모리 DB·worker·server |
| 통합 테스트 | 엔드포인트별 `fetch → unwrap → mapper` 왕복 |
| 문서 | `frontend/docs/msw-guide.md` (D-146 열린 항목) |

### 검증 명령

```bash
cd frontend
npm ci
npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
cp .env.example .env    # VITE_ENABLE_MSW=true
npm run dev             # 브라우저 콘솔에서 §14 의 확인 스니펫 실행
```

### 완료 기준

- [ ] §10 의 엔드포인트가 전부 mock 으로 응답한다.
- [ ] 같은 handler 로 Vitest 가 돈다. 미처리 요청은 테스트를 **실패**시킨다.
- [ ] 엔티티 9개에 도메인 타입과 변환이 있고, 변환마다 `null`·폴백 경로를 덮는 테스트가 있다.
- [ ] **`pages`·`widgets`·`features`·`app` 에서 DTO 를 import 하면 ESLint 가 막는다** (§12).
- [ ] production 번들에 MSW 가 들어가지 않는다 — `npm run build` 후 `dist/assets/*.js` 에 `msw` 가 0건 (§14).
- [ ] 위 5개 npm 명령이 전부 통과한다.

---

## 1. 하지 말 것

- **화면을 만들지 않는다.** 페이지·위젯·라우트는 M3~M8 이다. `src/App.tsx` 의 M2 갤러리는 그대로 둔다.
- **axios·TanStack Query·react-router 를 설치하지 않는다.** 데이터 계층은 M3 이다 (§3-1).
- **Zod 로 API 응답을 검증하지 않는다** (D-134). 이 단계에는 사용자 입력이 없으므로 Zod 자체를 설치하지 않는다.
- **계약에 없는 엔드포인트·필드를 발명하지 않는다.** 필요하면 계약 문서를 먼저 고치고 그 커밋을 근거로 삼는다.
- **`docs/design/canvas/`** 와 **`docs/design/site-runtime/`** 을 수정하지 않는다. 읽기 전용 스냅샷이다. 픽스처 값의 **참고 자료**로만 쓴다.
- **`.github/workflows/`** 의 `assign-mentor`·`notify-discord`·`convention-check` 를 건드리지 않는다. 운영진(CODEOWNERS) 소유다.
- 패키지 매니저는 **npm** 만 쓴다.
- **계약의 `결정 대기`(계약 §8)를 앞질러 확정하지 않는다.** 태스크 목록의 정렬·페이지네이션 정책, 메시지 화면, 워크스페이스 설정의 나머지 항목이 여기 해당한다.
- **메시지(`/messages`)는 모델도 픽스처도 만들지 않는다** (D-171, 계약 §5.7).

---

## 2. 지금 저장소 상태

M0(툴체인)과 M2(디자인 토큰·공통 컴포넌트)가 끝나 있다. `src/` 에 **데이터를 다루는 코드는 한 줄도 없다.**

**있는 것**

- React 19 · TypeScript ~6.0 · Vite 8 · Vitest 5(jsdom, `globals: true`, `passWithNoTests: true`)
- Tailwind v4(`@theme`) · Radix primitive 5종 · `src/shared/ui/` 12종 + Mascot
- ESLint flat config — type-checked, `boundaries` 로 FSD 단방향 강제, `no-explicit-any: error`,
  `no-restricted-imports` 로 `date-fns` 루트·`radix-ui` 통합 패키지 금지
- alias `@/* → src/*`, dev proxy `/api → http://localhost:8000`
- `.env.example` 에 `VITE_API_BASE_URL`, `VITE_ENABLE_MSW`
- `tsconfig.json` 에 **`verbatimModuleSyntax: true`** — 타입은 반드시 `import type` 으로 가져온다. 안 그러면 빌드가 깨진다.
- `src/shared/test/setup.ts` — 현재 `@testing-library/jest-dom/vitest` 한 줄뿐

**없는 것**

- `public/` 디렉터리 (`msw init` 이 만든다)
- HTTP 클라이언트, 상태 관리, 라우터, 날짜 라이브러리
- `src/entities/`·`src/shared/types/`·`src/shared/api/`·`src/shared/mock/` 은 `.gitkeep` 만 있다

**백엔드**

- FastAPI, 포트 `8000`, prefix `/api/v1`, **CORS 없음** — Vite proxy 가 로컬 연동의 유일한 경로다.
- workspaces·members·meetings·extractions·approvals·tasks 가 **이미 구현돼 있다**(계약 §2).
- auth·integrations·회의 웹 경로·Discord 사용자 목록은 **없다**(계약 §4). 이 단계에서는 둘을 구분하지 않고 전부 mock 한다.

---

## 3. 이번에 정한 경계 — 판단이 갈리는 지점 4개

구현하다 반드시 부딪히는 지점이고, 답을 안 정하면 사람마다 다르게 짠다. 여기서 못 박는다.

### 3-1. HTTP 클라이언트를 만들지 않는다

M1 의 완료 기준은 "mock 이 응답하고 같은 handler 로 Vitest 가 돈다" 이지 "화면이 데이터를 받는다" 가 아니다.
axios 인스턴스·인터셉터·TanStack Query 훅은 **M3(앱 셸·데이터 계층)의 산출물**이다. 여기서 만들면 M3 이 두 번 짠다.

**이번에 만드는 것은 봉투를 벗기는 함수 하나다.**

```
src/shared/api/envelope.ts   Envelope<T> 를 벗기고 error 면 ApiError 를 던진다
src/shared/api/errors.ts     ApiError 클래스 + 오류 코드 상수
```

통합 테스트는 전역 `fetch` 로 handler 를 직접 때린다. M3 에서 axios 가 들어오면 `unwrap` 은 인터셉터로 옮겨 가고 테스트는 그대로 남는다.

### 3-2. 엔티티는 서로 import 할 수 없다

ESLint `boundaries` 정책상 **`entities` 는 `shared` 만 참조할 수 있다.** `entities → entities` 는 에러다.

그래서 이런 코드는 **막힌다.**

```ts
// src/entities/task/lib/assignee.ts
import type { Member } from '@/entities/member' // ✗ boundaries/dependencies 에러
```

> **이 강제는 `settings['import/resolver']` 가 있어야 성립한다.**
> `boundaries/dependencies` 는 import 경로를 파일로 **해석하지 못하면 조용히 건너뛴다.** 경고도 내지 않는다.
> 기본 resolver 는 tsconfig 의 `paths` 별칭(`@/…`)도, 확장자 없는 `.ts` 도 읽지 못해
> 위 코드가 **에러 없이 통과했다.** M1 검증에서 발견해 `eslint-import-resolver-typescript` 를 붙여 고쳤다.
> 경위는 `docs/impl-decision/2026-09-21-boundaries-import-resolver.md` 에 있다. §12 도 함께 본다.

규칙 셋:

1. **조인 함수는 남의 엔티티 타입을 받지 않고, 필요한 모양만 인자로 받는다.**
   ```ts
   // src/entities/task/lib/assignee.ts
   export function withAssigneeName(task: Task, names: ReadonlyMap<string, string>): TaskWithAssignee
   ```
   호출부(`widgets`·`features`)가 `Map<memberId, displayName>` 을 만들어 넘긴다. 그 계층은 두 엔티티를 모두 볼 수 있다.
2. **두 엔티티가 같은 리터럴 유니온을 쓰면 `src/shared/types/common.ts` 에 둔다.**
   지금은 `Role`(`'pm' | 'member'`) 하나다. `workspace` 와 `member` 가 같이 쓴다.
   **이 파일은 DTO 가 아니므로 §12 의 import 금지 대상이 아니다.**
3. **여러 엔티티를 합치는 조립은 `entities` 가 하지 않는다.** 대시보드 조립(계약 §5.4)과 팀원 연결 화면 조립(계약 §5.3)은 M4·M7 에서 `widgets` 가 한다. M1 은 재료만 만든다.

### 3-3. `extraction` 을 9번째 엔티티로 둔다 — `제안`

개발 계획의 M1-B 목록은 8개(`user`·`workspace`·`member`·`meeting`·`minutes`·`task`·`approval`·`integration`)인데,
**계약 §5.4·§5.5 가 `GET /extractions/{id}` 를 화면이 직접 부르도록 적고 있다.** 회의록의 `반영된 태스크`와 대시보드의 `최근 반영`이 여기서 온다.

`minutes` 안에 욱여넣으면 회의록 화면에서만 쓰이는 것처럼 보이고, 대시보드가 `minutes` 를 import 하게 된다.
**`src/entities/extraction/` 을 추가한다.** 개발 계획의 8개 목록은 계약보다 앞선 판이라 이 결정으로 9개가 된다.

### 3-4. 워크스페이스 목록에는 온보딩 상태가 없다 — `확인 필요`

계약 §4.2 는 `role` 을 **목록과 상세 모두에**, `onboarding` 을 **상세에만** 요청한다.
그런데 D-070 은 워크스페이스 **선택 화면**에서 미완료 워크스페이스를 달리 표시하라고 한다. 목록 응답만으로는 그릴 수 없다.

**M1 은 계약을 따른다.** 목록 DTO 에 `onboarding` 을 넣지 않는다. 선택 화면은 목록 1회 + 항목별 상세 N회로 조립한다(M4 에서).
워크스페이스 개수가 한 자리라 N 은 작다. **M4 착수 시점에 이 조립이 불편하면 계약 §4.2 에 목록 필드 추가를 요청하고, 그때 `docs/impl-decision/` 에 기록한다.**

---

## 4. 파일 배치

```
src/shared/types/api/          DTO — 백엔드 응답 모양 그대로. snake_case 를 바꾸지 않는다
  envelope.ts                  Envelope<T>, ListDto<T>, ApiErrorDto
  auth.ts workspace.ts member.ts meeting.ts minutes.ts
  extraction.ts approval.ts task.ts integration.ts
src/shared/types/common.ts     여러 엔티티가 공유하는 리터럴 유니온 (§3-2). DTO 아님

src/shared/api/
  envelope.ts                  unwrap(res)
  errors.ts                    ApiError, ERROR_CODES

src/shared/lib/date/
  today.ts                     todayInSeoul()

src/entities/<name>/           name: user workspace member meeting minutes extraction approval task integration
  model/types.ts               도메인 타입 (camelCase)
  model/mapper.ts              toXxx(dto) — DTO 를 아는 유일한 곳
  model/mapper.test.ts
  lib/*.ts                     파생 함수 (§7) + 테스트
  index.ts                     slice 경계 barrel. 여기서만 만든다

src/shared/mock/
  fixtures/*.ts                고정 데이터 (§9)
  db.ts                        픽스처를 복제한 메모리 상태 + resetDb()
  envelope.ts                  ok() fail() list()
  handlers/*.ts                도메인별 handler
  handlers/index.ts            전체 합본
  browser.ts                   setupWorker
  server.ts                    setupServer
```

**barrel 규칙**(개발 계획 "번들 크기 규칙"): `index.ts` 는 **slice 경계에서만** 만든다.
`src/entities/index.ts` 나 `src/shared/index.ts` 같은 광역 barrel을 만들지 않고, barrel 에서 서드파티를 재export 하지 않는다.

---

## 5. 타입 규약

### 5-1. DTO 와 도메인은 이름 규칙이 다르다

| | DTO (`shared/types/api`) | 도메인 (`entities/*/model`) |
|---|---|---|
| 표기 | `snake_case` — 서버 응답 그대로 | `camelCase` |
| 식별자 | `task_id`, `member_id` | `id`, `memberId` |
| 타입 이름 | `TaskDto`, `TaskListDto` | `Task`, `TaskSummary` |
| 누가 아나 | `entities/*/model/mapper.ts` 와 `shared/mock/` 만 | 전 계층 |

**DTO 를 손대지 않는다.** 서버가 `assignee_member_id` 를 주면 DTO 도 `assignee_member_id` 다. 이름을 고치는 곳은 매퍼 한 곳뿐이고, 실제 API 가 나왔을 때 고칠 범위가 그 한 파일로 묶인다(D-133).

### 5-2. 날짜는 문자열로 유지한다 (D-144, D-145)

- `YYYY-MM-DD`(`due_date`·`start_date`)는 **`Date` 로 바꾸지 않는다.** 시간대 때문에 하루가 밀린다.
  사전순 비교가 곧 날짜순 비교이므로 `a < b` 로 비교한다.
- ISO 8601 timestamp(`created_at` 등)도 문자열로 들고 있다가 표시 직전에만 변환한다. 변환은 M3 이후 `shared/lib/date` 의 몫이다.
- **오늘을 함수 안에서 읽지 않는다.** `isOverdue(task, today)` 처럼 인자로 받는다. 테스트가 결정적으로 된다.
- 오늘 한 줄만 이번에 만든다.

```ts
// src/shared/lib/date/today.ts
/** Asia/Seoul 기준 오늘. en-CA 로케일이 YYYY-MM-DD 를 준다 (D-144). */
export function todayInSeoul(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}
```

`date-fns` 는 **설치하지 않는다.** M1 에 날짜 덧셈이 필요한 계산이 없다. 마감 임박(오늘+6일) 계산은 대시보드(M7)에서 들어오고 그때 `date-fns/addDays` 를 정적 import 한다(D-145).

### 5-3. `null` 과 폴백은 매퍼에서만 처리한다 (D-134)

화면이 `?? '이름 없음'` 을 쓰기 시작하면 같은 폴백이 여러 곳에 흩어진다. **매퍼가 이미 결정된 값을 내려보낸다.**

| 폴백 | 매퍼가 하는 일 | 근거 |
|---|---|---|
| 화자 이름 | `speaker_display_name ?? speaker_fallback` → `speakerName` + `isFallbackName` | D-028, 계약 §4.4 |
| 추출 담당자 | `assignee.member_id` 없으면 `assignee.raw` → `assigneeLabel` | D-161, 계약 §2.4 |
| 태스크 시작일 | `start_date ?? created_at.slice(0, 10)` → `startDate`(항상 채움) | 계약 §4.8-5, D-170 |
| 보완 사유 | payload 의 `assignee_member_id`·`due_date` 가 비었는지로 `missing: ('assignee'\|'due')[]` | 계약 §2.5 |
| Notion 반영 | `notion_page_id !== null` → `isSyncedToNotion` | 계약 §4.8-1 |

**담당자 이름 조인과 `overdue` 는 매퍼가 아니라 `lib` 함수다**(§7). 매퍼는 DTO 하나만 보고, 바깥 데이터나 오늘 날짜를 필요로 하지 않는다.

**2026-09-21 — 시작일 폴백의 근거가 바뀌었지만 폴백은 남는다.**
PR #59 가 계약 §4.7-6 을 반영해 `task.start_date` 를 만들었다. 「응답에 아예 없다」는 경우가 사라지고 **`null` 만 남는다.**
그래도 폴백은 줄어들지 않는다 — 컬럼이 방금 생겨 **기존 태스크 행이 전부 `null`** 이고, 봇이 만드는 태스크도 시작일을 보내지 않는다.
바뀐 것은 근거뿐이다: 「백엔드가 안 주니까 가정한다」 → 「백엔드가 주는데 대부분 비어 있으니 채운다」.

### 5-4. 모르는 유니온 값을 만나면 떨어뜨리지 않는다

서버가 나중에 상태 값을 늘릴 수 있다. `status` 를 좁힌 리터럴 유니온으로 두되, **매퍼가 모르는 값을 만나면 던지지 말고 안전한 기본값으로 내리고 개발 콘솔에만 경고한다.** 화면 하나 때문에 앱 전체가 죽지 않게 한다.

승인(`approval`)만은 예외다. `type` 마다 화면이 다르므로(계약 §2.5) **판별 유니온으로 좁히고, 모르는 `type` 은 `kind: 'unsupported'` 로 만들어 화면이 건너뛴다.**

### 5-5. `any` 금지, Zod 없음

- `@typescript-eslint/no-explicit-any: error` 는 이미 켜져 있다. 불가피하면 한 줄 disable + 사유 주석.
- payload 처럼 모양이 열린 값은 `Record<string, unknown>` 으로 받고 매퍼에서 좁힌다.
- **API 응답을 Zod 로 검증하지 않는다**(D-134). 검증은 타입 + 이 단계에서 만드는 통합 테스트가 한다.

---

## 6. 엔티티 사양 9개

각 절은 `DTO 출처 → 도메인 타입 → 변환 규칙` 순이다. DTO 필드는 계약 문서에서 그대로 가져왔다.

### 6-1. `user` — 계약 §4.1 (요청 중)

```ts
// entities/user/model/types.ts
export interface User {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

/** 로그인·부팅 시 서버가 주는 세션 정보 */
export interface Session {
  user: User
  workspaceCount: number
  lastWorkspaceId: string | null
}

/** D-010 의 로그인 후 이동 분기 */
export type PostLoginRoute = 'onboarding' | 'dashboard' | 'workspace-select'
```

- DTO: `{user: {user_id, email, name, avatar_url}, workspace_count, last_workspace_id}`
- `lib/postLoginRoute.ts` — `workspaceCount === 0 → 'onboarding'`, `=== 1 → 'dashboard'`, `>= 2 → 'workspace-select'` (D-010).

### 6-2. `workspace` — 계약 §2.1(구현됨) + §4.2(요청 중)

```ts
// entities/workspace/model/types.ts
import type { Role } from '@/shared/types/common'

export type OnboardingStep =
  | 'create_workspace' | 'connect_discord' | 'connect_notion' | 'connect_members'
export type OnboardingStepStatus = 'pending' | 'completed' | 'skipped'

export interface OnboardingProgress {
  completed: boolean
  currentStep: OnboardingStep | null
  steps: { step: OnboardingStep; status: OnboardingStepStatus }[]
}

/** 목록 항목. onboarding 이 없다 — §3-4 */
export interface WorkspaceSummary {
  id: string
  name: string
  role: Role
  createdAt: string
}

export interface Workspace extends WorkspaceSummary {
  onboarding: OnboardingProgress
}
```

- 단계 순서는 `create_workspace → connect_discord → connect_notion → connect_members` 로 고정이다 (D-008).
- `skipped` 는 재개 대상에서 제외한다 (D-012). `currentStep` 은 서버가 계산해 준다. 프론트엔드가 다시 계산하지 않는다.
- 생성 요청 본문은 `{name}` 하나다. 이미 그렇게 구현돼 있다 (D-014, D-153, 계약 §2.1).

### 6-3. `member` — 계약 §2.2(구현됨) + §4.5(Discord 목록은 요청 중)

```ts
// entities/member/model/types.ts
import type { Role } from '@/shared/types/common'

export interface Member {
  id: string
  workspaceId: string
  displayName: string
  discordUserId: string | null
  notionName: string | null
  role: Role
  createdAt: string
}

export type AliasType = 'realname' | 'nickname' | 'mention' | 'inferred'
export type AliasSource = 'manual' | 'discord_profile' | 'learned'

export interface MemberAlias {
  id: string; memberId: string; workspaceId: string
  text: string; type: AliasType; source: AliasSource
  confidence: number; verified: boolean; createdAt: string
}

/** 회의에서 나왔지만 팀원과 연결되지 않은 이름 (계약 §2.2) */
export interface UnresolvedAlias { text: string; occurrences: number; lastSeenAt: string }

/** Discord 서버의 사용자. member 가 아니다 (계약 §4.5) */
export interface DiscordUser {
  discordUserId: string; username: string
  displayName: string | null; avatarUrl: string | null; isBot: boolean
}
```

- `lib/linkDiscordUsers.ts` — 온보딩 팀원 연결 화면의 조립(계약 §5.3)을 **순수 함수로** 만든다.

```ts
export type MemberLinkKind = 'linked' | 'unlinked' | 'inactive'
export interface MemberLink {
  kind: MemberLinkKind
  discordUser: DiscordUser | null   // inactive 면 null
  member: Member | null             // unlinked 면 null
  label: string                     // 연결됨이면 팀원 이름, 아니면 username (D-028)
}
export function linkDiscordUsers(discordUsers: DiscordUser[], members: Member[]): MemberLink[]
```

- `isBot: true` 는 결과에서 **제외한다** (계약 §4.5).
- `members` 에만 있고 Discord 목록에 없는 팀원은 `inactive` 다. 서버를 나간 사람이며 행은 남는다 (D-031).
- `discordUserId` 가 `null` 인 팀원은 애초에 연결된 적이 없다. `inactive` 로 세지 않고 결과에서 뺀다.
- **`unresolved-aliases` 는 이 화면이 아니다.** 워크스페이스 설정의 보조 화면이다 (계약 §4.5, §5.8).

### 6-4. `meeting` — 계약 §2.3(구현됨) + §4.4(목록·업로드는 요청 중)

```ts
export type MeetingStatus = 'created' | 'recording' | 'processing' | 'done' | 'failed'
export type MeetingSource = 'discord' | 'manual_upload'

/** 목록 항목 (계약 §4.4) */
export interface MeetingSummary {
  id: string; title: string; status: MeetingStatus; source: MeetingSource
  startedAt: string; durationMs: number | null
  attendeeCount: number; processedAt: string | null
}

/** 단건 조회 (계약 §2.3). 폴링이 이 타입을 쓴다 */
export interface Meeting {
  id: string; workspaceId: string; title: string
  status: MeetingStatus; startedAt: string; endedAt: string | null
  extractionId: string | null      // status === 'done' 일 때만 채워진다
  failedStage: string | null
  progress: MeetingProgress | null // §4.7-1 반영됨(PR #59). null 은 방어로만 남긴다
}

export interface MeetingProgress { audioMerged: boolean; transcribed: boolean; extracted: boolean }
```

- **목록과 단건의 필드가 다르다.** 매퍼도 `toMeetingSummary` / `toMeeting` 둘이다. 하나로 합치면 없는 필드를 `null` 로 채우게 되고 화면이 어느 쪽인지 모른다.
- 단건 DTO의 `title` 은 실제 `MeetingDetailResponse`처럼 `string | null` 이다. 매퍼는 `null` 제목을 빈 문자열로 내려 도메인의 문자열 계약을 지킨다.
- 목록은 `started_at` 내림차순이고 **실패한 회의는 들어 있지 않다** (D-093, D-106).
- ~~`progress` 는 백엔드가 응답에서 빼 놓은 상태다~~ **2026-09-21: PR #59 가 §4.7-1 을 반영했다.**
  `MeetingDetailResponse.progress` 는 이제 **필수** 필드다. 그래도 **DTO 는 좁히지 않는다** (§4-1 의 원칙).
  Zod 를 쓰지 않아 런타임 검증이 없으므로(D-134), 필수로 선언해 두면 서버가 한 번 빠뜨렸을 때 `dto.progress.audio_merged` 가 그 자리에서 터진다.
  `progress?: … | null` 을 유지하고 매퍼의 `null` 분기를 **방어로 남긴다.** 진행률 UI 는 M5 에서 `status` 만으로도 그려지게 만든다.

### 6-5. `minutes` — 계약 §4.4 (요청 중)

```ts
export interface MinutesAttendee { memberId: string; displayName: string }

export interface TranscriptLine {
  atMs: number
  speakerMemberId: string | null
  speakerName: string      // 폴백 적용 완료 (§5-3)
  isFallbackName: boolean
  text: string
}

export interface MinutesSummary { overview: string; keyPoints: string[]; decisions: string[] }

export interface Minutes {
  meetingId: string; title: string; startedAt: string
  durationMs: number; source: MeetingSource
  attendees: MinutesAttendee[]
  summary: MinutesSummary
  transcript: TranscriptLine[]
  canReview: boolean   // permissions.can_review — 일반 팀원은 false (D-104)
  canUndo: boolean
}
```

- `MeetingSource` 를 `entities/meeting` 에서 import 하면 **§3-2 위반이다.** `shared/types/common.ts` 에 두고 둘이 같이 쓴다.
- **반영된 태스크와 확인 필요 항목은 여기 없다.** `extraction` 에서 온다 (계약 §4.4, §5.5).

### 6-6. `extraction` — 계약 §2.4 (구현됨) · §3-3 의 9번째 엔티티

```ts
export type ExtractionGate = 'auto' | 'review' | 'hold'

export interface ExtractionEvidence { quote: string | null; speaker: string | null; atMs: number | null }

export interface ExtractionItem {
  id: string
  title: string
  confidence: number
  gate: ExtractionGate
  assigneeMemberId: string | null
  assigneeLabel: string          // member 이름이 없으면 raw, 둘 다 null이면 빈 문자열 (D-161)
  dueDate: string | null
  dueRaw: string | null
  evidence: ExtractionEvidence
  // 생성 시점에는 gate 'auto' 면 appliedTaskId, 'review'|'hold' 면 approvalId 하나만 채워진다.
  // 승인 뒤에는 둘 다 채워진다 — 백엔드가 task_id 를 넣으면서 approval_id 도 gate 도 그대로 둔다.
  // 그래서 gate 로 어느 쪽이 채워졌는지 추론하면 안 된다 (계약 §3.1, §4.0-②-12)
  appliedTaskId: string | null
  approvalId: string | null
}

export interface Extraction { id: string; meetingId: string; items: ExtractionItem[] }
```

- **픽스처에서는 `appliedTaskId` 와 `approvalId` 가 배타적이다** (계약 §2.4). 둘 다 채워졌거나 둘 다 비었으면 픽스처가 틀린 것이다.
  **단 승인을 반영한 뒤에는 배타적이지 않다.** 백엔드가 `task_id` 를 채우면서 `approval_id` 를 비우지 않는다 (계약 §3.1, §4.0-②-12).
  MSW 도 같은 모양을 낸다. 화면은 `task_id` 를 우선으로 읽는다.
- `ExtractionEvidence` 는 승인도 쓰므로 `shared/types/common.ts` 에 둔다. 실제 `EvidenceInfo` 응답은 객체 내부 세 필드를 `null` 로 허용한다(`backend/app/schemas/meeting.py`). 빈 근거를 발명하지 않고 그대로 보존한다.
- `lib/extractionView.ts`
  ```ts
  export function appliedItems(extraction: Extraction): ExtractionItem[]   // appliedTaskId !== null

  /** 태스크가 없고 승인이 걸려 있다. 대기인지 반려인지는 extraction 만으로 알 수 없다 */
  export function isUnresolved(item: ExtractionItem): boolean

  /** 확인 필요 — PM 전용. GET /approvals?status=pending 의 ID 집합과 조인해야 정확하다 */
  export function pendingItems(extraction: Extraction, openApprovalIds: ReadonlySet<string>): ExtractionItem[]

  /** 일반 팀원에게는 확인 필요 항목의 존재 자체를 숨긴다 (D-104) */
  export function visibleItems(extraction: Extraction, canReview: boolean): ExtractionItem[]
  ```
  `canReview` 가 `false` 면 `isUnresolved` 인 항목을 **개수에서도** 뺀다. 조인이 필요 없다 — 대기든 반려든 숨기는 것이 맞고,
  D-163 대로 일반 팀원은 승인 목록을 부르지 않는다.

  **`pendingItems` 만 인자가 하나 더 있는 이유.** 백엔드가 승인·반려 어느 쪽으로 닫혀도 `extraction_item.approval_id` 를
  비우지 않는다(계약 §4.0-②-12). 특히 **반려는 `extraction_item` 을 아예 건드리지 않아** 대기 중인 항목과 응답이 완전히 같다.
  그래서 `확인 필요` 는 extraction 단독으로 판정할 수 없고, 열려 있는 승인 목록과 조인해야 한다.
  `entities → entities` 를 피하려고 `Approval` 타입이 아니라 `ReadonlySet<string>` 만 받는다 (§3-2 의 규칙 1과 같다).

### 6-7. `approval` — 계약 §2.5 (구현됨). `확인 필요` 의 데이터 출처

**태스크가 아니다.** 승인 전에는 태스크 행이 존재하지 않으며 식별자는 `approvalId` 뿐이다 (D-161, D-162, 계약 §3.1).

```ts
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type ApprovalMissing = 'assignee' | 'due'

interface ApprovalBase {
  id: string; workspaceId: string; status: ApprovalStatus
  relatedTaskId: string | null       // 승인 후에만 채워진다
  requestedBy: string | null; resolvedBy: string | null
  createdAt: string; resolvedAt: string | null
}

export interface TaskCreateApproval extends ApprovalBase {
  kind: 'task_create'
  title: string                      // payload.task_title
  assigneeMemberId: string | null
  assigneeRaw: string | null
  dueDate: string | null
  dueRaw: string | null
  missing: ApprovalMissing[]         // §5-3 에서 파생
  evidence: ExtractionEvidence
  meetingId: string | null
  extractionItemId: string | null
  gate: 'review' | 'hold' | null
}

export interface TaskUpdateApproval extends ApprovalBase {
  kind: 'task_update'
  title: string | null
  changes: { field: string; value: unknown }[]   // payload 에 존재하는 키만
}

/** 모르는 type. 화면이 건너뛴다 (§5-4) */
export interface UnsupportedApproval extends ApprovalBase { kind: 'unsupported'; type: string }

export type Approval = TaskCreateApproval | TaskUpdateApproval | UnsupportedApproval
```

- payload 키 11개는 **가정이 아니라 사실이다** (계약 §2.5). `task_title` 이며 `task` 가 아니다.
- `reminder_dm` 은 태스크에 반영되지 않는다. `unsupported` 로 떨어뜨린다.
- 목록은 `created_at` **내림차순**으로 오는데, 화면은 **대기 오래된 순**(D-050)이다. `lib/sortByWaiting.ts` 로 뒤집는다. 서버 정렬을 바꿔 달라고 요청하지 않는다 (D-160).
- `payload` 가 예상 키를 빠뜨리면 던지지 말고 그 필드만 `null` 로 둔다. `title` 이 없으면 `payload.title` 을 본 뒤에도 없을 때만 빈 문자열로 둔다 (계약 §2.5 의 `_apply_approval` 이 같은 순서로 읽는다).

### 6-8. `task` — 계약 §2.6 (구현됨)

```ts
import type { Role } from '@/shared/types/common'

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'

export interface Task {
  id: string; workspaceId: string; meetingId: string | null
  title: string
  assigneeMemberId: string | null
  status: TaskStatus
  progress: number | null
  blocker: string | null
  dueDate: string | null
  startDate: string          // start_date 가 null 이면 폴백으로 채운다 (계약 §4.8-5)
  notionPageId: string | null
  isSyncedToNotion: boolean  // 계약 §4.8-1
  createdAt: string; updatedAt: string
}

export type TaskTab = 'all' | 'needs_review' | 'in_progress' | 'done'

export interface TaskHistoryEntry {
  id: string; taskId: string
  // start_date 는 PR #59 가 ChangedField 에 추가했다 (계약 §2.6, §4.7-6)
  field: 'assignee' | 'start_date' | 'due_date' | 'status' | 'title' | 'progress' | 'blocker'
  oldValue: string | null; newValue: string | null
  source: 'meeting' | 'chat' | 'checkin' | 'notion' | 'reminder_reply' | 'manual'
  changedBy: string | null
  isAuto: boolean; isRolledBack: boolean; rolledBackAt: string | null
  createdAt: string
}
```

- **`status` 질의 파라미터를 쓰지 않는다.** 단일 값만 받으므로 `진행 중` 탭을 서버에서 거를 수 없다. 페이지네이션이 없으니 전량을 받아 클라이언트에서 거른다 (D-166, 계약 §3.2).
- `lib/taskFilter.ts`
  ```ts
  /** 완료가 아닌 태스크는 전부 '진행 중' 이다 (계약 §3.2, §4.8-4) */
  export function filterByTab(tasks: Task[], tab: Exclude<TaskTab, 'needs_review' | 'all'>): Task[]
  ```
  `needs_review` 는 태스크가 아니라 `approval` 이므로 이 함수가 다루지 않는다. 병합은 화면 계층의 일이다 (§3-2).
  **보드의 컬럼도 같은 함수를 쓴다** (D-169).
- `lib/taskDate.ts`
  ```ts
  export function isOverdue(task: Task, today: string): boolean   // status !== 'done' && dueDate < today
  export function isDueSoon(task: Task, today: string, until: string): boolean
  ```
  `until`(오늘+6일)은 호출자가 넘긴다. M1 에 날짜 덧셈을 들이지 않기 위해서다 (§5-2).
- `lib/assignee.ts` — §3-2 의 시그니처.
- 되돌리기는 `POST /tasks/{id}/history/{history_id}/rollback` 이며 **이미 구현돼 있다.** 응답은 갱신된 `TaskResponse` 다.

**2026-09-22 — PR #55 가 태스크 쓰기 경로의 의미를 셋 바꿨다. MSW 를 거기에 맞췄다.**

| | 이전 | 지금 |
|---|---|---|
| `PATCH` 의 명시적 `null` | **무시**했다 (`exclude_none=True`) | **필드를 해제한다.** 백엔드가 그 옵션을 뺐다 |
| `title`·`status` 에 `null` | 무시 | **400 `INVALID_REQUEST`.** DB 가 NOT NULL 이다 |
| 되돌리기 | 이미 되돌린 건만 거절 | **충돌 감지가 붙었다.** 그 이력 이후에 다른 변경이 있으면 400 |

- **화면은 보내지 않을 필드를 `undefined` 로 빼야 한다.** 부분 갱신에 `null` 이 섞이면 값이 지워진다.
  `JSON.stringify` 가 `undefined` 키를 지우는 동작에 기대는 것이 안전하다.
- 최초 생성 이력(`old_value` 가 `null` 인 `title`·`status`)은 되돌릴 수 없다. **400 이다** — 예전 MSW 는 500 을 냈는데 그게 틀렸다.
- 충돌은 「최신 이력부터 되돌려라」는 뜻이다. 화면은 이력 목록에서 **가장 위 항목만** 되돌리기 버튼을 열어 두는 편이 낫다.
- `start_date` 도 이력과 되돌리기 대상이다 (계약 §4.7-6).
  다만 **승인(`task_update`) 반영 경로는 `start_date` 를 받지 않는다.** 백엔드 `_TASK_UPDATE_FIELDS` 에 없다.
  `shared/mock/task-state.ts` 가 `taskFields` 와 `approvalTaskUpdateFields` 두 목록을 따로 두는 이유가 이것이다.

### 6-9. `integration` — 계약 §4.3 (요청 중)

```ts
export type IntegrationProvider = 'discord' | 'notion'
export type IntegrationStatus = 'not_connected' | 'connected' | 'revoked'

export interface Integration {
  provider: IntegrationProvider
  status: IntegrationStatus
  displayName: string | null
  connectedAt: string | null
}

export interface Integrations { discord: Integration; notion: Integration }
```

- **`not_connected` 와 `revoked` 를 합치지 않는다.** 미연결은 `Notion 연결이 필요해요`(D-097), 끊김은 `Notion 연결이 끊어졌어요`(D-100) 로 다른 모달을 띄운다. 매퍼가 둘을 하나로 뭉개면 화면이 구분할 방법이 사라진다.
- DTO 는 `{discord: {...}, notion: {...}}` 로 `provider` 키가 없다. 매퍼가 채워 넣는다.

---

## 7. 파생 규칙이 어디에 사는가

계약 §6 이 "변환 계층이 반드시 해야 할 일" 7가지를 적었다. 각각의 위치를 확정한다.

| 규칙 | 위치 | M1 에서 만드나 |
|---|---|---|
| 담당자 이름 조인 | `entities/task/lib/assignee.ts` (`Map` 을 인자로) | **만든다** |
| `overdue` 계산 | `entities/task/lib/taskDate.ts` | **만든다** |
| 보완 사유 파생 | `entities/approval/model/mapper.ts` | **만든다** |
| 화자 이름 대체 | `entities/minutes/model/mapper.ts` | **만든다** |
| 추출 담당자 대체 | `entities/extraction/model/mapper.ts` | **만든다** |
| 시작일 폴백 | `entities/task/model/mapper.ts` | **만든다** |
| 탭·컬럼 필터링 | `entities/task/lib/taskFilter.ts` | **만든다** |
| 대시보드 상단 숫자 4개 | `widgets/` (M7) | 아니다 — §9-7 의 숫자만 픽스처로 보장한다 |
| 확인 필요 + 태스크 병합(`전체` 탭) | `widgets/` (M4~M6) | 아니다 |
| Discord 사용자 조인 | `entities/member/lib/linkDiscordUsers.ts` | **만든다** (한 엔티티 안이라 §3-2 위반이 아니다) |

**파생 함수는 전부 순수 함수다.** 인자로 받은 것만 쓰고, `new Date()` 를 읽지 않고, 네트워크를 모른다. 테스트가 붙는 곳이 여기다.

---

## 8. MSW

### 8-1. 설치

```bash
cd frontend
npm i -D msw
npx msw init public/ --save
```

- `public/` 이 없으므로 이 명령이 만든다. `public/mockServiceWorker.js` 는 **커밋한다.**
- `--save` 가 `package.json` 에 `"msw": {"workerDirectory": ["public"]}` 를 적는다.
- `.gitignore` 에 `public/mockServiceWorker.js` 가 들어가지 않도록 확인한다.

### 8-2. 부트스트랩

**브라우저** — production 번들에서 빠져야 하므로 **동적 import 만 쓴다** (D-146).

```ts
// src/main.tsx — 기존 파일을 고친다
async function enableMocking(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_MSW !== 'true') return
  const { worker } = await import('@/shared/mock/browser')
  await worker.start({ onUnhandledRequest: 'warn' })
}

void enableMocking().finally(() => {
  createRoot(root).render(/* ... */)
})
```

- `import.meta.env.DEV` 가 **정적으로 false** 가 되어 Vite 가 이 import 를 통째로 떨군다. 조건을 변수로 빼면 안 떨어진다.
- `src/vite-env.d.ts` 에 환경 변수 타입을 추가한다. 없으면 `VITE_ENABLE_MSW` 가 `any` 로 새고 lint 가 막는다.
  ```ts
  /// <reference types="vite/client" />
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string
    readonly VITE_ENABLE_MSW: string
  }
  interface ImportMeta { readonly env: ImportMetaEnv }
  ```

**테스트** — `src/shared/test/setup.ts` 에 붙인다.

```ts
import '@testing-library/jest-dom/vitest'
import { server } from '@/shared/mock/server'
import { resetDb } from '@/shared/mock/db'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDb()          // ← 이걸 빼먹으면 테스트 순서에 따라 결과가 달라진다 (§8-4)
})
afterAll(() => server.close())
```

`shared/ui` 테스트도 이 setup 을 공유한다. 요청을 보내지 않으므로 `onUnhandledRequest: 'error'` 에 걸리지 않고, 파일을 나누면 두 setup 을 관리해야 한다.

### 8-3. 봉투 헬퍼

```ts
// src/shared/mock/envelope.ts
import { HttpResponse } from 'msw'

export function ok<T>(data: T, init?: ResponseInit) {
  return HttpResponse.json({ data, error: null }, init)
}

export function list<T>(items: T[], init?: ResponseInit) {
  return ok({ items, total: items.length }, init)
}

export function fail(code: string, message: string, status: number, details?: Record<string, unknown>) {
  return HttpResponse.json({ data: null, error: { code, message, details: details ?? null } }, { status })
}
```

- **`total` 은 배열 길이다.** 필터를 적용한 뒤 세어야 화면의 숫자와 맞는다 (계약 §4.6).
- `error.message` 는 **한국어**다. 토스트에 그대로 쓰인다 (계약 §1).

### 8-4. 상태를 가진 handler — 메모리 DB

승인하면 태스크가 생긴다(계약 §3.1). 이걸 mock 이 재현하지 못하면 M6 의 핵심 흐름을 테스트할 수 없다.

- `fixtures/*.ts` 는 **불변 상수**다. 절대 수정하지 않는다.
- `db.ts` 가 픽스처를 **깊은 복사**해 들고 있고, handler 는 `db` 만 읽고 쓴다.
- `resetDb()` 가 픽스처에서 다시 복사한다. `server.resetHandlers()` 는 handler 만 되돌리고 **데이터는 되돌리지 않는다.**

```ts
// src/shared/mock/db.ts
import { taskFixtures, approvalFixtures /* ... */ } from './fixtures'

interface MockDb { tasks: TaskDto[]; approvals: ApprovalDto[]; /* ... */ }

function seed(): MockDb {
  return structuredClone({ tasks: taskFixtures, approvals: approvalFixtures /* ... */ })
}

export let db: MockDb = seed()
export function resetDb(): void { db = seed() }
```

**`PATCH /approvals/{id}` 가 반드시 해야 할 일** (계약 §3.1):

1. 이미 `pending` 이 아니면 409 `APPROVAL_ALREADY_RESOLVED`.
2. `status: 'approved'` 면 payload 로 태스크를 만들어 `db.tasks` 에 넣고, 승인의 `related_task_id` 를 채운다.
3. `status: 'rejected'` 면 태스크를 만들지 않고 승인만 닫는다.
4. `resolved_at` 을 채운다.

새 태스크의 `task_id` 는 `tk_90`, `tk_91` … 처럼 **픽스처와 겹치지 않는 고정 접두어**로 만든다. `Math.random()`·`Date.now()` 를 쓰지 않는다. 테스트가 값을 단언할 수 있어야 한다.

### 8-5. handler 작성 규칙

```ts
// src/shared/mock/handlers/tasks.ts
import { http } from 'msw'
import { db } from '../db'
import { list, ok, fail } from '../envelope'

export const taskHandlers = [
  http.get('/api/v1/tasks', ({ request }) => {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get('workspace_id')
    if (!workspaceId) return fail('INVALID_REQUEST', '워크스페이스가 필요합니다.', 400)
    // status·assignee_member_id·due_before·due_after 를 계약 §2.6 대로 지원한다
    return list(db.tasks.filter((t) => t.workspace_id === workspaceId))
  }),
]
```

- **경로는 상대 경로(`/api/v1/...`)로 쓴다.** dev proxy 와 테스트가 같은 경로를 쓴다.
- 질의 파라미터를 **계약대로 전부 지원한다.** 화면이 안 쓰더라도 `due_before`·`due_after` 는 구현한다 (캘린더가 M8 에서 쓴다).
- 정렬도 계약대로 고정한다 — 태스크는 `due_date` 오름차순·`created_at` 내림차순, 승인과 회의는 `created_at`·`started_at` 내림차순. 현재 백엔드 SQLite의 오름차순 정렬처럼 `due_date: null` 은 먼저 온다.
- **정상 응답이 기본이다.** 오류·빈 상태·느린 응답은 handler 에 넣지 않고 override 로 만든다.
- **인위적 지연을 넣지 않는다** (D-146). `delay()` 는 테스트에 쓰지 않는다.

### 8-6. override

```ts
import { server } from '@/shared/mock/server'
import { http } from 'msw'
import { fail } from '@/shared/mock/envelope'

it('온보딩이 끝나지 않은 워크스페이스는 403 을 받는다', async () => {
  server.use(
    http.get('/api/v1/workspaces/:id', () =>
      fail('ONBOARDING_INCOMPLETE', '온보딩을 마쳐야 합니다.', 403, { current_step: 'connect_notion' }),
    ),
  )
  // ...
})
```

`afterEach` 의 `server.resetHandlers()` 가 원래대로 돌린다. **override 를 `handlers/` 에 상수로 만들어 두지 않는다.** 쓰는 자리에서 쓴다.

### 8-7. mock 하지 않는 것

| 대상 | 이유 |
|---|---|
| `GET /auth/google/start`, `/integrations/{provider}/start`·`/callback` | 302 로 현재 탭을 이동시키는 경로다 (D-158). 브라우저 네비게이션이라 worker 가 가로채도 의미가 없다. M4 에서 개발용 스텁 경로로 다룬다 |
| `POST /extractions`, `POST /approvals` | **AI → BE** 경로다. 프론트엔드가 호출하지 않는다 (계약 §2.4, §2.5) |
| 메시지 관련 전부 | 1차에서 화면을 만들지 않는다 (D-171) |

### 8-8. 업로드(multipart)는 202 까지만

`POST /workspaces/{id}/meetings/upload` handler 는 `await request.formData()` 로 `file`·`title`·`started_at`·`attendee_member_ids` 를 확인하고 **202 `{meeting_id, status: 'processing'}`** 를 준다.

- **업로드 진행률은 mock 하지 않는다.** `fetch` 로는 업로드 진행률을 읽을 수 없다. 진행률은 XHR 이 필요하고 M3 에서 axios 가 들어올 때 다룬다.
- 처리 진행률은 별개다. `GET /meetings/{id}` 폴링이며 `status` 와 `progress` 를 본다 (계약 §4.7-1 — **반영됨**).
- 워크스페이스에 `processing` 인 회의가 이미 있으면 409 `MEETING_PROCESSING_IN_PROGRESS` + `details.meeting_id` (D-088, D-089). **픽스처에 `processing` 회의가 하나 있으므로**(§9-5) 기본 상태에서 이 경로가 바로 밟힌다. 정상 업로드를 테스트하려면 그 회의를 먼저 `done` 으로 바꾸거나 override 한다.

---

## 9. 픽스처

### 9-1. 기준일을 고정한다

**픽스처의 오늘은 `2026-09-18` 이다.** 상대 날짜를 만들지 않는다.

```ts
// src/shared/mock/fixtures/constants.ts
export const MOCK_TODAY = '2026-09-18'
export const MOCK_NOW = '2026-09-18T09:00:00+09:00'
```

날짜에 의존하는 테스트는 시스템 시간을 고정한다.

```ts
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(MOCK_NOW)) })
afterEach(() => { vi.useRealTimers() })
```

### 9-2. 워크스페이스 · 사용자

| id | name | role | 온보딩 |
|---|---|---|---|
| `ws_01` | 카테캠 3팀 | `pm` | 완료 (4단계 모두 `completed`) |
| `ws_02` | 사이드 프로젝트 | `member` | 미완 — `connect_discord: skipped`, `connect_notion: pending`, `currentStep: 'connect_notion'` |

사용자 `us_01` 최진호 · `pm@example.com` · `workspace_count: 2` · `last_workspace_id: 'ws_01'`
→ 로그인 후 이동이 `workspace-select` 로 떨어진다 (D-010). 세 분기를 다 보려면 `workspace_count` 를 override 한다.

**`ws_02` 는 스코프 테스트용이다.** 태스크·승인·회의 픽스처는 전부 `ws_01` 소속이며, `ws_02` 로 조회하면 빈 목록이 와야 한다.

### 9-3. 팀원과 Discord 사용자

| member | 이름 | role | `discord_user_id` |
|---|---|---|---|
| `mb_01` | 김서연 | `pm` | `1123` |
| `mb_02` | 박민수 | `member` | `1124` |
| `mb_03` | 이재환 | `member` | `null` |
| `mb_04` | 정하늘 | `member` | `1126` |

`GET /workspaces/ws_01/discord/members`

| `discord_user_id` | username | display_name | is_bot |
|---|---|---|---|
| `1123` | `seoyeon_01` | 서연 | false |
| `1124` | `minsu` | `null` | false |
| `1125` | `jihun_dev` | 지훈 | false |
| `1199` | `manager_bot` | 매니저봇 | **true** |

이 조합이 `linkDiscordUsers` 의 네 경로를 한 번에 덮는다.

- `linked` — `1123`·`1124`
- `unlinked` — `1125` (Discord 에는 있고 팀원이 없다)
- `inactive` — `mb_04`(`1126`, 서버를 나갔다)
- 제외 — `1199`(봇), `mb_03`(연결된 적 없음)

별칭: `al_01` = `mb_01` ← `서연`(`nickname`, `manual`, verified).
미매칭 이름: `{text: '지훈', occurrences: 3, last_seen_at: '2026-09-15T06:00:00Z'}`.

### 9-4. 태스크 10건 — `ws_01`

`status` 가 `done` 이 아닌 것이 7건, `done` 이 3건이다. 확인 필요 3건(§9-5)과 합해 **`전체 13 = 3 + 7 + 3`** 이 된다 (계약 §7).

| id | 제목 | 담당 | status | due_date | start_date | 비고 |
|---|---|---|---|---|---|---|
| `tk_01` | 로그인 API 연동 | `mb_01` | `in_progress` | `2026-09-20` | `2026-09-15` | `progress: 40`, `notion_page_id` 있음 |
| `tk_02` | 회원가입 화면 | `mb_02` | `todo` | `2026-09-16` | **`null`** | 기한 지남 · 시작일 폴백 경로 |
| `tk_03` | DB 스키마 정리 | `mb_03` | **`blocked`** | `2026-09-22` | `2026-09-16` | `blocker: 'Notion 권한 대기'` |
| `tk_04` | 배포 스크립트 | `mb_01` | `in_progress` | `2026-09-24` | `2026-09-17` | 7일 경계(오늘+6) |
| `tk_05` | 회의록 요약 검수 | `mb_02` | `todo` | **`null`** | `null` | 마감 없음 |
| `tk_06` | STT 정확도 측정 | `mb_04` | `in_progress` | `2026-09-19` | `2026-09-16` | |
| `tk_07` | 온보딩 문구 수정 | **`null`** | `todo` | `2026-09-10` | `null` | 담당자 없음 + 기한 지남 |
| `tk_08` | 랜딩 카피 | `mb_03` | `done` | `2026-09-12` | `2026-09-08` | |
| `tk_09` | 폰트 적용 | `mb_01` | `done` | `2026-09-14` | `null` | `notion_page_id` 있음 |
| `tk_10` | 토큰 정리 | `mb_02` | `done` | `2026-09-17` | `2026-09-12` | |

- `start_date` 는 **일부만 채운다.** `null` 인 항목이 있어야 §4.8-5 의 폴백이 테스트된다 (계약 §7).
  `start_date` 가 `null` 인 태스크의 `created_at` 은 해당 `due_date` 보다 앞선 날짜로 둔다.
  **§4.7-6 이 반영된 뒤에도 이 지침은 그대로다.** 컬럼이 방금 생겨 실제 DB 의 기존 행이 전부 `null` 이라 이쪽이 오히려 흔한 경우다.
- `blocked` 는 최소 1건 — `tk_03` (계약 §7, D-169).
- `meeting_id` 는 `tk_01`·`tk_02`·`tk_03` 이 `mt_09`, 나머지는 `null`.

이력: `tk_01` 에 2건 — `due_date` 변경(`is_auto: true`, `source: 'meeting'`), `status` 변경(`manual`). 둘 다 `is_rolled_back: false` 라 되돌리기 경로가 열려 있다.

### 9-5. 승인 3건 — 전부 `pending`

| id | gate | 담당 | 마감 | `missing` |
|---|---|---|---|---|
| `ap_01` | `hold` | `null` (`assignee_raw: '민수'`) | `null` (`due_raw: '다음 주 월요일'`) | `['assignee', 'due']` |
| `ap_02` | `review` | `mb_02` | `null` | `['due']` |
| `ap_03` | `review` | `null` (`assignee_raw: '지훈'`) | `2026-09-25` | `['assignee']` |

- payload 는 계약 §2.5 의 **11개 키를 그대로** 쓴다. `task_title` 이며 `task` 가 아니다.
- `created_at` — `ap_01` `2026-09-15T06:00:00Z` · `ap_02` `2026-09-15T06:01:00Z` · `ap_03` `2026-09-17T02:00:00Z`.
  **응답은 내림차순(`ap_03`, `ap_02`, `ap_01`)이고 화면은 오름차순으로 뒤집는다** (D-050). 이 순서 차이를 테스트한다.
- `related_task_id` 는 전부 `null`. 승인 전에는 태스크가 없다 (계약 §3.1).

### 9-6. 회의 · 추출 · 회의록

| id | title | source | status | started_at |
|---|---|---|---|---|
| `mt_07` | 2주차 정기회의 | `discord` | `done` | `2026-09-08T05:00:00Z` |
| `mt_09` | 3주차 정기회의 | `discord` | `done` | `2026-09-15T05:00:00Z` |
| `mt_10` | 기획 논의 녹음 | `manual_upload` | **`processing`** | `2026-09-18T00:30:00Z` |

- `extraction_id` 는 `done` 인 회의에만 있다 — `mt_07 → ex_00`, `mt_09 → ex_01`, `mt_10 → null` (계약 §7).
- `mt_10` 때문에 업로드 409 경로가 기본 상태에서 밟힌다 (§8-8).
- 실패한 회의는 **목록에 넣지 않는다** (D-093). 실패 경로가 필요하면 override 로 만든다.

`ex_01` 의 항목 6개 — **`gate` 와 식별자의 짝이 맞아야 한다** (계약 §3.1, §7).

| item | gate | `task_id` | `approval_id` |
|---|---|---|---|
| `it_01` | `auto` | `tk_01` | `null` |
| `it_02` | `auto` | `tk_02` | `null` |
| `it_03` | `auto` | `tk_03` | `null` |
| `it_04` | `hold` | `null` | `ap_01` |
| `it_05` | `review` | `null` | `ap_02` |
| `it_06` | `review` | `null` | `ap_03` |

`confidence` 는 게이트와 맞춘다 — `auto` 는 0.8 이상, `review` 는 0.5 이상 0.8 미만, `hold` 는 0.5 미만 (계약 §2.4).

`mt_09` 의 회의록: 참석자 4명(`mb_01`~`mb_04`), 요약 3블록, 전사문 5줄.
**5줄 중 1줄은 `speaker_display_name: null` + `speaker_fallback: 'jihun_dev'`** 로 둔다. 폴백 경로가 테스트된다 (D-028).
`permissions` 는 `{can_review: true, can_undo: true}` (PM 기준). 일반 팀원 화면은 override 로 `false` 를 준다 (D-104).

### 9-7. 이 픽스처가 만드는 숫자

대시보드(M7)가 이 숫자를 쓴다. **M1 에서 집계를 구현하지는 않지만, 픽스처는 이 숫자가 나오도록 고정한다.** 계산식은 계약 §5.4 다.

| 항목 | 값 | 근거 |
|---|---|---|
| 확인 대기 | **3** | `ap_01`~`ap_03` |
| 기한 지남 | **2** | `tk_02`(09-16) · `tk_07`(09-10) |
| 7일 이내 마감 | **4** | `tk_06`(19) · `tk_01`(20) · `tk_03`(22) · `tk_04`(24) — 오늘+6 = `2026-09-24` 포함 |
| 막힌 일 | **1** | `tk_03` |
| 마감 임박 목록(5개) | `tk_07` → `tk_02` → `tk_06` → `tk_01` → `tk_03` | 지난 것 먼저, 그다음 가까운 순 (D-044, D-045) |
| 최근 반영 | `mt_09` 의 `auto` 3건 = `tk_01`·`tk_02`·`tk_03` | D-038, 계약 §5.4 |

`기한 지남` 과 `7일 이내 마감` 은 겹치지 않는다 (D-054). 합이 6이고 `tk_05`(마감 없음)와 완료 3건이 빠진다.

### 9-8. 참고 자료

`docs/design/site-runtime/runtime.js` 의 시드 데이터를 **값의 톤을 맞추는 참고 자료**로만 본다. 마크업은 쓰지 않는다. 위 표와 어긋나면 위 표가 맞다.

---

## 10. 엔드포인트 커버리지

전부 handler 가 있어야 한다. `구현됨`·`요청 중` 은 실제 백엔드 기준이고, **mock 은 둘을 구분하지 않는다.**

| # | Method · Path | 상태 | 비고 |
|---|---|---|---|
| 1 | `POST /api/v1/auth/signup` | 구현됨 | 201 · 409 `EMAIL_ALREADY_EXISTS` 경로 포함 |
| 2 | `POST /api/v1/auth/login` | 구현됨 | 401 `INVALID_CREDENTIALS` 경로 포함 |
| 3 | `POST /api/v1/auth/logout` | 구현됨 |  |
| 4 | `GET /api/v1/auth/me` | 구현됨 | 미인증이면 401 `UNAUTHENTICATED` (override) |
| 5 | `POST /api/v1/workspaces` | 구현됨 | 본문 `{name}` 하나 |
| 6 | `GET /api/v1/workspaces` | 구현됨 | 사용자 소속만 · `role` 포함 |
| 7 | `GET /api/v1/workspaces/{id}` | 구현됨 + 증분 | `role` · `onboarding` 포함 |
| 8 | `PATCH /api/v1/workspaces/{id}/onboarding` | 구현됨(스텁) | `{step, action}` · 실 API 는 `skip` 이 동작하지 않는다 |
| 9 | `GET /api/v1/workspaces/{id}/integrations` | 구현됨 | 실 API 는 `revoked` 를 내지 않는다 (계약 §4.0) |
| 10 | `DELETE /api/v1/workspaces/{id}/integrations/{provider}` | 구현됨 | 실 API 는 204 무본문이라 봉투가 아니다 |
| 11 | `GET /api/v1/workspaces/{id}/discord/members` | 구현됨(스텁) | 실 API 는 하드코딩 2명 |
| 12 | `GET /api/v1/workspaces/{id}/meetings` | 구현됨 | 실패 회의 제외 |
| 13 | `POST /api/v1/workspaces/{id}/meetings/upload` | 구현됨(스텁) | multipart · 202 (§8-8) · 실 API 는 파일·참석자를 저장하지 않는다 |
| 14 | `GET /api/v1/meetings/{id}` | 구현됨 | 폴링 대상 |
| 15 | `POST /api/v1/meetings` | 구현됨 | 봇 경로. 프론트엔드는 안 쓰지만 계약에 있으므로 둔다 |
| 16 | `PATCH /api/v1/meetings/{id}/end` | 구현됨 | 〃 |
| 17 | `GET /api/v1/meetings/{id}/minutes` | 구현됨(스텁) | 실 API 는 `transcript`·`summary` 가 비었다 (계약 §4.0) |
| 18 | `GET /api/v1/extractions/{id}` | 구현됨 | |
| 19 | `GET /api/v1/approvals` | 구현됨 | `workspace_id` 필수 · `status` 필터 |
| 20 | `GET /api/v1/approvals/{id}` | 구현됨 | |
| 21 | `PATCH /api/v1/approvals/{id}` | 구현됨 | **태스크를 만든다** (§8-4) |
| 22 | `GET /api/v1/tasks` | 구현됨 | 질의 파라미터 4종 |
| 23 | `POST /api/v1/tasks` | 구현됨 | |
| 24 | `GET /api/v1/tasks/{id}` | 구현됨 | |
| 25 | `PATCH /api/v1/tasks/{id}` | 구현됨 | 상태 변경 · 낙관적 업데이트 대상 (D-137) · **명시적 `null` 은 필드 해제** |
| 26 | `GET /api/v1/tasks/{id}/history` | 구현됨 | |
| 27 | `POST /api/v1/tasks/{id}/history/{history_id}/rollback` | 구현됨 | 409 `TASK_HISTORY_ALREADY_ROLLED_BACK` · 400 최초 이력·**충돌** |
| 28 | `GET /api/v1/members` | 구현됨 | `workspace_id` 필수 |
| 29 | `POST /api/v1/members` | 구현됨 | 409 `DISCORD_USER_ALREADY_MAPPED` |
| 30 | `GET /api/v1/members/{id}` | 구현됨 | |
| 31 | `PATCH /api/v1/members/{id}` | 구현됨 | `discord_user_id: null` 로 연결 해제 |
| 32 | `POST /api/v1/members/{id}/aliases` | 구현됨 | |
| 33 | `GET /api/v1/members/aliases` | 구현됨 | |
| 34 | `GET /api/v1/members/unresolved-aliases` | 구현됨 | |
| 35 | `DELETE /api/v1/members/aliases/{alias_id}` | 구현됨 | 204 |

**주의** — `/api/v1/members/aliases` 와 `/api/v1/members/{member_id}` 는 경로가 겹친다. MSW 는 **먼저 등록된 handler** 가 이긴다. `handlers/index.ts` 에서 `aliases`·`unresolved-aliases` 를 `{member_id}` **앞에** 둔다. 순서가 틀리면 `member_id = 'aliases'` 로 404 가 난다.

---

## 11. 테스트

테스트를 먼저 쓴다. 계약 문서의 표를 그대로 단언문으로 옮기면 된다.

**작성 순서** (엔티티 하나씩 끝낸다)

1. DTO 타입을 적는다 → 2. 픽스처를 적는다 → 3. **매퍼 테스트를 적는다(빨강)** → 4. 매퍼를 만든다(초록) →
5. handler 를 만든다 → 6. **통합 테스트를 적는다** → 7. 파생 함수와 그 테스트.

**반드시 있어야 할 테스트**

| 대상 | 단언 |
|---|---|
| 매퍼 (엔티티마다) | `snake_case → camelCase`, `null` 처리, §5-3 의 폴백 5종 |
| 봉투 | `unwrap` 이 `data` 를 꺼낸다 · `error` 면 `ApiError` 를 던지고 `code`·`status` 를 보존한다 |
| 통합 — 목록 | `GET /tasks?workspace_id=ws_01` → 10건, `total: 10`, `ws_02` → 0건 |
| 통합 — 승인 흐름 | `PATCH /approvals/ap_01 {status:'approved', resolved_by:'mb_01'}` → 이후 `GET /tasks` 가 11건, `GET /approvals?status=pending` 이 2건. `resolved_by` 는 계약 §2.5의 필수 요청 필드다 |
| 통합 — 409 | 같은 승인을 두 번 처리하면 `APPROVAL_ALREADY_RESOLVED` |
| 통합 — 격리 | 위 테스트 다음에 도는 테스트가 다시 10건을 본다 (`resetDb`) |
| `linkDiscordUsers` | §9-3 의 네 경로 |
| `filterByTab` | `in_progress` 7건 · `done` 3건 |
| `isOverdue` | `MOCK_TODAY` 기준 `tk_02`·`tk_07` 만 참, `done` 인 `tk_08`(09-12)은 거짓 |
| 추출 항목 | **픽스처의** `gate`·식별자 배타성(생성 직후 상태) · `visibleItems(canReview: false)` 가 `auto` 3건만 준다 |
| 추출 항목 — 승인·반려 후 | 승인하면 `approval_id` 가 남은 채 `task_id` 가 채워진다 · 반려하면 항목이 그대로여서 `pendingItems` 는 열린 승인 집합과 조인해야 빠진다 |

**하지 않는 것** — 화면 렌더 테스트(M4~), 느린 응답·로딩 상태 테스트, Zod 스키마 테스트, 커버리지 수치 목표.

---

## 12. ESLint — DTO import 금지를 실제로 막는다

**규칙만 문서에 적으면 지켜지지 않는다.** `eslint.config.js` 에 블록을 하나 더한다.

```js
{
  files: [
    'src/app/**/*.{ts,tsx}',
    'src/pages/**/*.{ts,tsx}',
    'src/widgets/**/*.{ts,tsx}',
    'src/features/**/*.{ts,tsx}',
  ],
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '@/shared/types/api',
              '@/shared/types/api/*',
              '**/shared/types/api',
              '**/shared/types/api/*',
            ],
            message:
              'DTO 는 entities 와 shared/mock 에서만 다룬다 (D-133). 도메인 타입은 @/entities/<name> 에서 가져온다.',
          },
        ],
      },
    ],
  },
}
```

- **`@typescript-eslint/` 확장 규칙을 쓴다.** 기본 `no-restricted-imports` 를 이 블록에서 다시 선언하면 상위의 `date-fns`·`radix-ui` 설정이 **덮여서 사라진다.** 규칙 이름이 다르면 둘이 함께 동작한다.
- `allowTypeImports` 를 켜지 않는다. DTO 는 대부분 `import type` 으로 들어오므로 그걸 허용하면 규칙이 무의미하다.
- `src/shared/types/common.ts` 는 이 패턴에 걸리지 않는다. DTO 가 아니다 (§3-2).
- **확인 방법** — `src/pages/_probe.ts` 에 DTO import 한 줄을 넣고 `npm run lint` 가 에러를 내는지 본 뒤 파일을 지운다. 지우는 것까지 하고 커밋한다.

~~`entities → entities` 금지는 이미 `boundaries` 가 막고 있다. 따로 설정하지 않는다 (§3-2).~~

**이 문장은 틀렸다 (2026-09-21 검증).** `boundaries/dependencies` 는 `error` 로 켜져 있고 `elements`·`policies` 도 맞았지만
**한 번도 발동하지 않았다.** `settings['import/resolver']` 가 없어 import 경로를 파일로 해석하지 못했고,
`boundaries` 는 **해석 실패를 위반이 아니라 「판단 불가」로 보고 조용히 건너뛴다.**

확인한 것:

| 쓴 코드 | 결과 |
|---|---|
| `import … from '@/entities/member'` | 에러 **없음** (별칭을 못 읽는다) |
| `import … from '../../member/model/types'` | 에러 **없음** (`.ts` 를 못 붙인다) |
| `import … from '../../member/model/types.ts'` | 에러 발생 |

`eslint-import-resolver-typescript` 를 설치하고 `settings['import/resolver'].typescript` 를 붙여 고쳤다.
고친 뒤 위 세 경우가 모두 잡히고, 허용된 `entities → shared` 는 그대로 통과한다.
**M1 코드에 실제 위반은 없었다** — 규칙이 아니라 규칙의 작동 여부가 문제였다.
경위와 대안 비교는 `docs/impl-decision/2026-09-21-boundaries-import-resolver.md` 에 있다.

남은 구멍 하나는 알고 둔다. `boundaries/elements` 패턴이 `src/<layer>/*` 라 **하위 폴더 한 겹을 요구한다.**
`src/entities/foo.ts` 처럼 루트에 바로 놓인 파일은 `isUnknown` 으로 분류돼 정책을 전부 빠져나간다.
지금 그런 파일이 없어 무해하고, 막으려면 `boundaries/no-unknown-files` 가 필요한데 그것은 `src/App.tsx`·`src/main.tsx`·`src/vite-env.d.ts` 까지 잡는다. M1 범위 밖이다.

---

## 13. 문서 산출물

### 13-1. `frontend/docs/msw-guide.md` — D-146 의 열린 항목

> 실제 개발을 시작하기 전에 팀이 MSW 의 browser worker, Node test server, handler override, 미처리 요청 정책을 추가 학습하고 프로젝트용 간단한 사용 가이드와 예제를 작성한다 (D-146).

**이 문서는 M1 의 산출물이다.** 이 저장소의 코드를 예제로 쓴다. 담을 것:

1. worker 와 server 가 어떻게 다르고 각각 언제 뜨는가 (§8-2)
2. 픽스처를 고치고 싶을 때 어디를 고치나 — `fixtures` vs `db` vs `server.use` (§8-4, §8-6)
3. 미처리 요청 정책 — 테스트는 실패, 로컬은 경고. 실패했을 때 읽는 법
4. 오류·빈 상태를 테스트에서 만드는 법 (override 예제 2개)
5. **해서는 안 되는 것** — 픽스처 직접 수정, `delay()` 로 로딩 만들기, handler 안에서 `Date.now()`

### 13-2. `frontend/docs/impl-decision/` — 갈린 지점만

`docs/impl-decision/README.md` 의 형식을 따른다(파일명 `YYYY-MM-DD-영문-슬러그.md`). **코드를 짜다 두 길이 생긴 곳만** 적는다.
이 문서의 §3 에 이미 적힌 결정을 다시 쓰지 않는다. 빌드 통과·버전 확인 같은 것도 적지 않는다.

기록될 만한 후보: 승인 payload 를 좁히는 방식, mock DB 의 초기화 시점, 경로 겹침(§10 주의) 처리.

---

## 14. 검증

```bash
cd frontend
npm ci
npm run typecheck      # 오류 0
npm run lint           # 오류 0 — DTO import 금지 포함
npm run format:check
npm run test           # 매퍼 · 파생 · 통합 전부 초록
npm run build
```

**production 번들에 MSW 가 없는지**

```bash
grep -rl "msw" dist/assets/*.js | wc -l      # 0 이어야 한다
```

**브라우저에서 mock 확인**

```bash
cp .env.example .env    # VITE_ENABLE_MSW=true
npm run dev
```

Windows PowerShell 에서는 `VITE_ENABLE_MSW=true npm run dev` 가 동작하지 않는다. **반드시 `.env` 파일로 켠다.**

콘솔에 `[MSW] Mocking enabled.` 가 뜬 뒤, 개발자 도구 콘솔에서:

```js
await (await fetch('/api/v1/tasks?workspace_id=ws_01')).json()
// {data: {items: Array(10), total: 10}, error: null}

await (await fetch('/api/v1/approvals?workspace_id=ws_01&status=pending')).json()
// {data: {items: Array(3), total: 3}, error: null}

await (await fetch('/api/v1/meetings/mt_09/minutes')).json()
// {data: {..., transcript: Array(5)}, error: null}
```

**백엔드 연동 확인(선택)** — `VITE_ENABLE_MSW=false` 로 두고 백엔드를 띄우면 같은 경로가 proxy 를 타고 실제 서버로 간다.
계약 §2 의 구현된 엔드포인트는 실제 응답과 mock 응답이 같은 모양이어야 한다. 다르면 **계약 문서가 아니라 mock 을 고친다.**

```bash
cd ../backend && ./run.sh     # :8000
```

PR 을 열면 `frontend-ci` 의 `check` 와 `build` 가 모두 초록이어야 한다. base 는 `develop` 이다.

---

## 다음

**M3 — 앱 셸 · 라우팅 · 데이터 계층.** 이 mock 위에 axios 인스턴스와 TanStack Query 훅을 얹고, 라우터와 가드·에러 경계를 세운다.
`unwrap`(§3-1)은 그때 인터셉터로 옮겨 가고, 여기서 만든 매퍼와 통합 테스트는 그대로 남는다.

M2 는 이미 끝나 있으므로 M1 이 끝나면 **M4(인증·온보딩·워크스페이스 선택)의 선행이 M3 하나만 남는다.**
