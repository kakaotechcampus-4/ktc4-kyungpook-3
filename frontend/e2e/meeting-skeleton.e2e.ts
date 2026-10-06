import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { start } from './support'

/*
 * UX1 — 회의록의 로딩 자리 (docs/impl-decision/2026-10-06-minutes-skeleton-and-selection.md). 1440px.
 * ① 첫 진입: 가드가 세션·소속을 기다리는 단계(헤더 뼈대 + 화면 뼈대) → 화면 코드 대기(라우트 스켈레톤) → 데이터 대기(위젯 스켈레톤)
 *    → 완성까지, 첫 프레임부터 **모든 샘플**에서 헤더 아래 선·목록·본문 머리 자리가 완성 화면과 같다.
 *    앱 코드보다 먼저 requestAnimationFrame 마다(그리고 DOM 이 바뀔 때마다) 자리를 적는다. 어떤 단계도 걸러 내지 않는다 (UX1-M01).
 *    가드 단계가 늘 지나가도록 세션·소속 답을 XHR 에서 늦춘다 — 앱 코드·MSW 응답은 그대로다.
 * ② 회의를 연달아 고르면(빠른 MSW) 본문 스켈레톤이 한 번도 붙지 않는다.
 * ③ 고른 회의의 상세 답이 0·180·650ms 늦어도 목록 선택 표시와 본문 머리 제목이 어긋난 프레임이 없고, 흐림은 들고 있는 동안만이다 (UX1-M02).
 * ④ 참석자가 많아도 참석자 줄은 칩 한 줄 높이이고 남는 사람은 `+N` 이다. 1024px · 참석자 10명(이름 칩이 두 줄로 접히던 데이터)에서
 *    첫 가드부터의 모든 샘플과 연달아 고르기의 모든 샘플이 완성 화면과 같은 자리다 (UX1-M03).
 *    창 크기를 바꾸는 동안 그려지는 모든 프레임에서 잘린 칩 · 낡은 `+N` 이 없다 (UX1-N02).
 * ⑤ 제목이 길어도 늘 한 줄이고 넘치면 말줄임이다 — 1024px 에서 첫 가드부터 · 연달아 고르기의 모든 샘플이 같은 자리고,
 *    가리키거나 키보드로 제목에 가면 전체 제목이 뜬다 (UX1-M04).
 * ⑥ 상세 답이 들고 있기 상한을 막 넘겨 와도 본문 뼈대가 번쩍이지 않는다 — 한 번 보인 뼈대는 최소 시간 이어진다 (UX1-N03).
 * 들고 있기 · 뼈대 시간의 정확한 경계는 Vitest 가 가짜 시계로 본다(model/useShownMeeting.test.ts, app/meetingMinutesSelection.test.tsx).
 * 여기는 실제 Chromium 의 프레임 · 밀리초다 — 부하는 시간을 늦출 뿐 당기지 않으므로 아래쪽 한계(이보다 일찍 바뀌지 않는다)만 잰다.
 * 임의 waitForTimeout 은 쓰지 않는다 — 화면 조건과 다음 프레임을 기다린다.
 */

const FIRST_PAINT = { timeout: 15_000 }

/** 위치를 같은 자리로 볼 오차(px). 글자 줄 높이의 소수점 반올림만 허용한다 */
const SAME_SPOT = 1

/** 가드 단계를 늘 지나가게 하는 답 지연(ms). 몇 프레임은 넉넉히 그려질 길이다 */
const GUARD_LAG = 300

/* widgets/meeting-minutes/model/useShownMeeting.ts 의 값. E2E 는 앱 모듈(별칭 `@`)을 가져오지 않아 옮겨 적었다 */
/** 고른 회의의 답을 기다리며 이전 본문을 들고 있는 최대 시간 */
const MINUTES_HOLD_MS = 250
/** 회의를 바꾸며 그린 본문 뼈대를 두는 최소 시간 */
const MINUTES_SKELETON_MIN_MS = 300
/** 한 프레임(60Hz). 샘플은 커밋 뒤에 적히므로 뼈대가 붙은 샘플이 커밋보다 이만큼까지 늦을 수 있다 */
const FRAME_MS = 1000 / 60

/** 한 줄에 다 들지 않는 정상 입력의 회의 제목 — 3회차 검증이 두 줄 접힘(+33.8px)을 재현한 제목이다 */
const LONG_TITLE =
  '2026년 10월 서비스 출시 계획과 개발 일정 및 사용자 피드백을 함께 논의하는 정기 회의'

interface Spot {
  x: number
  y: number
  width: number
}

interface PlaceSample {
  at: number
  /** 이 샘플의 단계 — guard: 헤더 뼈대, route: 회의록 라우트 뼈대, widget: 본문 뼈대, real: 완성 */
  stage: 'guard' | 'route' | 'widget' | 'real'
  /** 헤더(뼈대 또는 진짜) 아래 끝 */
  headerBottom: number | null
  /** 화면의 main 위 끝 */
  mainTop: number | null
  aside: Spot | null
  /** 목록이 시작하는 자리 — 목록 머리 줄의 아래 끝 */
  listTop: number | null
  title: Spot | null
  /** 제목 줄(뼈대 또는 진짜)의 높이 — 제목이 길어도 한 줄이다 */
  titleHeight: number | null
  tabsTop: number | null
}

interface SelectionSample {
  at: number
  /** 목록에서 aria-current 인 회의 제목 */
  current: string | null
  /** 본문 머리에 보이는 제목 */
  title: string | null
  skeleton: boolean
  /** 들고 있는 이전 본문 (aria-busy) */
  held: boolean
  /** 본문의 실제 불투명도(getComputedStyle) */
  opacity: number | null
}

