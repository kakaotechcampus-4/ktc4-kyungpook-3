import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectAudioReady, expectMinutesOpened, SHORT_AUDIO, start } from './support'

/*
 * M5 U6-2 — 회의 올리기 → 정리 → 회의록. 상태는 MSW 시나리오(shared/mock/scenarios.ts)로만 만든다.
 * 테스트마다 새 컨텍스트에서 `?msw-scenario=` 로 모의 db 를 처음부터 만든다 — 서로 상태를 나누지 않는다.
 *
 * - meeting-instant: 업로드 뒤 첫 상세 조회에 정리가 끝난다(인위적 지연 없음)
 * - meeting-demo: 상세 조회마다 한 단계씩 간다. 앱의 3초 polling 으로 세 단계 + 완료를 밟는다 — 정리 중에 다른 화면으로
 *   떠날 틈이 있어야 하는 ② 에만 쓴다. instant 는 처리 화면이 첫 조회에서 끝을 보고 회의록으로 옮겨 그 틈이 없다(U4-5)
 * - meeting-fail: 첫 상세 조회에 실패로 끝난다. Notion 은 연결된 채다(일반 실패, D-092)
 * - meeting-member: ws_01 의 일반 팀원
 */

/*
 * 한 테스트가 lazy 화면 셋(회의 올리기·처리·회의록)을 지난다. 개발 서버는 처음 요청받은 화면을 그때 변환해서, 병렬로 처음 돌 때
 * 한 테스트가 기본 30초에 닿았다(27초 관찰, 따뜻한 서버에서는 8~15초). 단언 한도는 그대로 두고 테스트 전체 한도만 늘린다 (F-r3)
 */
test.describe.configure({ timeout: 60_000 })

/** lazy 화면으로 옮긴 뒤 첫 단언 — 개발 서버가 그 화면을 처음 변환하는 동안 기본 5초를 넘길 때가 있다 (support.start 와 같은 까닭) */
const FIRST_PAINT = { timeout: 15_000 }

const WORKSPACE = '/workspaces/ws_01'
const UPLOAD = `${WORKSPACE}/meetings/upload`

/** 업로드 POST 경로 (entities/meeting/api/uploadMeeting.ts) */
const UPLOAD_POST = /\/api\/v1\/workspaces\/ws_01\/meetings\/upload$/

/** 처리 화면 주소에서 회의 ID 를 꺼낸다 */
const PROCESSING_URL = /\/workspaces\/ws_01\/meetings\/(mt_\w+)\/processing$/

/** 페이지가 보낸 요청을 기록한다. MSW 가 서비스 워커에서 받는 요청도 페이지 요청으로 잡힌다 */
function recordRequests(page: Page) {
  const requests: { method: string; pathname: string }[] = []
  page.on('request', (request) => {
    requests.push({ method: request.method(), pathname: new URL(request.url()).pathname })
  })
  return requests
}

/**
 * 전역 토스트 한 장. 토스트는 `Notifications` 영역의 목록 항목이다 — Radix 가 스크린리더용으로 같은 문구를 한 번 더
 * 읽어 주므로(`role="status"`) 글자로만 찾으면 둘이 잡힌다
 */
function toastOf(page: Page, text: string) {
  return page
    .getByRole('region', { name: /^Notifications/ })
    .getByRole('listitem')
    .filter({ hasText: text })
}

/** 오른쪽 아래 정리 진행 토스트 (#424). 짧은 토스트 목록 아래 고정 칸에 회의마다 카드 하나다 */
function signalOf(page: Page, text: string) {
  return page.getByTestId('pinned-toast-slot').locator('section').filter({ hasText: text })
}

/** 지나간 주소 — 클라이언트 이동(history)도 프레임 이동으로 잡힌다 */
function recordUrls(page: Page) {
  const urls: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(new URL(frame.url()).pathname)
  })
  return urls
}

/** 파일·참석자를 채우고 `정리 시작하기`. 제목·날짜는 파일이 정한 기본값 그대로 둔다 */
async function uploadShortAudio(page: Page) {
  await page.getByLabel('녹음 파일').setInputFiles(SHORT_AUDIO.path)
  await expectAudioReady(page)
  // 제목 기본값은 확장자를 포함한 파일 이름이다 (U3-5)
  await expect(page.getByLabel('회의 제목')).toHaveValue(SHORT_AUDIO.name)
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await page.getByRole('menuitem', { name: '박민수' }).click()
  await expect(page.getByRole('button', { name: '박민수 빼기' })).toBeVisible()
  await page.getByRole('button', { name: '정리 시작하기' }).click()
}

