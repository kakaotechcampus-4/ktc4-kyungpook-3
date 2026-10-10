import { expect, test } from '@playwright/test'
import type { Locator, Page, Response } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'

/*
 * M6 §5 — 태스크 목록·상세·확인 필요 상세. 상태는 MSW 시나리오(shared/mock/scenarios.ts)로만 만든다.
 * 개발 서버 + VITE_ENABLE_MSW 라 승인 처리 경로는 `msw` 다 — `보완하기` 가 있고 보완값이 승인 요청에 함께 실린다.
 * 실 API 의 보완 지원·승인 조회 PM 제한·실제 Notion 반영은 여기서 검증하지 않는다(별도 연동 과제).
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

/**
 * 확인 필요 상세에서 `보완하기` 로 빈 칸을 채우고 `보완 완료`. 고르지 않은 칸만 채운다.
 * 보완값은 아직 저장되지 않았다 — 승인해야 함께 저장된다
 */
async function completeOverrides(
  page: Page,
  values: { assignee?: string; due?: string },
): Promise<void> {
  await page.getByRole('button', { name: '보완하기' }).click()
  const form = page.getByRole('group', { name: '확정할 값 보완' })
  if (values.assignee !== undefined)
    await form.getByLabel('담당자').selectOption({ label: values.assignee })
  if (values.due !== undefined) await form.getByLabel('마감').fill(values.due)
  await page.getByRole('button', { name: '보완 완료' }).click()
  await expect(page.getByText('보완한 값이에요. 승인해야 저장돼요.')).toBeVisible()
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
  await expect(page.getByRole('heading', { name: '새 태스크 확인' })).toBeVisible(FIRST_PAINT)
  const approve = page.getByRole('button', { name: '승인', exact: true })
  await expect(approve).toBeDisabled()

  await completeOverrides(page, { assignee: '박민수', due: '2026-10-20' })
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

  // 태스크 목록 — 승인 하나가 태스크 하나로 바뀌었다. 탭 개수와 목록이 같다
  await page.getByRole('banner').getByRole('link', { name: '태스크', exact: true }).click()
  await expect(page).toHaveURL(`${WORKSPACE}/tasks`)
  await expect(tabTexts(page)).toHaveText(['전체 13', '확인 필요 2', '진행 중 8', '완료 3'], {
    timeout: 15_000,
  })
  const list = page.getByRole('list', { name: '태스크 목록' })
  await expect(list.locator('li[data-kind="approval"]')).toHaveCount(2)
  await expect(list.getByRole('link', { name: '알림 문구 검토' })).toHaveAttribute(
    'href',
    `${WORKSPACE}/tasks/${taskId}`,
  )
  await expect(list.locator(`a[href="${WORKSPACE}/approvals/ap_01"]`)).toHaveCount(0)
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
  await expect(page.getByRole('heading', { name: '새 태스크 확인' })).toBeVisible(FIRST_PAINT)
  // ap_02 는 마감만 비었다
  await completeOverrides(page, { due: '2026-10-21' })
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

test('키보드 — 목록 탭은 화살표로 옮겨 URL 에 남고, 보완 폼의 오류는 칸에 연결되며 승인까지 키보드로 간다', async ({
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
  await expect(page.getByRole('heading', { name: '새 태스크 확인' })).toBeVisible(FIRST_PAINT)

  // 꺼진 `승인` 은 이유 문구를 설명으로 읽는다
  const approve = page.getByRole('button', { name: '승인', exact: true })
  await expect(approve).toHaveAccessibleDescription(/^승인하려면 담당자·마감 정보를/)

  const edit = page.getByRole('button', { name: '보완하기' })
  await tabTo(page, edit)
  await page.keyboard.press('Enter')
  const form = page.getByRole('group', { name: '확정할 값 보완' })
  const title = form.getByLabel('제목')
  await tabTo(page, title)
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  const done = page.getByRole('button', { name: '보완 완료' })
  await tabTo(page, done)
  await page.keyboard.press('Enter')

  // 제출하면 첫 오류 칸(제목)으로 포커스가 가고, 칸마다 오류가 aria-describedby 로 이어진다
  await expect(title).toBeFocused()
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await expect(title).toHaveAccessibleDescription('제목을 입력해 주세요.')
  const assignee = form.getByLabel('담당자')
  await expect(assignee).toHaveAccessibleDescription(
    '이 워크스페이스의 팀원 중에서 담당자를 골라 주세요.',
  )
  const due = form.getByLabel('마감')
  await expect(due).toHaveAccessibleDescription('마감 날짜를 입력해 주세요.')

  // 키보드로 고친다 — 제목 입력, 담당자는 화살표, 마감은 숫자로
  await page.keyboard.type('알림 문구 최종 검토')
  await expect(title).not.toHaveAttribute('aria-invalid', 'true')
  await tabTo(page, assignee)
  await page.keyboard.press('ArrowDown')
  await expect(assignee).not.toHaveValue('')
  await tabTo(page, due)
  await page.keyboard.type('20261022')
  await expect(due).toHaveValue('2026-10-22')
  await tabTo(page, done)
  await page.keyboard.press('Enter')
  await expect(page.getByText('보완한 값이에요. 승인해야 저장돼요.')).toBeVisible()
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
    name: '확인 필요 상세 보완',
    path: `${WORKSPACE}/approvals/ap_01`,
    check: async (page) => {
      await expect(page.getByRole('heading', { name: '새 태스크 확인' })).toBeVisible(FIRST_PAINT)
      await page.getByRole('button', { name: '보완하기' }).click()
      const form = page.getByRole('group', { name: '확정할 값 보완' })
      await expect(form).toBeVisible()
      // 담당자·마감 칸이 한 줄이다
      const assignee = await boxOf(form.getByLabel('담당자'))
      const due = await boxOf(form.getByLabel('마감'))
      expect(Math.abs(assignee.y - due.y)).toBeLessThanOrEqual(1)
      expect(assignee.x + assignee.width).toBeLessThanOrEqual(due.x)
      // 승인·반려가 본문 단 안이다
      const main = await boxOf(page.locator('#root main').first())
      for (const name of ['반려', '승인']) {
        const button = await boxOf(page.getByRole('button', { name, exact: true }))
        expect(button.x + button.width).toBeLessThanOrEqual(main.x + main.width)
      }
    },
  },
]

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