declare global {
  interface Window {
    __places?: PlaceSample[]
    __selection?: SelectionSample[]
    __clickedAt?: number
    __rowFrames?: RowFrame[]
    __detailSkeletonSeen?: boolean
    __stopSampling?: boolean
  }
}

/** 이 주소(정규식 원문)로 가는 XHR 을 ms 만큼 늦게 보낸다 — 앱의 API 클라이언트는 axios(XHR)다 */
function lagRequests(page: Page, pattern: string, ms: number) {
  return page.addInitScript(
    ({ pattern, ms }) => {
      const matcher = new RegExp(pattern)
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
          if (!matcher.test(this.url)) return super.send(body)
          setTimeout(() => super.send(body), ms)
        }
      }
      window.XMLHttpRequest = LaggedRequest
    },
    { pattern, ms },
  )
}

/** 앱 코드보다 먼저 지켜보기 시작한다 — 프레임마다·DOM 이 바뀔 때마다 헤더·목록·본문 머리 자리를 적는다. 거르지 않는다 */
function recordPlaces(page: Page) {
  return page.addInitScript(() => {
    const samples: PlaceSample[] = []
    window.__places = samples
    const box = (element: Element | null | undefined) => {
      if (!element) return null
      const { x, y, width } = element.getBoundingClientRect()
      return { x, y, width }
    }
    const sample = () => {
      if (window.__stopSampling) return
      const headerSkeleton = document.querySelector('[data-testid="app-header-skeleton"]')
      const header = headerSkeleton ?? document.querySelector('#root header')
      const asideSkeleton = document.querySelector('[data-testid="minutes-skeleton-aside"]')
      const aside = asideSkeleton ?? document.querySelector('aside[aria-label="회의 목록"]')
      const detailSkeleton = document.querySelector('[data-testid="minutes-detail-skeleton"]')
      const title =
        document.querySelector('[data-testid="minutes-detail-skeleton-title"]') ??
        document.querySelector('section[aria-label="회의록 본문"] h2')
      const tabs =
        document.querySelector('[data-testid="minutes-detail-skeleton-tabs"]') ??
        document.querySelector('section[aria-label="회의록 본문"] [role="tablist"]')
      const main = document.querySelector('#root main')
      if (!header && !aside && !title && !main) return
      samples.push({
        at: performance.now(),
        stage: headerSkeleton
          ? 'guard'
          : asideSkeleton
            ? 'route'
            : detailSkeleton
              ? 'widget'
              : 'real',
        headerBottom: header ? header.getBoundingClientRect().bottom : null,
        mainTop: main ? main.getBoundingClientRect().top : null,
        aside: box(aside),
        listTop: aside?.firstElementChild
          ? aside.firstElementChild.getBoundingClientRect().bottom
          : null,
        title: box(title),
        titleHeight: title ? title.getBoundingClientRect().height : null,
        tabsTop: tabs ? tabs.getBoundingClientRect().top : null,
      })
    }
    const frame = () => {
      sample()
      if (!window.__stopSampling) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    new MutationObserver(sample).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
    })
  })
}

/** 다음 두 프레임까지 기다린다 — 마지막 커밋이 그려진 뒤에 샘플을 닫는다 */
async function nextFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}

/** 완성된 회의록 — 본문 제목·탭·참석자(회의록에서만 온다)가 있고 기다리는 표시가 없다 */
async function minutesComplete(page: Page, title: string) {
  const body = page.getByRole('region', { name: '회의록 본문' })
  await expect(body.getByRole('heading', { level: 2, name: title })).toBeVisible(FIRST_PAINT)
  await expect(body.getByRole('list', { name: '참석자' })).toBeVisible()
  await expect(body.getByRole('tablist')).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
}

async function closePlaces(page: Page) {
  await nextFrames(page)
  return page.evaluate(() => {
    window.__stopSampling = true
    return window.__places ?? []
  })
}

function near(actual: number | null, expected: number | null) {
  expect(actual).not.toBeNull()
  expect(expected).not.toBeNull()
  expect(Math.abs(actual! - expected!)).toBeLessThanOrEqual(SAME_SPOT)
}

/** 첫 샘플부터 마지막까지 모든 자리가 완성 화면(마지막 샘플)과 같다 */
function expectStill(samples: PlaceSample[]) {
  const real = samples[samples.length - 1]
  expect(real.stage).toBe('real')
  expect(real.headerBottom).not.toBeNull()
  for (const sample of samples) {
    if (sample.headerBottom !== null) near(sample.headerBottom, real.headerBottom)
    if (sample.mainTop !== null) near(sample.mainTop, real.mainTop)
    if (sample.aside) {
      near(sample.aside.x, real.aside!.x)
      near(sample.aside.y, real.aside!.y)
      expect(sample.aside.width).toBe(real.aside!.width)
    }
    if (sample.listTop !== null) near(sample.listTop, real.listTop)
    if (sample.title) {
      near(sample.title.x, real.title!.x)
      near(sample.title.y, real.title!.y)
    }
    if (sample.titleHeight !== null) near(sample.titleHeight, real.titleHeight)
    if (sample.tabsTop !== null) near(sample.tabsTop, real.tabsTop)
  }
}

test.use({ viewport: { width: 1440, height: 900 } })

