import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectAudioReady, SHORT_AUDIO, start } from './support'

/*
 * M5 U6-3 키보드 — 마우스 없이 파일을 고르고, 참석자를 고르고, 올린다. 모달은 포커스를 가두고 닫히면 연 요소로 돌아온다.
 * 파일 선택 창(OS 창)만 Playwright 의 filechooser 로 대신한다 — 그 창을 여는 것은 키보드다.
 */

/** 이 파일의 테스트는 lazy 화면을 둘 이상 지난다 — meeting-flow.e2e.ts 와 같은 까닭으로 전체 한도만 늘린다 (F-r3) */
test.describe.configure({ timeout: 60_000 })

const FIRST_PAINT = { timeout: 15_000 }

const UPLOAD = '/workspaces/ws_01/meetings/upload'

/**
 * Tab(또는 Shift+Tab)을 눌러 target 에 닿을 때까지 간다. limit 번 안에 닿지 않으면 실패다 — 키보드로 닿을 수 없다는 뜻이다.
 * 날짜 칸처럼 안에서 여러 번 멈추는 요소가 있어 정확한 횟수 대신 상한을 둔다
 */
async function tabTo(page: Page, target: Locator, { back = false, limit = 25 } = {}) {
  for (let step = 0; step < limit; step += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab')
  }
  await expect(target).toBeFocused()
}

/** 활성 요소가 모달 안이다 */
async function expectFocusInside(dialog: Locator) {
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
}

/** `컴퓨터에서 찾기` 를 Enter 로 눌러 파일 선택 창을 열고 짧은 음원을 고른다 */
async function chooseAudioByKeyboard(page: Page) {
  // 가로채기를 먼저 켠다. Playwright 는 filechooser 를 기다리기 시작할 때 가로채기를 비동기로 켠다 — Enter 바로 앞에서 켜면
  // 병렬 부하에서 가로채기보다 Enter 가 먼저 닿아 선택 창 이벤트를 놓친 적이 있다
  const chooser = page.waitForEvent('filechooser')
  const browse = page.getByRole('button', { name: '컴퓨터에서 찾기' })
  await expect(browse).toBeVisible(FIRST_PAINT)
  await tabTo(page, browse)
  await page.keyboard.press('Enter')
  await (await chooser).setFiles(SHORT_AUDIO.path)
  await expectAudioReady(page)
}

test('키보드만으로 파일을 고르고 참석자를 골라 올린다', async ({ page }) => {
  await start(page, 'meeting-instant', UPLOAD)
  await chooseAudioByKeyboard(page)

  // 참석자 `추가` — 메뉴는 화살표로 옮기고 Enter 로 고른다. 닫히면 `추가` 로 돌아온다
  const add = page.getByRole('button', { name: '추가', exact: true })
  await tabTo(page, add)
  await page.keyboard.press('Enter')
  // Radix 메뉴는 트리거(`추가`)를 이름으로 삼는다(aria-labelledby). 메뉴는 한 번에 하나다
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: '김서연' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: '박민수' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(add).toBeFocused()
  const chosen = page.getByRole('list', { name: '고른 참석자' })
  await expect(chosen.getByRole('button', { name: '박민수 빼기' })).toBeVisible()

  // Esc 는 고르지 않고 닫는다 — 포커스는 `추가` 로, 고른 참석자는 그대로다
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(add).toBeFocused()
  await expect(chosen.getByRole('button', { name: / 빼기$/ })).toHaveCount(1)

  // 하나 더 고르고(End → 정하늘) 칩의 `빼기` 를 Enter 로 눌러 뺀다
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: '정하늘' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(chosen.getByRole('button', { name: '정하늘 빼기' })).toBeVisible()
  await tabTo(page, chosen.getByRole('button', { name: '정하늘 빼기' }), { back: true })
  await page.keyboard.press('Enter')
  await expect(chosen.getByRole('button', { name: / 빼기$/ })).toHaveCount(1)

  // `정리 시작하기` 까지 Tab 으로 가서 Enter — 처리 화면을 지나 그 회의록이 열린다
  const submit = page.getByRole('button', { name: '정리 시작하기' })
  await tabTo(page, submit)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/workspaces\/ws_01\/meetings\/mt_\w+$/, FIRST_PAINT)
  const minutes = page.getByRole('article', { name: SHORT_AUDIO.name })
  await expect(minutes.getByRole('list', { name: '참석자' })).toContainText('박민수', FIRST_PAINT)
  await expect(minutes.getByRole('list', { name: '참석자' })).not.toContainText('정하늘')
})

