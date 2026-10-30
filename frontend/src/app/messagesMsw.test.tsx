import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { renderApp } from './test/renderApp'

/*
 * M8 메시지 (계획 C-6 1~6단계, AC-01 ~ AC-07). 개발 서버 + VITE_ENABLE_MSW=true 를 흉내낸다 — 이 파일 안에서만 설정을 바꾼다.
 * 실 API 모드의 준비 중 안내는 라우트·가드·앱 셸 테스트가 그대로 본다 (AC-01)
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

const list = () => within(screen.getByRole('complementary', { name: '메시지 목록' }))
const detail = () => within(screen.getByRole('region', { name: '메시지 내용' }))
const reviewList = () => list().getByRole('region', { name: /^보내기 전 확인/ })
const threadList = () => list().getByRole('region', { name: '대화' })
/** 화면 읽기가 읽는 글자. 장식(aria-hidden 아바타 글자·답장 대기 점)은 뺀다 */
function readable(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
  return copy.textContent
}
const rowTexts = (region: HTMLElement) => within(region).getAllByRole('link').map(readable)
const current = () =>
  list()
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')

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
  it('보내기 전 확인 2건과 대화 5건(사람별 4 + 채널 1)이 시안 순서로 보이고, 고르기 전에는 상세가 비어 있다', async () => {
    await openInbox()
    expect(within(reviewList()).getByRole('heading', { level: 2 })).toHaveTextContent(
      '보내기 전 확인 2',
    )
    expect(rowTexts(reviewList())).toEqual([
      '이재환09/17API 명세서 진행 상황을 물어보는 DM',
      '정하늘09/15퍼블리싱 진행 상황 확인',
    ])
    expect(rowTexts(threadList())).toEqual([
      '이재환나: DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?09/10답장 기다리는 중',
      '박민수STT 튜닝 결과 Notion에 붙였습니다09/09',
      '정하늘발표 순서 정리해서 올릴게요09/04',
      '박지훈확인했습니다09/02',
      '#회의록 요약나: 3주차 정기회의 요약 게시09/09',
    ])
    expect(current()).toEqual([])
    expect(
      detail().getByText('왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.'),
    ).toBeInTheDocument()
  })

  it('검토 항목을 고르면 주소의 review 가 바뀌고, 그 행만 현재 항목이며 읽기 전용 미리보기가 보인다', async () => {
    const app = await openInbox()
    await userEvent.click(within(reviewList()).getByRole('link', { name: /정하늘/ }))
    await app.expectSearch('?review=rv_02')
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('정하늘')
    expect(detail().getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })).toBeVisible()
    const preview = detail().getByRole('region', { name: '보낼 메시지 미리보기' })
    expect(preview).toHaveTextContent('Discord 개인 메시지 · 카테캠 3팀 봇')
    // 본문 이모지를 그대로 보인다
    expect(preview).toHaveTextContent(
      '하늘님, 퍼블리싱은 어디까지 진행됐는지 알려주실 수 있을까요? 🙏',
    )
    // 결정 전이라 행동 버튼이 없다
    expect(detail().queryByRole('button')).toBeNull()
  })

  it('주소로 바로 들어와도(새로고침) 같은 검토 항목이 골라져 있다', async () => {
    await openInbox(paths.messageReview('ws_01', 'rv_01'))
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('이재환')
    expect(detail().getByRole('region', { name: '보낼 메시지 미리보기' })).toHaveTextContent(
      '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂',
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

describe('대화는 날짜 구분·보낸 쪽·시각·답장 대기를 구분해 보인다 (AC-03)', () => {
  const conversation = () => detail().getByRole('region', { name: '대화 내용' })
  const days = () =>
    within(conversation())
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
  const messages = () => within(conversation()).getAllByRole('listitem').map(readable)

  it('봇이 마지막으로 보낸 DM 은 날짜별로 묶이고, 보낸 쪽과 시각이 붙고, 답장 대기가 보인다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_01'))
    expect(await detail().findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    expect(detail().getByText('Discord 개인 메시지')).toBeInTheDocument()
    expect(detail().getByText('답장 기다리는 중')).toBeInTheDocument()
    expect(days()).toEqual(['9월 8일 화요일', '9월 10일 목요일'])
    expect(messages()).toEqual([
      '봇: 재환님, 3주차 회의에서 API 명세서를 9/24까지 정리해 주신다고 하셨어요.\nNotion 태스크로 올려 뒀습니다 🙂09:02',
      '이재환: 네 확인했습니다. DB 스키마 확정되면 바로 붙일게요.09:31',
      '봇: DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?18:00',
    ])
    expect(within(conversation()).getByText('여기서부터 답장을 기다리고 있어요')).toBeVisible()
    // 정해지지 않은 상태 문구와 이동은 두지 않는다
    expect(detail().queryByText(/자동 발송|승인|예정/)).toBeNull()
    expect(detail().queryByRole('link', { name: /Discord에서 열기/ })).toBeNull()
  })

  it('상대가 답한 DM 과 채널은 답장 대기가 아니다', async () => {
    const app = await openInbox(paths.messageThread('ws_01', 'th_02'))
    expect(await detail().findByRole('heading', { level: 2, name: '박민수' })).toBeVisible()
    expect(detail().queryByText('답장 기다리는 중')).toBeNull()
    expect(detail().queryByText('여기서부터 답장을 기다리고 있어요')).toBeNull()

    app.navigate(paths.messageThread('ws_01', 'th_05'))
    expect(await detail().findByRole('heading', { level: 2, name: '#회의록 요약' })).toBeVisible()
    expect(detail().getByText('Discord 채널')).toBeInTheDocument()
    expect(messages()).toEqual(['봇: 3주차 정기회의 요약 게시19:00'])
    expect(screen.queryByText('여기서부터 답장을 기다리고 있어요')).toBeNull()
  })

  it('오늘 보낸 메시지의 날짜 구분선은 오늘을 붙인다', async () => {
    db.messageThreads
      .find(({ thread_id }) => thread_id === 'th_02')!
      .messages.push({
        message_id: 'mg_90',
        sender: 'bot',
        body: '오늘 회의 전에 한 번 더 확인해요',
        sent_at: MOCK_NOW,
      })
    await openInbox(paths.messageThread('ws_01', 'th_02'))
    await detail().findByRole('heading', { level: 2, name: '박민수' })
    expect(days()).toEqual(['9월 9일 수요일', '오늘 · 9월 18일 금요일'])
    expect(detail().getByText('답장 기다리는 중')).toBeInTheDocument()
  })
})

/** 그 조회의 응답을 붙잡는다. 풀면 기본 handler 가 답한다 */
function hold(path: string) {
  const gate = deferred()
  server.use(
    http.get(`/api/v1${path}`, async () => {
      await gate.promise
      return undefined
    }),
  )
  return gate
}
const emptyWorkspace = (workspaceId: string) => {
  db.messageReviews = db.messageReviews.filter(({ workspace_id }) => workspace_id !== workspaceId)
  db.messageThreads = db.messageThreads.filter(({ workspace_id }) => workspace_id !== workspaceId)
}

describe('빈 상태·로딩·목록 오류·대화 오류가 서로 구분되고, 한쪽 오류가 다른 쪽을 막지 않는다 (AC-04)', () => {
  it('검토도 대화도 없으면 EmptyMessages 한 장이다 — 알림 규칙 보기는 목적지가 없어 두지 않는다', async () => {
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
    expect(screen.queryByRole('link', { name: '알림 규칙 보기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '알림 규칙 보기' })).toBeNull()
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

  it('검토 항목 주소로 들어오면 목록을 받는 동안 상세 자리도 스켈레톤이다', async () => {
    const gate = hold('/workspaces/ws_01/messages')
    renderApp(paths.messageReview('ws_01', 'rv_01'))
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
    const review = within(reviewList()).getByRole('link', { name: /이재환/ })
    await tabTo(review)
    await userEvent.keyboard('{Enter}')
    await app.expectSearch('?review=rv_01')
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
    await tabTo(detail().getByRole('region', { name: '대화 내용' }))
  })

  it('답장 대기는 점의 색이 아니라 글자로도 읽힌다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_01'))
    const waiting = within(threadList()).getByRole('link', { name: /이재환/ })
    expect(waiting).toHaveTextContent('답장 기다리는 중')
    expect(within(threadList()).getByRole('link', { name: /박민수/ })).not.toHaveTextContent(
      '답장 기다리는 중',
    )
    expect(await detail().findByText('답장 기다리는 중')).toBeVisible()
  })
})