test('① 짧은 음원을 올리면 정리가 끝나고 그 회의의 회의록이 열린다', async ({ page }) => {
  await start(page, 'meeting-instant', UPLOAD)
  await expect(page.getByRole('heading', { name: '회의를 올려 주세요' })).toBeVisible()
  const requests = recordRequests(page)
  const urls = recordUrls(page)

  await uploadShortAudio(page)

  // 202 → 처리 화면 → 정리 완료 → 그 회의의 회의록 (U3-7, U4-5)
  await expectMinutesOpened(page)
  const meetingId = new URL(page.url()).pathname.split('/').pop()
  expect(urls).toContain(`${WORKSPACE}/meetings/${meetingId}/processing`)
  expect(
    requests.filter(({ method, pathname }) => method === 'POST' && UPLOAD_POST.test(pathname)),
  ).toHaveLength(1)

  const minutes = page.getByRole('article', { name: SHORT_AUDIO.name })
  await expect(minutes.getByRole('heading', { name: SHORT_AUDIO.name })).toBeVisible(FIRST_PAINT)
  await expect(minutes.getByRole('list', { name: '참석자' })).toContainText('박민수')
  // 목록에서도 그 회의가 골라져 있다
  await expect(
    page
      .getByRole('complementary', { name: '회의 목록' })
      .getByRole('link', { name: new RegExp(SHORT_AUDIO.name) }),
  ).toHaveAttribute('aria-current', 'page')
  // 처리 화면을 보고 있었으니 바로 옮겨졌고, 진행 토스트는 완료로 바뀌었다
  await expect(signalOf(page, '회의 정리가 끝났어요')).toBeVisible()
})

test('② 정리 중에 다른 화면으로 가면 진행 토스트가 따라오고, 완료로 바뀐 토스트의 `회의록 보기`로 그 회의록에 간다', async ({
  page,
}) => {
  await start(page, 'meeting-demo', UPLOAD)
  await uploadShortAudio(page)

  await expect(page).toHaveURL(PROCESSING_URL, FIRST_PAINT)
  const meetingId = PROCESSING_URL.exec(new URL(page.url()).pathname)?.[1]
  expect(meetingId).toBeDefined()
  await expect(page.getByRole('heading', { name: '정리하고 있어요' })).toBeVisible(FIRST_PAINT)

  // 처리 화면에서는 진행 토스트를 숨긴다. 헤더에는 `정리 중` 링크가 없다 (#424)
  const header = page.getByRole('banner')
  const processing = page.getByRole('region', { name: `${SHORT_AUDIO.name} 정리 중` })
  await expect(processing).toHaveCount(0)
  await expect(header.getByRole('link', { name: '정리 중' })).toHaveCount(0)

  // 정리 중에 태스크 화면으로 떠난다 — 업로드가 끝나 입력이 없으니 이탈 확인은 없다 (U3-9)
  await header.getByRole('link', { name: '태스크', exact: true }).click()
  await expect(page).toHaveURL(`${WORKSPACE}/tasks`)
  // 진행 토스트는 접힌 알약으로 시작한다. 누르면 펼쳐 지금 단계와 `자세히 보기`가 보인다
  await page
    .getByTestId('pinned-toast-slot')
    .getByRole('button', { name: /펼치기/ })
    .click()
  await expect(processing.getByRole('button', { name: '자세히 보기' })).toBeVisible()

  // 앱 수준 추적기가 polling 을 이어 간다(3초 간격, 세 단계 + 완료). 다른 화면이라 옮기지 않고 토스트만 완료로 바뀐다 (U4-1, U4-5)
  const toast = signalOf(page, '회의 정리가 끝났어요')
  await expect(toast).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(`${WORKSPACE}/tasks`)
  await expect(processing).toHaveCount(0)

  await toast.getByRole('button', { name: '회의록 보기' }).click()
  await expect(page).toHaveURL(`${WORKSPACE}/meetings/${meetingId}`)
  await expect(
    page.getByRole('article', { name: SHORT_AUDIO.name }).getByRole('heading', {
      name: SHORT_AUDIO.name,
    }),
  ).toBeVisible(FIRST_PAINT)
})

