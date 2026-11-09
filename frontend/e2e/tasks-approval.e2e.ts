import { expect, test } from '@playwright/test'
import type { Locator, Page, Response } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'

/*
 * M6 §5 — 태스크 목록·상세·확인 필요 상세. 상태는 MSW 시나리오(shared/mock/scenarios.ts)로만 만든다.
 *
 * - tasks-default: ws_01 의 PM. 태스크 10건, 보완이 필요한 대기 생성 승인 3건(ap_01 알림 문구 검토 · ap_02 테스트 계획 정리 ·
 *   ap_03 배포 문서 보완). 셋 다 mt_09 회의의 추출 항목(it_04~it_06)이다. Notion 은 연동돼 있어 새 태스크는 반영 대기(pending)다
 * - tasks-member: 같은 공간의 일반 팀원
 */

/** 한 테스트가 lazy 화면을 둘 이상 지난다 — meeting-flow.e2e.ts 와 같은 까닭으로 전체 한도만 늘린다 (F-r3) */
test.describe.configure({ timeout: 60_000 })

/** lazy 화면으로 옮긴 뒤 첫 단언 — 개발 서버가 그 화면을 처음 변환하는 동안 기본 5초를 넘길 때가 있다 */
const FIRST_PAINT = { timeout: 15_000 }

const WORKSPACE = '/workspaces/ws_01'

/** 페이지가 보낸 요청. MSW 가 서비스 워커에서 받는 요청도 페이지 요청으로 잡힌다 (meeting-flow.e2e.ts) */
function recordRequests(page: Page) {
  const requests: { method: string; pathname: string }[] = []
  page.on('request', (request) => {
    requests.push({ method: request.method(), pathname: new URL(request.url()).pathname })
  })
  return requests
}

/** 전역 토스트 한 장 — Radix 가 같은 문구를 스크린리더용으로 한 번 더 그려서 목록 항목으로 고른다 (meeting-flow.e2e.ts) */
function toastOf(page: Page, text: string) {
  return page
    .getByRole('region', { name: /^Notifications/ })
    .getByRole('listitem')
    .filter({ hasText: text })
}

function tabTexts(page: Page) {
  return page.getByRole('tablist', { name: '태스크 구분' }).getByRole('tab')
}

/** 회의록 본문의 `추출된 일` 탭을 연다. 탭 선택은 화면 상태라 돌아오면 다시 고른다 */
async function openExtractedWork(page: Page) {
  const body = page.getByRole('region', { name: '회의록 본문' })
  await expect(body.getByRole('heading', { name: '3주차 정기회의' })).toBeVisible(FIRST_PAINT)
  await body.getByRole('tab', { name: /추출된 일/ }).click()
  return body
}

const CREATE = '이 태스크, 승인할까요?'
const UPDATE = '이 변경, 승인할까요?'

function approvalCard(page: Page) {
  return page.getByRole('region', { name: 'Notion 에 올라갈 태스크' })
}

/**
 * 확인 필요 상세의 카드에서 빈 칸을 바로 채운다. 고르지 않은 칸만 채운다.
 * 고친 값은 아직 저장되지 않았다 — 승인해야 함께 저장된다
 */
async function fillCard(page: Page, values: { assignee?: string; due?: string }): Promise<void> {
  const card = approvalCard(page)
  if (values.assignee !== undefined) {
    await card.getByRole('combobox', { name: /^담당자/ }).click()
    await page.getByRole('option', { name: values.assignee }).click()
    await expect(card.getByRole('combobox', { name: '담당자' })).toContainText(values.assignee)
  }
  if (values.due !== undefined) await card.getByRole('textbox', { name: /^마감/ }).fill(values.due)
}

/** 처리 결과의 생성된 태스크 링크(태스크 제목)에서 태스크 ID 를 꺼낸다 */
async function createdTaskId(page: Page, title: string): Promise<string> {
  const href = await page
    .getByRole('region', { name: '처리 결과' })
    .getByRole('link', { name: title })
    .getAttribute('href')
  const match = /\/tasks\/(tk_\w+)$/.exec(href ?? '')
  expect(match, `생성된 태스크 링크: ${href}`).not.toBeNull()
  return match![1]
}

