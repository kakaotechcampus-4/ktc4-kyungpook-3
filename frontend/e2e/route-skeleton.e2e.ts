import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import type { Scenario } from './support'

/*
 * 라우트 뼈대는 화면 안 뼈대와 같은 틀이다 (#510). 12시간 안에 다시 오면 스플래시 없이 라우트 뼈대가 바로 보이고,
 * 화면 코드를 받으면 화면 안 뼈대(#508)로 바뀐다. 그때 정해진 글자(제목·칸 이름·탭)가 움직이지 않는지 실제 Chromium 에서 잰다.
 *
 * - 라우트 뼈대: 세션·소속 조회를 붙잡아 가드가 뼈대를 그리게 한다.
 * - 화면 안 뼈대: 세션·소속은 바로 주고 나머지 API 를 붙잡는다. 인증 화면은 화면 안 뼈대가 없어 다 그려진 화면과 비교한다.
 * 붙잡기는 페이지의 XHR·fetch 를 늦춘다(브라우저 MSW 는 서비스 워커라 page.route 가 보지 못한다)
 */

type Mode = 'route' | 'screen' | 'loaded'

interface ScreenCase {
  name: string
  scenario: Scenario
  path: string
  /** 비교할 쪽. 화면 안 뼈대가 없는 화면은 loaded */
  against: Exclude<Mode, 'route'>
  /** 두 쪽에 모두 있어야 하는 글자. 비교가 빈 채로 통과하지 않게 한다 */
  anchors: string[]
  /** 고른 항목(보기 고르기 · 탭 · 목차)의 글자. 색·면·밑줄까지 같아야 한다 — 고른 표시가 화면이 뜰 때 생기지 않게 */
  selected?: string[]
  widths: number[]
}

const W = '/workspaces/ws_01'
const CASES: ScreenCase[] = [
  {
    name: '로그인',
    scenario: 'signed-out',
    path: '/login',
    against: 'loaded',
    anchors: ['이메일', '비밀번호를 잊으셨나요?', '회원가입'],
    widths: [1280],
  },
  {
    name: '로그인 휴대폰(H-1)',
    scenario: 'signed-out',
    path: '/login',
    against: 'loaded',
    anchors: [
      "Manager's Manager",
      '회의가 끝나면 할 일은 매스가 챙겨요',
      '비밀번호를 잊으셨나요?',
      '가입하기',
    ],
    widths: [390],
  },
  {
    name: '회원가입',
    scenario: 'signed-out',
    path: '/signup',
    against: 'loaded',
    anchors: ['계정 만들기', '이메일', '또는', '로그인'],
    widths: [1280, 390],
  },
  {
    name: '공간 선택',
    scenario: 'multiple-workspaces',
    path: '/workspaces',
    against: 'loaded',
    anchors: ['워크스페이스 선택'],
    widths: [1280],
  },
  {
    name: '대시보드',
    scenario: 'dashboard-default',
    path: `${W}/dashboard`,
    against: 'screen',
    anchors: ['워크스페이스 현황', '확인이 필요한 일', '마감 임박', '최근 반영'],
    widths: [1280, 390],
  },
  {
    name: '태스크 리스트',
    scenario: 'tasks-default',
    path: `${W}/tasks`,
    against: 'screen',
    anchors: ['리스트', '전체', '확인 필요', '완료'],
    selected: ['리스트', '전체'],
    widths: [1280, 390],
  },
  {
    name: '태스크 보드',
    scenario: 'tasks-default',
    path: `${W}/tasks?view=board`,
    against: 'screen',
    anchors: ['보드', '시작 전', '진행 중'],
    selected: ['보드'],
    widths: [1280],
  },
  {
    name: '태스크 상세',
    scenario: 'tasks-default',
    path: `${W}/tasks/tk_01`,
    against: 'screen',
    anchors: ['태스크 정보', '담당자', '변경 이력'],
    widths: [1280],
  },
  {
    name: '메시지',
    scenario: 'messages-default',
    path: `${W}/messages`,
    against: 'screen',
    anchors: ['메시지', '보내기 전 확인', '대화'],
    widths: [1280],
  },
  {
    name: '팀',
    scenario: 'team-invitations',
    path: `${W}/members`,
    against: 'screen',
    anchors: ['팀', '연결되지 않은 계정'],
    widths: [1280, 390],
  },
  {
    name: '설정',
    scenario: 'dashboard-default',
    path: `${W}/settings`,
    against: 'screen',
    anchors: ['설정', '워크스페이스 이름', '되돌리기', '자동 반영'],
    selected: ['일반'],
    widths: [1280],
  },
  {
    name: '회의 올리기',
    scenario: 'meeting-demo',
    path: `${W}/meetings/upload`,
    against: 'screen',
    anchors: ['회의를 올려 주세요', '회의 제목', '참석자'],
    widths: [1280],
  },
]

/**
 * 페이지 안에서 API 를 붙잡는다. route 는 세션·소속을, screen 은 그 밖을 붙잡는다. 12시간 안이라 스플래시는 건너뛴다.
 * 앱보다 먼저 도는 문서 스크립트라 문자열로 넘긴다
 */
