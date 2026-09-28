import { sessionQueryOptions } from '@/entities/user'
import type { Session } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import { guardLeave, hasUnsavedChanges, useUnsavedChangesStore } from '@/shared/lib/unsaved-changes'
import { toast, useToastStore } from '@/shared/ui/toast'
import { expireSession } from './expireSession'

const SESSION: Session = {
  user: { id: 'us_01', email: 'pm@example.com', name: '최진호', avatarUrl: null },
  workspaceCount: 2,
  lastWorkspaceId: 'ws_01',
}

const sessionKey = sessionQueryOptions().queryKey

describe('expireSession', () => {
  it('인증된 세션이면 진행 요청을 취소하고 사용자 캐시를 지운 뒤 세션을 null 로 둔다', async () => {
    const client = createQueryClient()
    client.setQueryData(sessionKey, SESSION)
    client.setQueryData(workspaceKey('ws_01', 'members'), ['김서연'])
    const captured: { signal?: AbortSignal } = {}
    const pending = client.fetchQuery({
      queryKey: workspaceKey('ws_01', 'slow'),
      queryFn: ({ signal }) => {
        captured.signal = signal
        return new Promise<never>(() => undefined)
      },
    })
    useUnsavedChangesStore.getState().mark('settings')
    // 이탈 모달이 열려 있던 중이다
    guardLeave(() => undefined)
    toast.show({ title: '이전 사용자에게 띄운 알림' })

    // 동시에 도착한 401 두 개. 두 번째는 세션이 이미 null 이라 지나간다
    expect(expireSession(client)).toBe(true)
    expect(expireSession(client)).toBe(false)

    await pending.catch(() => undefined)
    expect(captured.signal?.aborted).toBe(true)
    expect(client.getQueryData(workspaceKey('ws_01', 'members'))).toBeUndefined()
    // 세션 query 는 남기고 값만 null 이다 — RequireAuth 가 이것을 받아 로그인으로 보낸다
    expect(client.getQueryData(sessionKey)).toBeNull()
    expect(hasUnsavedChanges()).toBe(false)
    expect(useUnsavedChangesStore.getState().pendingLeave).toBeNull()
    expect(useToastStore.getState().items).toEqual([])
  })

  it('세션이 없던 401 은 아무것도 하지 않는다 — 최초 조회·비로그인', () => {
    const client = createQueryClient()
    client.setQueryData(workspaceKey('ws_01', 'members'), ['김서연'])

    expect(expireSession(client)).toBe(false)
    client.setQueryData(sessionKey, null)
    expect(expireSession(client)).toBe(false)

    expect(client.getQueryData(workspaceKey('ws_01', 'members'))).toEqual(['김서연'])
  })
})
