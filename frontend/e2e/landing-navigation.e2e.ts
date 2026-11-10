import { expect, test } from '@playwright/test'
import { capture, start } from './support'

const DESTINATIONS = [
  { label: '제품', hash: '#product', content: '[role="img"]', region: '#product' },
  { label: '기능', hash: '#features', content: 'div', region: '#features' },
  { label: '연동', hash: '#integrations', content: 'h2', region: '#integrations' },
]

for (const width of [1280, 1440]) {
  for (const { label, hash, content, region } of DESTINATIONS) {
    test(`${width}px에서 ${label} 링크로 이동하면 내용 위에 여백이 남는다`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await start(page, 'signed-out')
      await page
        .getByRole('navigation', { name: '랜딩 안내' })
        .getByRole('link', { name: label, exact: true })
        .click()

      await expect(page).toHaveURL(new RegExp(`${hash}$`))
      const target = page.locator(region).locator(content).first()
      await expect(target).toBeVisible()
      if (label === '연동') {
        await expect(target).toHaveText('승인한 것만 나갑니다')
        await expect(page.locator(region)).toContainText('Notion 반영도 Discord DM도')
      }
      await expect.poll(async () => (await target.boundingBox())?.y).toBeCloseTo(56, 0)
      await capture(page, testInfo, `landing-${hash.slice(1)}-${width}.png`)
    })
  }
}