test('이탈 확인 모달은 포커스를 가두고 닫히면 연 링크로 돌아온다', async ({ page }) => {
  await start(page, 'meeting-instant', UPLOAD)
  await chooseAudioByKeyboard(page)

  // 헤더의 `태스크` 로 거슬러 가서 Enter — 파일을 골랐으니 이탈 확인이 열린다 (U3-9, D-138)
  const tasks = page.getByRole('banner').getByRole('link', { name: '태스크', exact: true })
  await tabTo(page, tasks, { back: true })
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
  await expect(dialog).toBeVisible()
  const stay = dialog.getByRole('button', { name: '계속 작성하기' })
  const leave = dialog.getByRole('button', { name: '변경 내용 버리고 나가기' })
  // 첫 포커스는 `계속 작성하기` — 실수로 Enter 를 눌러도 입력을 잃지 않는다
  await expect(stay).toBeFocused()

  // 가두기 — Tab·Shift+Tab 이 두 버튼 사이만 돈다. 모달 밖(헤더·폼·스크림)으로 나가지 않는다
  for (const [key, next] of [
    ['Tab', leave],
    ['Tab', stay],
    ['Shift+Tab', leave],
    ['Shift+Tab', stay],
  ] as const) {
    await page.keyboard.press(key)
    await expect(next).toBeFocused()
    await expectFocusInside(dialog)
  }

  // Esc 로 닫으면 머문다. 포커스는 모달을 연 `태스크` 링크로 돌아온다 (impl-decision/2026-10-06-modal-focus-return.md)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(UPLOAD)
  await expect(tasks).toBeFocused()
  await expect(page.getByText(SHORT_AUDIO.name, { exact: true })).toBeVisible()

  // 다시 열어 `계속 작성하기` 를 Enter — 닫히고 역시 링크로 돌아온다
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await expect(stay).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(tasks).toBeFocused()

  // 이번에는 버리고 나간다 — 태스크 화면으로 간다
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(leave).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/workspaces/ws_01/tasks')
})

test('Notion 차단 모달은 포커스를 가두고, 연결로 가면 설정의 Notion 영역이 포커스를 받는다', async ({
  page,
}) => {
  await start(page, 'meeting-notion-not-connected', UPLOAD)
  const dialog = page.getByRole('dialog', { name: 'Notion 연결이 필요해요' })
  await expect(dialog).toBeVisible(FIRST_PAINT)
  const cancel = dialog.getByRole('button', { name: '취소' })
  const connect = dialog.getByRole('button', { name: 'Notion 연결하기' })
  // 화면에 들어오며 열린 모달이다 — 포커스는 처음부터 모달 안이다
  await expect(cancel).toBeFocused()
  for (const [key, next] of [
    ['Tab', connect],
    ['Tab', cancel],
    ['Shift+Tab', connect],
  ] as const) {
    await page.keyboard.press(key)
    await expect(next).toBeFocused()
    await expectFocusInside(dialog)
  }

  // 연결로 간다 — 새 화면(설정)이 자기 포커스 정책대로 Notion 영역 제목에 포커스를 둔다. 모달이 그 포커스를 가로채지 않는다
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/workspaces\/ws_01\/settings\?section=notion/, FIRST_PAINT)
  await expect(dialog).toBeHidden()
  const section = page.getByTestId('notion-connection')
  await expect(section.getByRole('heading', { name: 'Notion 연결' })).toBeFocused(FIRST_PAINT)
  // 그 다음 Tab 은 영역 안의 연결 버튼이다
  await page.keyboard.press('Tab')
  await expect(section.getByRole('button', { name: 'Notion 연결하기' })).toBeFocused()
})