test('회의록의 확인 필요 항목을 보완·승인하고 돌아오면 회의록과 태스크 목록이 갱신된다', async ({
  page,
}) => {
  await start(page, 'tasks-default', `${WORKSPACE}/meetings/mt_09`)
  let body = await openExtractedWork(page)
  await expect(body.getByRole('heading', { name: '확인이 필요한 일 3' })).toBeVisible()
  await expect(body.getByRole('link', { name: '알림 문구 검토', exact: true })).toHaveCount(0)

  // 회의록 → 확인 필요 상세. it_04 는 담당자·마감이 없는 보류 항목이라 `채워 넣기` 다
  await body.getByRole('link', { name: '알림 문구 검토 채워 넣기' }).click()
  await expect(page).toHaveURL(`${WORKSPACE}/approvals/ap_01`)
  await expect(page.getByRole('heading', { level: 1, name: CREATE })).toBeVisible(FIRST_PAINT)
  const approve = page.getByRole('button', { name: '승인', exact: true })
  await expect(approve).toBeEnabled()

  await fillCard(page, { assignee: '박민수', due: '2026-10-20' })
  await expect(approve).toBeEnabled()
  await approve.click()

  // 같은 상세에 처리 결과와 생성된 태스크 링크가 남는다
  await expect(page.getByTestId('approval-result')).toHaveText(/^승인했어요/)
  const taskId = await createdTaskId(page, '알림 문구 검토')

  // 뒤로 가면 회의록 — 확인 필요는 하나 줄고, 그 항목은 반영된 태스크로 옮겨 새 태스크를 가리킨다
  await page.goBack()
  await expect(page).toHaveURL(`${WORKSPACE}/meetings/mt_09`)
  body = await openExtractedWork(page)
  await expect(body.getByRole('heading', { name: '확인이 필요한 일 2' })).toBeVisible()
  await expect(body.getByRole('link', { name: '알림 문구 검토 채워 넣기' })).toHaveCount(0)
  await expect(body.getByRole('link', { name: '알림 문구 검토', exact: true })).toHaveAttribute(
    'href',
    `${WORKSPACE}/tasks/${taskId}`,
  )

  // 태스크 목록 — 승인 하나가 태스크 하나로 바뀌었다. 남은 확인 필요는 별도 목록이고, 만든 태스크는 태스크 목록에 있다
  await page.getByRole('banner').getByRole('link', { name: '태스크', exact: true }).click()
  await expect(page).toHaveURL(`${WORKSPACE}/tasks`)
  await expect(tabTexts(page)).toHaveText(['전체 13', '확인 필요 2', '진행 중 8', '완료 3'], {
    timeout: 15_000,
  })
  const review = page.getByRole('list', { name: '확인 필요 목록' })
  await expect(review.locator('[data-kind="approval"]')).toHaveCount(2)
  await expect(review.locator(`a[href="${WORKSPACE}/approvals/ap_01"]`)).toHaveCount(0)
  const list = page.getByRole('list', { name: '태스크 목록' })
  await expect(list.locator('[data-kind="approval"]')).toHaveCount(0)
  await expect(list.getByRole('link', { name: '알림 문구 검토' })).toHaveAttribute(
    'href',
    `${WORKSPACE}/tasks/${taskId}`,
  )
})

