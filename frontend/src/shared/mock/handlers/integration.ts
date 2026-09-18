import { http } from 'msw'
import { db } from '../db'
import { ok, fail } from '../envelope'

export const integrationHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/integrations', ({ params }) => {
    const integrations = db.integrations[String(params.workspaceId)]
    return integrations
      ? ok(integrations)
      : fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
  }),
  http.delete('/api/v1/workspaces/:workspaceId/integrations/:provider', ({ params }) => {
    const integrations = db.integrations[String(params.workspaceId)]
    if (!integrations) return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    const provider = params.provider
    if (provider !== 'discord' && provider !== 'notion')
      return fail('INVALID_REQUEST', '지원하지 않는 연동입니다.', 400)
    integrations[provider] = { status: 'not_connected', display_name: null, connected_at: null }
    return ok(integrations)
  }),
]
