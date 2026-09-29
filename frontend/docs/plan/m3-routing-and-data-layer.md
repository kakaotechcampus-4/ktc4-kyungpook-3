# M3 구현 계획: 라우팅·접근 제어·공통 데이터 계층

- 작성일: 2026-09-28
- 상태: 계획 확정, 구현 전
- 근거: `frontend-development-plan.md`, `../decision/frontend-decisions.md`, `../api/frontend-api-contract-draft.md`

## 요약

M1의 도메인 모델·MSW와 M2의 공통 UI 위에, M4 이후 화면을 연결할 실행 기반을 구축한다. 임시 UI 갤러리를 제거하고 최소 페이지로 라우팅·가드·오류 처리·이탈 확인까지 검증한다.

실제 헤더·5개 탭·워크스페이스 전환 UI·인증 폼은 M4에 유지한다. 백엔드 변경, Storybook, 외부 오류 모니터링 연동은 포함하지 않는다.

## 구현 순서

### 1. 공통 API 클라이언트와 설정

- Axios, TanStack Query, React Router, Zustand, Zod, date-fns를 추가하고 lockfile을 갱신한다.
- 환경 변수 접근을 `shared/config`로 모은다. 빈 API 주소는 동일 출처 `/api/v1`로 해석하고 MSW는 개발 환경에서만 활성화한다.
- Axios에 쿠키 전송, 요청 취소, 응답 봉투 해제, **204 → `undefined`** 처리를 구현한다.
- 기존 `ApiError`를 공통 오류 타입으로 확장·재사용한다. HTTP·네트워크·잘못된 응답을 구분하고 취소 오류는 일반 실패 알림에서 제외한다.
- 오류 코드별 한국어 문구를 중앙 관리한다. 알 수 없는 오류에도 서버 기술 문구를 직접 노출하지 않는다.
- `shared/test/api.ts`의 별도 fetch 경로를 공통 클라이언트로 교체해 기존 통합 테스트가 실제 통신 계층을 검증하도록 한다.

### 2. Query와 인증 초기화

- `entities/user`에 세션 조회, `entities/workspace`에 목록 조회 함수와 Query options를 추가한다. 목록은 기존 `toWorkspace`를 사용해 **온보딩 정보를 포함한 `Workspace[]`**로 반환한다.
- 앱 부팅 시 `/auth/me`와 `/workspaces`를 동시에 시작한다. 가드는 같은 Query 캐시를 구독하고 별도 요청을 만들지 않는다.
- **업무 데이터 요청은 인증·소속·온보딩·역할 확인 이후에 시작한다.** 부모 가드를 우회하는 자식 loader 선조회도 금지한다.
- Query 정책을 공통화한다.
  - 네트워크 오류·408·5xx만 1회 재시도, 대기 1초.
  - 그 외 오류·취소·mutation은 자동 재시도하지 않는다.
  - 기본 최신 시간 30초, 세션·워크스페이스·팀원·설정·완료 회의록 상세는 5분, 미사용 캐시 제거는 5분.
  - 워크스페이스 데이터 key에는 반드시 `workspaceId`를 넣는다.
- 최초 세션 조회의 401은 비로그인 상태로 처리한다. 인증된 세션의 만료는 진행 요청 취소·사용자 캐시 제거·로그인 이동을 한 번만 수행한다. 일반 네트워크 실패는 로그아웃으로 해석하지 않는다.
- 서버 데이터는 Query에만 저장한다. Zustand는 토스트 등 클라이언트 UI 상태에 사용하고 사용자·워크스페이스 객체나 인증 여부를 중복 저장하지 않는다. M3에서는 persist를 사용하지 않는다.

### 3. 라우트와 가드

- `BrowserRouter`·`Routes`·`Route`로 공개·인증·워크스페이스 레이아웃을 구성한다(데이터 라우터와 loader는 쓰지 않는다). 가드는 상위 layout route의 `element`이고 `Outlet`을 렌더한다. 테스트는 `MemoryRouter`다. 최소 페이지는 주요 화면 단위로 지연 로드하고 `Suspense`에 M2 Skeleton을 연결한다. 화면 렌더 오류는 페이지 element를 감싼 Route Error Boundary가, 그 밖의 렌더 오류는 라우터 트리를 감싼 Root Error Boundary가 받는다.
- 등록 경로:
  - `/`, `/login`, `/signup`, `/workspaces`
  - `/onboarding/create_workspace`
  - `/onboarding/:workspaceId/:step`
  - `/workspaces/:workspaceId/dashboard`
  - `/workspaces/:workspaceId/meetings/:meetingId?`
  - `/workspaces/:workspaceId/tasks/:taskId?`
  - `/workspaces/:workspaceId/approvals/:approvalId`
  - `/workspaces/:workspaceId/messages/*`
  - `/workspaces/:workspaceId/members`
  - `/workspaces/:workspaceId/settings`
