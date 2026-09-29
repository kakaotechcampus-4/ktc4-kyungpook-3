import type { ReactNode } from 'react'
import { Route } from 'react-router'
import { NotFoundPage } from '@/pages/not-found'
import { RouteErrorBoundary } from './errors/RouteErrorBoundary'
import { RedirectIfAuthed } from './guards/RedirectIfAuthed'
import { RequireAuth } from './guards/RequireAuth'
import { RequireOnboardingComplete } from './guards/RequireOnboardingComplete'
import { RequirePM } from './guards/RequirePM'
import { RequireTeamMember } from './guards/RequireTeamMember'
import { RequireValidOnboardingStep } from './guards/RequireValidOnboardingStep'
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
const tasksPage = lazyPage(() => import('@/pages/tasks').then((m) => m.TasksPage))
const approvalDetailPage = lazyPage(() =>
  import('@/pages/approval-detail').then((m) => m.ApprovalDetailPage),
)
const messagesPage = lazyPage(() => import('@/pages/messages').then((m) => m.MessagesPage))
const membersPage = lazyPage(() => import('@/pages/members').then((m) => m.MembersPage))
const settingsPage = lazyPage(() => import('@/pages/settings').then((m) => m.SettingsPage))

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
    <Route path="*" element={screen(<NotFoundPage />)} />
  </Route>
)