test.describe('첫 진입 — 첫 가드 프레임부터 완성까지 헤더·목록·본문 자리가 움직이지 않는다 (UX1-M01)', () => {
  test('회의록 직접 진입 — 세션을 기다리는 가드 단계부터', async ({ page }) => {
    await lagRequests(page, '/api/v1/auth/me$', GUARD_LAG)
    await recordPlaces(page)
    await start(page, 'meeting-demo', '/workspaces/ws_01/meetings/mt_09')
    await minutesComplete(page, '3주차 정기회의')
    const samples = await closePlaces(page)

    // 가드(헤더 뼈대) · 라우트 또는 본문 뼈대 · 완성이 모두 지나갔다 — 빈 검사가 아니다
    expect(samples.some(({ stage }) => stage === 'guard')).toBe(true)
    expect(samples.some(({ stage }) => stage === 'route' || stage === 'widget')).toBe(true)
    // 가드 단계에도 목록·본문 자리가 있다
    expect(samples.some(({ stage, aside, title }) => stage === 'guard' && aside && title)).toBe(
      true,
    )
    expectStill(samples)
  })

  test('기본 진입(/meetings → 최신 회의) — 소속을 기다리는 가드 단계부터', async ({ page }) => {
    await lagRequests(page, '/api/v1/workspaces$', GUARD_LAG)
    await recordPlaces(page)
    await start(page, 'single-workspace', '/workspaces/ws_01/meetings')
    await minutesComplete(page, '3주차 정기회의')
    await expect(page).toHaveURL(/\/workspaces\/ws_01\/meetings\/mt_09$/)
    const samples = await closePlaces(page)

    expect(samples.some(({ stage }) => stage === 'guard')).toBe(true)
    expect(samples.some(({ stage }) => stage === 'route' || stage === 'widget')).toBe(true)
    expectStill(samples)
  })

  test('다른 셸 화면(대시보드)도 가드 단계에 헤더 자리가 있어 화면이 내려가지 않는다', async ({
    page,
  }) => {
    await lagRequests(page, '/api/v1/auth/me$', GUARD_LAG)
    await recordPlaces(page)
    await start(page, 'single-workspace', '/workspaces/ws_01/dashboard')
    await expect(page.getByRole('link', { name: '회의록으로 가기', exact: true })).toBeVisible(
      FIRST_PAINT,
    )
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    const samples = await closePlaces(page)

    expect(samples.some(({ stage }) => stage === 'guard')).toBe(true)
    const real = samples[samples.length - 1]
    for (const sample of samples) {
      if (sample.headerBottom !== null) near(sample.headerBottom, real.headerBottom)
      // 화면이 시작하는 자리는 언제나 헤더 아래다
      if (sample.mainTop !== null) near(sample.mainTop, real.headerBottom)
    }
  })
})

test('회의를 연달아 고르면 본문 스켈레톤이 한 번도 붙지 않는다', async ({ page }) => {
  await start(page, 'single-workspace', '/workspaces/ws_01/meetings/mt_09')
  await minutesComplete(page, '3주차 정기회의')

  await page.evaluate(() => {
    const selector = '[data-testid="minutes-detail-skeleton"]'
    window.__detailSkeletonSeen = document.querySelector(selector) !== null
    new MutationObserver((records) => {
      for (const { addedNodes } of records)
        for (const node of addedNodes)
          if (node instanceof Element && (node.matches(selector) || node.querySelector(selector)))
            window.__detailSkeletonSeen = true
    }).observe(document.body, { childList: true, subtree: true })
  })

  const list = page
    .getByRole('complementary', { name: '회의 목록' })
    .getByRole('list', { name: '정리된 회의' })
  for (const title of ['2주차 정기회의', '3주차 정기회의', '2주차 정기회의', '3주차 정기회의']) {
    await list.getByRole('link', { name: new RegExp(title) }).click()
    await minutesComplete(page, title)
  }

  expect(await page.evaluate(() => window.__detailSkeletonSeen)).toBe(false)
})

/**
 * 2주차를 가리키기(미리 받기) 없이 누른다 — 터치처럼 바로 누르는 경로. 누르기 전부터 프레임마다 · DOM 이 바뀔 때마다 적는다.
 * 완성된 회의록이 그려진 다음 프레임까지 적고 돌려준다. `clickedAt` 은 누르기 바로 전의 시각이다
 */
async function selectWithSamples(page: Page) {
  await page.evaluate(() => {
    const samples: SelectionSample[] = []
    window.__selection = samples
    window.__stopSampling = false
    const sample = () => {
      if (window.__stopSampling) return
      const region = document.querySelector('section[aria-label="회의록 본문"]')
      const body = region?.querySelector('[data-testid="minutes-body"]')
      samples.push({
        at: performance.now(),
        current:
          document.querySelector('ul[aria-label="정리된 회의"] [aria-current="page"] span')
            ?.textContent ?? null,
        title: region?.querySelector('h2')?.textContent ?? null,
        skeleton: region?.querySelector('[data-testid="minutes-detail-skeleton"]') != null,
        held: body?.getAttribute('aria-busy') === 'true',
        opacity: body ? Number(getComputedStyle(body).opacity) : null,
      })
    }
    const frame = () => {
      sample()
      if (!window.__stopSampling) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    new MutationObserver(sample).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    })
    const row = [...document.querySelectorAll('ul[aria-label="정리된 회의"] a')].find((link) =>
      link.textContent?.includes('2주차 정기회의'),
    ) as HTMLAnchorElement
    window.__clickedAt = performance.now()
    row.click()
  })
  await expect(page).toHaveURL(/\/meetings\/mt_07$/)
  await minutesComplete(page, '2주차 정기회의')
  await nextFrames(page)
  return page.evaluate(() => {
    window.__stopSampling = true
    return { samples: window.__selection ?? [], clickedAt: window.__clickedAt ?? 0 }
  })
}