- 메시지는 준비 중 페이지만 제공하고 API를 호출하지 않는다. 알 수 없는 경로는 404 화면을 표시한다.
- `RequireAuth`, `RedirectIfAuthed`, `RequireTeamMember`, `RequireOnboardingComplete`, `RequirePM`을 상위 레이아웃에서 조합한다.
- 소속 여부는 **워크스페이스 목록 포함 여부**로 판정한다. 상세 응답의 `role` 폴백을 소속 근거로 쓰지 않는다.
- 미완료 워크스페이스는 서버의 현재 온보딩 단계로 이동한다. 단계가 없거나 유효하지 않으면 첫 `pending` 단계, 그것도 없으면 생성 단계로 이동한다. 온보딩 경로에는 완료 가드를 적용하지 않아 루프를 방지한다.
- 일반 팀원의 승인 상세 접근은 데이터 조회 전에 차단하고 태스크 목록으로 이동하며 `접근 권한이 없어요` 토스트를 한 번 표시한다.
- 로그인 완료 후 이동은 0개 → 생성 온보딩, 1개 → 해당 공간, 여러 개 → 선택 화면으로 한다. 로그인한 사용자의 인증 화면 재접근은 유효한 `lastWorkspaceId`를 우선하고, 없으면 개수별 분기로 돌아간다. 미완료 공간은 항상 온보딩으로 보낸다.

### 4. 오류·이탈 확인·공통 유틸리티

- Root Error Boundary와 페이지별 Route Error Boundary를 둔다. 예상 가능한 조회 실패는 인라인 안내와 `다시 시도`, 예상하지 못한 렌더 오류는 오류 화면으로 처리한다.
- 전역 토스트는 동일 key를 병합하고 동시 표시를 3개로 제한한다. 기본 5초, 액션 포함 10초를 사용한다.
- `useUnsavedChanges(isDirty)` 등록 인터페이스와 앱 수준의 단일 이탈 모달을 만든다. 앱 안 링크와 코드 이동은 `GuardedLink`·`useGuardedNavigate` 한 관문을 지나고, dirty이면 이동 전에 모달을 연다. 뒤로가기는 `window`의 `popstate`에서 보던 주소로 되돌린 뒤 같은 모달을 열고, 나가기를 고르면 그 뒤로가기를 다시 한다(다음 화면이 한 프레임 보일 수 있다). 새로고침·탭 닫기는 `beforeunload`로 처리한다.
- 모달의 `계속 작성하기`·Esc·배경 클릭은 이동 취소, `변경 내용 버리고 나가기`는 원래 이동 재개로 통일한다. 저장·초기화·업로드 시작 시 호출자가 dirty 상태를 해제한다.
- 날짜 유틸리티는 기존 `todayInSeoul`을 확장한다. timestamp 표시는 한국 시간, 날짜 전용 값은 시간대 변환 없이 처리한다.
- 워크스페이스 이름은 공백 정규화 후 1~20자로 검증한다. 이모지를 고려해 사용자에게 보이는 글자 단위로 계산하고, 정규화된 소속 공간 이름과 대소문자를 구분해 중복 비교한다.
- URL 검증 도구만 제공하고, 미결정인 필터·정렬·페이지네이션 규격은 만들지 않는다.

## 공개 인터페이스와 문서

- 공통 요청 함수는 `request<T>(...) → Promise<T>`와 취소 signal을 지원한다. DTO 변환은 entities에서 수행한다.
- 세션·워크스페이스 Query options, 워크스페이스 범위 key 생성 규칙, 경로 생성 함수, 이탈 확인 hook, 전역 토스트 인터페이스를 공개한다.
- 로그인 이동 정책은 `로그인 완료`와 `인증 화면 재접근`을 구분하는 순수 함수로 구현한다.
- 구현 시 기존 개발 계획의 업무 데이터 선조회 정책과 승인 상세 경로를 이 계획에 맞게 정정한다.

## 검증과 완료 기준

- **API:** 정상 봉투, HTTP 오류, 204, 네트워크 실패, 취소, 잘못된 응답, 한국어 오류 폴백.
- **Query:** 재시도 횟수·대상, 두 초기 요청의 동시 시작, 요청 중복 방지, 워크스페이스 전환·세션 종료 후 이전 데이터 비노출.
- **가드:** 비로그인, 공간 0/1/여러 개, 유효·무효 마지막 공간, 비소속, 미완료 온보딩, PM/일반 팀원, 잘못된 URL. 차단된 화면의 업무 API 요청이 **0회**인지 검증한다.
- **오류·이탈:** 조회 실패 재시도, Route·Root 오류 격리, 모달 취소·이동 재개, 여러 dirty 등록, 저장 후 해제, 중복 토스트 방지.
- **유틸리티:** 한국 시간 날짜 경계, 날짜 전용 값 보존, 공백·이모지·글자 수 경계·이름 중복.
- 기존 테스트와 `typecheck`, `lint`, `format:check`, `test`, `build`를 모두 통과한다. 브라우저에서 직접 URL 진입·새로고침·뒤로가기·키보드 모달 조작을 확인한다.

## 기본값과 제한

- M3는 MSW 기준으로 완결한다. 실제 인증·온보딩·업무 화면은 이후 마일스톤에서 연결한다.
- 미완료 공간의 일반 팀원은 해당 온보딩 경로에서 PM 설정 대기 안내만 보고 수정할 수 없도록 한다.
- `last_workspace_id`는 서버 응답을 사용하되, 현재 서버가 실제 최근 이용 공간을 기록하지 않는 제한을 문서화한다.
- 프론트 가드는 사용자 경험을 위한 접근 제어다. 현재 백엔드 권한 검사 누락은 M3로 해결되지 않는다.
- 이 문서는 구현 계획이며, 위 검증은 구현 시 수행한다.