test('③ 일반 팀원이 회의 올리기 주소로 바로 들어오면 막히고 업로드 요청이 없다', async ({
  page,
}) => {
  const requests = recordRequests(page)
  await start(page, 'meeting-member', UPLOAD)

  // 기존 PM 가드 — 태스크로 돌려보내고 접근 권한 안내 (U3-11)
  await expect(page).toHaveURL(`${WORKSPACE}/tasks`, FIRST_PAINT)
  await expect(toastOf(page, '접근 권한이 없어요')).toBeVisible()
  await expect(page.getByRole('heading', { name: '회의를 올려 주세요' })).toHaveCount(0)

  // 업로드 진입 판정(연동 상태)과 업로드 POST 가 하나도 없다
  const uploadRelated = requests.filter(
    ({ method, pathname }) =>
      (method === 'POST' && UPLOAD_POST.test(pathname)) || pathname.endsWith('/integrations'),
  )
  expect(uploadRelated).toEqual([])

  // 회의록 화면에도 팀원에게는 업로드 진입이 없다 (U5-2)
  await page.getByRole('banner').getByRole('link', { name: '회의록', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '회의 목록' })).toBeVisible(FIRST_PAINT)
  await expect(page.getByRole('link', { name: '회의 올리기' })).toHaveCount(0)
})

test('④ 정리에 실패하면 진행 토스트가 재업로드 안내로 바뀌고 그 회의는 목록에 없다', async ({
  page,
}) => {
  await start(page, 'meeting-fail', UPLOAD)
  await uploadShortAudio(page)

  // 처리 화면을 보고 있었으니 회의록 목록으로 옮긴다 (U4-6). 목록은 가장 최근 완료 회의를 고른다 (U5-1)
  const failed = signalOf(page, '회의를 정리하지 못했어요')
  await expect(failed).toBeVisible({ timeout: 15_000 })
  await expect(failed).toContainText(`${SHORT_AUDIO.name} · 파일을 다시 올려 주세요.`)
  await expect(page).toHaveURL(/\/workspaces\/ws_01\/meetings\/mt_\w+$/)
  const list = page.getByRole('complementary', { name: '회의 목록' })
  await expect(list.getByRole('link', { name: /기획 논의 녹음/ })).toBeVisible(FIRST_PAINT)
  // 실패 회의는 목록에 없다 (D-093). 일반 실패라 재연결 모달도 없다 (D-100 은 끊김일 때만)
  await expect(list.getByText(SHORT_AUDIO.name)).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('region', { name: /정리 중$/ })).toHaveCount(0)
})

test('⑤ 화자 지정 기한 만료는 목록과 상세에 남고 새로고침 뒤에도 다시 업로드할 수 있다', async ({
  page,
}, testInfo) => {
  await start(page, 'meeting-fail-expired', UPLOAD)
  const requests = recordRequests(page)
  await uploadShortAudio(page)

  await expect(page.getByRole('heading', { name: '화자 지정 기한이 지났어요' })).toBeVisible(
    FIRST_PAINT,
  )
  const meetingId = new URL(page.url()).pathname.split('/').pop()
  const list = page.getByRole('list', { name: '화자 지정 기한 만료' })
  await expect(list.getByRole('link', { name: new RegExp(SHORT_AUDIO.name) })).toBeVisible()
  await expect(
    page.getByRole('region', { name: '회의록 본문' }).getByText(/화자 지정 대기가 7일을 넘어/),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '화자 지정 기한이 지났어요' })).toBeVisible(
    FIRST_PAINT,
  )
  await expect(list.getByRole('link', { name: new RegExp(SHORT_AUDIO.name) })).toHaveAttribute(
    'aria-current',
    'page',
  )

  await page.getByRole('banner').getByRole('link', { name: '태스크', exact: true }).click()
  await page.getByRole('banner').getByRole('link', { name: '회의록', exact: true }).click()
  await list.getByRole('link', { name: new RegExp(SHORT_AUDIO.name) }).click()
  await expect(page.getByRole('heading', { name: '화자 지정 기한이 지났어요' })).toBeVisible()
  expect(
    requests.filter(({ pathname }) =>
      new RegExp('/meetings/' + meetingId + '/minutes$').test(pathname),
    ),
  ).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('expired-history.png') })
  await page.getByRole('link', { name: '다시 업로드', exact: true }).click()
  await expect(page).toHaveURL(UPLOAD)
  await expect(page.getByRole('heading', { name: '회의를 올려 주세요' })).toBeVisible(FIRST_PAINT)
})

