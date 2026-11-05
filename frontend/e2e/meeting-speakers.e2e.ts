import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectMinutesOpened, start } from './support'

/*
 * #256 화자 지정 — 회의록 목록의 `화자 지정 필요` → 지정 화면 → 제출 → 처리 재개 → 회의록. 상태는 MSW 시나리오로만 만든다.
 *
 * - meeting-speakers: 업로드 회의 mt_11(주간 회고 녹음)이 처음부터 화자 셋을 기다린다. 제출하면 상세 조회마다 한 단계씩 가서 완료된다
 * - meeting-speakers-expired: 같은 회의에 지정을 내면 그 순간 기한이 지나 409 `details.status=failed` 다
 */

/* lazy 화면 셋(회의록·지정·처리)을 지나고 처리 화면이 3초 polling 으로 세 단계 + 완료를 밟는다 (meeting-flow.e2e.ts 와 같은 까닭) */
test.describe.configure({ timeout: 60_000 })

const FIRST_PAINT = { timeout: 15_000 }
const WORKSPACE = '/workspaces/ws_01'
const SPEAKERS = `${WORKSPACE}/meetings/mt_11/speakers`

/** 화자 1·2 는 김서연, 화자 3 은 외부 참석자 — 같은 팀원을 두 화자에 고르는 것도 받는다 */
async function chooseAll(page: Page) {
  const submit = page.getByRole('button', { name: /지정하고 정리 이어 가기/ })
  await expect(page.getByText('아직 고르지 않은 화자 3명')).toBeVisible()
  await expect(submit).toBeDisabled()
  await page
    .getByRole('group', { name: '화자 1 지정' })
    .getByRole('radio', { name: /김서연/ })
    .click()
  await page
    .getByRole('group', { name: '화자 2 지정' })
    .getByRole('radio', { name: /김서연/ })
    .click()
  await page
    .getByRole('group', { name: '화자 3 지정' })
    .getByRole('radio', { name: /외부 참석자/ })
    .click()
  await expect(page.getByText(/아직 고르지 않은 화자/)).toHaveCount(0)
  await expect(submit).toBeEnabled()
  return submit
}

test('목록의 화자 지정 필요에서 지정하고 내면 정리가 이어져 그 회의록이 열린다', async ({
  page,
}) => {
  await start(page, 'meeting-speakers', `${WORKSPACE}/meetings`)
  const row = page
    .getByRole('complementary', { name: '회의 목록' })
    .getByRole('list', { name: '진행 중' })
    .getByRole('link', { name: /주간 회고 녹음/ })
  await expect(row).toContainText('화자 지정 필요', FIRST_PAINT)
  await row.click()

  await expect(page).toHaveURL(SPEAKERS)
  await expect(
    page.getByRole('heading', { level: 1, name: '누가 말했는지 골라 주세요' }),
  ).toBeVisible(FIRST_PAINT)
  const submit = await chooseAll(page)
  const assigned = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith('/meetings/mt_11/speakers'),
  )
  await submit.click()
  expect((await assigned).postDataJSON()).toEqual({
    mapping: { SPEAKER_00: 'mb_01', SPEAKER_01: 'mb_01', SPEAKER_02: null },
  })

  await expect(page).toHaveURL(`${WORKSPACE}/meetings/mt_11/processing`, FIRST_PAINT)
  await expectMinutesOpened(page, 30_000)
  await expect(page).toHaveURL(`${WORKSPACE}/meetings/mt_11`)
  await expect(
    page.getByRole('article', { name: '주간 회고 녹음' }).getByRole('heading', {
      name: '주간 회고 녹음',
    }),
  ).toBeVisible(FIRST_PAINT)
  await expect(
    page.getByRole('complementary', { name: '회의 목록' }).getByRole('list', { name: '진행 중' }),
  ).toHaveCount(0)
})

test('내는 순간 기한이 지났으면(409 failed) 만료 사유를 보이고 다시 낼 수 없다', async ({
  page,
}) => {
  await start(page, 'meeting-speakers-expired', SPEAKERS)
  await expect(
    page.getByRole('heading', { level: 1, name: '누가 말했는지 골라 주세요' }),
  ).toBeVisible(FIRST_PAINT)
  const submit = await chooseAll(page)
  await submit.click()

  await expect(page.getByRole('heading', { name: '화자 지정 기한이 지났어요' })).toBeVisible()
  await expect(page.getByRole('link', { name: '다시 업로드' })).toHaveAttribute(
    'href',
    `${WORKSPACE}/meetings/upload`,
  )
  await expect(page.getByRole('button', { name: /지정하고 정리 이어 가기/ })).toHaveCount(0)
})
