import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { start } from './support'

/*
 * 스플래시는 12시간에 한 번, 다시 온 사람은 랜딩 대신 로그인 (#510). 시계(Date)를 고정해 12시간 규칙을 본다.
 * 키는 src/shared/lib/splash/splashRecord.ts 의 SPLASH_RECORD_KEY 다 — E2E 는 앱 모듈을 불러오지 않으므로 그대로 적는다.
 * 설정의 움직임 줄이기(reduce) 그대로다. 줄이기면 `시작하기` 스플래시는 정면으로 0.8초 머물고 걷힌다
 */

const RECORD_KEY = 'splash-last-shown:v1'
const NOW = new Date('2026-11-08T09:00:00+09:00')
const HOUR = 60 * 60 * 1000
const LANDING_TITLE = /한 번의 클릭으로/

interface SplashSeen {
  /** React 가 그린 스플래시 판(`.splash` 이고 #boot-splash 가 아닌 것)이 문서에 붙었다 */
  react: boolean
  /** 판에 붙었던 사라짐 길이 표시(data-fade) */
  fades: string[]
}

async function watchReactSplash(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: SplashSeen = { react: false, fades: [] }
    Object.assign(window, { __splashSeen: seen })
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target
        if (record.type === 'attributes' && target instanceof HTMLElement) {
          const fade = target.getAttribute('data-fade')
          if (fade !== null) seen.fades.push(fade)
        }
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('splash') && node.id === '') {
            seen.react = true
            const fade = node.getAttribute('data-fade')
            if (fade !== null) seen.fades.push(fade)
          }
        }
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-fade'],
    })
  })
}

const splashSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __splashSeen: SplashSeen }).__splashSeen)
const reactSplashSeen = async (page: Page) => (await splashSeen(page)).react

const record = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), RECORD_KEY)

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW)
})

test('처음 방문 → 랜딩 → 시작하기 → 스플래시 → 로그인. 다시 `/` 는 로그인, 로그인 로고는 랜딩', async ({
  page,
}) => {
  await start(page, 'signed-out', '/')
  await expect(page.getByRole('heading', { name: LANDING_TITLE })).toBeVisible()
  expect(await record(page)).toBeNull()

  await page.getByRole('banner').getByRole('link', { name: '시작하기' }).click()
  // 누른 순간 정면으로 덮는다(등장 없음)
  await expect(page.locator('.splash[data-instant]')).toBeVisible()
  await expect(page).toHaveURL('/login')
  await expect(page.locator('.splash')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
  expect(Number(await record(page))).toBe(NOW.getTime())

  // 뒤로 가기는 앱 안 이동이다 — 들어올 때는 처음 온 사람이었으니 랜딩 그대로다
  await page.goBack()
  await expect(page.getByRole('heading', { name: LANDING_TITLE })).toBeVisible()

  // 바깥에서(주소 입력) 다시 `/` — 써 본 브라우저라 로그인으로 바꿔 보낸다. 랜딩 화면 코드는 받지 않는다
  const landingChunk: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/src/pages/landing/')) landingChunk.push(request.url())
  })
  await page.goto('/')
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
  await expect(page.getByRole('heading', { name: LANDING_TITLE })).toHaveCount(0)
  expect(landingChunk).toEqual([])

  // 로그인 화면 로고(앱 안 링크)로는 랜딩을 다시 본다
  await page.getByRole('link', { name: "Manager's Manager" }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: LANDING_TITLE })).toBeVisible()

  // 12시간 안이라 이번 `시작하기` 는 스플래시 없이 바로 로그인이다
  await page.getByRole('banner').getByRole('link', { name: '시작하기' }).click()
  await expect(page).toHaveURL('/login')
  await expect(page.locator('.splash')).toHaveCount(0)
})

/** 세션 확인을 늦춘 채 path 로 들어간다. 둘러보기가 시작되는 1.5초를 넘겨 전체 스플래시가 반드시 보인다 (msw-auth-delay) */
async function openHeld(page: Page, path: string): Promise<void> {
  await page.goto(`${path}?msw-scenario=signed-out&msw-auth-delay=2500`)
}

