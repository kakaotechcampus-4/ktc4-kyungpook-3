import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { start } from './support'

/*
 * #536 — 셸 탭의 화면 코드와 첫 화면 데이터를 셸이 뜬 뒤 한가할 때 미리 받는다. 여기서는 #536 의 다섯 탭을 본다(프로젝트 맵은 그래프 chunk 를 탭을 고를 때 받아 이 검사에 넣지 않았다, D-186).
 * API 를 모두 350ms 늦춘 채 설정 화면에서 셸이 뜬 뒤, 한가할 때 받기를 테스트가 직접 실행하고 그 미리 받기가 실제로 끝나기를
 * (각 탭이 이어 받는 마지막 조회까지 답을 받고, 진행 중인 API·화면 코드 요청이 없기를) 기다린 다음 각 탭으로 처음 옮긴다.
 * 누른 순간부터 내용이 뜰 때까지 프레임마다(그리고 DOM 이 바뀔 때마다) 화면 본문을 적는다 — 라우트 뼈대·화면 안 뼈대·뼈대 앞의
 * 빈 지연 구간(#527 의 `data-skeleton="blank"`)이 한 프레임도 없어야 한다. 이전 화면에서 바로 새 화면 내용으로 바뀐다.
 * 임의 waitForTimeout 이나 네트워크가 잠잠한 시간으로 끝을 판정하지 않는다 — 한가할 때를 앱의 상한(2초)에 맡기면 바쁜 CI 에서
 *   늦게 돌 수 있어 테스트가 붙잡았다가 부른다 (#536 리뷰).
 */

/** 이슈의 측정 조건. 이만큼 늦으면 미리 받지 않은 화면은 뼈대(#527 지연 200ms 넘음)를 반드시 거친다 */
const API_LAG = 350

/**
 * 한가할 때 받기가 끝났다고 볼 조회(경로). 탭마다 이어 받는 사슬의 마지막이다 — 대시보드는 목록 → 상세 → 추출,
 * 회의록은 목록 → 기본 회의 상세 → 회의록 본문, 메시지(PM)는 받은 목록, 팀은 Discord 사용자, 태스크는 태스크 목록
 */
const PREFETCH_ENDS = [
  /^\/api\/v1\/extractions\/[^/]+$/,
  /^\/api\/v1\/meetings\/[^/]+\/minutes$/,
  /^\/api\/v1\/workspaces\/ws_01\/messages$/,
  /^\/api\/v1\/workspaces\/ws_01\/discord\/members$/,
  /^\/api\/v1\/tasks$/,
]

const WS = '/workspaces/ws_01'

interface Sample {
  at: number
  path: string
  /** 화면 본문의 로딩 자리 — 라우트 뼈대·화면 안 뼈대(aria-busy 컨테이너). 버튼의 진행 표시는 뺀다 */
  busy: number
  /** #527 의 지연 자리(빈 자리 `blank` · 뼈대 `shown`) */
  deferred: number
  heading: string | null
  /** 로딩 자리가 있으면 그 자리를 알아볼 단서(가까운 이름표). 실패 메시지에 나온다 */
  where: string[]
}

declare global {
  interface Window {
    __shellSamples?: Sample[]
    __stopShellSampling?: boolean
    /** 늦추기 대기를 포함해 아직 끝나지 않은 API 요청 수 */
    __apiPending?: number
    /** 답(성공·실패)을 받은 API 경로 */
    __apiAnswered?: string[]
    /** 앱이 맡긴 한가할 때 일. 테스트가 부를 때까지 붙잡는다 */
    __idleCallbacks?: Map<number, IdleRequestCallback>
  }
}

/** 앱의 API 요청(XHR)을 ms 만큼 늦게 보낸다 — 앱 코드·MSW 응답은 그대로다 (meeting-skeleton.e2e.ts 와 같은 방법) */
function lagApi(page: Page, ms: number) {
  return page.addInitScript((ms) => {
    class LaggedRequest extends XMLHttpRequest {
      private url = ''
      open(
        method: string,
        url: string | URL,
        async = true,
        username?: string | null,
        password?: string | null,
      ) {
        this.url = new URL(String(url), location.href).pathname
        super.open(method, url, async, username, password)
      }
      send(body?: Document | XMLHttpRequestBodyInit | null) {
        if (!this.url.startsWith('/api/')) return super.send(body)
        const url = this.url
        window.__apiPending = (window.__apiPending ?? 0) + 1
        this.addEventListener('loadend', () => {
          window.__apiPending = (window.__apiPending ?? 1) - 1
          ;(window.__apiAnswered ??= []).push(url)
        })
        setTimeout(() => super.send(body), ms)
      }
    }
    window.XMLHttpRequest = LaggedRequest
  }, ms)
}

/** 앱의 한가할 때 일을 붙잡아 둔다 — `runIdleAndWait` 가 부를 때까지 돌지 않는다. 취소(StrictMode 의 effect 다시 돌기)는 지운다 */
function holdIdle(page: Page) {
  return page.addInitScript(() => {
    const held = new Map<number, IdleRequestCallback>()
    let next = 1
    window.__idleCallbacks = held
    window.requestIdleCallback = (callback) => {
      held.set(next, callback)
      return next++
    }
    window.cancelIdleCallback = (handle) => {
      held.delete(handle)
    }
  })
}

