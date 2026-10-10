import type { ReactNode } from 'react'
import { Route } from 'react-router'
import { NotFoundPage } from '@/pages/not-found'
import { config } from '@/shared/config/env'
import { RouteErrorBoundary } from './errors/RouteErrorBoundary'
import { RedirectIfAuthed } from './guards/RedirectIfAuthed'
import { RequireAuth } from './guards/RequireAuth'
import { RequireOnboardingComplete } from './guards/RequireOnboardingComplete'
import { RequirePM } from './guards/RequirePM'
import { RequireTeamMember } from './guards/RequireTeamMember'
import { RequireValidOnboardingStep } from './guards/RequireValidOnboardingStep'
import { AuthenticatedLayout } from './layouts/AuthenticatedLayout'
import { RootLayout } from './layouts/RootLayout'
import { WorkspaceLayout } from './layouts/WorkspaceLayout'
import { lazyPage } from './lazyPage'

/** 화면 한 칸. 화면에서 난 렌더 오류는 이 칸에서 멈추고 레이아웃과 가드는 남는다 (D-129) */
function screen(page: ReactNode) {
  return <RouteErrorBoundary>{page}</RouteErrorBoundary>
}

const landingPage = lazyPage(() => import('@/pages/landing').then((m) => m.LandingPage))
const loginPage = lazyPage(() => import('@/pages/login').then((m) => m.LoginPage))
const signupPage = lazyPage(() => import('@/pages/signup').then((m) => m.SignupPage))
const workspaceSelectPage = lazyPage(() =>
  import('@/pages/workspace-select').then((m) => m.WorkspaceSelectPage),
)
const onboardingCreatePage = lazyPage(() =>
  import('@/pages/onboarding-create').then((m) => m.OnboardingCreatePage),
)
const onboardingStepPage = lazyPage(() =>
  import('@/pages/onboarding-step').then((m) => m.OnboardingStepPage),
)
const dashboardPage = lazyPage(() => import('@/pages/dashboard').then((m) => m.DashboardPage))
const meetingsPage = lazyPage(() => import('@/pages/meetings').then((m) => m.MeetingsPage))
const meetingUploadPage = lazyPage(() =>
  import('@/pages/meeting-upload').then((m) => m.MeetingUploadPage),
)
const meetingProcessingPage = lazyPage(() =>
  import('@/pages/meeting-processing').then((m) => m.MeetingProcessingPage),
)
const tasksPage = lazyPage(() => import('@/pages/tasks').then((m) => m.TasksPage))
const approvalDetailPage = lazyPage(() =>
  import('@/pages/approval-detail').then((m) => m.ApprovalDetailPage),
)
const messagesPage = lazyPage(() => import('@/pages/messages').then((m) => m.MessagesPage))
const membersPage = lazyPage(() => import('@/pages/members').then((m) => m.MembersPage))
const settingsPage = lazyPage(() => import('@/pages/settings').then((m) => m.SettingsPage))

/*
 * 모의 OAuth 화면은 개발·MSW 모드에서만 등록한다. 경로는 shared/config/routes.ts 의 devPaths.mockOAuth 다.
 * DEV 를 먼저 본다 — 번들러가 이 분기를 지워야 프로덕션 번들에 모의 화면 코드가 남지 않는다.
 * 가드 밖이다. 실제 OAuth 제공자 화면 자리라 로그인·소속 확인은 콜백 흉내가 한다.
 */
const mockOAuthRoute =
  import.meta.env.DEV && config.mswEnabled ? (
    <Route
      path="__mock/oauth/:workspaceId/:provider"
      element={screen(
        lazyPage(() => import('@/shared/mock/oauth/MockOAuthPage').then((m) => m.MockOAuthPage)),
      )}
    />
  ) : null

/*
 * 경로 표. <Routes>{appRoutes}</Routes> 로 쓴다 — 브라우저는 BrowserRouter, 테스트는 MemoryRouter 안이다.
 * loader 를 쓰지 않는다 — 업무 데이터는 가드를 모두 통과한 화면 컴포넌트가 useQuery 로 시작한다.
 * 가드는 path 없는 상위 layout route 의 element 이고 <Outlet /> 을 그린다.
 * 바깥에서 안쪽으로 공개(RedirectIfAuthed) → 인증 → 소속 → 온보딩 완료 → 역할 순서다.
 * 온보딩 경로에는 완료 가드를 걸지 않는다 — 미완료 공간이 온보딩과 대시보드 사이를 오가는 루프가 생긴다.
 * Root Error Boundary 는 여기 없다. App 이 라우터 트리 전체를 감싼다.
 */
export const appRoutes = (
  <Route path="/" element={<RootLayout />}>
    <Route element={<RedirectIfAuthed />}>
      <Route index element={screen(landingPage)} />
      <Route path="login" element={screen(loginPage)} />
      <Route path="signup" element={screen(signupPage)} />
    </Route>
    <Route element={<RequireAuth />}>
      {/* 추적기 같은 로그인 뒤 전역 동작의 칸. path 가 없어 경로에는 끼지 않는다 */}
      <Route element={<AuthenticatedLayout />}>
        <Route path="workspaces" element={screen(workspaceSelectPage)} />
        <Route path="onboarding/create_workspace" element={screen(onboardingCreatePage)} />
        <Route path="onboarding/:workspaceId" element={<RequireTeamMember />}>
          <Route index element={screen(<NotFoundPage />)} />
          <Route path=":step" element={<RequireValidOnboardingStep />}>
            <Route index element={screen(onboardingStepPage)} />
          </Route>
        </Route>
        <Route path="workspaces/:workspaceId" element={<RequireTeamMember />}>
          <Route element={<RequireOnboardingComplete />}>
            <Route element={<WorkspaceLayout />}>
              <Route index element={screen(<NotFoundPage />)} />
              <Route path="dashboard" element={screen(dashboardPage)} />
              {/* `upload` 가 회의 ID 로 읽히지 않게 정적 경로로 따로 둔다. 정적 조각이 동적 조각보다 우선한다.
                  업로드는 PM 전용, 처리 화면은 팀원 모두 — docs/impl-decision/2026-10-02-meeting-upload-policy.md */}
              <Route path="meetings/upload" element={<RequirePM />}>
                <Route index element={screen(meetingUploadPage)} />
              </Route>
              <Route
                path="meetings/:meetingId/processing"
                element={screen(meetingProcessingPage)}
              />
              <Route path="meetings/:meetingId?" element={screen(meetingsPage)} />
              <Route path="tasks/:taskId?" element={screen(tasksPage)} />
              <Route path="approvals/:approvalId" element={<RequirePM />}>
                <Route index element={screen(approvalDetailPage)} />
              </Route>
              <Route path="messages/*" element={screen(messagesPage)} />
              <Route path="members" element={screen(membersPage)} />
              <Route path="settings" element={screen(settingsPage)} />
            </Route>
          </Route>
        </Route>
      </Route>
    </Route>
    {mockOAuthRoute}
    <Route path="*" element={screen(<NotFoundPage />)} />
  </Route>
)
