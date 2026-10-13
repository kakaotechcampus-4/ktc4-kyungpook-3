import type { Integrations, IntegrationStatus } from '../model/types'
import { waitWhileConnecting } from './waitWhileConnecting'

function integrations(notion: IntegrationStatus): Integrations {
  return {
    discord: { provider: 'discord', status: 'connected', displayName: null, connectedAt: null },
    notion: { provider: 'notion', status: notion, displayName: null, connectedAt: null },
  }
}

function sequence(...statuses: IntegrationStatus[]) {
  const load = vi.fn<() => Promise<Integrations>>()
  for (const status of statuses) load.mockResolvedValueOnce(integrations(status))
  return load
}

const instant = { sleep: () => Promise.resolve(), intervalMs: 3000, timeoutMs: 9000 }

describe('waitWhileConnecting', () => {
  it('준비 중이 아니면 한 번만 조회하고 그 값을 돌려준다', async () => {
    const load = sequence('connected')

    const result = await waitWhileConnecting(load, 'notion', instant)

    expect(result?.notion.status).toBe('connected')
    expect(load).toHaveBeenCalledOnce()
  })

  it('준비 중이면 끝난 상태(connected·revoked)가 올 때까지 다시 조회한다', async () => {
    const load = sequence('connecting', 'connecting', 'revoked')
    const onConnecting = vi.fn()

    const result = await waitWhileConnecting(load, 'notion', { ...instant, onConnecting })

    expect(result?.notion.status).toBe('revoked')
    expect(load).toHaveBeenCalledTimes(3)
    expect(onConnecting).toHaveBeenCalledTimes(2)
  })

  it('기다릴 시간이 지나도 준비 중이면 마지막 값을 돌려주고 더 묻지 않는다', async () => {
    const load = vi.fn(() => Promise.resolve(integrations('connecting')))

    const result = await waitWhileConnecting(load, 'notion', instant)

    // 0·3·6·9초에 묻는다. 9초가 기다릴 수 있는 끝이다
    expect(load).toHaveBeenCalledTimes(4)
    expect(result?.notion.status).toBe('connecting')
  })

  it('그만두라고 하면 다음 조회를 하지 않고 null 이다', async () => {
    const load = sequence('connecting', 'connected')
    let stopped = false

    const result = await waitWhileConnecting(load, 'notion', {
      ...instant,
      shouldStop: () => stopped,
      onConnecting: () => {
        stopped = true
      },
    })

    expect(result).toBeNull()
    expect(load).toHaveBeenCalledOnce()
  })

  it('조회가 실패하면 그 오류를 그대로 던진다 — 확인하지 못한 것을 연결로 보지 않게', async () => {
    const load = vi.fn().mockRejectedValue(new Error('network'))

    await expect(waitWhileConnecting(load, 'notion', instant)).rejects.toThrow('network')
  })
})
