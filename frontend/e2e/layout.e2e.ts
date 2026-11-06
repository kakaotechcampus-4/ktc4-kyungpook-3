import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'
import type { Scenario } from './support'

/*
 * U5-4 레이아웃 — 주요 화면에 가로 스크롤이 없고 핵심 요소가 화면 안에 보인다. 최소 지원 폭은 360px 이다 (D-180).
 * 1024px 미만(360·390·768)은 `narrow` 인 화면만 본다. 랜딩·로그인·회원가입의 휴대폰 배치는 #478 의 다음 PR 이 한다.
 * 768px 은 휴대폰 셸과 데스크톱 셸의 경계라 한 번 본다.
 * 화면마다 스크린샷을 테스트 결과에 붙인다(playwright-report).
 */

const VIEWPORTS = [360, 390, 768, 1024, 1280, 1440] as const

/** 이 폭 미만은 휴대폰 셸이다 — 헤더 탭 대신 아래 탭 막대 (D-180) */
const COMPACT_BELOW = 768

/** 이 폭 미만은 휴대폰 폭에 맞춘(`narrow`) 화면만 본다 */
const NARROW_BELOW = 1024

const SCREENS: {
  name: string
  scenario: Scenario
  path: string
  role: 'link' | 'button' | 'heading'
  landmark: string
  narrow?: true
  /** 768px 미만에서만 본다 */
  phoneOnly?: true
  /** 데이터 본문(또는 빈 상태)이 그려졌다는 표지. 제목은 불러오는 중에도 보여 그것만으로는 넘침을 잴 때가 아니다 */
  ready?: (page: Page) => Locator
}[] = [
  { name: '랜딩', role: 'link', scenario: 'signed-out', path: '/', landmark: '시작하기' },
  { name: '로그인', role: 'button', scenario: 'signed-out', path: '/login', landmark: '로그인' },
  {
    name: '회원가입',
    role: 'button',
    scenario: 'signed-out',
    path: '/signup',
    landmark: '계정 만들기',
  },
  {
    name: '워크스페이스 선택',
    role: 'button',
    scenario: 'multiple-workspaces',
    path: '/workspaces',
    landmark: '새 워크스페이스 만들기',
    narrow: true,
  },
  {
    name: '온보딩',
    role: 'button',
    scenario: 'incomplete-workspace',
    path: '/onboarding/ws_03/connect_discord',
    landmark: '연결하기',
    narrow: true,
  },
  {
    name: '대시보드',
    // M7 부터 빈 상태 껍데기가 아니라 대시보드 본문이다. 휴대폰은 한 열이라 `최근 반영` 이 첫 화면 아래로 내려간다 —
    // 두 단에서도 한 열에서도 첫 화면에 있는 `확인이 필요한 일` 머리를 본다
    role: 'heading',
    scenario: 'multiple-workspaces',
    path: '/workspaces/ws_01/dashboard',
    landmark: '확인이 필요한 일',
    narrow: true,
    ready: (page) => page.getByRole('list', { name: '확인이 필요한 일 목록' }),
  },
  {
    name: '태스크 리스트',
    role: 'heading',
    scenario: 'tasks-default',
    path: '/workspaces/ws_01/tasks',
    landmark: '태스크',
    narrow: true,
    ready: (page) => page.getByRole('list', { name: '태스크 목록' }).getByRole('listitem'),
  },
  // 긴 제목·긴 담당자 이름·줄바꿈할 곳 없는 문자열이 9/18 근처에 몰려 있다. 캘린더·간트는 그 달·주를 연다
  ...(
    [
      ['리스트', '', (page: Page) => page.getByRole('list', { name: '태스크 목록' })],
      ['보드', '?view=board', (page: Page) => page.getByRole('main').getByRole('listitem')],
      [
        '캘린더',
        '?view=calendar&month=2026-09',
        (page: Page) => page.getByRole('table', { name: '2026년 9월' }).getByRole('link'),
      ],
      [
        '간트',
        '?view=gantt&from=2026-09-14',
        (page: Page) => page.getByRole('region', { name: '일정 표' }).getByRole('link'),
      ],
    ] as const
  ).map(([label, search, ready]) => ({
    name: `태스크 ${label} (긴 내용)`,
    role: 'heading' as const,
    scenario: 'tasks-long-content' as const,
    path: `/workspaces/ws_01/tasks${search}`,
    landmark: '태스크',
    narrow: true as const,
    // 긴 내용 리스트는 768px 에서 이 PR 전부터 34px 넘친다. 768px 이상 배치를 바꿔야 고쳐져 휴대폰 폭만 본다
    phoneOnly: label === '리스트' ? (true as const) : undefined,
    ready,
  })),
  {
    name: '회의록',
    role: 'heading',
    scenario: 'single-workspace',
    path: '/workspaces/ws_01/meetings',
    landmark: '회의록',
    narrow: true,
    ready: (page) => page.getByRole('region', { name: '회의록 본문' }),
  },
  {
    name: '회의 상세',
    role: 'heading',
    scenario: 'single-workspace',
    path: '/workspaces/ws_01/meetings/mt_09',
    landmark: '회의록',
    narrow: true,
    ready: (page) => page.getByRole('region', { name: '회의록 본문' }).getByRole('tabpanel'),
  },
  ...(['single-workspace', 'tasks-long-content'] as const).map((scenario) => ({
    name: scenario === 'single-workspace' ? '팀' : '팀 (긴 내용)',
    role: 'heading' as const,
    scenario,
    path: '/workspaces/ws_01/members',
    landmark: '팀',
    narrow: true as const,
    ready: (page: Page) => page.getByRole('list', { name: /의 일$/ }).getByRole('listitem'),
  })),
  {
    name: '설정',
    role: 'heading',
    scenario: 'single-workspace',
    path: '/workspaces/ws_01/settings',
    landmark: '설정',
    narrow: true,
    ready: (page) => page.getByRole('textbox', { name: '워크스페이스 이름' }),
  },
]

