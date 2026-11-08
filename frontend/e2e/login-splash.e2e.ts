import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { start } from './support'

/*
 * 로그인 직후 스플래시는 0.3초 대기 없이 누른 순간 덮는다 (#539). 그 사이 도착 화면의 라우트 뼈대가 먼저 보였다가
 * 스플래시로 바뀌는 깜빡임이 없다. 12시간 기록과 상관없이 보이고 기록한다 (#510).
 * 키는 src/shared/lib/splash/splashRecord.ts 의 SPLASH_RECORD_KEY 다 — E2E 는 앱 모듈을 불러오지 않으므로 그대로 적는다.
 * 설정의 움직임 줄이기(reduce) 그대로다
 */

const RECORD_KEY = 'splash-last-shown:v1'
const NOW = new Date('2026-11-08T09:00:00+09:00')
const HOUR = 60 * 60 * 1000
const DASHBOARD = '/workspaces/ws_01/dashboard'

interface LoginTrace {
  /** 로그인을 누른 뒤부터 본다 */
  armed: boolean
  /** 스플래시 판이 처음 붙었다 */
  splash: boolean
  /** 스플래시가 붙기 전에 앱에 뼈대(aria-busy)가 그려졌다 */
  bareSkeleton: boolean
}

/** 로그인을 누른 뒤 스플래시보다 뼈대가 먼저 그려지는지 DOM 이 바뀔 때마다 본다 */
async function traceLogin(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const trace: LoginTrace = { armed: false, splash: false, bareSkeleton: false }
    Object.assign(window, { __loginTrace: trace })
    new MutationObserver(() => {
      if (!trace.armed || trace.splash) return
      if (document.querySelector('.splash') !== null) {
        trace.splash = true
        return
      }
      if (document.querySelector('#root [aria-busy="true"]:not(button)') !== null) {
        trace.bareSkeleton = true
      }
    }).observe(document, { childList: true, subtree: true, attributes: true })
  })
}

const loginTrace = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loginTrace: LoginTrace }).__loginTrace)

const record = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), RECORD_KEY)

/** 12시간 안에 다시 온 사람이다. 접속 스플래시는 건너뛰고, 로그인 직후 스플래시만 본다 */
async function openLoginRecentlySeen(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
    },
    [RECORD_KEY, String(NOW.getTime() - HOUR)],
  )
  await traceLogin(page)
  await start(page, 'signed-out', `/login?next=${encodeURIComponent(DASHBOARD)}`)
  await expect(page.locator('html')).toHaveAttribute('data-splash', 'skip')
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible()
}

async function logIn(page: Page): Promise<void> {
  await page.getByLabel('이메일').fill('pm@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('mock-password')
  await page.evaluate(() => {
    ;(window as unknown as { __loginTrace: LoginTrace }).__loginTrace.armed = true
  })
  await page.getByRole('button', { name: '로그인', exact: true }).click()
}

test('로그인 → 대시보드는 누른 뒤 스플래시가 먼저 덮는다 — 그 전에 뼈대가 보이지 않고, 12시간 안이어도 기록한다', async ({
  page,
}) => {
  await openLoginRecentlySeen(page)
  await logIn(page)

  await expect(page).toHaveURL(DASHBOARD)
  await expect(page.locator('.splash')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible()
  expect(await loginTrace(page)).toEqual({ armed: true, splash: true, bareSkeleton: false })
  expect(Number(await record(page))).toBe(NOW.getTime())
})

test('대시보드 화면 코드가 늦어도 뼈대가 스플래시 전에 보이지 않고, 스플래시가 화면 코드를 기다린다', async ({
  page,
  context,
}) => {
  // 대시보드 화면 코드(개발 서버의 모듈)를 1.5초 늦춘다. 둘러보기가 시작되는 1.5초를 넘겨 기다림이 보인다
  let delayed = 0
  await context.route('**/src/pages/dashboard/**', async (route) => {
    delayed += 1
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await route.continue()
  })
  await openLoginRecentlySeen(page)
  await logIn(page)

  await expect(page).toHaveURL(DASHBOARD)
  // 화면 코드를 기다리는 라우트 뼈대가 판 아래에 있고, 판이 그것을 기다린다
  await expect(page.locator('.splash [role="status"]')).toHaveText('로그인 확인 중', {
    timeout: 5_000,
  })
  await expect(page.locator('#root main[aria-busy="true"]')).toHaveCount(1)
  await expect(page.locator('.splash')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1, name: '대시보드' })).toBeVisible()
  expect(delayed).toBeGreaterThan(0)
  expect(await loginTrace(page)).toEqual({ armed: true, splash: true, bareSkeleton: false })
  expect(Number(await record(page))).toBe(NOW.getTime())
})
