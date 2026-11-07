import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { attributeReply } from '@/shared/mock/reply-state'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { conversation, detail, hold } from './test/messageScreen'
import { renderApp } from './test/renderApp'

/*
 * 답장 확인 필요 (#344, 계약 §5.7 「리마인드 답장 판단」). AI 가 어느 태스크에 대한 답장인지 정하지 못하면
 * PM 이 대화에서 태스크를 고른다. 시나리오 reply-judgment 의 박민수 th_02 답장 mg_05 가 고를 차례다(후보 tk_02·tk_05)
 */

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

const ATTRIBUTIONS = '/workspaces/ws_01/messages/threads/th_02/attributions'
const ATTRIBUTE = '/workspaces/ws_01/messages/replies/mg_05/attribution'
const REPLY = '거의 다 됐어요. 내일 오전에 올릴게요'

const picker = () =>
  within(conversation()).queryByRole('group', { name: '어느 태스크에 대한 답장인가요?' })
const radio = (name: string) => within(conversation()).getByRole('radio', { name })
const decide = () => within(conversation()).getByRole('button', { name: '정하기' })

async function openInbox(path: string) {
  renderApp(path)
  await screen.findByRole('region', { name: '대화' })
}

async function openPicker() {
  await openInbox(paths.messageThread('ws_01', 'th_02'))
  return detail().findByRole('group', { name: '어느 태스크에 대한 답장인가요?' })
}

describe('PM 은 AI 가 정하지 못한 답장의 태스크를 대화에서 고른다', () => {
  beforeEach(() => applyScenario('reply-judgment'))

  it('라디오만 옮겨서는 보내지 않고, 정하면 응답 뒤에 고른 태스크가 고르기 자리에 남는다', async () => {
    const log = recordRequests()
    const group = await openPicker()
    expect(log.started).toContainEqual({ method: 'GET', path: ATTRIBUTIONS })
    expect(
      within(group).getByText('AI가 어느 태스크에 대한 답장인지 정하지 못했어요.'),
    ).toBeVisible()
    expect(
      within(group)
        .getAllByRole('radio')
        .map((input) => input.closest('label')?.textContent),
    ).toEqual(['회원가입 화면', '회의록 요약 검수', '해당 없음'])
    expect(decide()).toBeDisabled()

    await userEvent.click(radio('회원가입 화면'))
    expect(log.started.some(({ path }) => path === ATTRIBUTE)).toBe(false)

    const request = hold(ATTRIBUTE, 'post')
    await userEvent.click(decide())
    await waitFor(() => expect(decide()).toHaveAttribute('aria-busy', 'true'))
    await userEvent.click(decide())
    expect(request.calls()).toBe(1)
    expect(within(conversation()).queryByText('태스크: 회원가입 화면')).toBeNull()

    act(() => request.resolve())
    expect(
      await screen.findByText("'회원가입 화면'에 대한 답장으로 정했어요. AI가 다시 판단해요."),
    ).toBeInTheDocument()
    expect(await within(conversation()).findByText('태스크: 회원가입 화면')).toBeVisible()
    expect(picker()).toBeNull()
    expect(within(conversation()).getByText(REPLY)).toBeVisible()
  })

  it('대화보다 늦게 온 고르기도 맨 아래를 보던 사람에게는 가려지지 않는다', async () => {
    const attributions = hold(ATTRIBUTIONS)
    await openInbox(paths.messageThread('ws_01', 'th_02'))
    await within(conversation()).findByText(REPLY)
    const body = conversation()
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 640 })

    act(() => attributions.resolve())
    expect(
      await detail().findByRole('group', { name: '어느 태스크에 대한 답장인가요?' }),
    ).toBeVisible()
    expect(body.scrollTop).toBe(640)
  })

  it('해당 없음으로 정할 수 있다', async () => {
    await openPicker()
    await userEvent.click(radio('해당 없음'))
    await userEvent.click(decide())
    expect(await screen.findByText('해당 없음으로 정했어요.')).toBeInTheDocument()
    expect(await within(conversation()).findByText('해당 없음으로 정했어요')).toBeVisible()
    expect(picker()).toBeNull()
  })

  it('정하지 못하면 고르기를 남기고 다시 시도로 같은 태스크를 다시 보낸다', async () => {
    db.messageFailures.actions = true
    await openPicker()
    await userEvent.click(radio('회의록 요약 검수'))
    await userEvent.click(decide())
    const alert = await within(conversation()).findByRole('alert')
    expect(alert).toHaveTextContent('답장의 태스크를 정하지 못했어요')
    expect(radio('회의록 요약 검수')).toBeChecked()

    db.messageFailures.actions = false
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await within(conversation()).findByText('태스크: 회의록 요약 검수')).toBeVisible()
    expect(picker()).toBeNull()
  })

  it('그사이 이미 정해진 답장이면 알리고 대화를 다시 받아 정해진 태스크를 보인다', async () => {
    await openPicker()
    expect(attributeReply('ws_01', 'mg_05', 'tk_05')).toBeNull()
    await userEvent.click(radio('회원가입 화면'))
    await userEvent.click(decide())
    expect(
      await screen.findByText('이미 처리된 답장이에요. 대화를 다시 불러올게요.'),
    ).toBeInTheDocument()
    expect(await within(conversation()).findByText('태스크: 회의록 요약 검수')).toBeVisible()
    expect(picker()).toBeNull()
    expect(within(conversation()).queryByRole('alert')).toBeNull()
  })

  it('고르기를 받지 못해도 대화는 보이고, 다시 시도하면 고르기가 나온다', async () => {
    let broken = true
    server.use(
      http.get(`/api/v1${ATTRIBUTIONS}`, () =>
        broken ? fail('INTERNAL_ERROR', '서버 오류', 500) : undefined,
      ),
    )
    await openInbox(paths.messageThread('ws_01', 'th_02'))
    const alert = await detail().findByRole('alert', {}, { timeout: 5_000 })
    expect(alert).toHaveTextContent('답장의 태스크 고르기를 불러오지 못했어요')
    expect(within(conversation()).getByText(REPLY)).toBeVisible()
    expect(picker()).toBeNull()

    broken = false
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(
      await detail().findByRole('group', { name: '어느 태스크에 대한 답장인가요?' }),
    ).toBeVisible()
    expect(detail().queryByRole('alert')).toBeNull()
  })
})

describe('팀원은 답장의 태스크를 고르지 않는다', () => {
  it('자기 대화를 열어도 고르기를 묻지 않는다', async () => {
    applyScenario('messages-member')
    const log = recordRequests()
    await openInbox(paths.messages('ws_01'))
    expect(await detail().findByRole('textbox', { name: '답장' })).toBeVisible()
    expect(log.started.some(({ path }) => path.endsWith('/attributions'))).toBe(false)
    expect(within(conversation()).queryByRole('group')).toBeNull()
  })
})