function holdScript(mode: Mode): string {
  return `(() => {
    const mode = ${JSON.stringify(mode)}
    const auth = (url) => {
      const path = new URL(url, window.location.href).pathname
      return path === '/api/v1/auth/me' || path === '/api/v1/workspaces'
    }
    const hold = (url) => {
      if (!url.includes('/api/v1/') || mode === 'loaded') return false
      return mode === 'route' ? auth(url) : !auth(url)
    }
    const open = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.holdUrl = String(url)
      return open.call(this, method, url, ...rest)
    }
    const send = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.send = function (body) {
      if (!hold(this.holdUrl ?? '')) send.call(this, body)
    }
    window.localStorage.setItem('splash-last-shown:v1', String(Date.now()))
  })()`
}

interface TextBox {
  text: string
  x: number
  y: number
}

/** main 안의 글자 상자(자식 요소가 없는 요소). 같은 글자가 둘 이상이면 빼서 짝을 헷갈리지 않는다 */
async function textBoxes(page: Page): Promise<TextBox[]> {
  const boxes = await page.evaluate(() => {
    const main = document.querySelector('#root main')
    if (main === null) return []
    return [...main.querySelectorAll('*')]
      .filter((element) => element.children.length === 0)
      .map((element) => {
        const box = element.getBoundingClientRect()
        return { text: (element.textContent ?? '').trim(), x: box.x, y: box.y, w: box.width }
      })
      .filter(({ text, w }) => text !== '' && w > 1)
      .map(({ text, x, y }) => ({ text, x, y }))
  })
  const counts = new Map<string, number>()
  for (const { text } of boxes) counts.set(text, (counts.get(text) ?? 0) + 1)
  return boxes.filter(({ text }) => counts.get(text) === 1)
}

/** 고른 표시의 색 — 글자색 · 면 · 밑줄 */
type Paint = Record<'color' | 'background' | 'underline', string>

/** main 안에서 그 글자를 가진 첫 글자 요소의 칠. 목차처럼 같은 글자가 뒤에 또 있어도 앞의 것(고르기)을 본다 */
async function paintOf(page: Page, text: string): Promise<Paint | null> {
  return page.evaluate((wanted) => {
    const main = document.querySelector('#root main')
    const element = [...(main?.querySelectorAll('*') ?? [])].find(
      (each) => each.children.length === 0 && (each.textContent ?? '').trim() === wanted,
    )
    if (element === undefined) return null
    const style = getComputedStyle(element)
    return {
      color: style.color,
      background: style.backgroundColor,
      underline: `${style.borderBottomWidth} ${style.borderBottomColor}`,
    }
  }, text)
}

interface Capture {
  boxes: TextBox[]
  paints: Map<string, Paint | null>
}

async function capture(
  browser: Browser,
  { scenario, path, selected = [] }: ScreenCase,
  width: number,
  mode: Mode,
): Promise<Capture> {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  await context.addInitScript({ content: holdScript(mode) })
  const page = await context.newPage()
  const url = new URL(path, 'http://placeholder')
  url.searchParams.set('msw-scenario', scenario)
  await page.goto(`${url.pathname}${url.search}`)
  if (mode === 'route')
    await expect(page.locator('#root main[aria-busy="true"]').first()).toBeVisible({
      timeout: 15_000,
    })
  // 라우트 뼈대의 글자는 aria-hidden 이라 제목이 없다. 제목이 생겼으면 화면이 그린 것이다(기다리는 중에도 제목은 있다)
  else
    await expect(page.locator('#root main').getByRole('heading').first()).toBeAttached({
      timeout: 15_000,
    })
  if (mode === 'loaded')
    await expect(page.locator('#root main[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
  const boxes = await textBoxes(page)
  const paints = new Map<string, Paint | null>()
  for (const text of selected) paints.set(text, await paintOf(page, text))
  await context.close()
  return { boxes, paints }
}

test.describe.configure({ mode: 'parallel' })

for (const screenCase of CASES) {
  for (const width of screenCase.widths) {
    test(`${screenCase.name} ${width}px — 라우트 뼈대에서 화면으로 바뀌어도 정해진 글자가 움직이지 않고 고른 표시가 같다`, async ({
      browser,
    }) => {
      test.setTimeout(60_000)
      const route = await capture(browser, screenCase, width, 'route')
      const other = await capture(browser, screenCase, width, screenCase.against)
      const byText = new Map(other.boxes.map((box) => [box.text, box]))
      const shared = route.boxes.filter(({ text }) => byText.has(text))
      for (const anchor of screenCase.anchors) {
        expect(
          shared.map(({ text }) => text),
          `두 쪽에 「${anchor}」 가 있다`,
        ).toContain(anchor)
      }
      for (const box of shared) {
        const match = byText.get(box.text)
        expect(match, box.text).toBeDefined()
        if (match === undefined) continue
        expect(Math.abs(box.x - match.x), `「${box.text}」 의 가로 자리`).toBeLessThanOrEqual(1)
        expect(Math.abs(box.y - match.y), `「${box.text}」 의 세로 자리`).toBeLessThanOrEqual(1)
      }
      for (const text of screenCase.selected ?? []) {
        const paint = route.paints.get(text)
        expect(paint, `라우트 뼈대에 고른 「${text}」 가 있다`).not.toBeNull()
        expect(paint, `고른 「${text}」 의 글자색 · 면 · 밑줄`).toEqual(other.paints.get(text))
      }
    })
  }
}
