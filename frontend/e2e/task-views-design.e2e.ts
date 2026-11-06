import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { MOCK_NOW, MOCK_TODAY } from '@/shared/mock/fixtures/constants'
import { start } from './support'

/*
 * M8 A — 태스크 보기(보드·캘린더·간트)의 시안 값 (#482). jsdom 은 Tailwind 를 계산하지 않고
 * 배치를 재지 못해 실제 브라우저에서 잰다. 흐름·링크·조회 상태는 src/app/taskViews*.test.tsx 가 본다.
 * 마감 임박과 간트 오늘 선은 오늘에 기대므로 시계를 픽스처의 서울 오늘(2026-09-18 09:00 KST)로 멈춘다.
 *
 * - tasks-default: ws_01 의 PM. 픽스처 태스크 10건, 대기 생성 승인 3건(ap_03 만 마감 9/25)
 */

test.describe.configure({ timeout: 60_000 })

const FIRST_PAINT = { timeout: 15_000 }

async function openView(page: Page, view: 'board' | 'calendar' | 'gantt') {
  await page.clock.setFixedTime(new Date(MOCK_NOW))
  await start(page, 'tasks-default', `/workspaces/ws_01/tasks?view=${view}`)
}

const cssOf = (locator: Locator, ...names: string[]) =>
  locator.evaluate((element, properties) => {
    const style = getComputedStyle(element)
    return properties.map((name) => style.getPropertyValue(name))
  }, names)

const rectOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const { top, bottom, left, width, height } = element.getBoundingClientRect()
    return { top, bottom, left, width, height }
  })

test('보드 — 필터는 머리 아래 22px·높이 36px 이고, 칸 머리 표식·완료 제목·진행 중 카드 테두리가 시안 색이다', async ({
  page,
}) => {
  await openView(page, 'board')
  const done = page.getByRole('region', { name: '완료' })
  await expect(done).toBeVisible(FIRST_PAINT)

  const header = page
    .getByRole('heading', { level: 1, name: '태스크' })
    .locator('xpath=ancestor::header[1]')
  const filter = await rectOf(page.getByRole('button', { name: /^담당자:/ }))
  expect(filter.top - (await rectOf(header)).bottom).toBe(22)
  expect(filter.height).toBe(36)

  const markOf = (name: string) =>
    page
      .getByRole('region', { name })
      .getByRole('heading', { name })
      .locator('xpath=preceding-sibling::*[1]')
  expect(
    await cssOf(
      markOf('시작 전'),
      'border-top-style',
      'border-top-color',
      'border-top-left-radius',
    ),
  ).toEqual(['solid', 'rgb(189, 189, 189)', '2px'])
  await expect(markOf('완료')).toHaveCSS('background-color', 'rgb(232, 232, 232)')
  await expect(done.getByRole('heading', { name: '완료' })).toHaveCSS('color', 'rgb(102, 102, 102)')

  const activeCards = page.getByRole('region', { name: '진행 중' }).getByRole('article')
  expect(await activeCards.count()).toBeGreaterThan(0)
  for (const card of await activeCards.all())
    await expect(card).toHaveCSS('border-top-color', 'rgb(201, 201, 201)')
})

test('보드 직접 추가 — 제목 입력에 포커스가 있으면 펼친 틀에 2px 먹 outline 이 테두리 위로 겹친다', async ({
  page,
}) => {
  await openView(page, 'board')
  const active = page.getByRole('region', { name: '진행 중' })
  await active.getByRole('button', { name: '진행 중에 직접 추가' }).click(FIRST_PAINT)
  await expect(active.getByRole('textbox', { name: '진행 중 새 태스크 제목' })).toBeFocused()
  const form = active.getByRole('form', { name: '진행 중에 직접 추가' })
  expect(
    await cssOf(form, 'outline-style', 'outline-width', 'outline-color', 'outline-offset'),
  ).toEqual(['solid', '2px', 'rgb(23, 23, 23)', '-1px'])
})