for (const lag of [0, 180, 650]) {
  test(`고른 회의의 상세 답이 ${lag}ms 늦어도 선택 표시와 본문 머리 제목이 어긋난 프레임이 없다 (UX1-M02)`, async ({
    page,
  }) => {
    if (lag > 0) await lagRequests(page, '/api/v1/meetings/mt_07$', lag)
    await start(page, 'single-workspace', '/workspaces/ws_01/meetings/mt_09')
    await minutesComplete(page, '3주차 정기회의')
    const { samples, clickedAt } = await selectWithSamples(page)

    const after = samples.filter(({ current }) => current === '2주차 정기회의')
    expect(after.length).toBeGreaterThan(0)
    for (const sample of after) {
      // 선택 표시가 새 회의인 모든 프레임에서 보이는 머리 제목도 새 회의다
      expect(sample.title).toBe('2주차 정기회의')
      // 흐림은 들고 있는 본문에만 있다
      if (!sample.held && sample.opacity !== null) expect(sample.opacity).toBe(1)
    }
    const dimmed = after.filter(({ opacity }) => opacity !== null && opacity < 1)
    if (lag === 0) {
      // 빠른 답 — 스켈레톤도 흐림도 보이지 않는다(깜빡임 없음). 흐림은 들고 있기가 MINUTES_DIM_DELAY_MS(100ms)를 넘겨야
      // 실제로 그려진다 — Vitest 의 「0ms 답의 들고 있기 < 100ms」를 실제 프레임의 불투명도로 본다 (UX1-T01)
      expect(after.some(({ skeleton }) => skeleton)).toBe(false)
      expect(dimmed).toEqual([])
    } else {
      // 늦은 답 — 들고 있는 이전 본문이 실제로 흐려진 프레임이 있다
      expect(dimmed.length).toBeGreaterThan(0)
      expect(dimmed.every(({ held }) => held)).toBe(true)
    }
    if (lag === 650) {
      // 들고 있는 시간을 넘기면 본문 모양 스켈레톤 — 머리는 그대로 고른 회의다
      const skeletons = after.filter(({ skeleton }) => skeleton)
      expect(skeletons.length).toBeGreaterThan(0)
      expect(skeletons.every(({ title, held }) => title === '2주차 정기회의' && !held)).toBe(true)
      // 들고 있기는 상한까지다 — 상한보다 먼저 뼈대로 넘어가지 않는다 (Vitest 에서 옮긴 실제 시간 검사, UX1-T01)
      expect(skeletons[0].at - clickedAt).toBeGreaterThanOrEqual(MINUTES_HOLD_MS)
    }
  })
}

test('상세 답이 들고 있기 상한을 막 넘겨 와도 본문 뼈대가 번쩍이지 않는다 — 한 번 보인 뼈대는 최소 시간 이어진다 (UX1-N03)', async ({
  page,
}, testInfo) => {
  // 3회차 검증의 61ms 번쩍임 — 상세 전송 지연 180ms 에서 준비가 250ms 를 조금 넘긴 경우다. 여기서는 그 경계를 늘 넘기게
  // 상세를 상한보다 조금 늦게(280ms) 보낸다 — 뼈대가 반드시 그려지고, 답은 그 직후 온다
  await lagRequests(page, '/api/v1/meetings/mt_07$', MINUTES_HOLD_MS + 30)
  await start(page, 'single-workspace', '/workspaces/ws_01/meetings/mt_09')
  await minutesComplete(page, '3주차 정기회의')
  const { samples, clickedAt } = await selectWithSamples(page)
  const timeline = samples.map((sample) => ({ ...sample, at: sample.at - clickedAt }))
  await testInfo.attach('selection-timeline.json', {
    body: JSON.stringify(timeline, null, 2),
    contentType: 'application/json',
  })

  const after = timeline.filter(({ current }) => current === '2주차 정기회의')
  const first = after.findIndex(({ skeleton }) => skeleton)
  // 뼈대가 실제로 그려졌다 — 빈 검사가 아니다
  expect(first).toBeGreaterThan(-1)
  const end = after.findIndex(({ skeleton }, index) => index > first && !skeleton)
  expect(end).toBeGreaterThan(first)
  // 뼈대는 한 번 붙어 끊기지 않고, 걷힌 뒤 다시 붙지 않는다
  expect(after.slice(first, end).every(({ skeleton }) => skeleton)).toBe(true)
  expect(after.slice(end).some(({ skeleton }) => skeleton)).toBe(false)
  // 상한 전에는 그리지 않는다
  expect(after[first].at).toBeGreaterThanOrEqual(MINUTES_HOLD_MS)
  // 붙은 첫 샘플부터 걷힌 첫 샘플까지 최소 시간 — 샘플은 커밋 뒤에 적혀 붙은 샘플이 한 프레임까지 늦을 수 있다
  expect(after[end].at - after[first].at).toBeGreaterThanOrEqual(MINUTES_SKELETON_MIN_MS - FRAME_MS)
  // 뼈대 동안 머리는 고른 회의고 이전 본문이 없다
  for (const sample of after.slice(first, end))
    expect(sample).toMatchObject({ title: '2주차 정기회의', held: false })
})

/*
 * ④ UX1-M03 — 참석자 수를 바꾼 모의 db. 시나리오로 한 번 띄워 저장된 db(sessionStorage `msw-db`, shared/mock/persistence.ts)를 받아
 * 회의록 본문의 참석자와 목록 요약의 참석자 수만 바꾼다. 새 컨텍스트에서 앱 코드보다 먼저 그 db 를 넣고 들어간다 — 콜드 진입이다.
 */

