import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { applyScenario } from '@/shared/mock/scenarios'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import {
  conversation,
  current,
  detail,
  hold,
  reviewList,
  rowTexts,
  threadList,
} from './test/messageScreen'
import { renderApp } from './test/renderApp'

/*
 * M8 메시지 — 보낼 메시지(묶음)의 행동 (계약 §5.7, 계획 C-5).
 * 모든 행동은 서버(MSW)가 성공한 뒤에만 화면을 바꾼다 — 응답을 붙잡아 「응답 전에는 그대로」와 중복 제출 방지를 본다 (D-137).
 * 실패는 그 자리의 role=alert 와 다시 시도로, 서버가 거절한 이유(바뀜·지난 시각·이미 처리됨)는 그 이유대로 알린다
 */

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

const BUNDLE_PATH = '/workspaces/ws_01/messages/bundles/bd_01'

async function openBundle(bundleId = 'bd_01') {
  const app = renderApp(paths.messageReview('ws_01', bundleId))
  await screen.findByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })
  return app
}
const bundleOf = (bundleId: string) => {
  const found = db.messageBundles.find(({ bundle_id }) => bundle_id === bundleId)
  if (!found) throw new Error(`mock bundle ${bundleId} is missing`)
  return found
}
const button = (name: string) => detail().getByRole('button', { name })
const radio = (name: RegExp | string) => detail().getByRole('radio', { name })
const detailPane = () => screen.getByRole('region', { name: '메시지 내용' })
/* 행동 잠금은 disabled 가 아니라 aria-disabled 다 — 누른 버튼·카드에서 포커스가 빠지지 않는다 (VR-03·VR-04) */
const expectLocked = (element: HTMLElement) =>
  expect(element).toHaveAttribute('aria-disabled', 'true')
const expectUnlocked = (element: HTMLElement) =>
  expect(element).not.toHaveAttribute('aria-disabled')

