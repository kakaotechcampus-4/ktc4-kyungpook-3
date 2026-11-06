import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { start } from './support'

/*
 * #336 — 강조색·흐린 글자의 명도 대비 (KWCAG 2.2 / WCAG 1.4.3). 브라우저가 실제로 칠한 글자색과 그 뒤 면의 색으로 잰다.
 * 강조색(accent·accent-solid) 글자, 레드 면(accent-solid·accent-badge·accent-chip) 위 글자, 흐린(faint) 글자를 화면에서 모두 찾아 4.5:1 이상인지 본다.
 * 글자가 아닌 표식(accent-point)은 3:1 기준이라 세지 않는다.
 * 비활성·작업 중 컨트롤의 글자는 기준 예외라 세지 않는다.
 */

test.describe.configure({ timeout: 60_000 })

const FIRST_PAINT = { timeout: 15_000 }
const AA = 4.5

interface Measured {
  text: string
  ratio: number
}

declare global {
  interface Window {
    contrast: {
      ratio: (a: string, b: string) => number
      faceBehind: (element: Element) => string
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const channels = (rgb: string) => (rgb.match(/[\d.]+/g) ?? []).map(Number)
    const luminance = (rgb: string) => {
      const [r, g, b] = channels(rgb).map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    window.contrast = {
      ratio: (a, b) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
      },
      faceBehind: (element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const face = getComputedStyle(node).backgroundColor
          if ((channels(face)[3] ?? 1) > 0) return face
        }
        return 'rgb(255, 255, 255)'
      },
    }
  })
})

function measureTokenText(page: Page): Promise<Measured[]> {
  return page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('span'))
    const tokenRgb = (name: string) => {
      probe.style.color = `var(${name})`
      return getComputedStyle(probe).color
    }
    const watched = new Set(
      ['--color-accent', '--color-accent-solid', '--color-faint'].map(tokenRgb),
    )
    const redFaces = new Set(
      ['--color-accent-solid', '--color-accent-badge', '--color-accent-chip'].map(tokenRgb),
    )
    probe.remove()

    const found: Measured[] = []
    for (const element of document.body.querySelectorAll('*')) {
      const own = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? '')
        .join('')
      if (!own || element.getClientRects().length === 0) continue
      if (element.closest(':disabled, [aria-disabled="true"], [aria-busy="true"]')) continue
      const style = getComputedStyle(element)
      if (style.visibility !== 'visible') continue
      const face = window.contrast.faceBehind(element)
      if (!watched.has(style.color) && !redFaces.has(face)) continue
      found.push({ text: own.slice(0, 30), ratio: window.contrast.ratio(style.color, face) })
    }
    return found
  })
}

async function expectAllPass(page: Page) {
  const measured = await measureTokenText(page)
  expect(measured.filter((item) => item.ratio < AA)).toEqual([])
  return measured.map((item) => item.text)
}

function textRatio(target: Locator, pseudo?: '::placeholder') {
  return target.evaluate(
    (element, part) =>
      window.contrast.ratio(
        getComputedStyle(element, part).color,
        window.contrast.faceBehind(element),
      ),
    pseudo,
  )
}

test('로그인 — 오류 문구·오류 입력의 플레이스홀더·`비밀번호를 잊으셨나요?` 는 4.5:1 이상이다', async ({
  page,
}) => {
  await start(page, 'signed-out', '/login')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByText('이메일을 입력해 주세요')).toBeVisible()

  expect(await expectAllPass(page)).toContain('이메일을 입력해 주세요.')
  // 누를 수 없는 버튼이지만 보고서가 지적한 글자다 — 비활성 예외로 넘기지 않는다
  expect(
    await textRatio(page.getByRole('button', { name: '비밀번호를 잊으셨나요?' })),
  ).toBeGreaterThanOrEqual(AA)
  expect(await textRatio(page.getByLabel('이메일'), '::placeholder')).toBeGreaterThanOrEqual(AA)
})

test('대시보드 — 지난 마감 날짜와 `기한 지남` 배지는 4.5:1 이상이다', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-18T09:00:00+09:00'))
  await start(page, 'dashboard-default', '/workspaces/ws_01/dashboard')
  await expect(
    page.getByRole('list', { name: '마감 임박 목록' }).getByText('기한 지남').first(),
  ).toBeVisible(FIRST_PAINT)

  expect(await expectAllPass(page)).toContain('기한 지남')
})

const VIEW_LABEL = { board: '보드', calendar: '캘린더', gantt: '간트' } as const

for (const view of ['board', 'calendar', 'gantt'] as const) {
  test(`태스크 ${VIEW_LABEL[view]} — 레드 면(흰 글자 면·배지·칩) 위 글자는 4.5:1 이상이다`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-09-18T09:00:00+09:00'))
    await start(
      page,
      'tasks-default',
      `/workspaces/ws_01/tasks?view=${view}&month=2026-09&from=2026-09-14`,
    )
    await expect(page.getByLabel('보기 방식')).toBeVisible(FIRST_PAINT)
    await expect(page.locator('main a[href*="/tasks/"]').first()).toBeVisible(FIRST_PAINT)

    expect(await expectAllPass(page)).not.toEqual([])
  })
}
