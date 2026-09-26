import type { PostLoginRoute } from '../model/types'

export function postLoginRoute(workspaceCount: number): PostLoginRoute {
  return workspaceCount === 0
    ? 'onboarding'
    : workspaceCount === 1
      ? 'dashboard'
      : 'workspace-select'
}
