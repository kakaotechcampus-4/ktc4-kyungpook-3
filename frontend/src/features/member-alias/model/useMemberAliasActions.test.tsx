import { QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { memberAliasesQueryOptions } from '@/entities/member'
import { createQueryClient } from '@/shared/api/queryClient'
import { endSessionScope } from '@/shared/api/sessionScope'
import { db } from '@/shared/mock/db'
import { recordRequests } from '@/shared/test/requests'
import { useMemberAliasActions } from './useMemberAliasActions'

/** 팀 화면처럼 공간의 별칭을 지켜보며 이재환(mb_03)의 별칭을 고친다 */
function renderActions(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => ({
      aliases: useQuery(memberAliasesQueryOptions('ws_01')),
      actions: useMemberAliasActions('ws_01', 'mb_03'),
    }),
    { wrapper },
  )
}

const writes = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method }) => method === 'POST' || method === 'DELETE')

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('useMemberAliasActions', () => {
  it('누른 뒤 보내기 전에 세션이 끝나면 다시 연결돼도 추가·삭제를 보내지 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderActions(client)
    await waitFor(() => expect(result.current.aliases.data).toBeDefined())
    const learned = result.current.aliases.data?.find(({ id }) => id === 'al_10')
    if (learned === undefined) throw new Error('al_10 missing')
    const log = recordRequests()
    const onAdded = vi.fn()

    onlineManager.setOnline(false)
    act(() => result.current.actions.add('재환 대리', onAdded))
    act(() => result.current.actions.remove(learned))
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .filter(({ state }) => state.isPaused),
      ).toHaveLength(2),
    )
    act(() => endSessionScope())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(writes(log)).toEqual([])
    expect(onAdded).not.toHaveBeenCalled()
    expect(result.current.actions.addFeedback).toBeNull()
    expect(db.aliases.some(({ alias_id }) => alias_id === 'al_10')).toBe(true)
  })

  it('같은 틱에 두 번 눌러도 한 번만 보낸다', async () => {
    const client = createQueryClient()
    const { result } = renderActions(client)
    await waitFor(() => expect(result.current.aliases.data).toBeDefined())
    const log = recordRequests()
    const onAdded = vi.fn()

    act(() => {
      result.current.actions.add('재환 대리', onAdded)
      result.current.actions.add('재환 대리', onAdded)
    })

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(writes(log)).toHaveLength(1)
    expect(db.aliases.filter(({ alias_text }) => alias_text === '재환 대리')).toHaveLength(1)
  })
})
