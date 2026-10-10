import { expect, test } from '@playwright/test'
import { start } from './support'

/* 시나리오 ② 기존 사용자의 워크스페이스 선택·전환 — 미저장 변경 확인 포함 (U5-2) */

test('로그인 → 선택 화면 → 공간 진입 → 저장하지 않은 변경이 있는 채로 전환', async ({ page }) => {
  await start(page, 'signed-out', '/login')
  await page.getByLabel('이메일').fill('pm@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('mock-password')
  await page.getByRole('button', { name: '로그인', exact: true }).click()

  // 공간이 여럿이면 선택 화면 (D-010). 미완료 공간에는 `설정 미완료`
  await expect(page).toHaveURL('/workspaces')
  await expect(page.getByRole('button', { name: /사이드 프로젝트/ })).toContainText('설정 미완료')
  await page.getByRole('button', { name: /카테캠 3팀/ }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/dashboard')

  // 설정에서 입력을 바꿔 둔다 — 설정은 탭이 아니라 워크스페이스 메뉴에 있다
  await page.getByRole('button', { name: /^워크스페이스 바꾸기/ }).click()
  await page.getByRole('menuitem', { name: '워크스페이스 설정' }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/settings')
  await page.getByLabel('워크스페이스 이름').fill('바꾸는 중')

  // 전환을 시도하면 묻는다 → 계속 작성하기: 그대로 (D-067)
  await page.getByRole('button', { name: /^워크스페이스 바꾸기/ }).click()
  await page.getByRole('menuitem', { name: /사이드 프로젝트/ }).click()
  const dialog = page.getByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
  await expect(dialog).toBeVisible()
  // 모달이 화면을 덮고 가운데 떠야 한다 — M2 부터 inset-0 이 생성되지 않아 화면 밖에 있었다
  await expect(dialog).toBeInViewport({ ratio: 1 })
  await dialog.getByRole('button', { name: '계속 작성하기' }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/settings')
  await expect(page.getByLabel('워크스페이스 이름')).toHaveValue('바꾸는 중')

  // 다시 전환 → 버리고 나가기: 미완료 공간은 온보딩 재개 지점이다 (D-070)
  await page.getByRole('button', { name: /^워크스페이스 바꾸기/ }).click()
  await page.getByRole('menuitem', { name: /사이드 프로젝트/ }).click()
  await dialog.getByRole('button', { name: '변경 내용 버리고 나가기' }).click()
  await expect(page).toHaveURL('/onboarding/ws_02/connect_notion')
  await expect(
    page.getByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' }),
  ).toBeVisible()

  // 나가기는 전환을 시작한 공간으로 돌아간다 — 이전 공간의 설정 입력은 남지 않는다
  await page.getByRole('link', { name: '온보딩 나가기' }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/dashboard')
})

test('키보드만으로 워크스페이스 메뉴를 열고 고르고 닫는다', async ({ page }) => {
  await start(page, 'multiple-workspaces', '/workspaces/ws_01/dashboard')
  const header = page.getByRole('banner')
  const trigger = header.getByRole('button', { name: /^워크스페이스 바꾸기/ })
  await expect(trigger).toBeVisible()
  // `정리 중` 링크는 지금 공간 목록을 받은 뒤에 붙는다(비동기, M5 U4-9). 메뉴 트리거보다 늦을 수 있어 Tab 순서를 보기 전에
  // 링크가 보일 때까지 기다린다 — 기다리지 않으면 링크가 붙기 전에 Tab 이 지나가 `태스크`에 포커스가 간다 (U4 r5 minor N02)
  await expect(header.getByRole('link', { name: '정리 중', exact: true })).toBeVisible()

  // 실제 Tab 으로 헤더를 차례로 지나간다 — 마크 → 탭 5개(회의록 다음에 `정리 중`) → 워크스페이스 메뉴 → 내 계정.
  // 이 시나리오의 ws_01 에는 정리 중 회의(mt_10)가 있어 M5 U4-9 의 `정리 중` 링크가 회의록 탭 바로 뒤에 온다
  const headerOrder = [
    header.getByRole('link', { name: "Manager's Manager 대시보드" }),
    ...['대시보드', '회의록', '정리 중', '태스크', '메시지', '팀'].map((name) =>
      header.getByRole('link', { name, exact: true }),
    ),
    trigger,
    header.getByRole('button', { name: /^내 계정/ }),
  ]
  for (const next of headerOrder) {
    await page.keyboard.press('Tab')
    await expect(next).toBeFocused()
  }
  // Shift+Tab 으로 한 칸 돌아와 워크스페이스 메뉴를 연다
  await page.keyboard.press('Shift+Tab')
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem').first()).toBeFocused()

  // Esc 로 닫으면 트리거로 돌아온다
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()

  // End 로 마지막 항목(워크스페이스 목록)을 골라 Enter
  await page.keyboard.press('Enter')
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: '워크스페이스 목록' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/workspaces')

  // 선택 화면도 Tab 으로 줄을 옮겨 Enter 로 들어간다 — 마크 → 내 계정 → 공간 목록 순서.
  // 메뉴에서 옮기면 포커스를 가졌던 트리거가 사라져 다음 Tab 의 시작점이 브라우저마다 달라진다(F-r2).
  // 문서를 새로 불러 첫 Tab 이 문서 처음에서 시작하게 한다 — 세션·모의 상태는 sessionStorage 로 남는다
  await page.reload()
  const target = page.getByRole('button', { name: /카테캠 3팀/ })
  await expect(target).toBeVisible()
  const selectOrder = [
    page.getByRole('link', { name: "Manager's Manager", exact: true }),
    page.getByRole('button', { name: /^내 계정/ }),
    page.getByRole('button', { name: /사이드 프로젝트/ }),
    target,
  ]
  for (const next of selectOrder) {
    await page.keyboard.press('Tab')
    await expect(next).toBeFocused()
  }
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/workspaces/ws_01/dashboard')
})