test.describe('회의록의 승인 전 수정 제안 (#419)', () => {
  // minutes-edit-pending: mt_09 의 it_08 은 tk_04(배포 스크립트) 마감을 바꾸는 수정 제안 ap_08 이다. 승인 전에도 task_id 가 tk_04 다
  const EDIT = '배포 스크립트'

  async function openPendingEdit(page: Page) {
    await start(page, 'minutes-edit-pending', `${WORKSPACE}/meetings/mt_09`)
    const body = await openExtractedWork(page)
    await expect(body.getByRole('heading', { name: '확인이 필요한 일 4' })).toBeVisible()
    await expect(body.getByRole('link', { name: EDIT, exact: true })).toHaveCount(0)
    await body.getByRole('link', { name: `${EDIT} 확인하기` }).click()
    await expect(page).toHaveURL(`${WORKSPACE}/approvals/ap_08`)
    await expect(page.getByRole('heading', { level: 1, name: UPDATE })).toBeVisible(FIRST_PAINT)
  }

  test('승인하면 확인 필요에서 빠지고 반영된 태스크로 옮겨 대상 태스크를 가리킨다', async ({
    page,
  }) => {
    await openPendingEdit(page)
    await page.getByRole('button', { name: '승인', exact: true }).click()
    await expect(page.getByTestId('approval-result')).toHaveText(/^승인했어요/)

    await page.goBack()
    await expect(page).toHaveURL(`${WORKSPACE}/meetings/mt_09`)
    const body = await openExtractedWork(page)
    await expect(body.getByRole('heading', { name: '확인이 필요한 일 3' })).toBeVisible()
    await expect(body.getByRole('link', { name: `${EDIT} 확인하기` })).toHaveCount(0)
    await expect(body.getByRole('link', { name: EDIT, exact: true })).toHaveAttribute(
      'href',
      `${WORKSPACE}/tasks/tk_04`,
    )
  })

  test('반려하면 확인 필요에서 빠지고 반영된 태스크에도 나오지 않는다', async ({ page }) => {
    await openPendingEdit(page)
    await page.getByRole('button', { name: '반려', exact: true }).click()
    await expect(page.getByTestId('approval-result')).toHaveText(/^반려했어요/)

    await page.goBack()
    await expect(page).toHaveURL(`${WORKSPACE}/meetings/mt_09`)
    const body = await openExtractedWork(page)
    await expect(body.getByRole('heading', { name: '확인이 필요한 일 3' })).toBeVisible()
    await expect(body.getByRole('link', { name: `${EDIT} 확인하기` })).toHaveCount(0)
    await expect(body.getByRole('link', { name: EDIT, exact: true })).toHaveCount(0)
  })
})

/** 태스크 단건 조회 응답의 notion_sync_status. MSW 응답 봉투는 `{ data, error }` 다 */
async function syncStatusOf(response: Response): Promise<unknown> {
  const body = (await response.json()) as { data?: { notion_sync_status?: unknown } }
  return body.data?.notion_sync_status
}

/**
 * 모의 db 의 태스크 Notion 상태를 바꾼다. MSW 에는 대기열을 처리하는 워커가 없다 — 통합 테스트처럼 필드를 직접 바꿔
 * 다음 조회 응답이 `synced` 가 되게 한다 (shared/mock/task-state.ts enqueueTaskSync). handler 는 페이지에서 돌고,
 * 개발 서버는 같은 주소의 모듈을 한 번만 읽으므로 앱의 db 와 같은 객체다. 실제 Notion 반영 검증이 아니다
 */
async function setMockNotionStatus(page: Page, taskId: string, status: 'synced'): Promise<void> {
  const changed = await page.evaluate(
    async ({ id, next }) => {
      const dbModule = '/src/shared/mock/db.ts'
      const { db } = (await import(/* @vite-ignore */ dbModule)) as {
        db: { tasks: { task_id: string; notion_sync_status: string | null }[] }
      }
      const task = db.tasks.find(({ task_id }) => task_id === id)
      if (task === undefined) return false
      task.notion_sync_status = next
      return true
    },
    { id: taskId, next: status },
  )
  expect(changed).toBe(true)
}