/** 정상 길이의 표시명 — 역할을 괄호로 붙인 이름. 검증자가 두 줄 접힘을 재현한 데이터(UX1 r2)와 같은 꼴이다 */
const ATTENDEE_NAMES = [
  '김서연(기획)',
  '박민수(개발)',
  '이재환(설계)',
  '정하늘(검증)',
  '최지훈(개발)',
  '윤지수(기획)',
  '강민정(설계)',
  '신동현(개발)',
  '한유진(검증)',
  '오수빈(기획)',
  '임태윤(개발)',
  '서지아(디자인)',
  '황보민재(운영)',
  '조은비(검증)',
  '남궁현우(개발)',
  '배서현(기획)',
  '유하준(설계)',
  '문채원(디자인)',
  '송지호(개발)',
  '권나연(운영)',
]

interface StoredMeetingDb {
  db: {
    meetings: { meeting_id: string; title: string }[]
    minutes: {
      meeting_id: string
      title: string
      attendees: { member_id: string; display_name: string }[]
    }[]
    meetingSummaries: { meeting_id: string; title: string; attendee_count: number }[]
  }
}

/** single-workspace 시나리오의 저장된 db */
async function scenarioDb(browser: Browser): Promise<string> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await start(page, 'single-workspace', '/workspaces/ws_01/meetings/mt_09')
  await minutesComplete(page, '3주차 정기회의')
  const stored = await page.evaluate(() => sessionStorage.getItem('msw-db'))
  await context.close()
  expect(stored).not.toBeNull()
  return stored!
}

/** 정리된 두 회의(mt_09 · mt_07)의 참석자를 count 명으로 */
function withAttendees(stored: string, count: number): string {
  const state = JSON.parse(stored) as StoredMeetingDb
  const attendees = ATTENDEE_NAMES.slice(0, count).map((display_name, index) => ({
    member_id: `mb_e2e_${index}`,
    display_name,
  }))
  for (const minutes of state.db.minutes)
    if (minutes.meeting_id === 'mt_09' || minutes.meeting_id === 'mt_07')
      minutes.attendees = attendees
  for (const summary of state.db.meetingSummaries)
    if (summary.meeting_id === 'mt_09' || summary.meeting_id === 'mt_07')
      summary.attendee_count = count
  return JSON.stringify(state)
}

/** 이 회의의 제목을 회의 · 목록 요약 · 회의록 모두 title 로 — 사용자가 업로드에서 정상으로 넣을 수 있는 제목이다 */
function withTitle(stored: string, meetingId: string, title: string): string {
  const state = JSON.parse(stored) as StoredMeetingDb
  for (const list of [state.db.meetings, state.db.meetingSummaries, state.db.minutes])
    for (const item of list) if (item.meeting_id === meetingId) item.title = title
  return JSON.stringify(state)
}

/** 앱 코드보다 먼저 저장 db 를 넣는다 — 이 탭의 첫 문서에서만. 앱이 그 뒤에 저장한 db 를 덮지 않는다 */
function seedStoredDb(page: Page, stored: string) {
  return page.addInitScript((stored) => {
    if (sessionStorage.getItem('e2e-stored-db') !== null) return
    sessionStorage.setItem('msw-db', stored)
    sessionStorage.setItem('e2e-stored-db', '1')
  }, stored)
}

/** 창 크기를 바꾸는 동안 참석자 줄이 다시 재진 순간의 모습 — 그 프레임에 그려질 모습이다 */
interface RowFrame {
  at: number
  width: number
  /** 잘리거나 `+N` 이 맞지 않으면 그 까닭, 맞으면 null */
  problem: string | null
}

interface AttendeeRowState {
  row: { left: number; top: number; width: number; height: number }
  /** 화면에 보이는 이름 칩 */
  shown: { right: number; top: number; height: number }[]
  /** `+N` 칩의 글자와 오른쪽 끝 */
  more: { text: string; right: number } | null
  /** 재는 칸의 칩 폭 — 이름 칩 전부와 마지막에 `+전체 인원` */
  measured: number[]
  gap: number
  tabsTop: number
}

async function readAttendeeRow(page: Page): Promise<AttendeeRowState> {
  return page.evaluate(() => {
    const region = document.querySelector('section[aria-label="회의록 본문"]')!
    const list = region.querySelector('ul[aria-label="참석자"]')!
    const row = list.parentElement!
    const { left, top, width, height } = row.getBoundingClientRect()
    const more = row.querySelector(':scope > button')
    const measure = row.querySelector('[data-testid="attendee-measure"]')!
    return {
      row: { left, top, width, height },
      shown: [...list.children]
        .filter((item) => !item.classList.contains('sr-only'))
        .map((item) => {
          const box = item.getBoundingClientRect()
          return { right: box.right, top: box.top, height: box.height }
        }),
      more: more
        ? { text: more.textContent ?? '', right: more.getBoundingClientRect().right }
        : null,
      measured: [...measure.children].map((chip) => chip.getBoundingClientRect().width),
      gap: Number.parseFloat(getComputedStyle(measure).columnGap),
      tabsTop: region.querySelector('[role="tablist"]')!.getBoundingClientRect().top,
    }
  })
}

/**
 * 이 줄의 보이는 칩 · `+N` 이 지금 줄 폭에 맞나 — 보인 칩과 `+N` 이 줄 안에 들고, 남는 사람이 있으면 한 사람을 더 보이면 넘친다.
 * 맞지 않으면 그 까닭을 돌려준다(맞으면 null)
 */