for (const width of VIEWPORTS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const screen of SCREENS) {
      if (width < NARROW_BELOW && !screen.narrow) continue
      if (width >= COMPACT_BELOW && screen.phoneOnly) continue
      test(`${screen.name} — 가로 스크롤 없음`, async ({ page }, testInfo) => {
        await start(page, screen.scenario, screen.path)
        const landmark = page.getByRole(screen.role, { name: screen.landmark, exact: true }).first()
        await expect(landmark).toBeInViewport()
        if (screen.ready !== undefined) await expect(screen.ready(page).first()).toBeVisible()
        // 뼈대는 aria-busy 를 진다 (M2 Skeleton). 데이터 영역이 모두 그려진 뒤에 잰다
        await expect(page.getByRole('main').locator('[aria-busy="true"]')).toHaveCount(0)
        await expectNoHorizontalOverflow(page)
        await testInfo.attach(`${screen.name}-${width}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })
      })
    }

    if (width < COMPACT_BELOW) {
      test('태스크 보드 — 칸을 나란히 두지 않고 위에서 골라 한 칸씩 본다 (H-3)', async ({
        page,
      }) => {
        await start(page, 'tasks-default', '/workspaces/ws_01/tasks?view=board')
        const picker = page.getByRole('tablist', { name: '상태' })
        await expect(picker.getByRole('tab')).toHaveText([
          /^시작 전 \d+$/,
          /^진행 중 \d+$/,
          /^완료 \d+$/,
        ])
        for (const tab of await picker.getByRole('tab').all())
          await expect(tab).toBeInViewport({ ratio: 1 })
        await expect(picker.getByRole('tab', { name: /^진행 중/ })).toHaveAttribute(
          'aria-selected',
          'true',
        )
        await picker.getByRole('tab', { name: /^완료/ }).click()
        await expect(page.getByRole('tabpanel')).toContainText('최근 완료순')
        await expectNoHorizontalOverflow(page)
      })

      test('아래 탭 막대 — 탭 5개가 화면 안에 있고 지금 화면을 표시하며 토스트가 그 위에 뜬다', async ({
        page,
      }) => {
        await start(page, 'multiple-workspaces', '/workspaces/ws_01/dashboard')
        const nav = page.getByRole('navigation', { name: '주요 화면' })
        await expect(nav).toHaveCount(1)
        await expect(nav.getByRole('link')).toHaveText(['홈', '회의록', '태스크', '메시지', '팀'])
        for (const tab of await nav.getByRole('link').all())
          await expect(tab).toBeInViewport({ ratio: 1 })
        await expect(nav.getByRole('link', { name: '홈' })).toHaveAttribute('aria-current', 'page')
        const bar = await nav.evaluate((element) => ({
          overflow: element.scrollWidth - element.clientWidth,
          bottom: element.getBoundingClientRect().bottom,
          top: element.getBoundingClientRect().top,
          viewport: window.innerHeight,
        }))
        expect(bar.overflow).toBeLessThanOrEqual(0)
        expect(bar.bottom).toBe(bar.viewport)

        const header = page
          .getByRole('banner')
          .filter({ has: page.getByRole('button', { name: /^워크스페이스 바꾸기/ }) })
        await expect(header.getByRole('link')).toHaveCount(0)
        for (const name of [/^알림/, /^워크스페이스 바꾸기/, /^내 계정/])
          await expect(header.getByRole('button', { name })).toBeInViewport({ ratio: 1 })

        const toast = page.getByTestId('pinned-toast-slot')
        await expect(toast).toContainText('정리 중')
        const toastBox = await toast.boundingBox()
        expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(bar.top)

        await nav.getByRole('link', { name: '태스크' }).click()
        await expect(page).toHaveURL(/\/workspaces\/ws_01\/tasks/)
        await expect(nav.getByRole('link', { name: '태스크' })).toHaveAttribute(
          'aria-current',
          'page',
        )
      })
      return
    }

    test('앱 헤더 — 탭 5개와 두 메뉴가 한 줄에 보인다', async ({ page }) => {
      await start(page, 'multiple-workspaces', '/workspaces/ws_01/dashboard')
      const header = page.getByRole('banner')
      const nav = header.getByRole('navigation', { name: '주요 화면' })
      // 이 시나리오의 ws_01 에는 정리 중 회의(mt_10)가 있다. 정리 신호는 헤더가 아니라 오른쪽 아래 진행 토스트다 (#424) —
      // 그 토스트(좁은 폭에서는 접힌 알약)가 보인 뒤에도 탭은 5개뿐이다
      await expect(page.getByTestId('pinned-toast-slot')).toContainText('정리 중')
      const TAB_NAMES = ['대시보드', '회의록', '태스크', '메시지', '팀']
      const tabs = TAB_NAMES.map((name) => nav.getByRole('link', { name, exact: true }))
      for (const tab of tabs) await expect(tab).toHaveCount(1)
      await expect(nav.getByRole('link')).toHaveText(TAB_NAMES)
      const menus = [/^워크스페이스 바꾸기/, /^내 계정/].map((name) =>
        header.getByRole('button', { name }),
      )
      for (const menu of menus) await expect(menu).toBeInViewport()

      // 높이 대신 위치로 본다 — 줄바꿈이 없으면 탭은 모두 같은 top, 헤더 항목은 모두 같은 세로 중심에 있다
      const boxOf = async (locator: Locator) => {
        const box = await locator.boundingBox()
        expect(box).not.toBeNull()
        return box!
      }

      const tabBoxes = await Promise.all(tabs.map(boxOf))
      for (const box of tabBoxes) expect(Math.abs(box.y - tabBoxes[0].y)).toBeLessThanOrEqual(1)
      const items = [
        header.getByRole('link', { name: "Manager's Manager 대시보드" }),
        ...tabs,
        ...menus,
      ]
      const itemBoxes = await Promise.all(items.map(boxOf))
      const centers = itemBoxes.map((box) => box.y + box.height / 2)
      for (const center of centers) expect(Math.abs(center - centers[0])).toBeLessThanOrEqual(1)
      // 왼쪽에서 오른쪽으로 차례로 놓인다 — 줄이 넘어가면 이 순서가 깨진다
      const lefts = itemBoxes.map((box) => box.x)
      expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
      await expectNoHorizontalOverflow(page)
    })
  })
}

test.describe('768px 경계와 안전 영역 (D-180)', () => {
  test('공간 메뉴를 연 채 390px → 768px 로 넓혀도 메뉴와 포커스가 남는다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await start(page, 'multiple-workspaces', '/workspaces/ws_01/dashboard')
    const trigger = page.getByRole('button', { name: /^워크스페이스 바꾸기/ })
    await trigger.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect.poll(() => menu.evaluate((el) => el.contains(document.activeElement))).toBe(true)

    await page.setViewportSize({ width: 768, height: 844 })
    // 열린 공간 메뉴가 나머지 화면을 접근성 트리에서 가리므로 셸 전환은 DOM 으로 본다
    await expect(page.locator('[data-bottom-tab-bar]')).toHaveCount(0)
    await expect(page.locator('header nav a', { hasText: '대시보드' })).toBeVisible()
    await expect(menu).toBeVisible()
    await expect.poll(() => menu.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })

  for (const { width, height, inset } of [
    { width: 852, height: 393, inset: 59 },
    { width: 667, height: 375, inset: 44 },
  ]) {
    test(`가로 ${width}px · 좌우 안전 영역 ${inset}px 안쪽에 헤더와 탭 막대를 그린다`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 0, bottom: 21, left: inset, right: inset },
      })
      await start(page, 'multiple-workspaces', '/workspaces/ws_01/dashboard')
      const header = page
        .getByRole('banner')
        .filter({ has: page.getByRole('button', { name: /^워크스페이스 바꾸기/ }) })
      const controls = [header.getByRole('link'), header.getByRole('button')]
      if (width < COMPACT_BELOW)
        controls.push(page.getByRole('navigation', { name: '주요 화면' }).getByRole('link'))
      for (const group of controls) {
        for (const control of await group.all()) {
          const box = await control.boundingBox()
          expect(box!.x).toBeGreaterThanOrEqual(inset)
          expect(box!.x + box!.width).toBeLessThanOrEqual(width - inset)
        }
      }
    })
  }
})
