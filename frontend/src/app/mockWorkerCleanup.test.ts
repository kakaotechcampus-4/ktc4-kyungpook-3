import { unregisterMockWorker } from './mockWorkerCleanup'

function worker(scriptURL: string): ServiceWorker {
  return { scriptURL } as ServiceWorker
}

function registration(active: ServiceWorker | null) {
  return {
    active,
    waiting: null,
    installing: null,
    unregister: vi.fn().mockResolvedValue(true),
  }
}

function container(
  registrations: ReturnType<typeof registration>[],
  controller: ServiceWorker | null = null,
): ServiceWorkerContainer {
  return {
    controller,
    getRegistrations: vi.fn().mockResolvedValue(registrations),
  } as unknown as ServiceWorkerContainer
}

describe('unregisterMockWorker', () => {
  it('mock worker 만 해제하고 다른 worker 는 그대로 둔다', async () => {
    const mock = registration(worker('http://localhost:5173/mockServiceWorker.js'))
    const other = registration(worker('http://localhost:5173/sw.js'))

    await expect(unregisterMockWorker(container([mock, other]))).resolves.toBe(false)

    expect(mock.unregister).toHaveBeenCalledOnce()
    expect(other.unregister).not.toHaveBeenCalled()
  })

  it('지금 페이지를 mock worker 가 관리하면 다시 불러오라고 알린다', async () => {
    const script = worker('http://localhost:5173/mockServiceWorker.js')
    const mock = registration(script)

    await expect(unregisterMockWorker(container([mock], script))).resolves.toBe(true)
    expect(mock.unregister).toHaveBeenCalledOnce()
  })

  it('service worker 를 지원하지 않으면 아무것도 하지 않는다', async () => {
    await expect(unregisterMockWorker(undefined)).resolves.toBe(false)
  })
})
