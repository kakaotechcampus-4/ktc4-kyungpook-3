import { expect, test } from '@playwright/test'
import { capture, expectNoHorizontalOverflow, start } from './support'

/*
 * #551 회의록에서 제목과 전사 줄 고치기 (BE #669, 계약 §4.4.3). 1280·390 폭에서 고치고, 새로고침해도 남고, 되돌린다.
 * 휴대폰 폭에서 고치는 칸·「고침」·원문이 가로로 넘치지 않는다. 화면마다 스크린샷을 테스트 결과에 붙인다
 */

const MT_09 = '/workspaces/ws_01/meetings/mt_09'
const LINE = '회원가입 화면은 제가 맡겠습니다.'
const LONG_LINE = `회원가입 화면은 민수가 맡겠습니다. ${'https://example.com/very/long/path/without/spaces/'.repeat(4)}`

for (const width of [1280, 390] as const) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } })

    test('제목과 발화를 고치고 새로고침해도 남으며, 원문을 보고 되돌린다', async ({
      page,
    }, testInfo) => {
      await start(page, 'tasks-default', MT_09)
      const heading = page.getByRole('heading', { level: 2, name: '3주차 정기회의' })
      await expect(heading).toBeVisible({ timeout: 15_000 })

      await page.getByRole('button', { name: '제목 고치기' }).click()
      const input = page.getByRole('textbox', { name: '회의 제목' })
      await expect(input).toBeFocused()
      await input.fill('3주차 정기회의 — 인증 연동')
      await capture(page, testInfo, `${width}-title-editing.png`)
      await expectNoHorizontalOverflow(page)
      await input.press('Enter')
      await expect(
        page.getByRole('heading', { level: 2, name: '3주차 정기회의 — 인증 연동' }),
      ).toBeVisible()

      await page.getByRole('tab', { name: /전사문/ }).click()
      const panel = page.getByRole('tabpanel')
      await panel.getByRole('button', { name: LINE }).click()
      const field = panel.getByRole('textbox', { name: '발화 고치기' })
      await expect(field).toBeFocused()
      await field.fill(LONG_LINE)
      await capture(page, testInfo, `${width}-line-editing.png`)
      await expectNoHorizontalOverflow(page)
      await panel.getByRole('button', { name: '저장' }).click()
      await expect(panel.getByRole('button', { name: LONG_LINE })).toBeFocused()

      await page.reload()
      await expect(
        page.getByRole('heading', { level: 2, name: '3주차 정기회의 — 인증 연동' }),
      ).toBeVisible({ timeout: 15_000 })
      await page.getByRole('tab', { name: /전사문/ }).click()
      await panel.getByRole('button', { name: '고친 발화 — 원문 보기' }).click()
      await page.getByRole('button', { name: '고친 제목 — 처음 제목 보기' }).click()
      await expect(panel.getByText(LINE, { exact: true })).toBeVisible()
      await expect(page.getByText('처음 제목: 3주차 정기회의')).toBeVisible()
      await capture(page, testInfo, `${width}-edited-originals.png`)
      await expectNoHorizontalOverflow(page)

      await panel.getByRole('button', { name: '원래 문장으로 되돌리기' }).click()
      await expect(panel.getByRole('button', { name: LINE })).toBeFocused()
      await page.getByRole('button', { name: '처음 제목으로 되돌리기' }).click()
      await expect(heading).toBeVisible()
      await expect(page.getByRole('button', { name: /고친/ })).toHaveCount(0)
    })
  })
}

test('키보드만으로 발화를 열고 Esc 로 닫으면 그 줄로 돌아온다', async ({ page }) => {
  await start(page, 'tasks-default', MT_09)
  await page.getByRole('tab', { name: /전사문/ }).click()
  const panel = page.getByRole('tabpanel')
  const line = panel.getByRole('button', { name: LINE })
  await line.focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('textbox', { name: '발화 고치기' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(line).toBeFocused()
})
