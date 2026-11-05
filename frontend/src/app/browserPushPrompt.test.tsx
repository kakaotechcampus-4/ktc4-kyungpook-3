import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { ENDPOINT, KEYS, installPushBrowser } from './test/pushBrowser'
import { renderApp } from './test/renderApp'

/*
 * #411 리마인드 대화 위 알림 띠. 팀원(mb_01, 계정 us_01)이 봇 리마인드를 받은 자기 대화 th_06 을 연다.
 * 알림 허용은 `알림 켜기` 를 누른 뒤에만 묻고, 닫거나 켜거나 막힌 기기·계정에는 다시 보이지 않는다
 */

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  window.localStorage.clear()
  applyScenario('messages-member')
})

const band = () => screen.queryByRole('region', { name: '기기 알림' })
const pushRequests = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ path }) => path.startsWith('/push/'))

async function openThread(path = paths.messageThread('ws_01', 'th_06')) {
  const app = renderApp(path)
  await screen.findByRole('region', { name: '대화 내용' })
  return app
}

async function findBand() {
  return within(await screen.findByRole('region', { name: '기기 알림' }))
}

function stubIphone() {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
  })
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'userAgent')
  })
}

describe('리마인드 대화 위 알림 띠 (#411)', () => {
  it('대화를 열면 띠만 보이고 허용은 묻지 않는다. 누르면 한 번 묻고 켠 뒤 띠를 거두고 알린다', async () => {
    db.push.publicKey = 'AQID'
    const browser = installPushBrowser()
    const bodies = recordRequestBodies('POST', '/push/subscriptions')
    const user = userEvent.setup()
    await openThread()

    const prompt = await findBand()
    expect(
      prompt.getByRole('heading', { name: '다음 리마인드를 기기 알림으로 받을까요?' }),
    ).toBeVisible()
    expect(prompt.getByText('새 리마인드가 오면 이 기기로 바로 알려 드려요.')).toBeVisible()
    expect(browser.notification.requestPermission).not.toHaveBeenCalled()

    await user.click(prompt.getByRole('button', { name: '알림 켜기' }))

    await waitFor(() => expect(band()).toBeNull())
    expect(browser.notification.requestPermission).toHaveBeenCalledTimes(1)
    expect(bodies).toEqual([{ endpoint: ENDPOINT, keys: KEYS }])
    expect(await screen.findByText('이 기기에서 알림을 받아요.')).toBeInTheDocument()
  })

  it('닫으면 사라지고, 대화를 다시 열어도 보이지 않으며 푸시 상태도 묻지 않는다', async () => {
    db.push.publicKey = 'AQID'
    const browser = installPushBrowser()
    const user = userEvent.setup()
    const first = await openThread()
    await user.click((await findBand()).getByRole('button', { name: '닫기' }))
    expect(band()).toBeNull()
    first.unmount()

    const log = recordRequests()
    await openThread()

    expect(band()).toBeNull()
    expect(pushRequests(log)).toEqual([])
    expect(browser.notification.requestPermission).not.toHaveBeenCalled()
  })

  it('같은 기기에서도 닫은 기록은 계정마다 따로다', async () => {
    db.push.publicKey = 'AQID'
    installPushBrowser()
    window.localStorage.setItem('browser-push-prompt-closed:us_99', '1')
    await openThread()
    expect(await findBand()).toBeTruthy()
  })

  it('브라우저가 알림을 막아 두었으면 띠가 없다', async () => {
    db.push.publicKey = 'AQID'
    installPushBrowser({ permission: 'denied' })
    const log = recordRequests()
    await openThread()
    expect(band()).toBeNull()
    expect(pushRequests(log)).toEqual([])
  })

  it('허용을 거절하면 띠가 사라지고 다시 열어도 보이지 않는다', async () => {
    db.push.publicKey = 'AQID'
    const browser = installPushBrowser({ answer: 'denied' })
    const user = userEvent.setup()
    const first = await openThread()
    await user.click((await findBand()).getByRole('button', { name: '알림 켜기' }))
    await waitFor(() => expect(band()).toBeNull())
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled()
    expect(screen.queryByText('이 기기에서 알림을 받아요.')).toBeNull()
    first.unmount()

    browser.notification.permission = 'default'
    const log = recordRequests()
    await openThread()
    expect(band()).toBeNull()
    expect(pushRequests(log)).toEqual([])
  })

  it('허용 창을 그냥 닫으면 띠가 남아 다시 누를 수 있다', async () => {
    db.push.publicKey = 'AQID'
    const browser = installPushBrowser({ answer: 'default' })
    const user = userEvent.setup()
    await openThread()
    await user.click((await findBand()).getByRole('button', { name: '알림 켜기' }))

    await waitFor(() => expect(browser.notification.requestPermission).toHaveBeenCalledTimes(1))
    const prompt = await findBand()
    await waitFor(() => expect(prompt.getByRole('button', { name: '알림 켜기' })).toBeEnabled())
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('켜지 못하면 띠 안에서 알리고 다시 시도할 수 있다', async () => {
    db.push.publicKey = 'AQID'
    server.use(
      http.post('/api/v1/push/subscriptions', () => fail('INTERNAL_ERROR', 'boom', 500), {
        once: true,
      }),
    )
    installPushBrowser()
    const user = userEvent.setup()
    await openThread()
    await user.click((await findBand()).getByRole('button', { name: '알림 켜기' }))

    const prompt = await findBand()
    expect(await prompt.findByRole('alert')).toHaveTextContent(
      '브라우저 알림을 켜지 못했어요. 다시 시도해 주세요.',
    )
    expect(prompt.getByRole('button', { name: '닫기' })).toBeEnabled()
    await user.click(prompt.getByRole('button', { name: '다시 시도' }))

    await waitFor(() => expect(band()).toBeNull())
    expect(db.push.subscriptions).toEqual([{ endpoint: ENDPOINT, keys: KEYS, user_id: 'us_01' }])
  })

  it('이미 켜 둔 기기는 띠도 알림도 없고, 다음에 열 때는 푸시 상태를 묻지 않는다', async () => {
    db.push.publicKey = 'AQID'
    installPushBrowser({ permission: 'granted', subscribed: true })
    const bodies = recordRequestBodies('POST', '/push/subscriptions')
    const first = await openThread()
    await waitFor(() => expect(bodies).toHaveLength(1))
    await waitFor(() =>
      expect(window.localStorage.getItem('browser-push-prompt-closed:us_01')).not.toBeNull(),
    )
    expect(band()).toBeNull()
    expect(screen.queryByText('이 기기에서 알림을 받아요.')).toBeNull()
    first.unmount()

    const log = recordRequests()
    await openThread()
    expect(band()).toBeNull()
    expect(pushRequests(log)).toEqual([])
  })

  it('iPhone 의 Safari 탭이면 홈 화면 앱 안내와 닫기만 있다', async () => {
    db.push.publicKey = 'AQID'
    stubIphone()
    const log = recordRequests()
    await openThread()

    const prompt = await findBand()
    expect(
      prompt.getByText(
        'iPhone·iPad 는 Safari 공유 메뉴에서 홈 화면에 추가한 앱으로 열어야 알림을 받을 수 있어요.',
      ),
    ).toBeVisible()
    expect(prompt.queryByRole('button', { name: '알림 켜기' })).toBeNull()
    expect(prompt.getAllByRole('button').map((button) => button.textContent)).toEqual(['닫기'])
    expect(pushRequests(log)).toEqual([])
  })

  it('PM 이 보는 팀원 대화에는 띠가 없다', async () => {
    applyScenario('messages-default')
    db.push.publicKey = 'AQID'
    installPushBrowser()
    const log = recordRequests()
    await openThread(paths.messageThread('ws_01', 'th_01'))
    expect(band()).toBeNull()
    expect(pushRequests(log)).toEqual([])
  })
})