test('⑥ 음성 처리 실패는 Notion 연결도 끊겨 있어도 해당 사유를 먼저 안내한다', async ({ page }) => {
  await start(page, 'meeting-fail-diarize', UPLOAD)
  await uploadShortAudio(page)
  await expect(
    signalOf(page, '음성 처리 중 회의 정리를 완료하지 못했어요. 파일을 다시 올려 주세요.'),
  ).toBeVisible(FIRST_PAINT)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('complementary', { name: '회의 목록' }).getByText(SHORT_AUDIO.name),
  ).toHaveCount(0)
})

test('⑦ 일반 팀원도 만료 이력을 볼 수 있고 재업로드는 PM에게 요청한다', async ({ page }) => {
  await start(page, 'meeting-expired-member', WORKSPACE + '/meetings/mt_10')
  await expect(page.getByRole('heading', { name: '화자 지정 기한이 지났어요' })).toBeVisible(
    FIRST_PAINT,
  )
  await expect(page.getByText('PM에게 파일 재업로드를 요청해 주세요.')).toBeVisible()
  await expect(page.getByRole('link', { name: '다시 업로드', exact: true })).toHaveCount(0)
  await expect(page.getByRole('list', { name: '화자 지정 기한 만료' })).toContainText(
    '기획 논의 녹음',
  )
})

test('⑧ 채팅 회의가 정리 중이어도 업로드 화면에 머물고 올릴 수 있다 (#450)', async ({
  page,
}, testInfo) => {
  await start(page, 'meeting-chat-processing', UPLOAD)
  await expect(page.getByRole('heading', { name: '회의를 올려 주세요' })).toBeVisible(FIRST_PAINT)
  await expect(page.getByRole('button', { name: '정리 시작하기' })).toBeVisible()
  await expect(page).toHaveURL(UPLOAD)
  await page.screenshot({ path: testInfo.outputPath('chat-processing-upload.png') })
  const requests = recordRequests(page)

  await uploadShortAudio(page)

  await expect(page).toHaveURL(PROCESSING_URL)
  expect(new URL(page.url()).pathname.match(PROCESSING_URL)?.[1]).not.toBe('mt_11')
  expect(
    requests.filter(({ method, pathname }) => method === 'POST' && UPLOAD_POST.test(pathname)),
  ).toHaveLength(1)
  await expect(page.getByRole('heading', { name: '정리하고 있어요' })).toBeVisible(FIRST_PAINT)
  await page.screenshot({ path: testInfo.outputPath('chat-processing-uploaded.png') })
})

test('⑨ 멈춘 채팅 회의(chat_stalled)는 토스트·처리 화면·회의록에서 다시 올리라고 하지 않는다 (#450)', async ({
  page,
}, testInfo) => {
  const STALLED = '채팅 대화를 정리하다 멈췄어요. 다음 수집 때 다시 정리해요.'
  await start(page, 'meeting-chat-stalled', `${WORKSPACE}/tasks`)
  const failed = signalOf(page, '회의를 정리하지 못했어요')
  await expect(failed).toBeVisible({ timeout: 15_000 })
  await expect(failed).toContainText(STALLED)
  await expect(failed).not.toContainText('다시 올려')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('chat-stalled-toast.png') })

  await page.goto(`${WORKSPACE}/meetings/mt_11/processing`)
  await expect(page.getByRole('heading', { name: '채팅 대화를 정리하지 못했어요' })).toBeVisible(
    FIRST_PAINT,
  )
  await expect(page.getByText(STALLED)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('chat-stalled-processing.png') })

  await page.getByRole('link', { name: '실패 사유 보기' }).click()
  const detail = page.getByRole('region', { name: '회의록 본문' })
  await expect(detail.getByText(STALLED)).toBeVisible(FIRST_PAINT)
  await expect(page.getByRole('link', { name: '다시 업로드', exact: true })).toHaveCount(0)
  await expect(detail.getByText(/재업로드|다시 올려/)).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('chat-stalled-minutes.png') })
})
