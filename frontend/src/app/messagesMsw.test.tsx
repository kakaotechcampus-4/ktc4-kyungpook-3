import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import {
  conversation,
  current,
  detail,
  hold,
  list,
  readable,
  reviewList,
  rowTexts,
  threadList,
} from './test/messageScreen'
import { renderApp } from './test/renderApp'

/*
 * M8 메시지 (계획 C-6 1~6단계, AC-01 ~ AC-07 — 화면은 디자인 캔버스 기준). 개발 서버 + VITE_ENABLE_MSW=true 를 흉내낸다 —
 * 이 파일 안에서만 설정을 바꾼다. 실 API 모드의 준비 중 안내는 라우트·가드·앱 셸 테스트가 그대로 본다 (AC-01).
 * 보내기 전 확인 항목의 행동(발송·보내지 않음·고쳐 쓰기·발송 시점·승인·반려)은 messagesActionsMsw.test.tsx 가 본다
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

async function openInbox(path = paths.messages('ws_01')) {
  const app = renderApp(path)
  await screen.findByRole('region', { name: '대화' })
  return app
}

describe('MSW 모드에서만 새 화면이다 (AC-01)', () => {
  it.each([
    paths.messages('ws_01'),
    paths.messageThread('ws_01', 'th_01'),
    `${paths.messages('ws_01')}/nope`,
  ])('%s 는 준비 중 안내 대신 메시지 화면이다', async (path) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: '메시지' })).toBeInTheDocument()
    expect(screen.queryByText('메시지는 준비 중이에요')).toBeNull()
  })
})

describe('왼쪽 목록 두 영역과 오른쪽 상세의 2단이고, 선택은 URL 이 정한다 (AC-02)', () => {
  it('보내기 전 확인 2건과 대화 5건(사람별 4 + 채널 1)이 시안 순서로 보이고, 들어오면 첫 확인 항목이 골라져 있다', async () => {
    await openInbox()
    expect(within(reviewList()).getByRole('heading', { level: 2 })).toHaveTextContent(
      '보내기 전 확인 2',
    )
    // 마감이 있는 항목은 마감일, 없는 항목은 만든 때를 오늘(MOCK_NOW 9/18) 기준으로 쓴다
    expect(rowTexts(reviewList())).toEqual([
      '이재환09/24 마감API 명세서 진행 상황을 물어보는 DM',
      '정하늘3일 전퍼블리싱 진행 상황 확인',
    ])
    expect(rowTexts(threadList())).toEqual([
      '이재환나: DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?09/16답장 기다리는 중',
      '박민수STT 튜닝 결과 Notion에 붙였습니다09/09',
      '정하늘발표 순서 정리해서 올릴게요09/04',
      '박지훈확인했습니다09/02',
      '#회의록 요약나: 3주차 정기회의 요약 게시09/09',
    ])
    // Messages 시안처럼 아무것도 고르지 않고 들어와도 첫 보내기 전 확인 항목이 골라져 있다
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('이재환')
    expect(detail().getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })).toBeVisible()
    expect(detail().getByRole('region', { name: '보낼 메시지 미리보기' })).toHaveTextContent(
      '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂',
    )
  })

  it('검토 항목을 고르면 주소의 review 가 바뀌고, 그 행만 현재 항목이며 그 항목의 보내기 전 확인이 보인다', async () => {
    const app = await openInbox()
    await userEvent.click(within(reviewList()).getByRole('link', { name: /정하늘/ }))
    await app.expectSearch('?review=rv_02')
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('정하늘')
    expect(detail().getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })).toBeVisible()
    expect(detail().getByText(/에게 Discord 개인 메시지로 나갑니다/)).toHaveTextContent(
      '정하늘에게 Discord 개인 메시지로 나갑니다. 보낸 뒤에는 되돌릴 수 없어요.',
    )
    const preview = detail().getByRole('region', { name: '보낼 메시지 미리보기' })
    expect(readable(preview)).toBe(
      'Discord 개인 메시지 · 카테캠 3팀 봇미리보기카테캠 3팀BOT바로 발송' +
        // 본문 이모지를 그대로 보인다
        '하늘님, 퍼블리싱은 어디까지 진행됐는지 알려주실 수 있을까요? 🙏' +
        '문구는 그대로 고칠 수 있어요고쳐 쓰기',
    )
    // 근거 링크가 없는 항목은 `마지막 메시지 보기` 가 없다
    const reason = detail().getByRole('region', { name: '왜 보내려 하나요' })
    expect(reason).toHaveTextContent(
      '퍼블리싱 태스크가 9/4 이후로 「진행 중」에서 바뀌지 않았어요.',
    )
    expect(within(reason).queryByRole('link')).toBeNull()
    // 마감이 없어 `마감 하루 전` 은 고를 수 없고 서버가 정한 `지금 바로` 가 골라져 있다
    expect(detail().getByRole('radio', { name: '마감 하루 전마감 없음' })).toBeDisabled()
    expect(detail().getByRole('radio', { name: /지금 바로/ })).toBeChecked()
  })

  it('보내기 전 확인은 Messages 시안의 항목·문구를 모두 갖는다 — 미리보기·근거·발송 시점·행동·안내', async () => {
    await openInbox(paths.messageReview('ws_01', 'rv_01'))
    const preview = detail().getByRole('region', { name: '보낼 메시지 미리보기' })
    expect(within(preview).getByText('Discord 개인 메시지 · 카테캠 3팀 봇')).toBeInTheDocument()
    expect(within(preview).getByText('BOT')).toBeInTheDocument()
    expect(within(preview).getByText('09/23 09:00 예정')).toBeInTheDocument()
    expect(within(preview).getByText('문구는 그대로 고칠 수 있어요')).toBeInTheDocument()
    expect(within(preview).getByRole('button', { name: '고쳐 쓰기' })).toBeEnabled()

    const reason = detail().getByRole('region', { name: '왜 보내려 하나요' })
    expect(reason).toHaveTextContent(
      'API 명세서 마감이 9/24인데, 9/16 이후로 #개발 채널에 진행 소식이 없어요.',
    )
    const lastMessage = within(reason).getByRole('link', { name: /마지막 메시지 보기/ })
    expect(lastMessage).toHaveAttribute('href', 'https://discord.com/channels/@me/mock-dev-last')
    expect(lastMessage).toHaveAttribute('target', '_blank')

    const timing = detail().getByRole('group', { name: '언제 보낼까요?' })
    expect(
      within(timing)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value')),
    ).toEqual(['day_before_deadline', 'now', 'custom'])
    expect(within(timing).getByRole('radio', { name: '마감 하루 전09/23 09:00' })).toBeChecked()
    // 지금(MOCK_NOW 금 09:00)이 언제인지 쓴다
    expect(within(timing).getByRole('radio', { name: '지금 바로금요일 아침' })).not.toBeChecked()
    expect(within(timing).getByRole('radio', { name: '직접 정하기날짜 · 시각' })).not.toBeChecked()

    expect(detail().getByRole('button', { name: '보내지 않음' })).toBeEnabled()
    expect(detail().getByRole('button', { name: '이대로 발송' })).toBeEnabled()
    expect(
      detail().getByText(
        '보낸 메시지는 되돌릴 수 없습니다. 이 화면에는 다른 작업을 두지 않았어요.',
      ),
    ).toBeInTheDocument()
  })

  it('주소로 바로 들어와도(새로고침) 같은 검토 항목이 골라져 있다', async () => {
    await openInbox(paths.messageReview('ws_01', 'rv_02'))
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('정하늘')
    expect(detail().getByRole('region', { name: '보낼 메시지 미리보기' })).toHaveTextContent(
      '하늘님, 퍼블리싱은 어디까지 진행됐는지 알려주실 수 있을까요? 🙏',
    )
  })

  it.each([
    ['목록에 없는 ID', 'rv_99'],
    ['ID 모양이 아닌 값', 'a/b'],
  ])('review 가 %s 이면 선택 없음이다 — 오류 화면이 아니다', async (_name, reviewId) => {
    await openInbox(`${paths.messages('ws_01')}?review=${encodeURIComponent(reviewId)}`)
    expect(current()).toEqual([])
    expect(
      detail().getByText('왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('확인 항목이 없고 대화만 있으면 들어왔을 때 고를 것을 안내한다', async () => {
    db.messageReviews = []
    await openInbox()
    expect(current()).toEqual([])
    expect(
      detail().getByText('왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.'),
    ).toBeInTheDocument()
  })

  it('대화를 고르면 경로가 바뀌고 그 대화 행만 현재 항목이다 — 검토 항목은 현재 항목이 아니다', async () => {
    const app = await openInbox(paths.messageReview('ws_01', 'rv_01'))
    await userEvent.click(within(threadList()).getByRole('link', { name: /박민수/ }))
    await app.expectPath(paths.messageThread('ws_01', 'th_02'))
    await app.expectSearch('')
    await waitFor(() => expect(current()).toHaveLength(1))
    expect(current()[0]).toHaveTextContent('박민수')
    expect(
      within(reviewList())
        .getAllByRole('link')
        .every((link) => link.getAttribute('aria-current') !== 'page'),
    ).toBe(true)
  })
})

describe('대화는 날짜 구분·보낸 쪽·시각·답장 대기·승인 대기를 구분해 보인다 (AC-03)', () => {
  const days = () =>
    within(conversation())
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
  const messages = () => within(conversation()).getAllByRole('listitem').map(readable)
  const footNote = () => detail().getByText(/메시지는 항상/)

  it('답장이 없는 DM 은 MessagesThread 시안대로 머리·말풍선 시각 줄·답장 없음 칩·승인 대기·안내 바를 보인다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_01'))
    expect(await detail().findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    expect(
      detail().getByText('백엔드 · Discord 개인 메시지 · 카테캠 3팀 봇으로 보냄'),
    ).toBeInTheDocument()
    // 9/16 에 보내고 오늘(9/18)까지 답이 없다 — 보낸 날이 1일째다
    expect(detail().getByText('답장 3일째 없음')).toBeVisible()
    const discord = detail().getByRole('link', { name: /Discord에서 열기/ })
    expect(discord).toHaveAttribute('href', 'https://discord.com/channels/@me/mock-th_01')
    expect(discord).toHaveAttribute('target', '_blank')

    expect(days()).toEqual(['9월 15일 화요일', '9월 16일 수요일', '오늘 · 9월 18일 금요일'])
    expect(messages()).toEqual([
      '봇: 재환님, 3주차 회의에서 API 명세서를 9/24까지 정리해 주신다고 하셨어요.\nNotion 태스크로 올려 뒀습니다 🙂09:02 · 자동 발송',
      '이재환: 네 확인했습니다. DB 스키마 확정되면 바로 붙일게요.09:31',
      '봇: DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?18:00 · 최진호 승인',
      '봇(승인 대기): 재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂\n혹시 막히는 부분 있으면 알려주세요. 필요하면 마감을 옮겨도 괜찮아요!09/23 09:00 발송 예정반려승인',
    ])
    expect(
      within(conversation()).getByText('여기서부터 답장이 없습니다 — 오늘로 3일째예요'),
    ).toBeVisible()
    const upcoming = within(conversation()).getByRole('list', { name: '아직 나가지 않은 메시지' })
    expect(within(upcoming).getByRole('button', { name: '승인' })).toBeEnabled()
    expect(within(upcoming).getByRole('button', { name: '반려' })).toBeEnabled()

    // 아래 안내 바 — 직접 입력 칸 대신 승인 대기 항목으로 보낸다
    expect(footNote()).toHaveTextContent(
      '메시지는 항상 카테캠 3팀 봇이 보냅니다. 직접 입력하는 대신 승인 대기 중인 1건을 확인해 주세요.',
    )
    expect(detail().getByRole('link', { name: '확인하기' })).toHaveAttribute(
      'href',
      paths.messageReview('ws_01', 'rv_01'),
    )
    expect(detail().queryByRole('textbox')).toBeNull()
  })

  it('상대가 답한 DM 과 채널은 답장 대기가 아니고, 승인 대기가 없으면 안내 바에 확인할 것이 없다고 쓴다', async () => {
    const app = await openInbox(paths.messageThread('ws_01', 'th_02'))
    expect(await detail().findByRole('heading', { level: 2, name: '박민수' })).toBeVisible()
    expect(detail().queryByText(/답장 \d+일째 없음/)).toBeNull()
    expect(detail().queryByText(/여기서부터 답장이 없습니다/)).toBeNull()
    expect(footNote()).toHaveTextContent(
      '메시지는 항상 카테캠 3팀 봇이 보냅니다. 지금 승인을 기다리는 메시지는 없어요.',
    )
    expect(detail().queryByRole('link', { name: '확인하기' })).toBeNull()

    app.navigate(paths.messageThread('ws_01', 'th_05'))
    expect(await detail().findByRole('heading', { level: 2, name: '#회의록 요약' })).toBeVisible()
    expect(detail().getByText('Discord 채널 · 카테캠 3팀 봇으로 보냄')).toBeInTheDocument()
    expect(messages()).toEqual(['봇: 3주차 정기회의 요약 게시19:00 · 자동 발송'])
    expect(screen.queryByText(/여기서부터 답장이 없습니다/)).toBeNull()
  })

  it('오늘 보낸 메시지의 날짜 구분선은 오늘을 붙이고, 오늘 보낸 날이 답장 없음 1일째다', async () => {
    db.messageThreads
      .find(({ thread_id }) => thread_id === 'th_02')!
      .messages.push({
        message_id: 'mg_90',
        sender: 'bot',
        body: '오늘 회의 전에 한 번 더 확인해요',
        sent_at: MOCK_NOW,
        status: 'sent',
        delivery: 'auto',
        approved_by: null,
      })
    await openInbox(paths.messageThread('ws_01', 'th_02'))
    await detail().findByRole('heading', { level: 2, name: '박민수' })
    expect(days()).toEqual(['9월 9일 수요일', '오늘 · 9월 18일 금요일'])
    expect(detail().getByText('답장 1일째 없음')).toBeInTheDocument()
    expect(detail().getByText('여기서부터 답장이 없습니다 — 오늘로 1일째예요')).toBeVisible()
  })
})

const emptyWorkspace = (workspaceId: string) => {
  db.messageReviews = db.messageReviews.filter(({ workspace_id }) => workspace_id !== workspaceId)
  db.messageThreads = db.messageThreads.filter(({ workspace_id }) => workspace_id !== workspaceId)
}

describe('빈 상태·로딩·목록 오류·대화 오류가 서로 구분되고, 한쪽 오류가 다른 쪽을 막지 않는다 (AC-04)', () => {
  it('검토도 대화도 없으면 EmptyMessages 한 장이다 — 알림 규칙 보기는 가장 가까운 팀 설정으로 간다', async () => {
    emptyWorkspace('ws_01')
    renderApp(paths.messages('ws_01'))
    expect(
      await screen.findByRole('heading', { level: 1, name: '보낼 메시지가 없어요' }),
    ).toBeVisible()
    expect(
      screen.getByText(
        '마감이 다가오거나 진행이 멈추면, 담당자에게 보낼 DM을 여기에 준비해 둘게요. 보내기 전에 항상 물어봅니다.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '메시지 목록' })).toBeNull()
    expect(screen.getByRole('link', { name: '알림 규칙 보기' })).toHaveAttribute(
      'href',
      paths.settings('ws_01'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('한 영역만 비면 그 영역에 비었다고 쓴다', async () => {
    db.messageReviews = []
    await openInbox()
    expect(within(reviewList()).getByRole('heading')).toHaveTextContent('보내기 전 확인 0')
    expect(within(reviewList()).getByText('지금 확인할 메시지가 없어요.')).toBeInTheDocument()
    expect(rowTexts(threadList())).toHaveLength(5)
  })

  it('목록을 받는 동안 목록 칸은 스켈레톤이다 — 빈 상태도 오류도 아니다', async () => {
    const gate = hold('/workspaces/ws_01/messages')
    renderApp(paths.messages('ws_01'))
    const skeleton = await screen.findByTestId('message-list-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('보낼 메시지가 없어요')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => gate.resolve())
    await screen.findByRole('region', { name: '대화' })
    expect(screen.queryByTestId('message-list-skeleton')).toBeNull()
  })

  it.each([
    ['검토 항목 주소', paths.messageReview('ws_01', 'rv_01')],
    ['고른 것이 없는 주소(첫 항목이 골라진다)', paths.messages('ws_01')],
  ])('%s 로 들어오면 목록을 받는 동안 상세 자리도 스켈레톤이다', async (_name, path) => {
    const gate = hold('/workspaces/ws_01/messages')
    renderApp(path)
    expect(await screen.findByTestId('message-review-skeleton')).toBeInTheDocument()
    act(() => gate.resolve())
    expect(await detail().findByRole('heading', { name: '이 메시지, 보낼까요?' })).toBeVisible()
  })

  it('목록 오류는 목록 칸에서 다시 시도로 알리고, 고른 대화는 그대로 보인다', async () => {
    db.messageFailures.inbox = true
    renderApp(paths.messageThread('ws_01', 'th_01'))
    expect(await screen.findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    const alert = await list().findByRole('alert', {}, { timeout: 4_000 })
    expect(alert).toHaveTextContent('메시지 목록을 불러오지 못했어요')
    expect(alert).toHaveTextContent('서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.')
    expect(screen.queryByText('보낼 메시지가 없어요')).toBeNull()
    expect(detail().queryByRole('alert')).toBeNull()

    db.messageFailures.inbox = false
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await list().findByRole('region', { name: '대화' })).toBeInTheDocument()
    expect(current()[0]).toHaveTextContent('이재환')
  })

  it('대화 오류는 상세 칸에서 다시 시도로 알리고, 목록은 그대로 고를 수 있다', async () => {
    db.messageFailures.threadIds = ['th_01']
    const app = await openInbox(paths.messageThread('ws_01', 'th_01'))
    const alert = await detail().findByRole('alert', {}, { timeout: 4_000 })
    expect(alert).toHaveTextContent('대화를 불러오지 못했어요')
    expect(list().queryByRole('alert')).toBeNull()
    expect(rowTexts(threadList())).toHaveLength(5)

    await userEvent.click(within(threadList()).getByRole('link', { name: /박민수/ }))
    await app.expectPath(paths.messageThread('ws_01', 'th_02'))
    expect(await detail().findByRole('heading', { level: 2, name: '박민수' })).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('대화를 받는 동안 상세 칸만 스켈레톤이고 목록은 보인다', async () => {
    const gate = hold('/workspaces/ws_01/messages/threads/th_02')
    await openInbox(paths.messageThread('ws_01', 'th_02'))
    expect(screen.getByTestId('message-thread-skeleton')).toHaveAttribute('aria-busy', 'true')
    expect(current()[0]).toHaveTextContent('박민수')
    act(() => gate.resolve())
    expect(await detail().findByRole('heading', { level: 2, name: '박민수' })).toBeVisible()
  })

  it.each([
    ['없는 대화', paths.messageThread('ws_01', 'th_99')],
    ['다른 공간의 대화', paths.messageThread('ws_01', 'th_11')],
    ['모양이 틀린 대화 ID', `${paths.messages('ws_01')}/threads/a.b`],
    ['없는 하위 경로', `${paths.messages('ws_01')}/nope`],
  ])('%s 는 찾을 수 없다고 알린다 — 다시 시도가 아니고 목록은 그대로다', async (_name, path) => {
    await openInbox(path)
    expect(
      await detail().findByRole('heading', { level: 2, name: '대화를 찾을 수 없어요' }),
    ).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(rowTexts(threadList())).toHaveLength(5)
  })
})

describe('워크스페이스를 바꾸면 이전 공간의 메시지가 보이지 않는다 (AC-05)', () => {
  beforeEach(() => {
    db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_02')!.onboarding.completed = true
  })

  it('새 공간의 목록을 받는 동안에도 이전 공간의 행을 들고 있지 않는다', async () => {
    const app = await openInbox(paths.messageThread('ws_01', 'th_01'))
    expect(await detail().findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()

    const gate = hold('/workspaces/ws_02/messages')
    act(() => app.navigate(paths.messages('ws_02')))
    await app.expectPath(paths.messages('ws_02'))
    expect(await screen.findByTestId('message-list-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('이재환')).toBeNull()

    act(() => gate.resolve())
    await screen.findByRole('region', { name: '대화' })
    expect(rowTexts(threadList())).toEqual(['한결랜딩 시안 공유드려요09/16'])
    expect(within(reviewList()).queryAllByRole('link')).toEqual([])
    expect(screen.queryByText(/이재환|박민수|정하늘/)).toBeNull()
  })

  it('이전 공간의 대화 ID 를 새 공간 주소에 붙이면 찾을 수 없다', async () => {
    await openInbox(paths.messageThread('ws_02', 'th_01'))
    expect(
      await detail().findByRole('heading', { level: 2, name: '대화를 찾을 수 없어요' }),
    ).toBeVisible()
    expect(screen.queryByText('이재환')).toBeNull()
  })
})

describe('키보드만으로 목록 이동·선택·상세 확인이 되고, 이름과 색 외 상태 표현이 있다 (AC-07)', () => {
  /** 포커스가 target 에 닿을 때까지 Tab 을 누른다. 화면 순서대로 닿아야 한다 */
  async function tabTo(target: HTMLElement) {
    for (let step = 0; step < 40 && document.activeElement !== target; step += 1)
      await userEvent.tab()
    expect(document.activeElement).toBe(target)
  }

  it('영역마다 접근 가능한 이름과 제목이 있다', async () => {
    await openInbox()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(list().getByRole('heading', { level: 1, name: '메시지' })).toBeInTheDocument()
    expect(within(reviewList()).getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(
      within(threadList()).getByRole('heading', { level: 2, name: '대화' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '메시지 내용' })).toBeInTheDocument()
  })

  it('Tab 으로 검토 항목에 가서 Enter 로 고르고, 다시 Tab 으로 대화를 골라 내용 칸까지 간다', async () => {
    const app = await openInbox()
    const review = within(reviewList()).getByRole('link', { name: /정하늘/ })
    await tabTo(review)
    await userEvent.keyboard('{Enter}')
    await app.expectSearch('?review=rv_02')
    expect(await detail().findByRole('heading', { name: '이 메시지, 보낼까요?' })).toBeVisible()
    // 고른 뒤에도 포커스가 목록에 남아 다음 항목으로 이어 간다
    expect(document.activeElement).toBe(review)
    expect(review).toHaveAttribute('aria-current', 'page')

    const thread = within(threadList()).getByRole('link', { name: /이재환/ })
    await tabTo(thread)
    await userEvent.keyboard('{Enter}')
    await app.expectPath(paths.messageThread('ws_01', 'th_01'))
    expect(await detail().findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    expect(document.activeElement).toBe(thread)
    expect(thread).toHaveAttribute('aria-current', 'page')

    // 스크롤 칸인 대화 내용도 Tab 으로 닿는다 — 키보드로 내릴 수 있다
    await tabTo(conversation())
  })

  it('발송 시점 카드는 Tab 으로 닿는 라디오이고, 서버가 정한 시점이 골라져 있다', async () => {
    await openInbox(paths.messageReview('ws_01', 'rv_01'))
    const deadline = detail().getByRole('radio', { name: /마감 하루 전/ })
    await tabTo(deadline)
    expect(deadline).toBeChecked()
  })

  it('답장 대기는 점의 색이 아니라 글자로도 읽힌다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_01'))
    const waiting = within(threadList()).getByRole('link', { name: /이재환/ })
    expect(waiting).toHaveTextContent('답장 기다리는 중')
    expect(within(threadList()).getByRole('link', { name: /박민수/ })).not.toHaveTextContent(
      '답장 기다리는 중',
    )
    // 대화 머리의 배지는 강조색에 더해 며칠째인지를 글자로 쓴다
    expect(await detail().findByText('답장 3일째 없음')).toBeVisible()
  })
})