test('승인 뒤 Notion 은 조회 응답이 실제로 synced 일 때만 `반영됨` 이다 — 그 전 polling 은 `반영 중`', async ({
  page,
}) => {
  await start(page, 'tasks-default', `${WORKSPACE}/approvals/ap_02`)
  await expect(page.getByRole('heading', { level: 1, name: CREATE })).toBeVisible(FIRST_PAINT)
  // ap_02 는 마감만 비었다
  await fillCard(page, { due: '2026-10-21' })
  await page.getByRole('button', { name: '승인', exact: true }).click()
  await expect(page.getByTestId('approval-result')).toHaveText(/^승인했어요/)
  const taskId = await createdTaskId(page, '테스트 계획 정리')
  const status = page.getByTestId('notion-sync-status')

  // 승인 성공만으로는 `반영됨` 이 아니다. 3초 polling 두 번이 pending 을 받는 동안 그대로 `반영 중`
  const detailPath = `/api/v1/tasks/${taskId}`
  const seen: unknown[] = []
  page.on('response', (response) => {
    if (response.request().method() === 'GET' && new URL(response.url()).pathname === detailPath)
      void syncStatusOf(response).then((value) => seen.push(value))
  })
  await expect(status).toHaveText('반영 중')
  await expect.poll(() => seen.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  expect(seen.every((value) => value === 'pending')).toBe(true)
  await expect(status).toHaveText('반영 중')

  // 서버(모의 db)가 synced 가 되면 다음 polling 응답이 synced 이고, 그 뒤에야 `반영됨` 이다
  const syncedResponse = page.waitForResponse(
    async (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === detailPath &&
      (await syncStatusOf(response)) === 'synced',
    { timeout: 10_000 },
  )
  await setMockNotionStatus(page, taskId, 'synced')
  await syncedResponse
  await expect(status).toHaveText('반영됨')

  // 태스크 상세도 같은 서버 상태를 읽는다. 종료 상태라 더 묻지 않는다
  await page.getByRole('link', { name: '테스트 계획 정리' }).click()
  await expect(page).toHaveURL(`${WORKSPACE}/tasks/${taskId}`)
  await expect(page.getByRole('heading', { name: '테스트 계획 정리' })).toBeVisible(FIRST_PAINT)
  await expect(page.getByTestId('notion-sync-status')).toHaveText('반영됨')
  const settled = seen.length
  await page.waitForTimeout(3_500)
  expect(seen.length - settled).toBeLessThanOrEqual(1)
})

test('일반 팀원이 승인 URL 로 들어오면 목록으로 가고 접근 권한 안내가 보이며 승인 조회는 0회다', async ({
  page,
}) => {
  const requests = recordRequests(page)
  await start(page, 'tasks-member', `${WORKSPACE}/approvals/ap_01`)
  await expect(page).toHaveURL(`${WORKSPACE}/tasks`, FIRST_PAINT)
  await expect(toastOf(page, '접근 권한이 없어요')).toBeVisible()
  await expect(tabTexts(page)).toHaveText(['전체 10', '진행 중 7', '완료 3'], FIRST_PAINT)
  // 상세는 물론 승인 목록도 부르지 않는다 (가드가 화면을 그리기 전에 막고, 팀원 목록은 승인 조회가 꺼져 있다)
  expect(requests.filter(({ pathname }) => pathname.startsWith('/api/v1/approvals'))).toEqual([])
})

/**
 * Tab(또는 Shift+Tab)을 눌러 target 에 닿을 때까지 간다. limit 번 안에 닿지 않으면 실패다 (meeting-keyboard.e2e.ts 와 같다)
 */
async function tabTo(page: Page, target: Locator, { back = false, limit = 40 } = {}) {
  for (let step = 0; step < limit; step += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab')
  }
  await expect(target).toBeFocused()
}

test('키보드 — 목록 탭은 화살표로 옮겨 URL 에 남고, 카드 칸의 오류는 칸에 연결되며 승인까지 키보드로 간다', async ({
  page,
}) => {
  await start(page, 'tasks-default', `${WORKSPACE}/tasks`)
  await expect(tabTexts(page)).toHaveText(['전체 13', '확인 필요 3', '진행 중 7', '완료 3'], {
    timeout: 15_000,
  })
  const all = page.getByRole('tab', { name: /^전체/ })
  await tabTo(page, all)
  await page.keyboard.press('ArrowRight')
  const review = page.getByRole('tab', { name: /^확인 필요/ })
  await expect(review).toBeFocused()
  await expect(review).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(`${WORKSPACE}/tasks?tab=needs_review`)

  // 확인 필요 첫 줄(가장 오래된 ap_01)로 Tab 해서 Enter
  const first = page.getByRole('link', { name: '알림 문구 검토' })
  await tabTo(page, first)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`${WORKSPACE}/approvals/ap_01`)
  await expect(page.getByRole('heading', { level: 1, name: CREATE })).toBeVisible(FIRST_PAINT)
  const approve = page.getByRole('button', { name: '승인', exact: true })
  await expect(approve).toBeEnabled()

  // 제목을 지우고 칸을 떠나면 칸에 오류가 이어지고, 꺼진 `승인` 은 이유 문구를 설명으로 읽는다
  const card = approvalCard(page)
  const title = card.getByRole('textbox', { name: '태스크명' })
  await tabTo(page, title)
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Tab')
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await expect(title).toHaveAccessibleDescription('제목을 입력해 주세요.')
  await expect(approve).toBeDisabled()
  await expect(approve).toHaveAccessibleDescription('승인하려면 제목 정보를 올바르게 채워야 해요.')
  const due = card.getByRole('textbox', { name: /^마감/ })
  await expect(due).not.toHaveAttribute('aria-invalid', 'true')

  // 키보드로 고친다 — 제목 입력, 담당자는 Enter 로 열어 화살표로 고르고, 마감은 칸에 값 입력
  await tabTo(page, title)
  await page.keyboard.type('알림 문구 최종 검토')
  await expect(title).not.toHaveAttribute('aria-invalid', 'true')
  const assignee = card.getByRole('combobox', { name: /^담당자/ })
  await tabTo(page, assignee)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox')).toBeVisible()
  // 고른 줄이 없으면 Radix 가 첫 활성 줄인 맨 위 「미정」에 포커스를 둔다 — 화살표 한 번이 첫 팀원이다
  await expect(page.getByRole('option', { name: '미정' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: '김서연' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(assignee).toBeFocused()
  await expect(assignee).toContainText('김서연')
  await tabTo(page, due)
  await due.fill('2026-10-22')
  await expect(due).toHaveValue('2026-10-22')
  await expect(approve).toBeEnabled()

  await tabTo(page, approve)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('approval-result')).toHaveText(/^승인했어요/)
  await expect(page.getByRole('link', { name: '알림 문구 최종 검토' })).toBeVisible()
})

const VIEWPORTS = [1024, 1440, 1920] as const

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

/** 본문 단이 960px 이하이고 문서 가운데에 있다 (목록·상세·확인 필요 상세 공통 ROOT) */
async function expectCenteredMain(page: Page) {
  const main = await boxOf(page.locator('#root main').first())
  const width = await page.evaluate(() => document.documentElement.clientWidth)
  expect(main.width).toBeLessThanOrEqual(960)
  expect(Math.abs(main.x - (width - (main.x + main.width)))).toBeLessThanOrEqual(1)
}

const SCREENS: { name: string; path: string; check: (page: Page) => Promise<void> }[] = [
  {
    name: '태스크 목록',
    path: `${WORKSPACE}/tasks`,
    check: async (page) => {
      await expect(page.getByRole('list', { name: '태스크 목록' })).toBeVisible(FIRST_PAINT)
      await expect(page.getByRole('tablist', { name: '태스크 구분' })).toBeInViewport()
      await expect(page.getByRole('group', { name: '마감 조건' })).toBeInViewport()
    },
  },
  {
    name: '태스크 상세',
    path: `${WORKSPACE}/tasks/tk_01`,
    check: async (page) => {
      await expect(page.getByRole('heading', { name: '로그인 API 연동' })).toBeVisible(FIRST_PAINT)
      await expect(page.getByLabel('상태 바꾸기')).toBeInViewport()
      await expect(page.getByTestId('notion-sync-status')).toBeVisible()
    },
  },
  {
    name: '확인 필요 상세',
    path: `${WORKSPACE}/approvals/ap_01`,
    check: async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: CREATE })).toBeVisible(FIRST_PAINT)
      await expectCardFieldsInOneRow(page)
      // 승인·반려가 본문 단 안이다
      const main = await boxOf(page.locator('#root main').first())
      for (const name of ['반려', '승인']) {
        const button = await boxOf(page.getByRole('button', { name, exact: true }))
        expect(button.x + button.width).toBeLessThanOrEqual(main.x + main.width)
      }
    },
  },
]

