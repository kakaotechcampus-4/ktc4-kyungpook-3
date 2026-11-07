import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { paths } from '@/shared/config/routes'
import { start } from './support'

/*
 * #474 — 메시지 화면에서 정리 중 토스트(#424)는 대화 영역 오른쪽 아래에 앉는다. 대화 아래 고정 줄(답장 줄·안내 줄)이 있으면
 * 그 위 16px, 없으면(보내기 전 확인) 영역 아래 24px, 오른쪽은 24px 이다. 셸의 아래 여백이 없어 바깥 페이지는 스크롤하지 않고,
 * 스크롤 칸을 끝까지 내리면 마지막 버튼·`확인하기` 가 토스트 위 16px 까지 올라온다. 768px 미만은 목록이면 독 자리, 화면 전체로 연 상세면 같은 규칙이다 (#478).
 * 자리를 바꾸는 것과 셸 여백이 0 이 되는 것은 shared/ui/toast/PinnedToastHost.test.tsx 가 본다
 */

test.use({ viewport: { width: 1280, height: 800 } })

type Fold = 'collapsed' | 'expanded'
const FOLDS: Fold[] = ['collapsed', 'expanded']

async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (found === null) throw new Error('보이지 않는 요소의 크기를 잴 수 없다')
  return found
}

const detail = (page: Page) => page.getByRole('region', { name: '메시지 내용' })
const pill = (page: Page) => page.getByRole('button', { name: /펼치기/ })
const card = (page: Page) => page.getByRole('region', { name: /정리 중$/ })
const toast = (page: Page, fold: Fold) => (fold === 'collapsed' ? pill(page) : card(page))

async function fold(page: Page, next: Fold): Promise<void> {
  if (next === 'expanded') await pill(page).click()
  else await page.getByRole('button', { name: '접기' }).click()
  await expect(toast(page, next)).toBeVisible()
}

/** 기대와 1px 넘게 어긋난 것을 적는다. 비어 있으면 맞다 */
async function placementErrors(page: Page, fold: Fold, floor: Locator | null): Promise<string[]> {
  const rect = await box(toast(page, fold))
  const area = await box(detail(page))
  const below =
    floor === null
      ? area.y + area.height - (rect.y + rect.height)
      : (await box(floor)).y - (rect.y + rect.height)
  const right = area.x + area.width - (rect.x + rect.width)
  const pageScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )
  const errors: string[] = []
  const expectedBelow = floor === null ? 24 : 16
  if (Math.abs(below - expectedBelow) > 1) errors.push(`아래 간격 ${below} ≠ ${expectedBelow}`)
  if (Math.abs(right - 24) > 1) errors.push(`오른쪽 간격 ${right} ≠ 24`)
  if (pageScroll !== 0) errors.push(`바깥 페이지가 ${pageScroll}px 스크롤한다`)
  return errors
}

async function expectPlaced(page: Page, fold: Fold, floor: Locator | null): Promise<void> {
  await expect.poll(() => placementErrors(page, fold, floor)).toEqual([])
}

/**
 * 스크롤 칸을 끝까지 내린 뒤 targets 의 아래 끝이 모두 토스트 위 16px(±1) 위에 있다.
 * 펼친 토스트의 높이가 늦게 재져 끝 여백이 뒤에 늘 수 있다 — 잴 때마다 끝까지 다시 내린다
 */
async function expectClearOfToast(
  page: Page,
  fold: Fold,
  scroller: Locator,
  targets: Locator[],
): Promise<void> {
  await expect
    .poll(async () => {
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      const top = (await box(toast(page, fold))).y
      const errors: string[] = []
      for (const target of targets) {
        const { y, height } = await box(target)
        if (y + height > top - 16 + 1) errors.push(`${y + height} > 토스트 위 ${top} − 16`)
      }
      return errors
    })
    .toEqual([])
}

test('F-4 팀원 대화: 토스트는 답장 줄 위 16px · 오른쪽 24px 이고 바깥 페이지는 스크롤하지 않는다', async ({
  page,
}) => {
  await start(page, 'messages-member', '/workspaces/ws_01/messages')
  const footer = page.getByRole('form', { name: '답장' }).locator('..')
  await expect(pill(page)).toBeVisible()
  await expect(detail(page)).toContainText('정리 중')
  await expectPlaced(page, 'collapsed', footer)
  await fold(page, 'expanded')
  await expectPlaced(page, 'expanded', footer)
  await fold(page, 'collapsed')
  await expectPlaced(page, 'collapsed', footer)
})

