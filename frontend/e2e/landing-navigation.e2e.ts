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
        await expect(target).toHaveText('팀이 쓰는 도구와,필요한 만큼 연결하세요.')
        await expect(page.locator(region)).toContainText(
          '회의에서 정한 태스크를 팀의 Notion에 반영',
        )
      }
      await expect.poll(async () => (await target.boundingBox())?.y).toBeCloseTo(56, 0)
      await capture(page, testInfo, `landing-${hash.slice(1)}-${width}.png`)
    })
  }
}

for (const width of [1280, 1440]) {
  test(`${width}px에서 맡길 일을 탭과 키보드로 선택해 설명을 읽는다`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await start(page, 'signed-out')
    const section = page.getByRole('region', { name: '이런 일을 맡길 수 있어요' })
    await section.scrollIntoViewIfNeeded()
    const panel = section.getByRole('tabpanel')
    const more = section.getByRole('link', { name: '기능 전부 보기' })
    const initialPanel = await panel.boundingBox()
    const initialLink = await more.boundingBox()
    expect(initialPanel).not.toBeNull()
    expect(initialLink).not.toBeNull()

    for (const [label, description] of [
      ['회의록 정리', '녹음의 화자를 지정하고, 제목과 전사문을 직접 다듬으세요.'],
      ['마감 리마인드', '다가오는 마감과 담당자를 확인하고 재촉을 준비하세요.'],
      ['담당자 배치', '회의에서 정해진 업무에 담당자와 마감을 연결하세요.'],
      ['진행 상황 점검', '대시보드에서 마감 임박과 막힌 일을 먼저 살펴보세요.'],
      ['주간 요약', '회의록과 태스크로 이번 주에 한 일과 남은 일을 돌아보세요.'],
    ]) {
      await section.getByRole('tab', { name: label, exact: true }).click()
      await expect(section.getByRole('tab', { selected: true })).toHaveText(label)
      await expect(section.getByRole('tabpanel', { name: label })).toContainText(description)
      expect((await panel.boundingBox())?.height).toBe(initialPanel?.height)
      expect((await more.boundingBox())?.y).toBe(initialLink?.y)
    }
    await capture(page, testInfo, `landing-capabilities-${width}.png`)

    await page.keyboard.press('ArrowRight')
    await expect(section.getByRole('tab', { name: '회의록 정리', selected: true })).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(section.getByRole('tab', { name: '주간 요약', selected: true })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(section.getByRole('tab', { name: '회의록 정리', selected: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(section.getByRole('tab', { name: '주간 요약', selected: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(section.getByRole('tabpanel', { name: '주간 요약' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(more).toBeFocused()
  })
}
