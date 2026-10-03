import { expect, test } from '@playwright/test'
import type { FrameLocator, Page } from '@playwright/test'

/*
 * 스토리의 `parameters.msw` 는 기본 handler 위에 얹힌다 (.storybook/preview.tsx, F-r1 #1).
 * - 오버라이드 스토리를 처음 열어도 나머지 요청은 기본 handler 가 받는다
 * - 같은 iframe 에서 다음 스토리로 옮겨도 앞 스토리의 handler 가 남거나 기본 handler 가 사라지지 않는다
 * MSW 가 받지 않은 요청은 정적 서버(serve.mjs)에서 404 가 된다 — 그래서 `/api/v1/*` 404 가 0 건이어야 한다.
 */

function watchUnhandled(page: Page) {
  const unhandled: string[] = []
  page.on('response', (response) => {
    const { pathname } = new URL(response.url())
    if (pathname.startsWith('/api/v1/') && response.status() === 404) unhandled.push(pathname)
  })
  return unhandled
}

/** Storybook 화면(사이드바 + iframe)으로 스토리를 연다 */
async function openInManager(page: Page, storyId: string) {
  await page.goto(`/?path=/story/${encodeURIComponent(storyId)}`)
  return page.frameLocator('#storybook-preview-iframe')
}

/** 사이드바에서 다른 스토리를 고른다 — iframe 은 다시 읽지 않고 그 안에서 스토리만 바뀐다 */
async function switchStory(page: Page, storyId: string) {
  await page.locator(`[data-item-id="${storyId}"]`).click()
  await expect(page).toHaveURL(new RegExp(`path=/story/${encodeURIComponent(storyId)}`))
}

/** iframe 이 다시 읽히지 않았음을 확인할 표식을 남긴다 */
async function markFrame(page: Page) {
  const frame = page.frame({ url: /iframe\.html/ })
  await frame?.evaluate(() => {
    ;(window as Window & { __sbSameFrame?: boolean }).__sbSameFrame = true
  })
}

async function expectSameFrame(page: Page) {
  const frame = page.frame({ url: /iframe\.html/ })
  expect(
    await frame?.evaluate(() => (window as Window & { __sbSameFrame?: boolean }).__sbSameFrame),
  ).toBe(true)
}

async function expectHeaderData(preview: FrameLocator) {
  await expect(preview.getByRole('button', { name: /^워크스페이스 바꾸기/ })).toContainText(
    '카테캠 3팀',
  )
}

test('오버라이드 스토리를 바로 열어도 나머지 요청은 기본 handler 가 받는다', async ({ page }) => {
  const unhandled = watchUnhandled(page)
  await page.goto('/iframe.html?id=m4-메뉴-앱-셸--로그아웃-오류&viewMode=story')
  const root = page.locator('#storybook-root')
  // play 가 로그아웃을 누른 뒤 — 오버라이드(500)가 먹었고 헤더에는 공간 이름이 있다
  await expect(root.getByRole('alert')).toBeVisible()
  await expect(root.getByRole('button', { name: /^워크스페이스 바꾸기/ })).toContainText(
    '카테캠 3팀',
  )
  expect(unhandled).toEqual([])
})

test('오버라이드 스토리 뒤에 연 기본 스토리도 기본 데이터를 그린다', async ({ page }) => {
  const unhandled = watchUnhandled(page)
  const preview = await openInManager(page, 'm4-메뉴-앱-셸--로그아웃-오류')
  await expect(preview.getByRole('alert')).toBeVisible()
  await expectHeaderData(preview)
  await markFrame(page)

  await switchStory(page, 'm4-메뉴-앱-셸--선택-목록-오류')
  await expect(preview.getByRole('button', { name: '다시 시도' })).toBeVisible()

  await switchStory(page, 'm4-메뉴-앱-셸--선택-목록-기본')
  await expect(preview.getByText('카테캠 3팀')).toBeVisible()
  await expect(preview.getByText('사이드 프로젝트')).toBeVisible()

  await switchStory(page, 'm4-메뉴-앱-셸--헤더-기본')
  await expectHeaderData(preview)

  await expectSameFrame(page)
  expect(unhandled).toEqual([])
})

test('멈춘 요청·조회 오류 스토리를 지나도 온보딩 기본 스토리가 그대로다', async ({ page }) => {
  const unhandled = watchUnhandled(page)
  const preview = await openInManager(page, 'm4-온보딩-단계--팀원-조회-오류')
  await expect(preview.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await markFrame(page)

  await switchStory(page, 'm4-온보딩-단계--팀원-기본')
  await expect(preview.getByLabel('@seoyeon_01의 팀원 이름')).toBeVisible()

  await switchStory(page, 'm4-온보딩-단계--discord-로딩')
  await expect(preview.getByRole('button', { name: '연결하기' })).toHaveCount(0)

  await switchStory(page, 'm4-온보딩-단계--discord-기본')
  await expect(preview.getByRole('button', { name: '연결하기' })).toBeVisible()

  await expectSameFrame(page)
  expect(unhandled).toEqual([])
})
