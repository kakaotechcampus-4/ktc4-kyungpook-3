import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { MockBundle } from '@/shared/mock/fixtures/message'
import { start } from './support'

/*
 * #371 — PM 이 보내기 전 확인에서 승인하면 예정으로 남고, 보는 동안 문구가 바뀌었으면 409 BUNDLE_CHANGED 로 알린 뒤 새 문구로 승인한다.
 * AI 초안을 기다리는 묶음은 손대지 않아도 끝난 문구로 바뀐다 (D-136).
 * 응답 전 잠금·중복 제출·다시 시도·이미 처리됨은 app/messagesActionsMsw.test.tsx 가 본다
 */

/** Vite 개발 서버는 handler 와 같은 모듈 주소로 db 를 내주므로 페이지에서 가져오면 MSW 와 같은 db 다 */
async function changeBundle(
  page: Page,
  bundleId: string,
  patch: Partial<MockBundle>,
  clickInSameTask?: Locator,
): Promise<void> {
  await (clickInSameTask ?? page.locator('body')).evaluate(
    async (element, { module, bundleId, patch, click }) => {
      const { db } = (await import(module)) as { db: { messageBundles: MockBundle[] } }
      const bundle = db.messageBundles.find(({ bundle_id }) => bundle_id === bundleId)
      if (bundle === undefined) throw new Error(`mock bundle ${bundleId} is missing`)
      Object.assign(bundle, patch)
      if (click) (element as HTMLElement).click()
    },
    { module: '/src/shared/mock/db.ts', bundleId, patch, click: clickInSameTask !== undefined },
  )
}

const detail = (page: Page) => page.getByRole('region', { name: '메시지 내용' })

async function openReview(page: Page, bundleId: string): Promise<void> {
  await start(page, 'messages-default', `/workspaces/ws_01/messages?review=${bundleId}`)
  await expect(
    detail(page).getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' }),
  ).toBeVisible()
}

test('보내기 전 확인에서 이대로 발송하면 예정으로 남고 대화에 승인함으로 보인다', async ({
  page,
}) => {
  await openReview(page, 'bd_01')
  await detail(page).getByRole('button', { name: '이대로 발송' }).click()

  await expect(page.getByText('09/23 09:00에 이재환님에게 보낼게요', { exact: true })).toBeVisible()
  const list = page.getByRole('complementary', { name: '메시지 목록' })
  await expect(
    list
      .getByRole('region', { name: /^보내기 전 확인/ })
      .getByRole('link')
      .filter({ hasText: '이재환' }),
  ).toContainText('09/23 발송 예정')

  await list
    .getByRole('region', { name: '대화', exact: true })
    .getByRole('link', { name: /이재환/ })
    .click()
  await expect(
    page.getByRole('region', { name: '대화 내용' }).getByText('09/23 09:00 발송 예정 · 승인함'),
  ).toBeVisible()

  await page.reload()
  await expect(
    page.getByRole('region', { name: '대화 내용' }).getByText('09/23 09:00 발송 예정 · 승인함'),
  ).toBeVisible({ timeout: 15_000 })
})

test('보는 동안 문구가 바뀌면 승인하지 못했다고 알리고 새 문구를 다시 불러와 그 문구로 승인한다', async ({
  page,
}) => {
  await openReview(page, 'bd_01')
  await changeBundle(
    page,
    'bd_01',
    { body: '재환님, 새로 다듬은 문구예요.', draft_version: 3 },
    detail(page).getByRole('button', { name: '이대로 발송' }),
  )

  const alert = detail(page).getByRole('alert')
  await expect(alert).toContainText('발송을 승인하지 못했어요')
  await expect(alert).toContainText('보낼 메시지가 바뀌었어요. 다시 확인해 주세요.')
  await expect(alert.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
  await expect(detail(page).getByRole('region', { name: '보낼 메시지 미리보기' })).toContainText(
    '재환님, 새로 다듬은 문구예요.',
  )

  await detail(page).getByRole('button', { name: '이대로 발송' }).click()
  await expect(page.getByText('09/23 09:00에 이재환님에게 보낼게요', { exact: true })).toBeVisible()
})

test('AI 초안을 기다리는 메시지를 보고 있으면 초안이 끝난 문구로 저절로 바뀐다', async ({
  page,
}) => {
  await openReview(page, 'bd_02')
  const preview = detail(page).getByRole('region', { name: '보낼 메시지 미리보기' })
  await expect(preview.getByText('문구 다듬는 중')).toBeVisible()

  await changeBundle(page, 'bd_02', {
    draft_status: 'done',
    body_source: 'ai',
    body: '하늘님, 퍼블리싱이랑 발표 자료 어디까지 됐는지 궁금해요 🙂',
    draft_version: 2,
  })

  await expect(preview).toContainText('하늘님, 퍼블리싱이랑 발표 자료 어디까지 됐는지 궁금해요', {
    timeout: 15_000,
  })
  await expect(preview.getByText('문구 다듬는 중')).toHaveCount(0)
})