function fitProblem(state: AttendeeRowState, count: number): string | null {
  const rowRight = state.row.left + state.row.width
  if (state.shown.length === 0) return '보이는 칩이 없다'
  if (state.shown[state.shown.length - 1].right > rowRight + 0.5) return '칩이 줄 밖으로 잘렸다'
  const hidden = count - state.shown.length
  if (hidden === 0) return state.more === null ? null : '모두 보이는데 +N 이 있다'
  if (state.more?.text !== `+${hidden}`)
    return `+N 이 ${state.more?.text ?? '없음'}, 남는 사람 ${hidden}`
  if (state.more.right > rowRight + 0.5) return '+N 이 줄 밖으로 잘렸다'
  const names = state.measured.slice(0, -1)
  const moreWidth = state.measured[state.measured.length - 1]
  const line = (n: number) =>
    names.slice(0, n).reduce((sum, chip) => sum + chip, 0) + state.gap * (n - 1)
  const oneMore = state.shown.length + 1
  const needed = oneMore === count ? line(count) : line(oneMore) + state.gap + moreWidth
  return needed > state.row.width ? null : `한 사람 더 들어간다(${needed} ≤ ${state.row.width})`
}

test.describe('참석자 줄은 몇 명이든 칩 한 줄이고 남는 사람은 +N 이다 (UX1-M03)', () => {
  // 한 워커에서 차례로 돈다 — 저장 db 를 한 번만 만들고, 콜드 진입이 다른 E2E 와 겹쳐 개발 서버에 몰리지 않게 한다.
  // 'serial' 이 아니라 앞이 실패해도 뒤가 돈다
  test.describe.configure({ mode: 'default' })
  let stored = ''
  test.beforeAll(async ({ browser }) => {
    stored = await scenarioDb(browser)
  })

  /*
   * 인원마다 한 번 들어가(1024px) 창 폭을 1440 → 1920 → 1024 로 바꿔 가며 잰다 — 처음 그릴 때의 재기와 줄 폭이 바뀔 때
   * 다시 재기(ResizeObserver)를 함께 본다. 인원 · 폭마다 새로 들어가면 개발 서버에 콜드 진입이 12번 몰려 다른 E2E 를 느리게 한다
   */
  test('참석자 1·4·10·20명 × 1024·1440·1920px — 참석자 줄이 같은 22px 한 줄이고 남는 사람은 +N, 탭 줄이 같은 자리다', async ({
    browser,
  }) => {
    const tabsByWidth = new Map<number, number[]>()
    for (const count of [1, 4, 10, 20]) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 900 } })
      const page = await context.newPage()
      await seedStoredDb(page, withAttendees(stored, count))
      await page.goto('/workspaces/ws_01/meetings/mt_09')
      await minutesComplete(page, '3주차 정기회의')
      // 접근성 트리의 `참석자` 목록 — 스크린리더가 읽는 이름은 줄에 들어가지 않은 사람까지 전체다
      await expect(
        page
          .getByRole('region', { name: '회의록 본문' })
          .getByRole('list', { name: '참석자' })
          .getByRole('listitem'),
      ).toHaveCount(count)

      for (const width of [1024, 1440, 1920, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        const at = `${count}명 · ${width}px`
        // 줄 폭이 바뀌면 ResizeObserver 가 다시 잰다 — 정한 프레임 수가 아니라 보이는 칩 · `+N` 이 새 폭에 맞을 때까지 기다린다.
        // 끝내 맞지 않으면 그 까닭과 함께 실패한다
        await expect
          .poll(async () => fitProblem(await readAttendeeRow(page), count), { message: at })
          .toBeNull()
        const state = await readAttendeeRow(page)

        // 한 줄 높이 — 칩 높이 그대로다. 보이는 칩은 모두 그 줄 위에 있다
        expect(state.row.height, at).toBe(22)
        for (const chip of state.shown) {
          expect(chip.top, at).toBe(state.row.top)
          expect(chip.height, at).toBe(22)
        }
        // 보이는 칩과 `+N` 이 줄 안에 다 들고(잘린 칩 없음), `+N` 은 남는 사람 수, 한 사람 더 보이면 넘친다(넣을 만큼 넣었다)
        expect(fitProblem(state, count), at).toBeNull()
        // 한두 명은 늘 다 보이고, 20명은 어느 폭에서도 줄어든다. 1024px 의 10명은 이름 칩이 두 줄로 접히던 데이터다
        if (count <= 4) expect(state.more, at).toBeNull()
        if (count === 20 || (width === 1024 && count === 10)) expect(state.more, at).not.toBeNull()
        tabsByWidth.set(width, [...(tabsByWidth.get(width) ?? []), state.tabsTop])
      }
      await context.close()
    }
    // 같은 폭에서는 인원이 몇이든 탭 줄이 같은 자리다
    for (const tabs of tabsByWidth.values()) for (const top of tabs) near(top, tabs[0])
  })

  test('창 크기를 바꾸는 동안 그려지는 모든 프레임에서 잘린 칩 · 낡은 `+N` 이 없다 — 20명 (UX1-N02)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await seedStoredDb(page, withAttendees(stored, 20))
    await page.goto('/workspaces/ws_01/meetings/mt_09')
    await minutesComplete(page, '3주차 정기회의')

    /*
     * 줄 폭이 바뀐 프레임마다 그리기 직전의 모습을 적는다. 한 프레임 안에서 ResizeObserver 콜백은 배치 뒤 · 그리기 전에,
     * 만든 순서대로 돈다 — 앱의 관찰자(먼저 만들어짐)가 칩 수를 고친 뒤 이 관찰자가 읽는다. 그래서 여기 적힌 모습이 그 프레임에
     * 그려지는 모습이다. requestAnimationFrame 은 배치 전이라 새 폭에 아직 고치기 전의 칩을 읽어 쓰지 않는다.
     */
    await page.evaluate(() => {
      const frames: RowFrame[] = []
      window.__rowFrames = frames
      const list = document.querySelector(
        'section[aria-label="회의록 본문"] ul[aria-label="참석자"]',
      )!
      const row = list.parentElement!
      const read = (): string | null => {
        const rowBox = row.getBoundingClientRect()
        const shown = [...list.children].filter((item) => !item.classList.contains('sr-only'))
        const last = shown[shown.length - 1]
        if (last && last.getBoundingClientRect().right > rowBox.right + 0.5)
          return `칩이 줄 밖으로 잘렸다(보인 ${shown.length})`
        const more = row.querySelector(':scope > button')
        const hidden = list.children.length - shown.length
        if (hidden === 0) return more === null ? null : '모두 보이는데 +N 이 있다'
        if (more?.textContent !== `+${hidden}`)
          return `+N 이 ${more?.textContent ?? '없음'}, 남는 사람 ${hidden}`
        if (more.getBoundingClientRect().right > rowBox.right + 0.5) return '+N 이 줄 밖으로 잘렸다'
        return null
      }
      new ResizeObserver(() =>
        frames.push({
          at: performance.now(),
          width: row.getBoundingClientRect().width,
          problem: read(),
        }),
      ).observe(row)
    })

    // 넓게 · 좁게 · 칩 수가 바뀌는 폭을 모두 지난다
    for (const width of [1024, 1440, 1920, 1200, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await expect
        .poll(async () => fitProblem(await readAttendeeRow(page), 20), { message: `${width}px` })
        .toBeNull()
      await nextFrames(page)
    }
    const frames = await page.evaluate(() => window.__rowFrames ?? [])
    // 폭이 바뀐 프레임마다 적혔다 — 빈 검사가 아니다(관찰 시작 1번 + 폭 바꾸기 5번)
    expect(frames.length).toBeGreaterThanOrEqual(6)
    expect(new Set(frames.map(({ width }) => Math.round(width))).size).toBeGreaterThanOrEqual(4)
    expect(frames.filter(({ problem }) => problem !== null)).toEqual([])
    await context.close()
  })

  test.describe('1024px · 참석자 10명', () => {
    test.use({ viewport: { width: 1024, height: 900 } })

    test('회의록 직접 진입 — 첫 가드 샘플부터 완성까지 탭 줄·제목이 움직이지 않는다', async ({
      page,
    }) => {
      await seedStoredDb(page, withAttendees(stored, 10))
      await lagRequests(page, '/api/v1/auth/me$', GUARD_LAG)
      await recordPlaces(page)
      await page.goto('/workspaces/ws_01/meetings/mt_09')
      await minutesComplete(page, '3주차 정기회의')
      const samples = await closePlaces(page)

      expect(samples.some(({ stage }) => stage === 'guard')).toBe(true)
      expect(samples.some(({ stage }) => stage === 'route' || stage === 'widget')).toBe(true)
      expectStill(samples)
      // 이 데이터는 1024px 한 줄에 다 들지 않는다 — 남는 사람은 `+N` 이다
      await expect(
        page.getByRole('button', { name: /^\+\d+, 참석자 10명 모두 보기$/ }),
      ).toBeVisible()
    })

    test('기본 진입(/meetings → 최신 회의) — 첫 가드 샘플부터 완성까지 탭 줄·제목이 움직이지 않는다', async ({
      page,
    }) => {
      await seedStoredDb(page, withAttendees(stored, 10))
      await lagRequests(page, '/api/v1/workspaces$', GUARD_LAG)
      await recordPlaces(page)
      await page.goto('/workspaces/ws_01/meetings')
      await minutesComplete(page, '3주차 정기회의')
      await expect(page).toHaveURL(/\/workspaces\/ws_01\/meetings\/mt_09$/)
      const samples = await closePlaces(page)

      expect(samples.some(({ stage }) => stage === 'guard')).toBe(true)
      expectStill(samples)
    })

    test('연달아 고르기 — 늦은 답(들고 있기 → 본문 뼈대)과 빠른 답 모두 모든 샘플에서 탭 줄이 제자리다', async ({
      page,
    }) => {
      await seedStoredDb(page, withAttendees(stored, 10))
      // 2주차의 상세 답만 늦춘다 — 들고 있기(요약 머리) 뒤 250ms 를 넘겨 본문 뼈대(요약 머리)까지 지나간다
      await lagRequests(page, '/api/v1/meetings/mt_07$', 650)
      await recordPlaces(page)
      await page.goto('/workspaces/ws_01/meetings/mt_09')
      await minutesComplete(page, '3주차 정기회의')

      await page.evaluate(() => {
        window.__detailSkeletonSeen = false
        new MutationObserver(() => {
          if (document.querySelector('[data-testid="minutes-detail-skeleton"]'))
            window.__detailSkeletonSeen = true
        }).observe(document.body, { childList: true, subtree: true })
      })
      const list = page
        .getByRole('complementary', { name: '회의 목록' })
        .getByRole('list', { name: '정리된 회의' })
      for (const title of [
        '2주차 정기회의',
        '3주차 정기회의',
        '2주차 정기회의',
        '3주차 정기회의',
      ]) {
        await list.getByRole('link', { name: new RegExp(title) }).click()
        await minutesComplete(page, title)
      }
      const samples = await closePlaces(page)

      // 늦은 답에서 본문 뼈대가 실제로 지나갔다 — 들고 있기 · 뼈대 · 완성을 모두 비교했다
      expect(await page.evaluate(() => window.__detailSkeletonSeen)).toBe(true)
      expectStill(samples)
    })
  })
})

