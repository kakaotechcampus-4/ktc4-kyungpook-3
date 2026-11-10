import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { paths } from '@/shared/config/routes'
import { start } from './support'

/*
 * #676 '원문 듣기' → 회의록 녹음. 실제 브라우저에서만 볼 수 있는 것 — 녹음 경로의 302 를 따라 모의 S3 에서
 * 메타데이터를 받고 근거 시각으로 옮기는지, 따라가지 않는 확인 요청이 opaqueredirect 인지, 다시 불러 그 자리로 돌아가는지.
 * 상태 전이와 문구는 src/app/meetingAudio.test.tsx 가 본다. 실제 S3·Safari 는 이 테스트의 범위 밖이다
 */

const recording = (page: Page) => page.getByRole('region', { name: '회의 녹음' })

async function openSourceFromApproval(page: Page) {
  await page.getByRole('figure', { name: '근거' }).getByRole('link', { name: '원문 듣기' }).click()
  await expect(page).toHaveURL(/\/workspaces\/ws_01\/meetings\/mt_09\?t=165000$/)
}

test('승인 카드의 원문 듣기는 회의록 녹음을 근거 시각(02:45)으로 옮기고, 끝난 임시 주소는 다시 불러 그 자리로 돌아간다', async ({
  page,
}) => {
  await start(page, 'tasks-default', paths.approval('ws_01', 'ap_02'))
  await openSourceFromApproval(page)

  const audio = recording(page).locator('audio')
  await expect(audio).toHaveAttribute('src', '/api/v1/meetings/mt_09/audio')
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(1)
  const position = () => audio.evaluate((element: HTMLAudioElement) => element.currentTime)
  await expect.poll(position).toBeGreaterThanOrEqual(165)
  expect(await position()).toBeLessThan(170)

  // 플레이어가 재생 오류 뒤에 묻는 요청과 같다. 302 를 따라가지 않아 S3 에는 가지 않는다
  const probe = await page.evaluate(async () => {
    const response = await fetch('/api/v1/meetings/mt_09/audio', {
      credentials: 'include',
      redirect: 'manual',
    })
    return { type: response.type, status: response.status }
  })
  expect(probe).toEqual({ type: 'opaqueredirect', status: 0 })

  // 임시 주소가 끝난 재생 오류를 흉내 낸다. 새 요소가 같은 경로를 다시 불러 듣던 자리(300초)로 돌아간다
  await audio.evaluate(async (element: HTMLAudioElement) => {
    element.pause()
    element.currentTime = 300
    await new Promise((resolve) => element.addEventListener('seeked', resolve, { once: true }))
    element.dataset.expired = 'true'
    element.dispatchEvent(new Event('error'))
  })
  await expect(recording(page).locator('audio:not([data-expired])')).toHaveCount(1)
  await expect.poll(position).toBeGreaterThanOrEqual(300)
  expect(await position()).toBeLessThan(305)
})

test('보관 기간이 지난 회의는 원문 듣기로 와도 플레이어 없이 안내만 한다', async ({ page }) => {
  await start(page, 'meeting-audio-expired', paths.approval('ws_01', 'ap_02'))
  await openSourceFromApproval(page)
  await expect(recording(page)).toHaveText('녹음이 없거나 보관 기간(7일)이 지났어요.')
  await expect(recording(page).locator('audio')).toHaveCount(0)
})
