import { expect, test } from '@playwright/test'
import { capture, expectNoHorizontalOverflow, start } from './support'

/*
 * #660 Discord 를 연결한 공간에서 서버에 없는 사람을 이름으로 추가하고 아이디로 초대한다.
 * 매칭 줄 입력 유지·같은 이름 막기·온보딩은 app/team.test.tsx·onboardingMembers.test.tsx 가 본다. 여기는 브라우저에서
 * 추가한 자리가 새로고침 뒤에도 남고 그 자리에서 초대까지 이어지는지만 본다
 */

test('Discord 서버에 아무도 없어도 PM 이 이름으로 팀원을 추가하고, 새로고침 뒤 그 팀원 줄에서 아이디로 초대한다', async ({
  page,
}, testInfo) => {
  await start(page, 'settings-discord-empty', '/workspaces/ws_01/members')
  await page.getByRole('button', { name: '팀원 관리' }).click()
  const dialog = page.getByRole('dialog', { name: '팀원 연결' })
  await dialog.getByRole('textbox', { name: '팀원 이름' }).fill('한지민')
  await dialog.getByRole('button', { name: '추가' }).click()
  await expect(dialog.getByRole('list', { name: '추가한 팀원' }).getByText('한지민')).toBeVisible()
  await capture(page, testInfo, 'dialog-added.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page)
  await capture(page, testInfo, 'dialog-added-390.png')
  await page.setViewportSize({ width: 1280, height: 720 })
  await dialog.getByRole('button', { name: '나중에 하기' }).click()
  await expect(dialog).toHaveCount(0)

  await page.reload()
  const added = page.getByRole('region', { name: '한지민' })
  await added.getByRole('button', { name: '초대' }).click({ timeout: 15_000 })
  const invite = page.getByRole('dialog', { name: '한지민 초대' })
  await invite.getByLabel('아이디').fill('doyun')
  await invite.getByRole('button', { name: '찾기' }).click()
  await expect(invite.getByText('한도윤')).toBeVisible()
  await invite.getByRole('button', { name: '초대하기' }).click()
  await expect(invite).toHaveCount(0)
  await expect(added.getByText('대기')).toBeVisible()
  await added.scrollIntoViewIfNeeded()
  await capture(page, testInfo, 'invited.png')

  await page.reload()
  await expect(page.getByRole('region', { name: '한지민' }).getByText('대기')).toBeVisible({
    timeout: 15_000,
  })
})