test('F-3 PM 이 남의 대화를 보면 토스트는 안내 줄 위 16px 이고, 끝까지 내리면 확인하기가 토스트 위로 올라온다', async ({
  page,
}) => {
  await start(page, 'messages-pm-self', '/workspaces/ws_01/messages/threads/th_01')
  const footer = page.getByText(/^메시지는 항상/).locator('../..')
  const body = page.getByRole('region', { name: '대화 내용' })
  await expect(pill(page)).toBeVisible()
  for (const state of FOLDS) {
    if (state === 'expanded') await fold(page, 'expanded')
    await expectPlaced(page, state, footer)
    await expectClearOfToast(page, state, body, [
      body.getByRole('link', { name: '확인하기' }).last(),
    ])
  }
})

test('F-5 PM 자기 대화: 토스트는 답장 줄 위 16px 이고, 끝까지 내리면 확인하기가 토스트 위로 올라온다', async ({
  page,
}) => {
  await start(page, 'messages-pm-self', '/workspaces/ws_01/messages/threads/th_06')
  const footer = page.getByRole('form', { name: '답장' }).locator('..')
  const body = page.getByRole('region', { name: '대화 내용' })
  await expect(pill(page)).toBeVisible()
  for (const state of FOLDS) {
    if (state === 'expanded') await fold(page, 'expanded')
    await expectPlaced(page, state, footer)
    await expectClearOfToast(page, state, body, [
      body.getByRole('link', { name: '확인하기' }).last(),
    ])
  }
})

test('F-2 보내기 전 확인: 토스트는 영역 아래 24px 이고, 끝까지 내리면 보내지 않음·이대로 발송이 토스트 위로 올라온다', async ({
  page,
}) => {
  await start(page, 'messages-default', paths.messageReview('ws_01', 'bd_01'))
  const area = detail(page)
  const review = area.getByRole('article')
  await expect(review.getByRole('heading', { level: 2 })).toBeVisible()
  await expect(pill(page)).toBeVisible()
  await fold(page, 'expanded')
  await expectPlaced(page, 'expanded', null)
  await expectClearOfToast(page, 'expanded', review.locator('..'), [
    review.getByRole('button', { name: '보내지 않음' }),
    review.getByRole('button', { name: '이대로 발송' }),
  ])
})

test('화면을 오가도 정리 중 토스트의 펼침이 그대로다', async ({ page }) => {
  await start(page, 'messages-member', '/workspaces/ws_01/messages')
  await fold(page, 'expanded')
  await expect(card(page)).toBeVisible()
  const header = page.getByRole('banner')

  await header.getByRole('link', { name: '태스크' }).click()
  await expect(page).toHaveURL(/\/tasks/)
  await expect(card(page)).toBeVisible()
  await expect(detail(page)).toHaveCount(0)

  await header.getByRole('link', { name: '메시지' }).click()
  await expect(detail(page)).toContainText('정리 중')
  await expect(card(page)).toBeVisible()
  await expect(pill(page)).toHaveCount(0)
})

test.describe('768px 미만 (#478)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('목록에서는 토스트가 셸 독과 같은 자리(아래 탭 막대 위 24px · 오른쪽 24px)이고 바깥 페이지는 스크롤하지 않는다', async ({
    page,
  }) => {
    await start(page, 'messages-member', '/workspaces/ws_01/messages')
    await expect(pill(page)).toBeVisible()
    await expect(detail(page)).toHaveCount(0)
    const bar = await box(page.getByRole('navigation', { name: '주요 화면' }))
    for (const next of FOLDS) {
      if (next === 'expanded') await fold(page, next)
      await expect
        .poll(async () => {
          const placed = await box(toast(page, next))
          return [
            Math.round(390 - (placed.x + placed.width)),
            Math.round(bar.y - (placed.y + placed.height)),
          ]
        })
        .toEqual([24, 24])
      const pageScroll = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      )
      expect(pageScroll).toBe(0)
    }
  })

  test('펼친 토스트 아래로도 목록 끝까지 내리면 마지막 행이 토스트 위 16px 까지 올라온다', async ({
    page,
  }) => {
    await start(page, 'messages-pm-self', '/workspaces/ws_01/messages')
    await fold(page, 'expanded')
    const list = page.getByRole('complementary', { name: '메시지 목록' })
    await expectClearOfToast(page, 'expanded', list, [list.getByRole('link').last()])
  })

  test('대화를 화면 전체로 열면 탭 막대가 없고 토스트는 답장 줄 위 16px · 오른쪽 24px 이다', async ({
    page,
  }) => {
    await start(page, 'messages-member', '/workspaces/ws_01/messages/threads/th_06')
    const footer = page.getByRole('form', { name: '답장' }).locator('..')
    await expect(pill(page)).toBeVisible()
    await expect(page.getByRole('navigation', { name: '주요 화면' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '메시지 목록으로' })).toBeVisible()
    for (const state of FOLDS) {
      if (state === 'expanded') await fold(page, 'expanded')
      await expectPlaced(page, state, footer)
    }
  })
})
