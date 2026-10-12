const MOCK_WORKER_SCRIPT = '/mockServiceWorker.js'

function isMockWorker(worker: ServiceWorker | null | undefined): boolean {
  return worker != null && new URL(worker.scriptURL).pathname === MOCK_WORKER_SCRIPT
}

/**
 * 예전에 MSW 로 띄운 브라우저에는 mock worker 가 등록된 채 남는다. 실제 API 로 띄울 때 그 worker 를 지운다.
 * 지금 페이지가 그 worker 의 관리 아래 있으면 해제만으로는 이번 페이지가 벗어나지 못한다 —
 * true 를 돌려주면 호출한 쪽이 한 번 다시 불러온다. 다시 불러온 페이지는 관리자가 없어 또 돌지 않는다
 */
export async function unregisterMockWorker(
  container: ServiceWorkerContainer | undefined = navigator.serviceWorker,
): Promise<boolean> {
  if (!container) return false
  const registrations = await container.getRegistrations()
  const mocks = registrations.filter((registration) =>
    [registration.active, registration.waiting, registration.installing].some(isMockWorker),
  )
  await Promise.all(mocks.map((registration) => registration.unregister()))
  return isMockWorker(container.controller)
}