/** 태스크명·담당자·마감 세 칸이 한 줄이고 셋 다 44px 다 (E-6) */
async function expectCardFieldsInOneRow(page: Page) {
  const card = approvalCard(page)
  const boxes = [
    await boxOf(card.getByRole('textbox', { name: '태스크명' })),
    await boxOf(card.getByRole('combobox', { name: /^담당자/ })),
    await boxOf(card.getByRole('textbox', { name: /^마감/ }).locator('..')),
  ]
  for (const box of boxes) {
    expect(box.height).toBe(44)
    expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1)
  }
  expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x)
  expect(boxes[1].x + boxes[1].width).toBeLessThanOrEqual(boxes[2].x)
}

test.describe('390px 휴대폰', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('확인 필요 상세 — 본문과 카드가 화면 폭 안에 들고 세 칸이 위아래로 쌓이며 채우기가 보인다', async ({
    page,
  }, testInfo) => {
    await start(page, 'tasks-default', `${WORKSPACE}/approvals/ap_01`)
    await expect(page.getByRole('heading', { level: 1, name: CREATE })).toBeVisible(FIRST_PAINT)
    const card = approvalCard(page)
    const title = await boxOf(card.getByRole('textbox', { name: '태스크명' }))
    const due = await boxOf(card.getByRole('textbox', { name: /^마감/ }).locator('..'))
    expect(due.y).toBeGreaterThan(title.y + title.height)
    await expect(page.getByRole('button', { name: '9/21(월)로 채우기' })).toBeVisible()
    // 본문과 카드만 화면 폭에 맞는지 본다. 앱 셸의 넘침은 #478 범위다
    const { mainWidth, innerWidth } = await page.evaluate(() => ({
      mainWidth: document.querySelector('#root main')?.scrollWidth ?? Infinity,
      innerWidth: window.innerWidth,
    }))
    expect(mainWidth).toBeLessThanOrEqual(innerWidth)
    const box = await boxOf(card)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(innerWidth)
    await testInfo.attach('approval-390', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
})

for (const width of VIEWPORTS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const screen of SCREENS) {
      test(`${screen.name} — 가로 스크롤 없이 가운데 본문 단을 지킨다`, async ({
        page,
      }, testInfo) => {
        await start(page, 'tasks-default', screen.path)
        await screen.check(page)
        await expectCenteredMain(page)
        await expectNoHorizontalOverflow(page)
        await testInfo.attach(`${screen.name}-${width}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })
      })
    }
  })
}

test('담당자와 마감을 미정으로 승인하고 원래 제안과 서버 반영값을 함께 읽는다', async ({
  page,
}, testInfo) => {
  const bodies: unknown[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === '/api/v1/approvals/ap_03'
    )
      bodies.push(request.postDataJSON())
  })
  await start(page, 'tasks-default', `${WORKSPACE}/approvals/ap_03`)
  const card = approvalCard(page)
  await card.getByRole('textbox', { name: '태스크명' }).fill('미정으로 승인한 태스크', FIRST_PAINT)
  // ap_03 의 담당자는 처음부터 미정이다. 마감은 비우면 미정으로 올라간다
  await expect(card.getByRole('combobox', { name: '담당자 · 미정' })).toBeVisible()
  await card.getByRole('textbox', { name: '마감' }).fill('')
  await page.getByRole('button', { name: '승인', exact: true }).click()
  await expect(page.getByTestId('approval-result')).toHaveText(/^승인했어요/)
  expect(bodies).toEqual([
    {
      status: 'approved',
      // 본 카드의 지문 (#547)
      payload_version: expect.stringMatching(/^[0-9a-f]{16}$/),
      task_overrides: { task_title: '미정으로 승인한 태스크', due_date: null },
    },
  ])
  await expect(page.getByLabel('반영한 값')).toContainText('미정으로 승인한 태스크')
  await expect(page.getByLabel('반영한 값')).toContainText('미정')
  await expect(page.getByLabel('요청한 값')).toContainText('2026-09-25')
  await testInfo.attach('undecided-approved-result', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
})

test('변경을 고친 뒤 충돌하고 입력을 바꿨다 되돌려도 새 충돌을 확인한 뒤에만 재승인한다', async ({
  page,
}, testInfo) => {
  const bodies: unknown[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === '/api/v1/approvals/ap_04'
    )
      bodies.push(request.postDataJSON())
  })
  await start(page, 'approval-conflict', `${WORKSPACE}/approvals/ap_04`)
  const due = page.getByRole('textbox', { name: '마감', exact: true })
  await due.fill('2026-10-22', FIRST_PAINT)
  await page.getByRole('button', { name: '승인', exact: true }).click()
  await expect(page.getByRole('alert', { name: '변경 충돌' })).toBeVisible()
  await due.fill('2026-10-23')
  await due.fill('2026-10-22')
  await expect(page.getByRole('alert', { name: '변경 충돌' })).toHaveCount(0)
  await page.getByRole('button', { name: '승인', exact: true }).click()
  await expect(page.getByRole('alert', { name: '변경 충돌' })).toBeVisible()
  expect(bodies).toEqual([
    { status: 'approved', task_overrides: { due_date: '2026-10-22' } },
    { status: 'approved', task_overrides: { due_date: '2026-10-22' } },
  ])
  await testInfo.attach('updated-conflict', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
  await page.getByRole('button', { name: '지금 값을 확인했어요, 다시 승인' }).click()
  await expect(page.getByTestId('approval-result')).toHaveText(/^승인했어요/)
  expect(bodies.at(-1)).toEqual({
    status: 'approved',
    task_overrides: { due_date: '2026-10-22' },
    confirm_task_version: 1,
  })
  await expect(page.getByRole('table', { name: '현재값과 제안값' })).toContainText('2026-10-22')
})

test('범위 변경 승인은 결정 문장과 근거를 보이고, 승인하면 태스크 이력에 범위 변경 한 줄이 남는다 (#205)', async ({
  page,
}, testInfo) => {
  await start(page, 'approval-scope', `${WORKSPACE}/tasks?tab=needs_review`)
  const review = page.getByRole('list', { name: '확인 필요 목록' })
  const scopeCards = review
    .locator('[data-kind="approval"]')
    .filter({ hasText: '범위 변경을 확인해야 해요' })
  await expect(scopeCards).toHaveCount(2, FIRST_PAINT)
  await expect(review).not.toContainText('변경 제안을 확인해야 해요')

  await page.goto(`${WORKSPACE}/approvals/ap_06`)
  const withDue = page.getByRole('region', { name: '범위 변경' })
  await expect(withDue).toContainText(
    '회원가입은 이메일 인증까지만 하고 마감을 25일로 미뤄요.',
    FIRST_PAINT,
  )
  await expect(page.getByRole('table', { name: '현재값과 제안값' })).toContainText('2026-09-25')
  await testInfo.attach('scope-with-due', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })

  await page.goto(`${WORKSPACE}/approvals/ap_05`)
  const scope = page.getByRole('region', { name: '범위 변경' })
  await expect(scope).toContainText('소셜 로그인은 이번 범위에서 빼기로 했어요.', FIRST_PAINT)
  await expect(scope.getByRole('figure', { name: '근거' })).toContainText(
    '소셜 로그인은 이번엔 빼기로 했어요.',
  )
  await expect(page.getByText('바꿀 항목 값은 없어요.')).toBeVisible()
  await expect(page.getByRole('table', { name: '현재값과 제안값' })).toHaveCount(0)
  await testInfo.attach('scope-only', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })

  await page.getByRole('button', { name: '승인', exact: true }).click()
  await expect(page.getByTestId('approval-result')).toHaveText(/^승인했어요/)
  await page
    .getByRole('region', { name: '처리 결과' })
    .getByRole('link', { name: '로그인 API 연동' })
    .click()
  await expect(page).toHaveURL(`${WORKSPACE}/tasks/tk_01`)
  const history = page.getByRole('list', { name: '변경 이력' })
  await expect(
    history.getByText('범위 변경: 소셜 로그인은 이번 범위에서 빼기로 했어요.'),
  ).toBeVisible(FIRST_PAINT)
  await expect(history).not.toContainText('제목: 없음')
  await page.reload()
  await expect(
    page
      .getByRole('list', { name: '변경 이력' })
      .getByText('범위 변경: 소셜 로그인은 이번 범위에서 빼기로 했어요.'),
  ).toBeVisible(FIRST_PAINT)
  await testInfo.attach('scope-history', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
})
