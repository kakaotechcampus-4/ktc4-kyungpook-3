import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { applyScenario } from '@/shared/mock/scenarios'
import { recordRequests } from '@/shared/test/requests'
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
 * M8 메시지 — 보내기 전 확인 항목의 행동 (결정 4 의 UI 범위는 디자인 캔버스 기준 MSW 목, 계획 C-5).
 * 모든 행동은 서버(MSW)가 성공한 뒤에만 화면을 바꾼다 — 응답을 붙잡아 「응답 전에는 그대로」와 중복 제출 방지를 본다 (D-137).
 * 실패는 그 자리의 role=alert 와 다시 시도로 알린다
 */
vi.mock('@/shared/config/env', () => ({
  config: { apiBaseUrl: '/api/v1', mswEnabled: true },
}))

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

const REVIEW_PATH = '/workspaces/ws_01/messages/reviews/rv_01'

async function openReview(reviewId = 'rv_01') {
  const app = renderApp(paths.messageReview('ws_01', reviewId))
  await screen.findByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })
  return app
}
const button = (name: string) => detail().getByRole('button', { name })
const radio = (name: RegExp | string) => detail().getByRole('radio', { name })
const detailPane = () => screen.getByRole('region', { name: '메시지 내용' })
/* 행동 잠금은 disabled 가 아니라 aria-disabled 다 — 누른 버튼·카드에서 포커스가 빠지지 않는다 (VR-03·VR-04) */
const expectLocked = (element: HTMLElement) =>
  expect(element).toHaveAttribute('aria-disabled', 'true')
const expectUnlocked = (element: HTMLElement) =>
  expect(element).not.toHaveAttribute('aria-disabled')