test('캘린더 — 날짜 이동·마감일 없음·주말 숫자·마감 임박 칩이 시안 크기와 색이다', async ({
  page,
}) => {
  await openView(page, 'calendar')
  const table = page.getByRole('table', { name: '2026년 9월' })
  await expect(table).toBeVisible(FIRST_PAINT)

  const prev = page.getByRole('button', { name: '이전 달' })
  const prevBox = await rectOf(prev)
  expect([prevBox.width, prevBox.height]).toEqual([30, 36])
  await expect(prev.locator('svg')).toHaveAttribute('width', '15')
  await expect(prev).toHaveCSS('color', 'rgb(90, 90, 90)')
  await expect(page.getByRole('heading', { name: '마감일 없음' })).toHaveCSS('font-size', '13px')

  const dayColor = async (date: string) =>
    (await cssOf(table.getByRole('cell', { name: date }).locator('xpath=*[1]'), 'color'))[0]
  expect([
    await dayColor('2026-09-06'),
    await dayColor('2026-09-12'),
    await dayColor('2026-09-07'),
  ]).toEqual(['rgb(102, 102, 102)', 'rgb(102, 102, 102)', 'rgb(90, 90, 90)'])

  const urgent = table.getByRole('link', { name: /온보딩 문구 수정/ })
  const title = urgent.locator('xpath=*[1]')
  expect([
    (await cssOf(urgent, 'background-color'))[0],
    (await cssOf(title, 'color'))[0],
    (await cssOf(urgent.locator('xpath=*[last()]'), 'color'))[0],
  ]).toEqual(['rgb(244, 217, 215)', 'rgb(23, 23, 23)', 'rgb(90, 90, 90)'])
  await expect(title).toHaveCSS('font-weight', '600')
})

test('간트 — 오늘 선은 표 높이만큼 서고 오늘 날짜 원 가운데를 지난다 (VR-10). 일정이 없는 일 목록은 시안 값이다', async ({
  page,
}) => {
  await openView(page, 'gantt')
  const table = page.getByRole('table', { name: '일정' })
  await expect(table).toBeVisible(FIRST_PAINT)

  const todayLine = await rectOf(table.locator('[data-gantt-today]'))
  const mark = await rectOf(
    table.getByText(String(Number(MOCK_TODAY.slice(8, 10))), { exact: true }),
  )
  const tableHeight = await table.evaluate((element) => element.clientHeight)
  expect(Math.abs(todayLine.height - tableHeight)).toBeLessThanOrEqual(1)
  expect(
    Math.abs(todayLine.left + todayLine.width / 2 - (mark.left + mark.width / 2)),
  ).toBeLessThanOrEqual(1)

  const note = page.getByText('승인하면 담당자가 붙습니다')
  const [noteLineHeight] = await cssOf(note, 'line-height')
  expect((await rectOf(note)).height).toBeLessThanOrEqual(parseFloat(noteLineHeight) + 1)

  const unscheduled = page.getByRole('region', { name: '일정이 없는 일' })
  const dateLink = unscheduled.getByRole('link', { name: '알림 문구 검토 날짜 넣기' })
  expect(await cssOf(dateLink, 'font-size', 'font-weight', 'height')).toEqual([
    '12.5px',
    '600',
    '32px',
  ])
  await expect(dateLink.locator('svg')).toHaveCount(1)

  expect(await cssOf(unscheduled, 'padding-top', 'row-gap')).toEqual(['14px', '10px'])
  await expect(unscheduled.getByRole('heading', { name: /일정이 없는 일/ })).toHaveCSS(
    'font-size',
    '14px',
  )
  const row = dateLink.locator('xpath=ancestor::li[1]')
  expect(
    await cssOf(row, 'column-gap', 'padding-top', 'padding-bottom', 'border-bottom-color'),
  ).toEqual(['12px', '13px', '13px', 'rgb(239, 239, 239)'])
  const badge = row.getByText('일정 없음')
  expect([(await rectOf(badge)).height, ...(await cssOf(badge, 'font-size', 'color'))]).toEqual([
    21,
    '11px',
    'rgb(90, 90, 90)',
  ])
  await expect(row.getByText('알림 문구 검토')).toHaveCSS('font-size', '13.5px')
  expect(
    await cssOf(
      row.getByText('?'),
      'border-top-style',
      'border-top-color',
      'background-color',
      'font-size',
    ),
  ).toEqual(['dashed', 'rgb(189, 189, 189)', 'rgba(0, 0, 0, 0)', '10px'])
})
