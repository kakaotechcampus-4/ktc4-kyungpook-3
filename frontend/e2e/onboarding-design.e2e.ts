import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'

async function cardAppearance(card: Locator) {
  return card.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const heading = element.querySelector('h2')
    if (heading === null) throw new Error('온보딩 카드 제목이 없어요.')
    const title = getComputedStyle(heading)
    return {
      width: box.width,
      centerX: box.x + box.width / 2,
      borderRadius: style.borderRadius,
      borderColor: style.borderColor,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      titleSize: title.fontSize,
      titleWeight: title.fontWeight,
    }
  })
}

test('온보딩 시작과 팀 확인은 기존 생성 단계와 같은 카드·중앙 열을 사용한다', async ({
  page,
}, testInfo) => {
  await start(page, 'no-workspace', '/onboarding/create_workspace')
  const create = page.getByRole('region', { name: '팀 만들기', exact: true })
  await expect(create).toBeVisible()
  const expected = await cardAppearance(create)
  expect(expected.width).toBe(512)

  await page.goto('/onboarding/start')
  const choice = page.getByRole('region', { name: '시작 방식 선택', exact: true })
  await expect(choice).toBeVisible()
  expect(await cardAppearance(choice)).toEqual(expected)
  await expect(page.getByRole('banner')).toHaveCount(0)
  await expect(page.getByRole('img', { name: /단계 중/ })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await testInfo.attach('unified-start.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })

  await page.getByRole('link', { name: /팀원으로 시작/ }).click()
  const teams = page.getByRole('region', { name: '소속 팀 확인', exact: true })
  await expect(teams).toBeVisible()
  expect(await cardAppearance(teams)).toEqual(expected)
  await expect(page.getByRole('banner')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await testInfo.attach('unified-member.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
})
