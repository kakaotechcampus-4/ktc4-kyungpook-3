import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { MemberDto } from '@/shared/types/api/member'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { db } from './db'
import { settleMockOAuth } from './oauth/mockOAuth'
import { setMockRole } from './sessions'

/*
 * M8-B — 연동 해제, 팀원 생성·수정, 모의 OAuth 완료는 백엔드처럼 PM 만 한다.
 * integrations.py 의 delete_integration(get_current_pm)·_start_connection(PM 이 아니면 failed),
 * members.py 의 create_member(require_pm)·update_member(_get_member(..., pm=True)).
 */

/** 거부된 쓰기가 아무것도 바꾸지 않았는지 비교할 상태 */
const snapshot = () => structuredClone({ members: db.members, integrations: db.integrations })

const disconnect = (provider: string) =>
  fetchDto(`/workspaces/ws_01/integrations/${provider}`, { method: 'DELETE' })
const createMember = () =>
  fetchDto<MemberDto>(
    '/members',
    jsonRequest('POST', {
      workspace_id: 'ws_01',
      display_name: '새 팀원',
      discord_user_id: '1125',
    }),
  )
const updateMember = () =>
  fetchDto<MemberDto>('/members/mb_03', jsonRequest('PATCH', { discord_user_id: '1125' }))

describe('연결 관리 쓰기 권한', () => {
  it('PM 은 연동을 해제하고 팀원을 만들고 고친다', async () => {
    await expect(disconnect('discord')).resolves.toBeUndefined()
    expect(db.integrations.ws_01.discord.status).toBe('not_connected')
    await expect(createMember()).resolves.toMatchObject({ discord_user_id: '1125' })
    await expect(
      fetchDto<MemberDto>('/members/mb_03', jsonRequest('PATCH', { display_name: '이재환2' })),
    ).resolves.toMatchObject({ display_name: '이재환2' })
  })

  it('일반 팀원의 연동 해제·팀원 생성·수정은 403 이고 팀원·연동이 그대로다', async () => {
    setMockRole('member')
    const before = snapshot()
    const writes: [string, () => Promise<unknown>][] = [
      ['DELETE discord', () => disconnect('discord')],
      ['DELETE notion', () => disconnect('notion')],
      ['POST member', createMember],
      ['PATCH member', updateMember],
    ]
    for (const [name, write] of writes)
      await expect(write(), name).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(snapshot()).toEqual(before)
  })

  it('없는 팀원 수정은 권한보다 먼저 404 다 — 백엔드가 팀원을 찾은 뒤 PM 을 본다', async () => {
    setMockRole('member')
    await expect(
      fetchDto('/members/mb_99', jsonRequest('PATCH', { display_name: 'x' })),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND', status: 404 })
  })

  it('세션 팀원 대응이 없는 새 공간도 만든 PM 이면 팀원을 만들고 연결한다 — 온보딩을 마칠 수 있다', async () => {
    const { workspace_id: id } = await fetchDto<WorkspaceDto>(
      '/workspaces',
      jsonRequest('POST', { name: '새 공간' }),
    )
    expect(settleMockOAuth({ workspaceId: id, provider: 'discord', outcome: 'success' })).toBe(
      'success',
    )
    await expect(
      fetchDto<MemberDto>(
        '/members',
        jsonRequest('POST', { workspace_id: id, display_name: '새 팀원', discord_user_id: '1125' }),
      ),
    ).resolves.toMatchObject({ workspace_id: id })
  })
})

describe('모의 OAuth 완료 권한', () => {
  it.each(['discord', 'notion'] as const)(
    '일반 팀원이 %s 연결을 허용해도 failed 로 돌아가고 연동이 그대로다',
    (provider) => {
      db.integrations.ws_01[provider] = {
        status: 'not_connected',
        display_name: null,
        connected_at: null,
      }
      setMockRole('member')
      const before = snapshot()
      expect(settleMockOAuth({ workspaceId: 'ws_01', provider, outcome: 'success' })).toBe('failed')
      expect(snapshot()).toEqual(before)
    },
  )

  it('PM 이 허용하면 connected 가 된다', () => {
    db.integrations.ws_01.discord = {
      status: 'not_connected',
      display_name: null,
      connected_at: null,
    }
    expect(settleMockOAuth({ workspaceId: 'ws_01', provider: 'discord', outcome: 'success' })).toBe(
      'success',
    )
    expect(db.integrations.ws_01.discord.status).toBe('connected')
  })
})
