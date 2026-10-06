import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

/** 지금 iframe 이 그리는 스토리 — 사이드바 화면은 `path=/story/<id>`, iframe 단독은 `id=<id>` */
function currentStoryId(page: Page) {
  const params = new URL(page.url()).searchParams
  return params.get('path')?.replace('/story/', '') ?? params.get('id')
}

/**
 * iframe 이 그리고 있는 스토리의 렌더 단계와 play 결과(.storybook/playOutcome.ts).
 * 단계만 보면 안 된다 — Storybook 은 play 의 단언이 던져도 오류를 채널·console 로만 알리고 `finished` 까지 간다
 * (기본 `throwPlayFunctionExceptions: false`, U6 r1 M01). 그래서 채널에서 모은 오류가 비었는지를 함께 본다
 */
function storyState(page: Page) {
  return page.frame({ url: /iframe\.html/ })?.evaluate(() => {
    const preview = (
      window as Window & { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } }
    ).__STORYBOOK_PREVIEW__
    const play = (
      window as Window & {
        __storyPlay?: { storyId: string; finished: boolean; errors: string[] }
      }
    ).__storyPlay
    return { phase: preview?.currentRender?.phase, play }
  })
}

/** 지금 스토리가 play 까지 끝났고, play·렌더 중 오류가 하나도 없었다 */
async function expectStoryFinished(page: Page) {
  const storyId = currentStoryId(page)
  await expect
    .poll(async () => {
      const state = await storyState(page)
      return state?.phase === 'finished' && state.play?.storyId === storyId && state.play.finished
    })
    .toBe(true)
  expect((await storyState(page))?.play?.errors).toEqual([])
}

/**
 * 사이드바에서 다른 스토리를 고른다 — iframe 은 다시 읽지 않고 그 안에서 스토리만 바뀐다.
 * 지금 스토리의 play 가 끝난 뒤에 고른다. 아직 도는 중에 떠나면 Storybook 이 iframe 을 다시 읽는다(StoryRender.teardown).
 * 다른 컴포넌트의 스토리는 사이드바에서 접혀 있어 그 컴포넌트 줄(`제목--` 앞부분)을 먼저 눌러 펼친다. 컴포넌트 줄을 누르면
 * Storybook 이 그 첫 스토리를 열므로 그 play 도 끝난 뒤에 고른다 — 바로 고르면 가끔 iframe 이 다시 읽혔다 (U6 r2, 5회 반복 중 1회)
 */
async function switchStory(page: Page, storyId: string) {
  await expectStoryFinished(page)
  const item = page.locator(`[data-item-id="${storyId}"]`)
  if (!(await item.isVisible())) {
    const component = storyId.split('--')[0]
    await page.locator(`[data-item-id="${component}"]`).click()
    await expect(page).toHaveURL(new RegExp(`path=/story/${encodeURIComponent(component)}--`))
    await expectStoryFinished(page)
  }
  await item.click()
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
  await expectStoryFinished(page)
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

  await expectStoryFinished(page)
  await expectSameFrame(page)
  expect(unhandled).toEqual([])
})

test('M5 회의 스토리 — 멈춘 업로드·db 손질·역할 바꾸기가 다음 스토리에 남지 않는다', async ({
  page,
}) => {
  const unhandled = watchUnhandled(page)
  // 업로드 POST 가 멈춘 채(오버라이드) 다음 스토리로 간다
  const preview = await openInManager(page, 'm5-회의-올리기--전송-중')
  await expect(preview.getByRole('button', { name: '정리 시작하기' })).toBeDisabled()
  await markFrame(page)

  // 팀원으로 바꾸고 회의를 지운 스토리(setup) 뒤에도 PM 회의록이 원래 데이터로 그려진다
  await switchStory(page, 'm5-회의-회의록--빈-목록-팀원')
  await expect(preview.getByText('아직 올린 회의가 없어요')).toBeVisible()
  await switchStory(page, 'm5-회의-회의록--pm-완료')
  await expect(preview.getByRole('heading', { name: '3주차 정기회의' })).toBeVisible()
  await expect(preview.getByRole('link', { name: /회의 올리기/ })).toBeVisible()

  // 단계를 손본 처리 스토리 뒤의 다른 단계 스토리는 자기 단계다
  await switchStory(page, 'm5-회의-처리--단계-2')
  await expect(preview.getByRole('status')).toContainText('2 / 3 단계 완료')
  await switchStory(page, 'm5-회의-처리--단계-0')
  await expect(preview.getByRole('status')).toContainText('0 / 3 단계 완료')

  // 조회 오류(오버라이드) 뒤의 Notion 영역은 시나리오의 상태를 그린다
  await switchStory(page, 'm5-회의-설정-notion-영역--조회-오류')
  await expect(preview.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await switchStory(page, 'm5-회의-설정-notion-영역--pm-끊김')
  await expect(preview.getByRole('button', { name: 'Notion 다시 연결하기' })).toBeVisible()

  // 올리기 기본은 멈춘 POST 와 상관없이 처음 상태다
  await switchStory(page, 'm5-회의-올리기--기본')
  await expect(preview.getByRole('button', { name: '정리 시작하기' })).toBeEnabled()

  await expectStoryFinished(page)
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

  await expectStoryFinished(page)
  await expectSameFrame(page)
  expect(unhandled).toEqual([])
})

/*
 * M5 스토리의 play 가 끝까지 통과한다 (U6-1). 렌더 단계는 play 가 던져도 `finished` 로 끝나므로 play 결과의 오류 목록을
 * 본다(expectStoryFinished) — 화면만 그려지고 play 가 깨진 스토리를 여기서 잡는다. 목록은 막 빌드한 index.json 에서 읽는다
 * (`npm run test:storybook` 이 빌드부터 한다). 헤더 `정리 중` 링크와 가드 대기의 헤더 뼈대(UX1-M01)는 M4 앱 셸 스토리 묶음에 있다.
 */
const STORY_INDEX = resolve(import.meta.dirname, '../../storybook-static/index.json')
const M5_STORIES = Object.values(
  (
    JSON.parse(readFileSync(STORY_INDEX, 'utf8')) as {
      entries: Record<string, { id: string; type: string }>
    }
  ).entries,
)
  .filter(({ id, type }) => type === 'story' && id.startsWith('m5-'))
  .map(({ id }) => id)
  .concat('m4-메뉴-앱-셸--헤더-정리-중', 'm4-메뉴-앱-셸--헤더-뼈대')

/** 스토리가 일부러 404 를 돌려주는 요청 — handler 가 받은 404 라 빠진 handler 가 아니다 */
const INTENDED_404: Record<string, string[]> = {
  'm5-회의-처리--볼-수-없음': ['/api/v1/meetings/mt_10'],
}

test('M5 스토리가 index.json 에 있다', () => {
  expect(M5_STORIES.length).toBeGreaterThan(30)
})

for (const storyId of M5_STORIES) {
  test(`play 통과 — ${storyId}`, async ({ page }) => {
    const unhandled = watchUnhandled(page)
    await page.goto(`/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`)
    await expectStoryFinished(page)
    expect(unhandled).toEqual(INTENDED_404[storyId] ?? [])
  })
}