test.describe('제목이 길어도 한 줄이고 넘치면 말줄임이다 — 1024px (UX1-M04)', () => {
  // 저장 db 를 한 번 만들고 콜드 진입이 다른 E2E 와 몰리지 않게 한 워커에서 차례로 돈다
  test.describe.configure({ mode: 'default' })
  test.use({ viewport: { width: 1024, height: 900 } })
  let stored = ''
  test.beforeAll(async ({ browser }) => {
    stored = withTitle(await scenarioDb(browser), 'mt_09', LONG_TITLE)
  })

  test('회의록 직접 진입 — 첫 가드 샘플부터 완성까지 제목 줄 높이 · 탭 줄이 움직이지 않는다', async ({
    page,
  }) => {
    await seedStoredDb(page, stored)
    await lagRequests(page, '/api/v1/auth/me$', GUARD_LAG)
    await recordPlaces(page)
    await page.goto('/workspaces/ws_01/meetings/mt_09')
    await minutesComplete(page, LONG_TITLE)
    const samples = await closePlaces(page)

    expect(samples.some(({ stage }) => stage === 'guard')).toBe(true)
    expect(samples.some(({ stage }) => stage === 'route' || stage === 'widget')).toBe(true)
    expectStill(samples)
    // 한 줄 높이다 — 26px · 1.3
    expect(samples[samples.length - 1].titleHeight).toBeCloseTo(26 * 1.3, 1)
  })

  test('기본 진입(/meetings → 최신 회의) — 첫 가드 샘플부터 완성까지 제목 줄 높이 · 탭 줄이 움직이지 않는다', async ({
    page,
  }) => {
    await seedStoredDb(page, stored)
    await lagRequests(page, '/api/v1/workspaces$', GUARD_LAG)
    await recordPlaces(page)
    await page.goto('/workspaces/ws_01/meetings')
    await minutesComplete(page, LONG_TITLE)
    await expect(page).toHaveURL(/\/workspaces\/ws_01\/meetings\/mt_09$/)
    const samples = await closePlaces(page)

    expect(samples.some(({ stage }) => stage === 'guard')).toBe(true)
    expectStill(samples)
  })

  test('긴 제목과 짧은 제목을 연달아 고르기 — 늦은 답(들고 있기 → 본문 뼈대)도 모든 샘플에서 제목 줄 · 탭 줄이 제자리다', async ({
    page,
  }) => {
    await seedStoredDb(page, stored)
    await lagRequests(page, '/api/v1/meetings/mt_07$', 650)
    await recordPlaces(page)
    await page.goto('/workspaces/ws_01/meetings/mt_09')
    await minutesComplete(page, LONG_TITLE)

    const list = page
      .getByRole('complementary', { name: '회의 목록' })
      .getByRole('list', { name: '정리된 회의' })
    for (const title of ['2주차 정기회의', LONG_TITLE, '2주차 정기회의', LONG_TITLE]) {
      // 목록 행의 제목은 그대로 접혀 다 보인다(바꾸지 않았다) — 행 이름의 앞부분으로 고른다
      await list.getByRole('link', { name: new RegExp(title.slice(0, 12)) }).click()
      await minutesComplete(page, title)
    }
    expectStill(await closePlaces(page))
  })

  test('잘린 제목은 가리키거나 키보드로 가면 전체가 뜬다 — 스크린리더의 heading 이름은 전체 제목이다', async ({
    page,
  }) => {
    await seedStoredDb(page, stored)
    await page.goto('/workspaces/ws_01/meetings/mt_09')
    await minutesComplete(page, LONG_TITLE)
    const body = page.getByRole('region', { name: '회의록 본문' })
    const heading = body.getByRole('heading', { level: 2, name: LONG_TITLE })
    const tooltip = page.getByTestId('minutes-title-tooltip')

    // 한 줄로 잘렸다 — 말줄임
    const shape = await heading.evaluate((element) => ({
      truncated: element.scrollWidth > element.clientWidth,
      textOverflow: getComputedStyle(element).textOverflow,
      whiteSpace: getComputedStyle(element).whiteSpace,
      height: element.getBoundingClientRect().height,
    }))
    expect(shape).toMatchObject({ truncated: true, textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
    expect(shape.height).toBeCloseTo(26 * 1.3, 1)

    // 가리키면 전체 제목
    await heading.hover()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveText(LONG_TITLE)
    // 사람처럼 여러 점을 지나 멀어진다 — Radix 는 제목을 벗어난 뒤의 포인터 이동으로 툴팁 쪽으로 가는 중인지 본다
    await page.mouse.move(0, 0, { steps: 8 })
    await expect(tooltip).toBeHidden()

    // 키보드 — 목록의 마지막 행에서 Tab 하면 제목이다. 전체 제목이 뜨고 Esc 로 닫힌다
    const rows = page
      .getByRole('complementary', { name: '회의 목록' })
      .getByRole('list', { name: '정리된 회의' })
      .getByRole('link')
    await rows.last().focus()
    await page.keyboard.press('Tab')
    await expect(heading).toBeFocused()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveText(LONG_TITLE)
    await page.keyboard.press('Escape')
    await expect(tooltip).toBeHidden()
    await expect(heading).toBeFocused()
  })

  test('다 보이는 제목은 Tab 자리도 툴팁도 없다', async ({ page }) => {
    await seedStoredDb(page, stored)
    await page.goto('/workspaces/ws_01/meetings/mt_07')
    await minutesComplete(page, '2주차 정기회의')
    const heading = page
      .getByRole('region', { name: '회의록 본문' })
      .getByRole('heading', { level: 2, name: '2주차 정기회의' })
    await expect(heading).not.toHaveAttribute('tabindex')
    // 포커스로는 지연 없이 열린다 — 열리지 않는 것을 바로 본다
    await heading.dispatchEvent('focusin')
    await nextFrames(page)
    await expect(page.getByTestId('minutes-title-tooltip')).toHaveCount(0)
  })
})
