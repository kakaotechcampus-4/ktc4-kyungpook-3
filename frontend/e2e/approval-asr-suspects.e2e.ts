import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { paths } from '@/shared/config/routes'
import { LONG_ASR_CANDIDATE, LONG_ASR_WORD } from '@/shared/mock/fixtures/approval'
import { start } from './support'

/*
 * #643 전사 오인식 의심 사유 — 실제 브라우저에서만 잴 수 있는 넘침. 문구·표시 규칙은 src/app/approvalAsrSuspects.test.tsx 가 본다.
 * approval-asr-suspects-long: ap_01 은 공백 없는 42자 후보, ap_02 는 긴 단어와 긴 후보이고 빠진 값이 없다
 */

test.use({ viewport: { width: 390, height: 844 } })

/** 줄이 칸 안에서 끝나고 옆으로 넘치지 않는다 */
async function expectInside(line: Locator, box: Locator) {
  const [lineBox, outer] = await Promise.all([line.boundingBox(), box.boundingBox()])
  expect(lineBox && outer).toBeTruthy()
  expect(lineBox!.x + lineBox!.width).toBeLessThanOrEqual(outer!.x + outer!.width + 0.5)
  expect(
    await line.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(0)
}

test('390 폭에서 공백 없는 긴 의심 단어·후보가 카드·상세·대시보드 밖으로 나가지 않는다', async ({
  page,
}) => {
  await start(page, 'approval-asr-suspects-long', `${paths.tasks('ws_01')}?tab=needs_review`)
  const lists = page.getByRole('list', { name: '전사 확인' })
  await expect(lists).toHaveCount(2)
  for (const list of await lists.all()) {
    const card = list.locator('xpath=ancestor::article[1]')
    for (const line of await list.getByRole('listitem').all()) await expectInside(line, card)
  }
  await expect(lists.first()).toContainText(LONG_ASR_CANDIDATE)

  for (const id of ['ap_01', 'ap_02']) {
    await page.goto(paths.approval('ws_01', id))
    const reasons = page.getByRole('region', { name: '확인이 필요한 이유' })
    const line = reasons.getByRole('listitem').filter({ hasText: '전사' })
    await expect(line).toContainText(LONG_ASR_CANDIDATE)
    await expectInside(line, reasons)
  }

  await page.goto(paths.dashboard('ws_01'))
  const row = page
    .getByRole('list', { name: '확인이 필요한 일 목록' })
    .getByRole('listitem')
    .filter({ hasText: LONG_ASR_WORD })
  const reason = row.locator('p')
  await expect(reason).toContainText(LONG_ASR_CANDIDATE)
  await expectInside(reason, row)
})