/** 앱 진입 전부터 화면 코드·API 요청이 진행 중인지 센다 */
function trackRequests(page: Page) {
  let inFlight = 0
  page.on('request', () => (inFlight += 1))
  page.on('requestfinished', () => (inFlight -= 1))
  page.on('requestfailed', () => (inFlight -= 1))
  return { inFlight: () => inFlight }
}

/**
 * 붙잡아 둔 한가할 때 일(셸 탭 미리 받기)을 부르고, 그 미리 받기가 실제로 끝나기를 기다린다 —
 * 탭마다 사슬의 마지막 조회가 답을 받았고, 늦추기 대기를 포함해 진행 중인 API 요청과 화면 코드 요청이 없다
 */
async function runIdleAndWait(page: Page, requests: { inFlight: () => number }) {
  // 셸이 맡긴 일은 하나다(공간·역할이 그대로면 다시 맡기지 않는다)
  await expect.poll(() => page.evaluate(() => window.__idleCallbacks?.size ?? 0)).toBe(1)
  await page.evaluate(() => {
    const held = window.__idleCallbacks!
    const callbacks = [...held.values()]
    held.clear()
    for (const callback of callbacks) callback({ didTimeout: false, timeRemaining: () => 50 })
  })
  const ends = PREFETCH_ENDS.map((pattern) => pattern.source)
  await expect
    .poll(
      async () =>
        requests.inFlight() === 0 &&
        (await page.evaluate(
          (ends) =>
            (window.__apiPending ?? 0) === 0 &&
            ends.every((end) =>
              (window.__apiAnswered ?? []).some((path) => new RegExp(end).test(path)),
            ),
          ends,
        )),
      { timeout: 20_000, intervals: [100] },
    )
    .toBe(true)
}

/** 지금부터 프레임마다·DOM 이 바뀔 때마다 화면 본문을 적는다. 거르지 않는다 */
function recordFrames(page: Page) {
  return page.evaluate(() => {
    const samples: Sample[] = []
    window.__shellSamples = samples
    window.__stopShellSampling = false
    const sample = () => {
      const main = document.querySelector('#root main')
      samples.push({
        at: performance.now(),
        path: location.pathname,
        busy: document.querySelectorAll(
          '#root main[aria-busy="true"], #root main [aria-busy="true"]:not(button)',
        ).length,
        deferred: document.querySelectorAll('#root [data-skeleton]').length,
        heading: main?.querySelector('h1')?.textContent ?? null,
        where: [
          ...document.querySelectorAll(
            '#root [data-skeleton], #root main[aria-busy="true"], #root main [aria-busy="true"]:not(button)',
          ),
        ].map((element) => {
          const labelled = element.closest('[aria-label], [data-testid]')
          return `${element.getAttribute('data-skeleton') ?? 'busy'}@${
            labelled?.getAttribute('aria-label') ?? labelled?.getAttribute('data-testid') ?? '?'
          }`
        }),
      })
    }
    const observer = new MutationObserver(sample)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })
    const frame = () => {
      if (window.__stopShellSampling) {
        observer.disconnect()
        return
      }
      sample()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

async function stopFrames(page: Page): Promise<Sample[]> {
  // 내용이 뜬 뒤 몇 프레임 더 적는다 — 뒤늦은 뼈대가 붙지 않는지도 본다
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let left = 10
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
  )
  return page.evaluate(() => {
    window.__stopShellSampling = true
    return window.__shellSamples ?? []
  })
}

const TABS = [
  { label: '대시보드', path: new RegExp(`^${WS}/dashboard$`) },
  // 기본 진입은 가장 최근 회의록으로 주소를 바꾼다
  { label: '회의록', path: new RegExp(`^${WS}/meetings/[^/]+$`) },
  { label: '태스크', path: new RegExp(`^${WS}/tasks$`) },
  { label: '메시지', path: new RegExp(`^${WS}/messages$`) },
  { label: '팀', path: new RegExp(`^${WS}/members$`) },
] as const

for (const { label, path } of TABS) {
  test(`한가할 때 미리 받은 뒤 처음 옮긴 ${label} 탭은 뼈대·빈 자리 없이 바로 내용이 뜬다`, async ({
    page,
  }) => {
    await lagApi(page, API_LAG)
    await holdIdle(page)
    const requests = trackRequests(page)
    await start(page, 'messages-default', `${WS}/settings`)
    await expect(page.getByRole('heading', { level: 1, name: '설정' })).toBeVisible()
    await runIdleAndWait(page, requests)

    await recordFrames(page)
    await page
      .getByRole('navigation', { name: '주요 화면' })
      .getByRole('link', { name: label, exact: true })
      .click()
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10_000 }).toMatch(path)
    await expect(page.locator('#root main h1')).toBeVisible()
    const samples = await stopFrames(page)

    // 새 화면이 그려진 샘플이 있어야 한다 — 기록이 이동을 놓치지 않았다
    expect(samples.some((sample) => path.test(sample.path) && sample.heading !== '설정')).toBe(true)
    const loading = samples.filter(({ busy, deferred }) => busy > 0 || deferred > 0)
    expect(loading, JSON.stringify(loading.slice(0, 5))).toEqual([])
  })
}