describe('이대로 발송 — 서버가 성공한 뒤에만 목록과 대화가 바뀐다', () => {
  it('응답 전에는 목록·상세가 그대로이고 행동이 모두 잠겨 두 번 눌러도 한 번만 보낸다', async () => {
    const app = await openReview()
    const request = hold(`${REVIEW_PATH}/send`, 'post')
    await userEvent.click(button('이대로 발송'))

    await waitFor(() => expect(button('이대로 발송')).toHaveAttribute('aria-busy', 'true'))
    expectLocked(button('이대로 발송'))
    expectLocked(button('보내지 않음'))
    expectLocked(button('고쳐 쓰기'))
    expectLocked(radio(/지금 바로/))
    // 응답을 기다리는 동안에도 누른 버튼에 포커스가 남는다
    expect(document.activeElement).toBe(button('이대로 발송'))
    // 낙관적으로 빼지 않는다
    expect(rowTexts(reviewList())).toHaveLength(2)
    await userEvent.click(button('이대로 발송'))
    expect(request.calls()).toBe(1)

    act(() => request.resolve())
    // 시각이 있으면 항목은 예정으로 남는다. 주소만 목록으로 바꿔 끼운다
    await app.expectSearch('')
    await waitFor(() => expect(rowTexts(reviewList())[0]).toContain('09/23 발송 예정'))
    expect(rowTexts(reviewList())).toHaveLength(2)
    expect(within(reviewList()).getByRole('heading')).toHaveTextContent('보내기 전 확인 2')
    expect(current()[0]).toHaveTextContent('정하늘')
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(document.activeElement).toBe(detailPane())
    expect(await screen.findByText('09/23 09:00에 이재환님에게 보낼게요')).toBeInTheDocument()
    expect(detail().getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })).toBeVisible()
    expect(button('이대로 발송')).toBeVisible()
  })

  it('시각을 정해 둔 발송은 예정으로 남고, 확인하기에서 본 뒤 지금 바로로 되돌리면 다시 보낼 수 있다', async () => {
    await openReview()
    await userEvent.click(button('이대로 발송'))
    await waitFor(() => expect(rowTexts(reviewList())[0]).toContain('09/23 발송 예정'))
    await waitFor(() =>
      expect(
        detail().getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' }),
      ).toBeVisible(),
    )
    expect(current()[0]).toHaveTextContent('정하늘')

    await userEvent.click(within(threadList()).getByRole('link', { name: /이재환/ }))
    await detail().findByRole('heading', { level: 2, name: '이재환' })
    const upcoming = within(conversation()).getByRole('list', { name: '아직 나가지 않은 메시지' })
    expect(upcoming).toHaveTextContent('09/23 09:00 발송 예정 · 최진호 승인')
    expect(within(upcoming).queryByRole('button')).toBeNull()
    const confirm = within(upcoming).getByRole('link', { name: '확인하기' })
    expect(confirm).toHaveAttribute('href', paths.messageReview('ws_01', 'rv_01'))
    expect(detail().getByText(/메시지는 항상/)).toHaveTextContent(
      '메시지는 항상 카테캠 3팀 봇이 보냅니다. 승인·고쳐 쓰기·보내지 않음은 보내기 전 확인에서 해요.',
    )

    await userEvent.click(confirm)
    expect(
      await detail().findByRole('heading', { level: 2, name: '보낼 예정인 메시지예요' }),
    ).toBeVisible()
    expect(detail().queryByRole('button', { name: '이대로 발송' })).toBeNull()
    await userEvent.click(radio(/지금 바로/))
    expect(
      await detail().findByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' }),
    ).toBeVisible()
    expect(button('이대로 발송')).toBeEnabled()
  })

  it('미리 받아 둔 대화도 발송 뒤에는 무효화돼 다시 가리키면 새로 받고, 고르면 보낸 메시지가 보인다', async () => {
    await openReview()
    const log = recordRequests()
    const thread = () => within(threadList()).getByRole('link', { name: /이재환/ })
    const threadRequests = () =>
      log.started.filter(({ path }) => path === '/workspaces/ws_01/messages/threads/th_01')

    await userEvent.hover(thread())
    await waitFor(() => expect(threadRequests()).toHaveLength(1))
    await userEvent.unhover(thread())
    await userEvent.click(button('이대로 발송'))
    await waitFor(() => expect(rowTexts(reviewList())[0]).toContain('09/23 발송 예정'))
    // 보이지 않는 대화는 무효화 때 바로 다시 받지 않는다 — 다시 가리킬 때 staleTime 안이어도 새로 받는다
    expect(threadRequests()).toHaveLength(1)

    await userEvent.hover(thread())
    await waitFor(() => expect(threadRequests()).toHaveLength(2))
    await userEvent.click(thread())
    const upcoming = await within(conversation()).findByRole('list', {
      name: '아직 나가지 않은 메시지',
    })
    expect(upcoming).toHaveTextContent('09/23 09:00 발송 예정 · 최진호 승인')
  })

  it('지금 바로 보내면 대화의 마지막 메시지가 되고 그 대화가 목록 맨 위로 온다', async () => {
    await openReview('rv_02')
    await userEvent.click(button('이대로 발송'))
    expect(await screen.findByText('정하늘님에게 메시지를 보냈어요')).toBeInTheDocument()
    await waitFor(() =>
      expect(rowTexts(threadList())[0]).toBe(
        '정하늘나: 하늘님, 퍼블리싱은 어디까지 진행됐는지 알려주실 수 있을까요? 🙏09/18답장 기다리는 중',
      ),
    )
  })

  it('실패하면 그 자리에 다시 시도를 알리고 화면은 그대로다 — 다시 시도가 성공하면 반영된다', async () => {
    db.messageFailures.actions = true
    await openReview()
    await userEvent.click(button('이대로 발송'))
    const alert = await detail().findByRole('alert')
    expect(alert).toHaveTextContent('메시지를 보내지 못했어요')
    expect(alert).toHaveTextContent('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.')
    expect(rowTexts(reviewList())).toHaveLength(2)
    expect(current()[0]).toHaveTextContent('이재환')
    expectUnlocked(button('이대로 발송'))
    // 실패해도 포커스는 누른 버튼에 그대로다 — 알림은 role=alert 로 읽힌다
    expect(document.activeElement).toBe(button('이대로 발송'))
    expect(screen.queryByText(/보낼게요|보냈어요/)).toBeNull()

    db.messageFailures.actions = false
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    await waitFor(() =>
      expect(
        detail().getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' }),
      ).toBeVisible(),
    )
    expect(rowTexts(reviewList())[0]).toContain('09/23 발송 예정')
    expect(current()[0]).toHaveTextContent('정하늘')
    expect(rowTexts(reviewList())).toHaveLength(2)
    expect(detail().queryByRole('alert')).toBeNull()
  })

  it('다른 곳에서 이미 처리한 항목이면 다시 시도 대신 목록을 새로 받게 한다', async () => {
    await openReview()
    db.messageReviews = db.messageReviews.filter(({ review_id }) => review_id !== 'rv_01')
    await userEvent.click(button('이대로 발송'))
    const alert = await detail().findByRole('alert')
    expect(alert).toHaveTextContent('메시지를 보내지 못했어요')
    expect(alert).toHaveTextContent(
      '이미 처리했거나 사라진 메시지예요. 목록을 새로 받아 다시 확인해 주세요.',
    )
    expect(within(alert).queryByRole('button', { name: '다시 시도' })).toBeNull()
    await userEvent.click(within(alert).getByRole('button', { name: '목록 새로 받기' }))
    await waitFor(() => expect(rowTexts(reviewList())).toHaveLength(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('보내지 않음', () => {
  it('항목은 목록에서 빠지고 대화에는 오늘 취소됨으로 남는다', async () => {
    const app = await openReview()
    const request = hold(`${REVIEW_PATH}/dismiss`, 'post')
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
    const today = await detail().findByRole('heading', { level: 3, name: /오늘/ })
    expect(today).toBeVisible()
    expect(conversation()).toHaveTextContent('봇(취소됨):')
    expect(detail().getByText('09:00 · 취소됨')).toBeVisible()
  })
})

describe('고쳐 쓰기', () => {
  it('고친 문구는 서버가 저장한 뒤에 미리보기에 보이고, 고치는 동안에는 보낼 수 없다', async () => {
    await openReview()
    await userEvent.click(button('고쳐 쓰기'))
    const field = detail().getByRole('textbox', { name: '보낼 문구' })
    expect(field).toHaveValue(
      '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂\n혹시 막히는 부분 있으면 알려주세요. 필요하면 마감을 옮겨도 괜찮아요!',
    )
    // 문구 칸이 열리면 바로 고칠 수 있게 포커스가 그 칸으로 간다
    expect(document.activeElement).toBe(field)
    expectLocked(button('이대로 발송'))
    expectLocked(button('보내지 않음'))
    expect(detail().getByText('고친 문구를 저장하거나 취소한 뒤에 보낼 수 있어요.')).toBeVisible()
    expect(button('이대로 발송')).toHaveAccessibleDescription(
      '고친 문구를 저장하거나 취소한 뒤에 보낼 수 있어요.',
    )

    await userEvent.clear(field)
    await userEvent.type(field, '재환님, 명세서 진행 상황 알려 주세요 🙂')
    const request = hold(REVIEW_PATH, 'patch')
    await userEvent.click(button('저장'))
    await waitFor(() => expect(button('저장')).toHaveAttribute('aria-busy', 'true'))
    expect(field).toBeDisabled()
    expect(document.activeElement).toBe(button('저장'))

    act(() => request.resolve())
    await waitFor(() => expect(detail().queryByRole('textbox')).toBeNull())
    expect(detail().getByRole('region', { name: '보낼 메시지 미리보기' })).toHaveTextContent(
      '재환님, 명세서 진행 상황 알려 주세요 🙂',
    )
    // 문구 칸이 닫히면 포커스는 연 자리(고쳐 쓰기)로 돌아간다
    expect(document.activeElement).toBe(button('고쳐 쓰기'))
    expectUnlocked(button('이대로 발송'))
    expect(db.messageReviews[0].body).toBe('재환님, 명세서 진행 상황 알려 주세요 🙂')
  })

  it('빈 문구는 보내지 않고 그 자리에서 알린다. 취소하면 원래 문구 그대로다', async () => {
    await openReview()
    await userEvent.click(button('고쳐 쓰기'))
    const field = detail().getByRole('textbox', { name: '보낼 문구' })
    await userEvent.clear(field)
    const request = hold(REVIEW_PATH, 'patch')
    await userEvent.click(button('저장'))
    expect(detail().getByText('보낼 문구를 입력해 주세요.')).toBeVisible()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(request.calls()).toBe(0)

    await userEvent.click(button('취소'))
    expect(detail().getByRole('region', { name: '보낼 메시지 미리보기' })).toHaveTextContent(
      '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂',
    )
    expect(document.activeElement).toBe(button('고쳐 쓰기'))
  })

  it('저장에 실패하면 고치던 문구를 그대로 두고 알린다', async () => {
    db.messageFailures.actions = true
    await openReview()
    await userEvent.click(button('고쳐 쓰기'))
    const field = detail().getByRole('textbox', { name: '보낼 문구' })
    await userEvent.clear(field)
    await userEvent.type(field, '고친 문구')
    await userEvent.click(button('저장'))
    expect(await detail().findByRole('alert')).toHaveTextContent('고친 문구를 저장하지 못했어요')
    expect(detail().getByRole('textbox', { name: '보낼 문구' })).toHaveValue('고친 문구')
    expect(document.activeElement).toBe(button('저장'))
    expect(db.messageReviews[0].body).not.toBe('고친 문구')
  })
})

describe('언제 보낼까요? — 고른 카드는 서버가 저장한 값이다', () => {
  it('지금 바로를 누르면 응답 전에는 그대로이고, 저장되면 카드와 미리보기 시각이 바뀐다', async () => {
    await openReview()
    const request = hold(REVIEW_PATH, 'patch')
    await userEvent.click(radio(/지금 바로/))
    await waitFor(() => expectLocked(radio(/지금 바로/)))
    expect(radio(/마감 하루 전/)).toBeChecked()
    expectLocked(button('이대로 발송'))
    // 저장을 기다리는 동안 카드에서 포커스가 빠지지 않는다
    expect(document.activeElement).toBe(radio(/지금 바로/))

    act(() => request.resolve())
    await waitFor(() => expect(radio(/지금 바로/)).toBeChecked())
    expect(document.activeElement).toBe(radio(/지금 바로/))
    expectUnlocked(radio(/지금 바로/))
    expect(detail().getByText('바로 발송')).toBeInTheDocument()
    expect(db.messageReviews[0]).toMatchObject({ send_timing: 'now', scheduled_at: null })
  })

  it('저장이 늦을 때만 그 카드에 저장 중이 보인다 — 짧은 저장에서는 번쩍이지 않고, 저장되면 사라진다', async () => {
    await openReview()
    const request = hold(REVIEW_PATH, 'patch')
    await userEvent.click(radio(/지금 바로/))
    const timing = detail().getByRole('group', { name: '언제 보낼까요?' })
    expect(detail().queryByText('저장 중')).toBeNull()
    await waitFor(() => expect(timing).toHaveAttribute('aria-busy', 'true'))

    const card = radio(/지금 바로/).closest('label')
    if (card === null) throw new Error('send timing card label is missing')
    expect(await within(card).findByText('저장 중')).toBeVisible()
    expect(detail().getAllByText('저장 중')).toHaveLength(1)

    act(() => request.resolve())
    await waitFor(() => expect(radio(/지금 바로/)).toBeChecked())
    expect(detail().queryByText('저장 중')).toBeNull()
    expect(timing).not.toHaveAttribute('aria-busy')
  })

  it('직접 정하기는 시각을 정해야 저장한다 — 지난 시각은 알리고, 정한 시각이 카드와 미리보기에 보인다', async () => {
    await openReview()
    await userEvent.click(detail().getByRole('radio', { name: /직접 정하기/ }))
    const input = detail().getByLabelText('보낼 날짜와 시각')
    expect(input).toHaveValue('2026-09-19T09:00')
    expect(db.messageReviews[0].send_timing).toBe('day_before_deadline')

    const request = hold(REVIEW_PATH, 'patch')
    // datetime-local 은 글자를 하나씩 치는 입력이 아니라 값이 한 번에 바뀐다
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
    // 시각 칸이 닫히면 포커스는 직접 정하기 카드로 돌아간다
    expect(document.activeElement).toBe(radio('직접 정하기09/25 14:30'))
  })

  it('저장한 직접 정하기 시각은 그 카드를 다시 눌러 고칠 수 있다 — 마우스와 Space 모두', async () => {
    await openReview()
    await userEvent.click(radio(/직접 정하기/))
    fireEvent.change(detail().getByLabelText('보낼 날짜와 시각'), {
      target: { value: '2026-09-25T14:30' },
    })
    await userEvent.click(button('이 시각으로 정하기'))
    await waitFor(() => expect(detail().queryByLabelText('보낼 날짜와 시각')).toBeNull())

    // 이미 골라진 라디오는 change 를 내지 않는다 — 누름(click)으로 다시 연다
    await userEvent.click(radio(/직접 정하기/))
    expect(detail().getByLabelText('보낼 날짜와 시각')).toHaveValue('2026-09-25T14:30')
    await userEvent.click(button('취소'))
    expect(detail().queryByLabelText('보낼 날짜와 시각')).toBeNull()

    expect(document.activeElement).toBe(radio(/직접 정하기/))
    await userEvent.keyboard(' ')
    expect(detail().getByLabelText('보낼 날짜와 시각')).toHaveValue('2026-09-25T14:30')
  })

  it('직접 정하기를 연 동안에는 이대로 발송·보내지 않음·고쳐 쓰기가 잠기고, 취소하면 풀린다', async () => {
    // 서버 값은 지금 바로다. 시각 칸을 연 채로 보내면 화면에 골라진 시점(직접 정하기)과 다르게 바로 나간다
    await openReview('rv_02')
    const send = hold('/workspaces/ws_01/messages/reviews/rv_02/send', 'post')
    const dismiss = hold('/workspaces/ws_01/messages/reviews/rv_02/dismiss', 'post')
    await userEvent.click(radio(/직접 정하기/))
    fireEvent.change(detail().getByLabelText('보낼 날짜와 시각'), {
      target: { value: '2026-09-25T14:30' },
    })
    expect(radio(/직접 정하기/)).toBeChecked()

    const hint = '정한 시각을 저장하거나 취소한 뒤에 보낼 수 있어요.'
    expect(detail().getByText(hint)).toBeVisible()
    for (const name of ['이대로 발송', '보내지 않음']) {
      expectLocked(button(name))
      expect(button(name)).toHaveAccessibleDescription(hint)
    }
    expectLocked(button('고쳐 쓰기'))
    await userEvent.click(button('이대로 발송'))
    await userEvent.click(button('보내지 않음'))
    await userEvent.click(button('고쳐 쓰기'))
    expect(send.calls()).toBe(0)
    expect(dismiss.calls()).toBe(0)
    expect(detail().queryByRole('textbox', { name: '보낼 문구' })).toBeNull()

    await userEvent.click(button('취소'))
    expect(radio(/지금 바로/)).toBeChecked()
    expect(detail().queryByText(hint)).toBeNull()
    expectUnlocked(button('이대로 발송'))
    expectUnlocked(button('보내지 않음'))
    expectUnlocked(button('고쳐 쓰기'))
    expect(document.activeElement).toBe(radio(/직접 정하기/))
  })

  it('화살표 키는 카드 사이를 옮겨 다닐 뿐 저장하지 않는다 — Space 로 골라야 저장한다', async () => {
    await openReview()
    const request = hold(REVIEW_PATH, 'patch')
    act(() => radio(/마감 하루 전/).focus())

    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(radio(/지금 바로/))
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(radio(/직접 정하기/))
    expect(detail().queryByLabelText('보낼 날짜와 시각')).toBeNull()
    // 끝에서는 처음으로 돈다. 왼쪽·위·아래도 같다
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(radio(/마감 하루 전/))
    await userEvent.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(radio(/직접 정하기/))
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(radio(/지금 바로/))
    expect(radio(/마감 하루 전/)).toBeChecked()
    expect(request.calls()).toBe(0)

    await userEvent.keyboard(' ')
    await waitFor(() => expect(request.calls()).toBe(1))
    act(() => request.resolve())
    await waitFor(() => expect(radio(/지금 바로/)).toBeChecked())
    expect(document.activeElement).toBe(radio(/지금 바로/))
  })

  it('화살표 키는 고를 수 없는 카드(마감 없음)를 건너뛴다', async () => {
    await openReview('rv_02')
    act(() => radio(/지금 바로/).focus())
    await userEvent.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(radio(/직접 정하기/))
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(radio(/지금 바로/))
  })

  it('바꾸지 못하면 원래 카드가 골라진 채로 알린다', async () => {
    db.messageFailures.actions = true
    await openReview()
    await userEvent.click(detail().getByRole('radio', { name: /지금 바로/ }))
    const alert = await detail().findByRole('alert')
    expect(alert).toHaveTextContent('발송 시점을 바꾸지 못했어요')
    expect(detail().getByRole('radio', { name: /마감 하루 전/ })).toBeChecked()
  })
})

describe('예정 시각이 지난 재촉', () => {
  it('발송은 거절되고, 시각을 지금 바로로 고르면 보낼 수 있다', async () => {
    applyScenario('messages-schedule-passed')
    await openReview('rv_06')
    const passed = detail().getByRole('radio', { name: /마감 하루 전/ })
    expect(passed).toBeDisabled()
    expect(passed).toBeChecked()
    expect(detail().getByText('09/17 09:00 · 지남')).toBeVisible()

    const before = structuredClone(db.messageReviews)
    await userEvent.click(button('이대로 발송'))
    const alert = await detail().findByRole('alert')
    expect(alert).toHaveTextContent('예정 시각이 지났어요')
    expect(alert).toHaveTextContent('보내려던 시각이 이미 지났어요. 언제 보낼지 다시 골라 주세요.')
    expect(within(alert).queryByRole('button', { name: '다시 시도' })).toBeNull()
    expectLocked(button('이대로 발송'))
    const lockLine = detail().getByText('보낼 시각을 다시 고른 뒤에 보낼 수 있어요.')
    expect(lockLine).toBeVisible()
    expect(alert.compareDocumentPosition(lockLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(button('이대로 발송')).toHaveAttribute('aria-describedby')
    expect(rowTexts(reviewList())).toHaveLength(3)
    expect(db.messageReviews).toEqual(before)

    await userEvent.click(radio(/지금 바로/))
    await waitFor(() => expect(radio(/지금 바로/)).toBeChecked())
    expect(detail().queryByRole('alert')).toBeNull()
    expectUnlocked(button('이대로 발송'))

    await userEvent.click(button('이대로 발송'))
    expect(await screen.findByText('이재환님에게 메시지를 보냈어요')).toBeInTheDocument()
    await waitFor(() => expect(rowTexts(reviewList())).toHaveLength(2))
    expect(reviewList()).not.toHaveTextContent('지난 예약 재촉')
  })

  it('문구를 고치거나 시각 저장이 실패하거나 다른 항목을 다녀와도 발송은 잠겨 있다', async () => {
    applyScenario('messages-schedule-passed')
    await openReview('rv_06')
    await userEvent.click(button('이대로 발송'))
    expect(await detail().findByRole('alert')).toHaveTextContent('예정 시각이 지났어요')

    await userEvent.click(button('고쳐 쓰기'))
    await userEvent.type(detail().getByRole('textbox', { name: '보낼 문구' }), '!')
    await userEvent.click(detail().getByRole('button', { name: '저장' }))
    await waitFor(() => expect(button('고쳐 쓰기')).toBeVisible())
    expect(detail().getByText(/재환님, 어제/)).toHaveTextContent('!')
    expect(detail().getByRole('alert')).toHaveTextContent('예정 시각이 지났어요')
    expectLocked(button('이대로 발송'))
    expect(detail().getByText('보낼 시각을 다시 고른 뒤에 보낼 수 있어요.')).toBeVisible()

    db.messageFailures.actions = true
    await userEvent.click(radio(/지금 바로/))
    await waitFor(() => expect(detail().getByText('발송 시점을 바꾸지 못했어요')).toBeVisible())
    expect(detail().getByText('예정 시각이 지났어요')).toBeVisible()
    expectLocked(button('이대로 발송'))
    db.messageFailures.actions = false

    await userEvent.click(within(reviewList()).getByRole('link', { name: /정하늘/ }))
    expect(
      await detail().findByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' }),
    ).toBeVisible()
    expect(detail().queryByText('예정 시각이 지났어요')).toBeNull()
    await userEvent.click(within(reviewList()).getByRole('link', { name: /지난 예약/ }))
    expect(await detail().findByText('09/17 09:00 · 지남')).toBeVisible()
    expect(detail().getByRole('alert')).toHaveTextContent('예정 시각이 지났어요')
    expectLocked(button('이대로 발송'))
  })
})