const splashStatus = (page: Page) => page.locator('.splash [role="status"]')

test('12시간 안 새로고침은 정적 스플래시 없이 뼈대 → 화면, 12시간이 지나면 다시 전체 스플래시다', async ({
  page,
}) => {
  await watchReactSplash(page)
  // 처음 접속. 세션 확인을 붙잡아 두어 스플래시가 둘러보기까지 보이고 기록된다
  await openHeld(page, '/login')
  await expect(splashStatus(page)).toHaveText('로그인 확인 중')
  expect(Number(await record(page))).toBe(NOW.getTime())
  await expect(page.locator('.splash')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()

  // 11시간 뒤 다시 들어온다. 같은 2.5초를 붙잡아도 판 없이 뼈대가 기다린다
  await page.clock.setFixedTime(new Date(NOW.getTime() + 11 * HOUR))
  await openHeld(page, '/login')
  await expect(page.locator('html')).toHaveAttribute('data-splash', 'skip')
  await expect(page.locator('main[aria-busy="true"]')).toBeVisible()
  await expect(page.locator('#boot-splash')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible({ timeout: 15_000 })
  expect(await reactSplashSeen(page)).toBe(false)
  // 건너뛴 접속은 기록을 고치지 않는다
  expect(Number(await record(page))).toBe(NOW.getTime())

  // 13시간 뒤에는 다시 전체 스플래시가 보이고 새 시각을 기록한다
  await page.clock.setFixedTime(new Date(NOW.getTime() + 13 * HOUR))
  await openHeld(page, '/login')
  await expect(page.locator('html')).not.toHaveAttribute('data-splash')
  await expect(splashStatus(page)).toHaveText('로그인 확인 중')
  expect(Number(await record(page))).toBe(NOW.getTime() + 13 * HOUR)
  await expect(page.locator('.splash')).toHaveCount(0, { timeout: 15_000 })
})

test('등장 시각(0.3초) 전에 준비되면 스플래시가 보이지 않고 기록도 바뀌지 않는다', async ({
  page,
}) => {
  // 준비가 등장 시각보다 먼저 오도록 앱이 읽는 performance.now 만 30초 늦춘다. 스플래시 시계의 차이(경과)만 바뀌고
  // 개발 서버 속도와 상관없이 등장 시각 전에 준비된 것과 같다. 기록 시각은 Date(고정)라 영향이 없다
  await page.addInitScript(() => {
    const now = performance.now.bind(performance)
    performance.now = () => now() - 30_000
  })
  const shownAt = NOW.getTime() - 13 * HOUR
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
    },
    [RECORD_KEY, String(shownAt)],
  )

  await start(page, 'signed-out', '/login')
  await expect(page.locator('html')).not.toHaveAttribute('data-splash')
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
  expect(Number(await record(page))).toBe(shownAt)
})

test('설치한 앱은 12시간 안이어도 정적 판을 그리고, 끝맺음 없이 짧게 사라진다', async ({
  page,
}) => {
  // Chromium 의 CDP 는 display-mode 를 흉내 내지 못한다(setEmulatedMedia 가 받지 않는다). 판정은 JS(matchMedia)가 하므로
  // 그 질의만 standalone 으로 답한다. CSS 의 @media (display-mode: standalone)(등장 없음)는 이 테스트 밖이다
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string) =>
      query === '(display-mode: standalone)'
        ? ({
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          } as MediaQueryList)
        : original(query)
  })
  await page.addInitScript(
    ([key, shownAt]) => {
      window.localStorage.setItem(key, shownAt)
    },
    [RECORD_KEY, String(NOW.getTime() - HOUR)],
  )
  await watchReactSplash(page)

  await start(page, 'signed-out', '/login')
  await expect(page.locator('html')).toHaveAttribute('data-splash', 'quick')
  expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true)
  // 정적 판을 React 가 이어받아 걷었다. 전체 스플래시가 아니라 기록은 그대로다
  const seen = await splashSeen(page)
  expect(seen.react).toBe(true)
  expect(seen.fades).toContain('quick')
  expect(Number(await record(page))).toBe(NOW.getTime() - HOUR)
})
