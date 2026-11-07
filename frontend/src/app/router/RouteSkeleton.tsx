import { useQueryClient } from '@tanstack/react-query'
import { matchPath, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { findMemberWorkspace, workspaceListQueryOptions } from '@/entities/workspace'
import { ForgotPasswordPageSkeleton } from '@/pages/forgot-password/skeleton'
import { LoginPageSkeleton } from '@/pages/login/skeleton'
import { ProcessingRouteSkeleton } from '@/pages/meeting-processing/skeleton'
import { SpeakersRouteSkeleton } from '@/pages/meeting-speakers/skeleton'
import { UploadRouteSkeleton } from '@/pages/meeting-upload/skeleton'
import { SettingsSkeleton } from '@/pages/settings/skeleton'
import { SignupPageSkeleton } from '@/pages/signup/skeleton'
import { WorkspaceSelectSkeleton } from '@/pages/workspace-select/skeleton'
import { useCompactScreen } from '@/shared/lib/compact-screen'
import { todayInSeoul } from '@/shared/lib/date'
import { useSplashHold } from '@/shared/lib/splash'
import { parseRouteId } from '@/shared/lib/url'
import { MESSAGE_PARAMS, SETTINGS_PARAMS } from '@/shared/config/routes'
import { MinutesPageSkeleton, OnboardingSkeleton, PageSkeleton } from '@/shared/ui/page-skeleton'
import { ApprovalRouteSkeleton } from '@/widgets/approval-review/skeleton'
import { DashboardSkeleton } from '@/widgets/dashboard/skeleton'
import { MessageInboxSkeleton } from '@/widgets/message-inbox/skeleton'
import { TaskBoardSkeleton } from '@/widgets/task-board/skeleton'
import { TaskDetailRouteSkeleton } from '@/widgets/task-detail/skeleton'
import { TeamOverviewSkeleton } from '@/widgets/team/skeleton'
import { WorkspaceShellSkeleton } from './layouts/WorkspaceLayout'

/*
 * 경로 판정은 routes.tsx 의 경로와 같은 패턴을 matchPath 로 본다 — 라우터처럼 대소문자를 가리지 않고 끝 슬래시를 받는다.
 * 동적 ID 는 바꾸지 않고 parseRouteId 로 모양만 본다 (#510)
 */
const WORKSPACE = '/workspaces/:workspaceId'

/** 경로가 패턴과 맞고 공간 ID 모양이 맞으면 그 매치. 공간 밖 패턴은 ID 를 보지 않는다 */
function match(pattern: string, pathname: string) {
  const found = matchPath(pattern, pathname)
  if (found === null) return null
  if (pattern.startsWith(WORKSPACE) && parseRouteId(found.params.workspaceId) === null) return null
  return found
}

/** 공간 화면 경로의 공간 ID. 역할을 읽는 데 쓴다 */
function routeWorkspaceId(pathname: string): string | null {
  return parseRouteId(matchPath(`${WORKSPACE}/*`, pathname)?.params.workspaceId)
}

/**
 * 이 공간에서의 역할. 캐시에 있는 소속 목록만 본다 — 가드가 세션을 기다리는 동안 목록을 새로 부르지 않는다(비로그인에게 401 을 만들지 않는다).
 * 모르면 PM 이다 — 공간을 만드는 사람이고 화면이 더 많은 틀이다
 */
function useCachedIsPm(workspaceId: string | null): boolean {
  const queryClient = useQueryClient()
  if (workspaceId === null) return true
  const workspaces = queryClient.getQueryData(workspaceListQueryOptions().queryKey)
  const workspace = workspaces === undefined ? null : findMemberWorkspace(workspaces, workspaceId)
  return workspace === null ? true : workspace.role === 'pm'
}

interface SkeletonContext {
  pathname: string
  search: string
  isPm: boolean
  compact: boolean
}

/** 경로에 맞는 화면 뼈대. 화면이 데이터를 기다릴 때 그리는 틀과 같다 — 코드를 받은 뒤 바뀌어도 제목·틀이 움직이지 않는다 (#510) */
function screenSkeleton({ pathname, search, isPm, compact }: SkeletonContext): ReactNode {
  const at = (pattern: string) => match(pattern, pathname) !== null
  const params = new URLSearchParams(search)
  if (at('/login')) return <LoginPageSkeleton />
  if (at('/signup')) return <SignupPageSkeleton />
  if (at('/forgot-password')) return <ForgotPasswordPageSkeleton />
  if (at('/workspaces')) return <WorkspaceSelectSkeleton />
  if (at('/onboarding/*')) return <OnboardingSkeleton />
  if (at(`${WORKSPACE}/dashboard`)) return <DashboardSkeleton isPm={isPm} today={todayInSeoul()} />
  if (at(`${WORKSPACE}/tasks`))
    return <TaskBoardSkeleton search={search} isPm={isPm} today={todayInSeoul()} />
  if (at(`${WORKSPACE}/tasks/:taskId`)) return <TaskDetailRouteSkeleton />
  if (at(`${WORKSPACE}/approvals/:approvalId`)) return <ApprovalRouteSkeleton />
  if (at(`${WORKSPACE}/members`)) return <TeamOverviewSkeleton isPm={isPm} />
  if (at(`${WORKSPACE}/settings`))
    return (
      <SettingsSkeleton
        isPm={isPm}
        connections={params.get(SETTINGS_PARAMS.section) === 'notion'}
      />
    )
  // `upload` 가 회의 ID 로 읽히지 않게 정적 경로가 먼저다 — routes.tsx 와 같다
  if (at(`${WORKSPACE}/meetings/upload`)) return <UploadRouteSkeleton />
  if (at(`${WORKSPACE}/meetings/:meetingId/processing`)) return <ProcessingRouteSkeleton />
  if (at(`${WORKSPACE}/meetings/:meetingId/speakers`)) return <SpeakersRouteSkeleton />
  if (at(`${WORKSPACE}/meetings/:meetingId?`)) return <MinutesPageSkeleton />
  const messages = match(`${WORKSPACE}/messages/*`, pathname)
  if (messages !== null) {
    const addressed =
      (messages.params['*'] ?? '') !== '' ||
      params.has(MESSAGE_PARAMS.review) ||
      params.has(MESSAGE_PARAMS.compose)
    // 휴대폰에서 상세를 바로 여는 주소는 셸을 걷은 전체 화면이다 — 그 틀은 화면이 그린다
    if (!(compact && addressed))
      return (
        <MessageInboxSkeleton isPm={isPm} thread={at(`${WORKSPACE}/messages/threads/:threadId`)} />
      )
  }
  return <PageSkeleton />
}

/**
 * 화면 코드·가드 캐시를 기다리는 동안의 자리. 화면마다 그 화면이 데이터를 기다릴 때와 같은 틀의 뼈대를 그린다 (#510) —
 * 12시간 안에 다시 오면 스플래시 없이 이 뼈대가 바로 보이고, 화면 코드를 받으면 화면 안 뼈대(#508)로 이어진다.
 * 경로를 모르는 화면(랜딩·404·비밀번호 재설정)은 일반 뼈대다.
 *
 * 그려져 있는 동안은 첫 화면이 아니다. 로딩 스플래시가 떠 있으면 이 뼈대가 모두 사라질 때까지 덮는다 (#430).
 * 가드 뼈대(GuardSkeleton)와 화면 코드 대기(lazyPage)도 이 컴포넌트를 그리므로 여기 한 곳에서 잡는다.
 */
export function RouteSkeleton() {
  useSplashHold()
  const { pathname, search } = useLocation()
  const isPm = useCachedIsPm(routeWorkspaceId(pathname))
  const compact = useCompactScreen()
  return screenSkeleton({ pathname, search, isPm, compact })
}

/**
 * 앱 셸(WorkspaceLayout) 안에 그려질 경로 — `/workspaces/:workspaceId/...`. 공간 선택(`/workspaces`)은 셸이 없다.
 * ID 모양이 틀리면 소속 가드가 셸 없는 404 를 그리므로 셸 자리를 두지 않는다
 */
function isWorkspaceShellPath(pathname: string): boolean {
  const match = matchPath('/workspaces/:workspaceId/*', pathname)
  return match !== null && parseRouteId(match.params.workspaceId) !== null
}

/**
 * 가드가 세션·소속 캐시를 기다리는 동안의 자리. 가드는 앱 셸 바깥 칸이라 셸 안 경로에서는 셸 틀과 헤더 뼈대를 함께 그린다 —
 * 그래야 셸이 뜰 때 화면 뼈대가 헤더 높이만큼 내려가지 않는다 (UX1-M01). 인증·온보딩·공간 선택처럼 헤더가 없는 경로는 RouteSkeleton 그대로다.
 * 화면 코드 대기(lazyPage 의 Suspense)는 이미 셸 안이라 RouteSkeleton 만 쓴다.
 */
export function GuardSkeleton() {
  const { pathname } = useLocation()
  if (!isWorkspaceShellPath(pathname)) return <RouteSkeleton />
  return (
    <WorkspaceShellSkeleton>
      <RouteSkeleton />
    </WorkspaceShellSkeleton>
  )
}