/*
 * 디자인 값 (VR-05 ~ VR-09). jsdom 은 Tailwind 를 계산하지 않아 클래스로 고정한다 — 실제 계산 값은 결과 문서 C 의 브라우저 측정이 본다
 */
describe('목록 라벨·발송 시점 포커스 선·버튼 크기가 디자인 시스템과 Messages 캔버스 값이다', () => {
  it('목록 영역 라벨은 400 이다 — h2 기본 굵기를 받지 않는다', async () => {
    await openInbox()
    expect(within(reviewList()).getByRole('heading')).toHaveClass('font-normal')
    expect(within(threadList()).getByRole('heading', { name: '대화' })).toHaveClass('font-normal')
  })

  it('발송 시점 카드의 포커스 선은 테두리 위(-1)이고, 고른 먹 면 카드는 안쪽 흰 선(-3)이다 — 양수 offset 이 없다', async () => {
    await openInbox(paths.messageReview('ws_01', 'rv_01'))
    const card = detail()
      .getByRole('radio', { name: /지금 바로/ })
      .closest('label')
    expect(card).toHaveClass(
      'has-[input:focus-visible]:-outline-offset-1',
      'has-[input:focus-visible]:outline-ink',
      'has-[input:checked]:has-[input:focus-visible]:-outline-offset-3',
      'has-[input:checked]:has-[input:focus-visible]:outline-surface',
    )
    expect(card?.className).not.toMatch(/(^| )[^ ]*:outline-offset-\d/)
  })

  it('보내기 전 확인의 버튼은 캔버스 크기이고 모두 36px 이상이다 — 덮어쓰는 className 이 없다', async () => {
    await openInbox(paths.messageReview('ws_01', 'rv_01'))
    const button = (name: string) => detail().getByRole('button', { name })
    expect(button('고쳐 쓰기')).toHaveClass('h-36', 'px-11', 'text-[12px]')
    expect(button('보내지 않음')).toHaveClass('h-44', 'px-18', 'text-[14px]')
    expect(button('보내지 않음')).not.toHaveClass('px-22')
    expect(button('이대로 발송')).toHaveClass('h-44', 'px-24', 'gap-8', 'text-[14.5px]')
    expect(button('이대로 발송')).not.toHaveClass('gap-6', 'px-22')

    await userEvent.click(button('고쳐 쓰기'))
    expect(button('취소')).toHaveClass('h-36')
    expect(button('저장')).toHaveClass('h-36')
    await userEvent.click(button('취소'))

    await userEvent.click(detail().getByRole('radio', { name: /직접 정하기/ }))
    expect(button('이 시각으로 정하기')).toHaveClass('h-36')
    expect(button('취소')).toHaveClass('h-36')
  })

  it('대화의 반려·승인은 13px 이고 반려 좌우 16 · 승인 좌우 20 이다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_01'))
    const upcoming = within(
      await within(conversation()).findByRole('list', { name: '아직 나가지 않은 메시지' }),
    )
    expect(upcoming.getByRole('button', { name: '반려' })).toHaveClass(
      'h-36',
      'px-16',
      'text-(length:--text-control)',
    )
    expect(upcoming.getByRole('button', { name: '승인' })).toHaveClass(
      'h-36',
      'px-20',
      'text-(length:--text-control)',
    )
  })
})