describe('이대로 발송 — 보이는 문구의 판으로 승인하고, 서버가 성공한 뒤에만 목록과 대화가 바뀐다', () => {
  it('응답 전에는 목록·상세가 그대로이고 행동이 모두 잠겨 두 번 눌러도 한 번만 보낸다', async () => {
    const app = await openBundle()
    const request = hold(`${BUNDLE_PATH}/approve`, 'post')
    await userEvent.click(button('이대로 발송'))

    await waitFor(() => expect(button('이대로 발송')).toHaveAttribute('aria-busy', 'true'))
    expectLocked(button('이대로 발송'))
    expectLocked(button('보내지 않음'))
    expectLocked(button('고쳐 쓰기'))
    expectLocked(radio(/직접 정하기/))
    expect(document.activeElement).toBe(button('이대로 발송'))
    expect(rowTexts(reviewList())).toHaveLength(2)
    await userEvent.click(button('이대로 발송'))
    expect(request.calls()).toBe(1)

    act(() => request.resolve())
    // 승인한 묶음은 예정으로 남는다. 주소만 목록으로 바꿔 끼우고 다음 승인 전 묶음이 골라진다
    await app.expectSearch('')
    await waitFor(() => expect(rowTexts(reviewList())[0]).toContain('09/23 발송 예정'))
    expect(rowTexts(reviewList())).toHaveLength(2)
    expect(current()[0]).toHaveTextContent('정하늘')
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(document.activeElement).toBe(detailPane())
    expect(await screen.findByText('09/23 09:00에 이재환님에게 보낼게요')).toBeInTheDocument()
    expect(bundleOf('bd_01')).toMatchObject({ approved: true })
  })

  it('승인한 묶음은 대화에 승인함으로 보이고, 확인하기에서는 이대로 발송 없이 예정으로 보인다', async () => {
    await openBundle()
    await userEvent.click(button('이대로 발송'))
    await waitFor(() => expect(rowTexts(reviewList())[0]).toContain('09/23 발송 예정'))

    await userEvent.click(within(threadList()).getByRole('link', { name: /이재환/ }))
    await detail().findByRole('heading', { level: 2, name: '이재환' })
    expect(within(conversation()).getByText('09/23 09:00 발송 예정 · 승인함')).toBeVisible()

    await userEvent.click(within(conversation()).getByRole('link', { name: '확인하기' }))
    expect(
      await detail().findByRole('heading', { level: 2, name: '보낼 예정인 메시지예요' }),
    ).toBeVisible()
    expect(detail().getByText(/에게 .*Discord 개인 메시지로 나갑니다/)).toHaveTextContent(
      '이재환에게 09/23 09:00에 Discord 개인 메시지로 나갑니다. 승인했어요.',
    )
    expect(detail().queryByRole('button', { name: '이대로 발송' })).toBeNull()
    expect(button('보내지 않음')).toBeEnabled()
  })

  it('미리 받아 둔 대화도 승인 뒤에는 무효화돼 다시 가리키면 새로 받는다', async () => {
    await openBundle()
    const log = recordRequests()
    const thread = () => within(threadList()).getByRole('link', { name: /이재환/ })
    const threadRequests = () =>
      log.started.filter(({ path }) => path === '/workspaces/ws_01/messages/threads/th_01')

    await userEvent.hover(thread())
    await waitFor(() => expect(threadRequests()).toHaveLength(1))
    await userEvent.unhover(thread())
    await userEvent.click(button('이대로 발송'))
    await waitFor(() => expect(rowTexts(reviewList())[0]).toContain('09/23 발송 예정'))
    expect(threadRequests()).toHaveLength(1)

    await userEvent.hover(thread())
    await waitFor(() => expect(threadRequests()).toHaveLength(2))
  })

  it('실패하면 그 자리에 다시 시도를 알리고 화면은 그대로다 — 다시 시도가 성공하면 반영된다', async () => {
    db.messageFailures.actions = true
    await openBundle()
    await userEvent.click(button('이대로 발송'))
    const alert = await detail().findByRole('alert')
    expect(alert).toHaveTextContent('발송을 승인하지 못했어요')
    expect(alert).toHaveTextContent('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.')
    expect(current()[0]).toHaveTextContent('이재환')
    expectUnlocked(button('이대로 발송'))
    expect(document.activeElement).toBe(button('이대로 발송'))
    expect(screen.queryByText(/보낼게요/)).toBeNull()

    db.messageFailures.actions = false
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(rowTexts(reviewList())[0]).toContain('09/23 발송 예정'))
    await waitFor(() => expect(current()[0]).toHaveTextContent('정하늘'))
    expect(detail().queryByRole('alert')).toBeNull()
  })

  it('보는 동안 문구가 바뀌었으면 바뀌었다고 알리고 새 문구를 다시 불러온다 — 새 문구로는 승인된다', async () => {
    await openBundle()
    Object.assign(bundleOf('bd_01'), { body: '재환님, 새로 다듬은 문구예요.', draft_version: 3 })
    await userEvent.click(button('이대로 발송'))

    const alert = await detail().findByRole('alert')
    expect(alert).toHaveTextContent('발송을 승인하지 못했어요')
    expect(alert).toHaveTextContent('보낼 메시지가 바뀌었어요. 다시 확인해 주세요.')
    expect(within(alert).queryByRole('button', { name: '다시 시도' })).toBeNull()
    await waitFor(() =>
      expect(detail().getByRole('region', { name: '보낼 메시지 미리보기' })).toHaveTextContent(
        '재환님, 새로 다듬은 문구예요.',
      ),
    )
    expect(bundleOf('bd_01').approved).toBe(false)

    await userEvent.click(button('이대로 발송'))
    expect(await screen.findByText('09/23 09:00에 이재환님에게 보낼게요')).toBeInTheDocument()
    expect(bundleOf('bd_01')).toMatchObject({ approved: true, draft_version: 3 })
  })

  it.each([
    [
      '다른 곳에서 보내지 않음으로 처리된 묶음',
      () => {
        bundleOf('bd_01').status = 'cancelled'
      },
    ],
    [
      '없어진 묶음',
      () => {
        db.messageBundles = db.messageBundles.filter(({ bundle_id }) => bundle_id !== 'bd_01')
      },
    ],
  ])('%s 이면 이미 처리됐다고 알리고 목록을 다시 불러온다', async (_name, settleElsewhere) => {
    await openBundle()
    settleElsewhere()
    await userEvent.click(button('이대로 발송'))
    expect(
      await screen.findByText('이미 처리된 메시지예요. 목록을 다시 불러올게요.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(rowTexts(reviewList())).toHaveLength(1))
    expect(
      detail().getByText('왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.'),
    ).toBeInTheDocument()
  })
})

describe('보내지 않음', () => {
  it('묶음은 목록과 대화에서 빠진다', async () => {
    const app = await openBundle()
    const request = hold(`${BUNDLE_PATH}/cancel`, 'post')
    await userEvent.click(button('보내지 않음'))
    await waitFor(() => expect(button('보내지 않음')).toHaveAttribute('aria-busy', 'true'))
    expectLocked(button('이대로 발송'))
    expect(document.activeElement).toBe(button('보내지 않음'))
    expect(rowTexts(reviewList())).toHaveLength(2)

    act(() => request.resolve())
    await app.expectSearch('')
    await waitFor(() => expect(rowTexts(reviewList())).toHaveLength(1))
    expect(document.activeElement).toBe(detailPane())
    expect(
      await screen.findByText('이재환님에게 보낼 메시지를 보내지 않기로 했어요'),
    ).toBeInTheDocument()
    await userEvent.click(within(threadList()).getByRole('link', { name: /이재환/ }))
    await detail().findByRole('heading', { level: 2, name: '이재환' })
    expect(within(conversation()).queryByRole('link', { name: '확인하기' })).toBeNull()
    expect(conversation()).not.toHaveTextContent('API 명세서 마감이 다음 주 목요일')
  })
})

describe('고쳐 쓰기', () => {
  it('고친 문구는 서버가 저장한 뒤에 미리보기에 보이고, 고치는 동안에는 보낼 수 없다. 새 판으로 승인된다', async () => {
    await openBundle()
    await userEvent.click(button('고쳐 쓰기'))
    const field = detail().getByRole('textbox', { name: '보낼 문구' })
    expect(document.activeElement).toBe(field)
    expectLocked(button('이대로 발송'))
    expectLocked(button('보내지 않음'))
    expect(button('이대로 발송')).toHaveAccessibleDescription(
      '고친 문구를 저장하거나 취소한 뒤에 보낼 수 있어요.',
    )

    await userEvent.clear(field)
    await userEvent.type(field, '재환님, 명세서 진행 상황 알려 주세요 🙂')
    const request = hold(BUNDLE_PATH, 'patch')
    await userEvent.click(button('저장'))
    await waitFor(() => expect(button('저장')).toHaveAttribute('aria-busy', 'true'))
    expect(field).toBeDisabled()

    act(() => request.resolve())
    await waitFor(() => expect(detail().queryByRole('textbox')).toBeNull())
    const preview = detail().getByRole('region', { name: '보낼 메시지 미리보기' })
    expect(preview).toHaveTextContent('재환님, 명세서 진행 상황 알려 주세요 🙂')
    expect(preview).toHaveTextContent('직접 고친 문구 · 문구는 그대로 고칠 수 있어요')
    expect(document.activeElement).toBe(button('고쳐 쓰기'))
    expectUnlocked(button('이대로 발송'))
    expect(bundleOf('bd_01')).toMatchObject({
      body: '재환님, 명세서 진행 상황 알려 주세요 🙂',
      draft_version: 3,
    })

    await userEvent.click(button('이대로 발송'))
    expect(await screen.findByText('09/23 09:00에 이재환님에게 보낼게요')).toBeInTheDocument()
    expect(bundleOf('bd_01').approved).toBe(true)
  })

  it('빈 문구는 보내지 않고 그 자리에서 알린다. 취소하면 원래 문구 그대로다', async () => {
    await openBundle()
    await userEvent.click(button('고쳐 쓰기'))
    const field = detail().getByRole('textbox', { name: '보낼 문구' })
    await userEvent.clear(field)
    const request = hold(BUNDLE_PATH, 'patch')
    await userEvent.click(button('저장'))
    expect(detail().getByText('보낼 문구를 입력해 주세요.')).toBeVisible()
    expect(request.calls()).toBe(0)

    await userEvent.click(button('취소'))
    expect(detail().getByRole('region', { name: '보낼 메시지 미리보기' })).toHaveTextContent(
      '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂',
    )
    expect(document.activeElement).toBe(button('고쳐 쓰기'))
  })

  it('저장에 실패하면 고치던 문구를 그대로 두고 알린다', async () => {
    db.messageFailures.actions = true
    await openBundle()
    await userEvent.click(button('고쳐 쓰기'))
    const field = detail().getByRole('textbox', { name: '보낼 문구' })
    await userEvent.clear(field)
    await userEvent.type(field, '고친 문구')
    await userEvent.click(button('저장'))
    expect(await detail().findByRole('alert')).toHaveTextContent('고친 문구를 저장하지 못했어요')
    expect(detail().getByRole('textbox', { name: '보낼 문구' })).toHaveValue('고친 문구')
    expect(bundleOf('bd_01').body).not.toBe('고친 문구')
  })
})

describe('언제 보낼까요? — 고른 카드는 서버가 저장한 시각에서 정한다', () => {
  it('마감 하루 전을 누르면 응답 전에는 그대로이고, 저장되면 그 카드가 골라진다', async () => {
    await openBundle('bd_02')
    const request = hold('/workspaces/ws_01/messages/bundles/bd_02', 'patch')
    await userEvent.click(radio(/마감 하루 전/))
    await waitFor(() => expectLocked(radio(/마감 하루 전/)))
    expect(radio(/직접 정하기/)).toBeChecked()
    expectLocked(button('이대로 발송'))
    expect(document.activeElement).toBe(radio(/마감 하루 전/))

    act(() => request.resolve())
    await waitFor(() => expect(radio(/마감 하루 전/)).toBeChecked())
    expectUnlocked(radio(/마감 하루 전/))
    expect(detail().getByText('09/29 09:00 예정')).toBeInTheDocument()
    expect(radio('직접 정하기날짜 · 시각')).not.toBeChecked()
    expect(Date.parse(bundleOf('bd_02').scheduled_at)).toBe(Date.parse('2026-09-29T09:00:00+09:00'))
  })

  it('저장이 늦을 때만 그 카드에 저장 중이 보인다 — 저장되면 사라진다', async () => {
    await openBundle('bd_02')
    const request = hold('/workspaces/ws_01/messages/bundles/bd_02', 'patch')
    await userEvent.click(radio(/마감 하루 전/))
    const timing = detail().getByRole('group', { name: '언제 보낼까요?' })
    expect(detail().queryByText('저장 중')).toBeNull()
    await waitFor(() => expect(timing).toHaveAttribute('aria-busy', 'true'))

    const card = radio(/마감 하루 전/).closest('label')
    if (card === null) throw new Error('send timing card label is missing')
    expect(await within(card).findByText('저장 중')).toBeVisible()

    act(() => request.resolve())
    await waitFor(() => expect(radio(/마감 하루 전/)).toBeChecked())
    expect(detail().queryByText('저장 중')).toBeNull()
    expect(timing).not.toHaveAttribute('aria-busy')
  })

  it('직접 정하기는 시각을 정해야 저장한다 — 지난 시각은 알리고, 정한 시각이 카드와 미리보기에 보인다', async () => {
    await openBundle()
    await userEvent.click(radio(/직접 정하기/))
    const input = detail().getByLabelText('보낼 날짜와 시각')
    expect(input).toHaveValue('2026-09-19T09:00')

    const request = hold(BUNDLE_PATH, 'patch')
    fireEvent.change(input, { target: { value: '2026-09-17T09:00' } })
    await userEvent.click(button('이 시각으로 정하기'))
    expect(detail().getByText('지금 이후의 날짜와 시각을 골라 주세요.')).toBeVisible()
    expect(request.calls()).toBe(0)

    fireEvent.change(input, { target: { value: '2026-09-25T14:30' } })
    await userEvent.click(button('이 시각으로 정하기'))
    act(() => request.resolve())
    await waitFor(() => expect(detail().queryByLabelText('보낼 날짜와 시각')).toBeNull())
    expect(radio('직접 정하기09/25 14:30')).toBeChecked()
    expect(detail().getByText('09/25 14:30 예정')).toBeInTheDocument()
    expect(document.activeElement).toBe(radio('직접 정하기09/25 14:30'))
  })

  it('저장한 직접 정하기 시각은 그 카드를 다시 눌러 고칠 수 있다 — 마우스와 Space 모두', async () => {
    await openBundle('bd_02')
    await userEvent.click(radio(/직접 정하기/))
    expect(detail().getByLabelText('보낼 날짜와 시각')).toHaveValue('2026-09-25T14:00')
    await userEvent.click(button('취소'))
    expect(detail().queryByLabelText('보낼 날짜와 시각')).toBeNull()

    expect(document.activeElement).toBe(radio(/직접 정하기/))
    await userEvent.keyboard(' ')
    expect(detail().getByLabelText('보낼 날짜와 시각')).toHaveValue('2026-09-25T14:00')
  })

  it('직접 정하기를 연 동안에는 이대로 발송·보내지 않음·고쳐 쓰기가 잠기고, 취소하면 풀린다', async () => {
    await openBundle()
    const approve = hold(`${BUNDLE_PATH}/approve`, 'post')
    await userEvent.click(radio(/직접 정하기/))
    expect(radio(/직접 정하기/)).toBeChecked()

    const hint = '정한 시각을 저장하거나 취소한 뒤에 보낼 수 있어요.'
    expect(detail().getByText(hint)).toBeVisible()
    for (const name of ['이대로 발송', '보내지 않음']) {
      expectLocked(button(name))
      expect(button(name)).toHaveAccessibleDescription(hint)
    }
    expectLocked(button('고쳐 쓰기'))
    await userEvent.click(button('이대로 발송'))
    expect(approve.calls()).toBe(0)

    await userEvent.click(button('취소'))
    expect(radio(/마감 하루 전/)).toBeChecked()
    expect(detail().queryByText(hint)).toBeNull()
    expectUnlocked(button('이대로 발송'))
    expect(document.activeElement).toBe(radio(/직접 정하기/))
  })

  it('화살표 키는 카드 사이를 옮겨 다닐 뿐 저장하지 않는다 — Space 로 골라야 저장한다', async () => {
    await openBundle('bd_02')
    const request = hold('/workspaces/ws_01/messages/bundles/bd_02', 'patch')
    act(() => radio(/직접 정하기/).focus())

    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(radio(/마감 하루 전/))
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(radio(/직접 정하기/))
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(radio(/마감 하루 전/))
    expect(detail().queryByLabelText('보낼 날짜와 시각')).toBeNull()
    expect(request.calls()).toBe(0)

    await userEvent.keyboard(' ')
    await waitFor(() => expect(request.calls()).toBe(1))
    act(() => request.resolve())
    await waitFor(() => expect(radio(/마감 하루 전/)).toBeChecked())
  })

  it('바꾸지 못하면 원래 카드가 골라진 채로 알린다', async () => {
    db.messageFailures.actions = true
    await openBundle('bd_02')
    await userEvent.click(radio(/마감 하루 전/))
    const alert = await detail().findByRole('alert')
    expect(alert).toHaveTextContent('보낼 시각을 바꾸지 못했어요')
    expect(radio(/직접 정하기/)).toBeChecked()
  })
})

describe('예정 시각이 지난 묶음', () => {
  const passedCard = () => radio(/마감 하루 전/)

  async function openPassed() {
    applyScenario('messages-schedule-passed')
    await openBundle('bd_06')
  }

  async function chooseCustom(value: string) {
    await userEvent.click(radio(/직접 정하기/))
    fireEvent.change(detail().getByLabelText('보낼 날짜와 시각'), { target: { value } })
    await userEvent.click(button('이 시각으로 정하기'))
    await waitFor(() => expect(detail().queryByLabelText('보낼 날짜와 시각')).toBeNull())
  }

  it('승인은 거절되고 시각을 다시 고르기 전에는 잠긴다 — 새 시각을 정하면 승인된다', async () => {
    await openPassed()
    expect(passedCard()).toBeDisabled()
    expect(passedCard()).toBeChecked()
    expect(detail().getByText('09/17 09:00 · 지남')).toBeVisible()

    const before = structuredClone(db.messageBundles)
    await userEvent.click(button('이대로 발송'))
    const alert = await detail().findByRole('alert')
    expect(alert).toHaveTextContent('예정 시각이 지났어요')
    expect(alert).toHaveTextContent('보내려던 시각이 이미 지났어요. 언제 보낼지 다시 골라 주세요.')
    expect(within(alert).queryByRole('button', { name: '다시 시도' })).toBeNull()
    expectLocked(button('이대로 발송'))
    const lockLine = detail().getByText('보낼 시각을 다시 고른 뒤에 승인할 수 있어요.')
    expect(alert.compareDocumentPosition(lockLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(db.messageBundles).toEqual(before)

    await chooseCustom('2026-09-19T09:00')
    expect(detail().queryByRole('alert')).toBeNull()
    expectUnlocked(button('이대로 발송'))
    await userEvent.click(button('이대로 발송'))
    expect(await screen.findByText('09/19 09:00에 이재환님에게 보낼게요')).toBeInTheDocument()
  })

  it('문구를 고치거나 시각 저장이 실패하거나 다른 묶음을 다녀와도 승인은 잠겨 있다', async () => {
    await openPassed()
    await userEvent.click(button('이대로 발송'))
    expect(await detail().findByRole('alert')).toHaveTextContent('예정 시각이 지났어요')

    await userEvent.click(button('고쳐 쓰기'))
    await userEvent.type(detail().getByRole('textbox', { name: '보낼 문구' }), '!')
    await userEvent.click(detail().getByRole('button', { name: '저장' }))
    await waitFor(() => expect(button('고쳐 쓰기')).toBeVisible())
    expect(detail().getByRole('alert')).toHaveTextContent('예정 시각이 지났어요')
    expectLocked(button('이대로 발송'))

    db.messageFailures.actions = true
    await userEvent.click(radio(/직접 정하기/))
    fireEvent.change(detail().getByLabelText('보낼 날짜와 시각'), {
      target: { value: '2026-09-19T09:00' },
    })
    await userEvent.click(button('이 시각으로 정하기'))
    await waitFor(() => expect(detail().getByText('보낼 시각을 바꾸지 못했어요')).toBeVisible())
    await userEvent.click(button('취소'))
    expect(detail().getByText('예정 시각이 지났어요')).toBeVisible()
    expectLocked(button('이대로 발송'))
    db.messageFailures.actions = false

    await userEvent.click(within(reviewList()).getByRole('link', { name: /정하늘/ }))
    expect(
      await detail().findByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' }),
    ).toBeVisible()
    expect(detail().queryByText('예정 시각이 지났어요')).toBeNull()
    await userEvent.click(within(reviewList()).getAllByRole('link', { name: /이재환/ })[0])
    expect(await detail().findByText('09/17 09:00 · 지남')).toBeVisible()
    expect(detail().getByRole('alert')).toHaveTextContent('예정 시각이 지났어요')
    expectLocked(button('이대로 발송'))
  })

  it('대화에서도 지난 묶음은 지남으로 보인다', async () => {
    applyScenario('messages-schedule-passed')
    renderApp(paths.messageThread('ws_01', 'th_01'))
    await screen.findByRole('heading', { level: 2, name: '이재환' })
    expect(within(conversation()).getByText('09/17 09:00 발송 예정 · 지남')).toBeVisible()
  })
})

describe('보낼 시각을 같은 사람의 다른 묶음 시각으로 옮기면 합친 묶음으로 옮겨 간다', () => {
  const MERGED =
    '같은 시각의 메시지와 합쳤어요. 내용이 바뀌어 승인이 풀렸으니 다시 확인하고 승인해 주세요.'

  async function openMergeSource() {
    applyScenario('messages-merge')
    return openBundle('bd_07')
  }

  it('합친 묶음이 골라지고 승인이 풀렸다고 알린다 — 없어진 묶음의 주소는 바꿔 끼운다', async () => {
    const app = await openMergeSource()
    expect(rowTexts(reviewList())).toHaveLength(3)
    await userEvent.click(radio(/마감 하루 전/))

    await app.expectSearch('?review=bd_01')
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(await detail().findByRole('heading', { level: 3, name: '묶은 태스크 2' })).toBeVisible()
    expect(detail().getByRole('heading', { level: 2 })).toHaveTextContent('이 메시지, 보낼까요?')
    expect(detail().getByRole('button', { name: '이대로 발송' })).toBeVisible()
    expect(detail().getByText('ERD 정리')).toBeVisible()
    expect(await screen.findByText(MERGED)).toBeInTheDocument()
    expect(rowTexts(reviewList())).toHaveLength(2)
    expect(current()[0]).toHaveTextContent('이재환')
    expect(document.activeElement).toBe(detailPane())
    expect(bundleOf('bd_07').status).toBe('cancelled')
    expect(bundleOf('bd_01')).toMatchObject({ approved: false, approved_at: null })
    expect(bundleOf('bd_01').reminders.map(({ reminder_id }) => reminder_id)).toEqual([
      'rm_01',
      'rm_07',
    ])
  })

  it('겹치지 않는 시각으로 옮기면 그 묶음에 머물고 합쳤다고 알리지 않는다', async () => {
    const app = await openMergeSource()
    await userEvent.click(radio(/직접 정하기/))
    fireEvent.change(detail().getByLabelText('보낼 날짜와 시각'), {
      target: { value: '2026-09-22T10:00' },
    })
    await userEvent.click(button('이 시각으로 정하기'))
    await waitFor(() => expect(radio('직접 정하기09/22 10:00')).toBeChecked())

    expect(document.activeElement).toBe(radio('직접 정하기09/22 10:00'))
    await app.expectSearch('?review=bd_07')
    expect(rowTexts(reviewList())).toHaveLength(3)
    expect(screen.queryByText(MERGED)).toBeNull()
    expect(bundleOf('bd_01')).toMatchObject({ approved: true })
  })

  it('문구와 시각을 한 요청에 같이 보내지 않는다 — 문구를 고치는 동안에는 시각을 고를 수 없다', async () => {
    await openMergeSource()
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_01/messages/bundles/bd_07')
    await userEvent.click(button('고쳐 쓰기'))
    expectLocked(radio(/마감 하루 전/))
    expectLocked(radio(/직접 정하기/))
    await userEvent.click(radio(/마감 하루 전/))
    expect(radio(/직접 정하기/)).toBeChecked()

    const field = detail().getByRole('textbox', { name: '보낼 문구' })
    await userEvent.clear(field)
    await userEvent.type(field, '재환님, ERD 정리 어디까지 됐나요?')
    await userEvent.click(button('저장'))
    await waitFor(() => expect(detail().queryByRole('textbox')).toBeNull())
    expectUnlocked(radio(/마감 하루 전/))

    await userEvent.click(radio(/마감 하루 전/))
    expect(await screen.findByText(MERGED)).toBeInTheDocument()
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies).toEqual([
      { body: '재환님, ERD 정리 어디까지 됐나요?' },
      { scheduled_at: '2026-09-23T09:00:00+09:00' },
    ])
  })
})
