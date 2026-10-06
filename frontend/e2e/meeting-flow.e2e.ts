import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectAudioReady, SHORT_AUDIO, start } from './support'

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
  await expect(page).toHaveURL(/\/workspaces\/ws_01\/meetings\/mt_\w+$/, { timeout: 15_000 })
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
  // 처리 화면을 보고 있었으니 토스트와 함께 바로 옮겨졌다
  await expect(toastOf(page, '회의 정리가 끝났어요')).toBeVisible()
})

test('② 정리 중에 다른 화면으로 가도 완료 토스트의 `회의록 보기`로 그 회의록에 간다', async ({
  page,
}) => {
  await start(page, 'meeting-demo', UPLOAD)
  await uploadShortAudio(page)

  await expect(page).toHaveURL(PROCESSING_URL, FIRST_PAINT)
  const meetingId = PROCESSING_URL.exec(new URL(page.url()).pathname)?.[1]
  expect(meetingId).toBeDefined()
  await expect(page.getByRole('heading', { name: '정리하고 있어요' })).toBeVisible(FIRST_PAINT)

  // 헤더의 `정리 중` 링크가 이 회의의 처리 화면을 가리킨다 (U4-9)
  const header = page.getByRole('banner')
  await expect(header.getByRole('link', { name: '정리 중', exact: true })).toHaveAttribute(
    'href',
    `${WORKSPACE}/meetings/${meetingId}/processing`,
  )

  // 정리 중에 태스크 화면으로 떠난다 — 업로드가 끝나 입력이 없으니 이탈 확인은 없다 (U3-9)
  await header.getByRole('link', { name: '태스크', exact: true }).click()
  await expect(page).toHaveURL(`${WORKSPACE}/tasks`)

  // 앱 수준 추적기가 polling 을 이어 간다(3초 간격, 세 단계 + 완료). 다른 화면이라 옮기지 않고 토스트만 띄운다 (U4-1, U4-5)
  const toast = toastOf(page, '회의 정리가 끝났어요')
  await expect(toast).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(`${WORKSPACE}/tasks`)
  await expect(header.getByRole('link', { name: '정리 중', exact: true })).toHaveCount(0)

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

test('④ 정리에 실패하면 재업로드 토스트가 뜨고 그 회의는 목록에 없다', async ({ page }) => {
  await start(page, 'meeting-fail', UPLOAD)
  await uploadShortAudio(page)

  // 처리 화면을 보고 있었으니 회의록 목록으로 옮긴다 (U4-6). 목록은 가장 최근 완료 회의를 고른다 (U5-1)
  await expect(toastOf(page, '회의를 정리하지 못했어요. 파일을 다시 올려 주세요.')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page).toHaveURL(/\/workspaces\/ws_01\/meetings\/mt_\w+$/)
  const list = page.getByRole('complementary', { name: '회의 목록' })
  await expect(list.getByRole('link', { name: /기획 논의 녹음/ })).toBeVisible(FIRST_PAINT)
  // 실패 회의는 목록에 없다 (D-093). 일반 실패라 재연결 모달도 없다 (D-100 은 끊김일 때만)
  await expect(list.getByText(SHORT_AUDIO.name)).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('banner').getByRole('link', { name: '정리 중' })).toHaveCount(0)
})
