import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import { COMMON_MESSAGES } from '@/shared/api/errorMessages'
import { paths } from '@/shared/config/routes'
import { useRouteId } from '@/shared/lib/url'
import { toast } from '@/shared/ui/toast'

/** 같은 key 라서 StrictMode 가 effect 를 두 번 돌려도 토스트는 하나다 */
const ACCESS_DENIED_KEY = 'access-denied'

/**
 * PM 전용 경로. 역할은 소속 목록의 role 로 본다 — 소속은 RequireTeamMember 가 이미 확인했다.
 * 일반 팀원은 화면을 그리지 않고 업무 API 도 부르지 않은 채 태스크 목록으로 보낸다 (D-162).
 * 이것은 UX 장치다. 승인 API 자체는 서버가 막아야 한다 (계약 §4.0-②-1).
 */
export function RequirePM() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))

  if (workspace === null) return null
  if (workspace.role !== 'pm') return <DeniedRedirect to={paths.tasks(workspace.id)} />
  return <Outlet />
}

function DeniedRedirect({ to }: { to: string }) {
  useEffect(() => {
    toast.show({ key: ACCESS_DENIED_KEY, title: COMMON_MESSAGES.accessDenied })
  }, [])
  return <Navigate to={to} replace />
}
