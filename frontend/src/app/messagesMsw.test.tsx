import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { messageThreadQueryOptions } from '@/entities/message'
import { STALE_TIME } from '@/shared/api/queryClient'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, list as listResponse } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { botMessage } from '@/shared/mock/fixtures/message'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { isMemberOf, setMockRole } from '@/shared/mock/sessions'
import { recordRequests } from '@/shared/test/requests'
import { SELF_SECTION_TITLE } from '@/widgets/message-inbox'
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
 * M8 메시지 (계획 C-6 1~6단계, AC-01 ~ AC-07, 계약 §5.7). MSW 가 백엔드 메시지 API 와 같은 모양으로 답한다.
 * 보낼 메시지의 행동(승인·보내지 않음·문구·보낼 시각)은 messagesActionsMsw.test.tsx 가 본다
 */

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

const isReply = (request: { path: string }) => request.path.includes('/replies')
/** 요청이 나가지 않았음을 보기 전에, 나갔다면 시작했을 만큼 기다린다 — React Query 는 다음 틱에 알린다 */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))
/** 말풍선이 놓인 세로 칸. 왼쪽이면 items-start, 오른쪽이면 items-end 다 */
const columnOf = (text: string) =>
  within(conversation()).getByText(text).closest('p')?.parentElement

describe('준비 중 안내 없이 메시지 화면이 열린다', () => {
  it.each([
    paths.messages('ws_01'),
    paths.messageThread('ws_01', 'th_01'),
    `${paths.messages('ws_01')}/nope`,
  ])('%s 는 메시지 화면이다', async (path) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: '메시지' })).toBeInTheDocument()
    expect(screen.queryByText('메시지는 준비 중이에요')).toBeNull()
  })
})

describe('왼쪽 목록 두 영역과 오른쪽 상세의 2단이고, 선택은 URL 이 정한다 (AC-02)', () => {
  it('보낼 메시지 2통과 대화 4건이 보이고, 들어오면 아직 승인하지 않은 첫 묶음이 골라져 있다', async () => {
    await openInbox()
    expect(within(reviewList()).getByRole('heading', { level: 2 })).toHaveTextContent(
      '보내기 전 확인 2',
    )
    // 승인 전 묶음은 가장 이른 마감일과 묶은 태스크를 쓴다
    expect(rowTexts(reviewList())).toEqual([
      '이재환09/24 마감API 명세서',
      '정하늘09/30 마감퍼블리싱 외 1건',
    ])
    expect(rowTexts(threadList())).toEqual([
      '이재환나: DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?09/16답장 기다리는 중',
      '박민수거의 다 됐어요. 내일 오전에 올릴게요09/09',
      '정하늘발표 순서 정리해서 올릴게요09/04',
      '박지훈DM 못 보냄나: 지훈님, 회의록 템플릿 검토는 끝나셨나요?09/02답장 기다리는 중',
    ])
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('이재환')
    expect(detail().getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })).toBeVisible()
    expect(detail().getByRole('region', { name: '보낼 메시지 미리보기' })).toHaveTextContent(
      '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂',
    )
  })

  it('묶음을 고르면 주소의 review 가 바뀌고, 미리보기·묶은 태스크·보낼 시각이 그 묶음 것이다', async () => {
    const app = await openInbox()
    await userEvent.click(within(reviewList()).getByRole('link', { name: /정하늘/ }))
    await app.expectSearch('?review=bd_02')
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('정하늘')
    expect(detail().getByText(/에게 .*Discord 개인 메시지로 나갑니다/)).toHaveTextContent(
      '정하늘에게 09/25 14:00에 Discord 개인 메시지로 나갑니다. 승인해야 나가요.',
    )
    const preview = detail().getByRole('region', { name: '보낼 메시지 미리보기' })
    // AI 초안을 기다리는 중이라 `문구 다듬는 중` 이 붙고, 본문 줄바꿈은 그대로다
    expect(readable(preview)).toBe(
      'Discord 개인 메시지 · 카테캠 3팀 봇미리보기카테캠 3팀BOT09/25 14:00 예정문구 다듬는 중' +
        "하늘님, 최진호예요.\n'퍼블리싱' 외 1건 진행 상황을 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!" +
        '기본 문구 · 문구는 그대로 고칠 수 있어요고쳐 쓰기',
    )
    expect(within(preview).getByText(/하늘님, 최진호예요/)).toHaveClass('whitespace-pre-line')
    expect(readable(detail().getByRole('region', { name: '묶은 태스크 2' }))).toBe(
      '묶은 태스크 2퍼블리싱마감 없음메모: 시안 2차 반영분까지메모 고치기빼기' +
        '발표 자료09/30 마감메모 고치기빼기',
    )
    // 서버가 정한 시각이 마감 하루 전(9/29 09:00)이 아니라 직접 정한 시각이다
    expect(detail().getByRole('radio', { name: '마감 하루 전09/29 09:00' })).not.toBeChecked()
    expect(detail().getByRole('radio', { name: '직접 정하기09/25 14:00' })).toBeChecked()
  })

  it('보내기 전 확인은 미리보기·묶은 태스크·보낼 시각 두 가지·행동·안내를 갖는다 — 지금 바로와 재촉 이유는 없다', async () => {
    await openInbox(paths.messageReview('ws_01', 'bd_01'))
    const preview = detail().getByRole('region', { name: '보낼 메시지 미리보기' })
    expect(within(preview).getByText('Discord 개인 메시지 · 카테캠 3팀 봇')).toBeInTheDocument()
    expect(within(preview).getByText('09/23 09:00 예정')).toBeInTheDocument()
    expect(within(preview).queryByText('문구 다듬는 중')).toBeNull()
    expect(within(preview).getByText('AI 초안 · 문구는 그대로 고칠 수 있어요')).toBeInTheDocument()
    expect(within(preview).getByRole('button', { name: '고쳐 쓰기' })).toBeEnabled()
    expect(detail().queryByText('왜 보내려 하나요')).toBeNull()

    const timing = detail().getByRole('group', { name: '언제 보낼까요?' })
    expect(
      within(timing)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value')),
    ).toEqual(['day_before_deadline', 'custom'])
    expect(
      await within(timing).findByRole('radio', { name: '마감 하루 전09/23 09:00' }),
    ).toBeChecked()
    expect(within(timing).getByRole('radio', { name: '직접 정하기날짜 · 시각' })).not.toBeChecked()

    expect(detail().getByRole('button', { name: '보내지 않음' })).toBeEnabled()
    expect(detail().getByRole('button', { name: '이대로 발송' })).toBeEnabled()
    expect(
      detail().getByText(
        '보낸 메시지는 되돌릴 수 없습니다. 이 화면에는 다른 작업을 두지 않았어요.',
      ),
    ).toBeInTheDocument()
  })

  it.each([
    ['목록에 없는 ID', 'bd_99'],
    ['ID 모양이 아닌 값', 'a/b'],
  ])('review 가 %s 이면 선택 없음이다 — 오류 화면이 아니다', async (_name, bundleId) => {
    await openInbox(`${paths.messages('ws_01')}?review=${encodeURIComponent(bundleId)}`)
    expect(current()).toEqual([])
    expect(
      detail().getByText('왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('대화를 고르면 경로가 바뀌고 그 대화 행만 현재 항목이다', async () => {
    const app = await openInbox(paths.messageReview('ws_01', 'bd_01'))
    await userEvent.click(within(threadList()).getByRole('link', { name: /박민수/ }))
    await app.expectPath(paths.messageThread('ws_01', 'th_02'))
    await app.expectSearch('')
    await waitFor(() => expect(current()).toHaveLength(1))
    expect(current()[0]).toHaveTextContent('박민수')
  })
})

describe('마감 기준 카드는 공간의 재촉 규칙(메시지·알림 설정)을 따른다 (#340)', () => {
  const timing = () => detail().getByRole('group', { name: '언제 보낼까요?' })
  const rule = (days_before: number, hour: number) => {
    db.messageSettings.ws_01 = {
      due_reminder: true,
      minutes_summary: true,
      silence_alert: true,
      nudge_rule: { days_before, hour },
      pm_alert_method: 'both',
      reminder_auto_approve: false,
      updated_at: '2026-09-17T00:00:00Z',
      updated_by: 'mb_01',
    }
  }

  it('2일 전 18시면 `마감 2일 전` 카드가 가장 이른 마감(9/24)의 이틀 전 18:00 이다', async () => {
    rule(2, 18)
    await openInbox(paths.messageReview('ws_01', 'bd_01'))
    const card = await within(timing()).findByRole('radio', { name: '마감 2일 전09/22 18:00' })
    expect(card).toBeEnabled()
    // bd_01 은 9/23 09:00 에 나간다 — 규칙의 시각이 아니므로 직접 정한 시각으로 보인다
    expect(card).not.toBeChecked()
    expect(within(timing()).getByRole('radio', { name: '직접 정하기09/23 09:00' })).toBeChecked()
  })

  it('당일이면 `마감 당일` 이고 그 날 정시다', async () => {
    rule(0, 7)
    await openInbox(paths.messageReview('ws_01', 'bd_01'))
    expect(
      await within(timing()).findByRole('radio', { name: '마감 당일09/24 07:00' }),
    ).toBeEnabled()
  })

  it('규칙을 받기 전에는 마감 기준 카드를 고를 수 없다 — 짐작한 시각을 보이지 않는다', async () => {
    const gate = hold('/workspaces/ws_01/message-settings')
    await openInbox(paths.messageReview('ws_01', 'bd_01'))
    const card = await within(timing()).findByRole('radio', { name: '마감 기준불러오는 중' })
    expect(card).toBeDisabled()
    expect(within(timing()).getByRole('radio', { name: /직접 정하기/ })).not.toBeChecked()
    gate.resolve()
    expect(
      await within(timing()).findByRole('radio', { name: '마감 하루 전09/23 09:00' }),
    ).toBeChecked()
  })

  it('규칙을 받지 못하면 마감 기준 카드를 고를 수 없고 그렇다고 쓴다', async () => {
    server.use(
      http.get('/api/v1/workspaces/ws_01/message-settings', () =>
        fail('INTERNAL_ERROR', 'boom', 500),
      ),
    )
    await openInbox(paths.messageReview('ws_01', 'bd_01'))
    expect(
      await within(timing()).findByRole(
        'radio',
        { name: '마감 기준규칙을 불러오지 못했어요' },
        { timeout: 5_000 },
      ),
    ).toBeDisabled()
  })
})

describe('대화는 날짜 구분·보낸 쪽·시각·답장 대기·예정 묶음·DM 실패를 구분해 보인다 (AC-03)', () => {
  const days = () =>
    within(conversation())
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
  const messages = () => within(conversation()).getAllByRole('listitem').map(readable)
  const footNote = () => detail().getByText(/메시지는 항상/)

  it('답장이 없는 대화는 머리 배지·답장 없음 줄을 보이고, 예정 묶음은 나갈 날짜에 점선으로 섞인다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_01'))
    expect(await detail().findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    expect(detail().getByText('Discord 개인 메시지 · 카테캠 3팀 봇으로 보냄')).toBeInTheDocument()
    expect(detail().getByText('답장 3일째 없음')).toBeVisible()

    expect(days()).toEqual(['9월 15일 화요일', '9월 16일 수요일', '9월 23일 수요일'])
    expect(messages()).toEqual([
      '봇: 재환님, 3주차 회의에서 API 명세서를 9/24까지 정리해 주신다고 하셨어요.\nNotion 태스크로 올려 뒀습니다 🙂09:02',
      '이재환: 네 확인했습니다. DB 스키마 확정되면 바로 붙일게요.09:31',
      '봇: DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?18:00',
      '여기서부터 답장이 없습니다 — 오늘로 3일째예요',
      '봇(승인 대기): 재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂\n혹시 막히는 부분 있으면 알려주세요. 필요하면 마감을 옮겨도 괜찮아요!09/23 09:00 발송 예정확인하기',
    ])
    expect(within(conversation()).getByRole('link', { name: '확인하기' })).toHaveAttribute(
      'href',
      paths.messageReview('ws_01', 'bd_01'),
    )
    expect(footNote()).toHaveTextContent(
      '메시지는 항상 카테캠 3팀 봇이 보냅니다. 승인·고쳐 쓰기·보내지 않음은 보내기 전 확인에서 해요.',
    )
    // 답장은 대화 주인만 한다 — PM 이 남의 대화를 보면 답장 칸이 없다
    expect(detail().queryByRole('textbox')).toBeNull()
  })

  it('AI 초안을 기다리는 예정 묶음은 대화에서도 문구 다듬는 중이다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_03'))
    expect(await detail().findByRole('heading', { level: 2, name: '정하늘' })).toBeVisible()
    const upcoming = within(conversation()).getByText(/하늘님, 최진호예요/).parentElement
    if (!upcoming) throw new Error('upcoming bubble column is missing')
    expect(within(upcoming).getByText('문구 다듬는 중')).toBeVisible()
    expect(within(upcoming).getByText('09/25 14:00 발송 예정')).toBeVisible()
  })

  it('DM 으로 가지 못한 봇 메시지는 말풍선 아래에 이유와 함께 알리고, 목록 행에도 DM 못 보냄을 붙인다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_04'))
    expect(await detail().findByRole('heading', { level: 2, name: '박지훈' })).toBeVisible()
    expect(within(conversation()).getByText('DM 못 보냄 · 서버 DM이 막혀 있어요')).toBeVisible()
    expect(within(threadList()).getByRole('link', { name: /박지훈/ })).toHaveTextContent(
      'DM 못 보냄',
    )
    expect(within(threadList()).getByRole('link', { name: /박민수/ })).not.toHaveTextContent(
      'DM 못 보냄',
    )
  })

  it('상대가 답한 대화는 답장 대기가 아니고 예정 묶음이 없으면 확인하기도 없다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_02'))
    expect(await detail().findByRole('heading', { level: 2, name: '박민수' })).toBeVisible()
    expect(detail().queryByText(/답장 \d+일째 없음/)).toBeNull()
    expect(detail().queryByText(/여기서부터 답장이 없습니다/)).toBeNull()
    expect(detail().queryByRole('link', { name: '확인하기' })).toBeNull()
  })

  it('오늘 보낸 메시지의 날짜 구분선은 오늘을 붙이고, 오늘 보낸 날이 답장 없음 1일째다', async () => {
    db.messageThreads
      .find(({ thread_id }) => thread_id === 'th_02')!
      .messages.push(botMessage('mg_90', '오늘 회의 전에 한 번 더 확인해요', MOCK_NOW))
    await openInbox(paths.messageThread('ws_01', 'th_02'))
    await detail().findByRole('heading', { level: 2, name: '박민수' })
    expect(days()).toEqual(['9월 9일 수요일', '오늘 · 9월 18일 금요일'])
    expect(detail().getByText('답장 1일째 없음')).toBeInTheDocument()
    expect(detail().getByText('여기서부터 답장이 없습니다 — 오늘로 1일째예요')).toBeVisible()
  })
})

const emptyWorkspace = (workspaceId: string) => {
  db.messageBundles = db.messageBundles.filter(({ workspace_id }) => workspace_id !== workspaceId)
  db.messageThreads = db.messageThreads.filter(({ workspace_id }) => workspace_id !== workspaceId)
}

describe('빈 상태·로딩·목록 오류·대화 오류가 서로 구분되고, 한쪽 오류가 다른 쪽을 막지 않는다 (AC-04)', () => {
  it('보낼 메시지도 대화도 없으면 EmptyMessages 한 장이다 — 알림 규칙 보기는 가장 가까운 팀 설정으로 간다', async () => {
    emptyWorkspace('ws_01')
    renderApp(paths.messages('ws_01'))
    expect(
      await screen.findByRole('heading', { level: 1, name: '보낼 메시지가 없어요' }),
    ).toBeVisible()
    expect(
      screen.getByText(
        '마감이 다가오면 담당자에게 보낼 DM을 여기에 준비해 둘게요. 승인해야 나가요.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '메시지 목록' })).toBeNull()
    expect(screen.getByRole('link', { name: '알림 규칙 보기' })).toHaveAttribute(
      'href',
      paths.settings('ws_01'),
    )
  })

  it('보낼 메시지만 없으면 그 영역에 비었다고 쓰고, 들어왔을 때 고를 것을 안내한다', async () => {
    db.messageBundles = []
    await openInbox()
    expect(within(reviewList()).getByRole('heading')).toHaveTextContent('보내기 전 확인 0')
    expect(within(reviewList()).getByText('지금 확인할 메시지가 없어요.')).toBeInTheDocument()
    expect(rowTexts(threadList())).toHaveLength(4)
    expect(current()).toEqual([])
    expect(
      detail().getByText('왼쪽 목록에서 확인할 메시지나 대화를 골라 주세요.'),
    ).toBeInTheDocument()
  })

  it('목록을 받는 동안 목록 칸과 상세 칸은 스켈레톤이다 — 빈 상태도 오류도 아니다', async () => {
    const gate = hold('/workspaces/ws_01/messages')
    renderApp(paths.messages('ws_01'))
    const skeleton = await screen.findByTestId('message-list-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('message-review-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('보낼 메시지가 없어요')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => gate.resolve())
    expect(await detail().findByRole('heading', { name: '이 메시지, 보낼까요?' })).toBeVisible()
    expect(screen.queryByTestId('message-list-skeleton')).toBeNull()
  })

  it('목록 오류는 목록 칸에서 다시 시도로 알리고, 고른 대화는 그대로 보인다', async () => {
    db.messageFailures.inbox = true
    renderApp(paths.messageThread('ws_01', 'th_01'))
    expect(await screen.findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    const alert = await list().findByRole('alert', {}, { timeout: 4_000 })
    expect(alert).toHaveTextContent('메시지 목록을 불러오지 못했어요')
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
    expect(rowTexts(threadList())).toHaveLength(4)
  })
})

describe('워크스페이스를 바꾸면 이전 공간의 메시지가 보이지 않는다 (AC-05)', () => {
  beforeEach(() => {
    db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_02')!.onboarding.completed = true
    setMockRole('pm', 'ws_02')
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
    await waitFor(() => expect(rowTexts(threadList())).toEqual(['한결랜딩 시안 공유드려요09/16']))
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

describe('대화 행을 가리키거나 포커스하면 그 대화를 미리 받는다', () => {
  const TH_02 = '/workspaces/ws_01/messages/threads/th_02'
  const row = (name: RegExp) => within(threadList()).getByRole('link', { name })
  const messageRequests = (log: ReturnType<typeof recordRequests>) =>
    log.started.map(({ path }) => path).filter((path) => path.includes('/messages'))
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 80)))

  /** 상세 칸에 스켈레톤이 한 번이라도 붙었는지 지켜본다 — 붙었다 곧 떨어져도 기록의 붙은 노드로 잡는다 */
  function watchSkeleton() {
    let seen = false
    const check = (records: MutationRecord[]) => {
      for (const { addedNodes } of records)
        for (const node of addedNodes)
          if (node instanceof Element && node.closest('[data-testid="message-thread-skeleton"]'))
            seen = true
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      check(observer.takeRecords())
      observer.disconnect()
      return seen
    }
  }

  it('가리키면 그 대화를 한 번 받고, 고르면 스켈레톤 없이 바로 그리며 다시 묻지 않는다', async () => {
    const app = await openInbox()
    const log = recordRequests()

    await userEvent.hover(row(/박민수/))
    await waitFor(() =>
      expect(
        app.queryClient.getQueryData(messageThreadQueryOptions('ws_01', 'th_02').queryKey),
      ).toBeDefined(),
    )
    expect(messageRequests(log)).toEqual([TH_02])

    const skeletonSeen = watchSkeleton()
    await userEvent.click(row(/박민수/))
    expect(detail().getByRole('heading', { level: 2, name: '박민수' })).toBeVisible()
    await settle()
    expect(skeletonSeen()).toBe(false)
    // 연 대화에서 PM 은 답장 고르기만 새로 받는다 (#344)
    expect(messageRequests(log)).toEqual([TH_02, `${TH_02}/attributions`])
  })

  it('같은 행을 다시 가리켜도 staleTime(앱 기본 30초) 안에는 다시 받지 않고, 지나면 다시 받는다', async () => {
    await openInbox()
    const log = recordRequests()

    await userEvent.hover(row(/박민수/))
    await waitFor(() => expect(messageRequests(log)).toEqual([TH_02]))
    await settle()
    await userEvent.unhover(row(/박민수/))
    await userEvent.hover(row(/박민수/))
    await settle()
    expect(messageRequests(log)).toEqual([TH_02])

    vi.setSystemTime(Date.parse(MOCK_NOW) + STALE_TIME.default + 1)
    await userEvent.unhover(row(/박민수/))
    await userEvent.hover(row(/박민수/))
    await waitFor(() => expect(messageRequests(log)).toEqual([TH_02, TH_02]))
  })

  it('키보드로 포커스해도 미리 받는다', async () => {
    await openInbox()
    const log = recordRequests()

    act(() => row(/박민수/).focus())
    await waitFor(() => expect(messageRequests(log)).toEqual([TH_02]))
  })

  it('미리 받기가 실패해도 화면에 알리지 않고, 고르면 대화 칸이 그 오류를 알린다', async () => {
    db.messageFailures.threadIds = ['th_02']
    await openInbox()
    const log = recordRequests()

    await userEvent.hover(row(/박민수/))
    // 5xx 는 1초 뒤 한 번 더 묻는다 — 두 번 모두 실패할 때까지 기다린다
    await waitFor(() => expect(log.answered.filter(({ path }) => path === TH_02)).toHaveLength(2), {
      timeout: 4_000,
    })
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()

    await userEvent.click(row(/박민수/))
    const alert = await detail().findByRole('alert', {}, { timeout: 4_000 })
    expect(alert).toHaveTextContent('대화를 불러오지 못했어요')
  })

  it('보낼 메시지 행은 가리켜도 요청이 없다 — 목록 응답에 상세가 다 있다', async () => {
    await openInbox()
    const log = recordRequests()

    await userEvent.hover(within(reviewList()).getByRole('link', { name: /정하늘/ }))
    await settle()
    expect(messageRequests(log)).toEqual([])
  })
})

describe('키보드만으로 목록 이동·선택·상세 확인이 되고, 이름과 색 외 상태 표현이 있다 (AC-07)', () => {
  /** 포커스가 target 에 닿을 때까지 Tab 을 누른다. 화면 순서대로 닿아야 한다 */
  async function tabTo(target: HTMLElement) {
    for (let step = 0; step < 40 && document.activeElement !== target; step += 1)
      await userEvent.tab()
    expect(document.activeElement).toBe(target)
  }

  it('Tab 으로 묶음에 가서 Enter 로 고르고, 다시 Tab 으로 대화를 골라 내용 칸까지 간다', async () => {
    const app = await openInbox()
    const bundleRow = within(reviewList()).getByRole('link', { name: /정하늘/ })
    await tabTo(bundleRow)
    await userEvent.keyboard('{Enter}')
    await app.expectSearch('?review=bd_02')
    expect(await detail().findByRole('heading', { name: '이 메시지, 보낼까요?' })).toBeVisible()
    expect(document.activeElement).toBe(bundleRow)
    expect(bundleRow).toHaveAttribute('aria-current', 'page')

    const thread = within(threadList()).getByRole('link', { name: /이재환/ })
    await tabTo(thread)
    await userEvent.keyboard('{Enter}')
    await app.expectPath(paths.messageThread('ws_01', 'th_01'))
    expect(await detail().findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    expect(document.activeElement).toBe(thread)

    await tabTo(conversation())
  })

  it('보낼 시각 카드는 Tab 으로 닿는 라디오이고, 서버가 정한 시각의 카드가 골라져 있다', async () => {
    await openInbox(paths.messageReview('ws_01', 'bd_01'))
    const deadline = await detail().findByRole('radio', { name: /마감 하루 전/ })
    await tabTo(deadline)
    expect(deadline).toBeChecked()
  })

  it('답장 대기와 DM 못 보냄은 색이 아니라 글자로도 읽힌다', async () => {
    await openInbox(paths.messageThread('ws_01', 'th_01'))
    expect(within(threadList()).getByRole('link', { name: /이재환/ })).toHaveTextContent(
      '답장 기다리는 중',
    )
    expect(within(threadList()).getByRole('link', { name: /박민수/ })).not.toHaveTextContent(
      '답장 기다리는 중',
    )
    expect(await detail().findByText('답장 3일째 없음')).toBeVisible()
  })
})

/*
 * 디자인 값 (VR-05 ~ VR-09). jsdom 은 Tailwind 를 계산하지 않아 클래스로 고정한다 — 실제 계산 값은 결과 문서 C 의 브라우저 측정이 본다
 */
describe('목록 라벨·보낼 시각 포커스 선·버튼 크기가 디자인 시스템과 Messages 캔버스 값이다', () => {
  it('목록 영역 라벨은 400 이다 — h2 기본 굵기를 받지 않는다', async () => {
    await openInbox()
    expect(within(reviewList()).getByRole('heading')).toHaveClass('font-normal')
    expect(within(threadList()).getByRole('heading', { name: '대화' })).toHaveClass('font-normal')
  })

  it('보낼 시각 카드의 포커스 선은 테두리 위(-1)이고, 고른 먹 면 카드는 안쪽 흰 선(-3)이다 — 양수 offset 이 없다', async () => {
    await openInbox(paths.messageReview('ws_01', 'bd_01'))
    const card = detail()
      .getByRole('radio', { name: /직접 정하기/ })
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
    await openInbox(paths.messageReview('ws_01', 'bd_01'))
    const button = (name: string) => detail().getByRole('button', { name })
    expect(button('고쳐 쓰기')).toHaveClass('h-36', 'px-11', 'text-[12px]')
    expect(button('보내지 않음')).toHaveClass('h-44', 'px-18', 'text-[14px]')
    expect(button('이대로 발송')).toHaveClass('h-44', 'px-24', 'gap-8', 'text-[14.5px]')

    await userEvent.click(button('고쳐 쓰기'))
    expect(button('취소')).toHaveClass('h-36')
    expect(button('저장')).toHaveClass('h-36')
    await userEvent.click(button('취소'))

    await userEvent.click(detail().getByRole('radio', { name: /직접 정하기/ }))
    expect(button('이 시각으로 정하기')).toHaveClass('h-36')
    expect(button('취소')).toHaveClass('h-36')
  })
})

describe('팀원은 자기 대화만 보고 웹에서 답장한다', () => {
  it('받은 대화가 없으면 답장 안내만 있다', async () => {
    applyScenario('messages-member')
    db.messageThreads = db.messageThreads.filter(({ member_id }) => member_id !== 'mb_01')
    renderApp(paths.messages('ws_01'))
    expect(await screen.findByRole('heading', { name: '받은 메시지가 없어요' })).toBeVisible()
    expect(
      screen.getByText('카테캠 3팀 봇이 메시지를 보내면 여기에서 보고 답장할 수 있어요.'),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: '알림 규칙 보기' })).toBeNull()
  })

  it('첫 대화를 열고, 보낼 메시지·답장 대기는 보이지 않으며 DM 못 보냄과 웹 답장은 보인다', async () => {
    applyScenario('messages-member')
    const app = await openInbox()
    await app.expectPath(paths.messages('ws_01'))
    expect(list().queryByRole('region', { name: /^보내기 전 확인/ })).toBeNull()
    expect(current()).toHaveLength(1)
    expect(current()[0]).toHaveTextContent('카테캠 3팀 봇')
    expect(await detail().findByRole('heading', { level: 2, name: '카테캠 3팀 봇' })).toBeVisible()
    expect(detail().getByText('Discord 개인 메시지 · 웹에서도 답장할 수 있어요')).toBeVisible()
    expect(columnOf('서연님, 이번 주 할 일을 정리해 뒀어요.')).toHaveClass('items-start')
    expect(columnOf('디스코드에서 답했어요')).toHaveClass('items-end')
    expect(within(conversation()).getByText('14:20 · 웹에서 답장')).toBeVisible()
    expect(
      within(conversation()).getByText('DM 못 보냄 · Discord 계정이 연결되지 않았어요'),
    ).toBeVisible()
    expect(detail().queryByText(/답장 \d+일째 없음/)).toBeNull()
    expect(detail().queryByRole('link', { name: '확인하기' })).toBeNull()
    expect(screen.queryByText('서연님, 이 재촉은 보내기 전 확인에만 있어요.')).toBeNull()
    expect(detail().getByText(/봇 DM 창에 쓴 글은 모두 PM 대화에 보여요/)).toBeVisible()
  })

  it('빈 칸·공백뿐인 칸에서는 답장 보내기가 꺼져 있고, 적은 답장은 웹에서 답장으로 대화에 남고 칸은 비운다', async () => {
    applyScenario('messages-member')
    await openInbox()
    const field = await detail().findByRole('textbox', { name: '답장' })
    const send = detail().getByRole('button', { name: '답장 보내기' })
    expect(field).toHaveAccessibleDescription(/봇 DM 창에 쓴 글은 모두 PM 대화에 보여요/)
    const log = recordRequests()
    expect(send).toBeDisabled()
    await userEvent.type(field, '   {Enter}')
    await settle()
    expect(send).toBeDisabled()
    expect(log.started.some(isReply)).toBe(false)
    expect(detail().queryByRole('alert')).toBeNull()

    await userEvent.clear(field)
    await userEvent.type(field, '웹에서 한 줄 더')
    expect(send).toBeEnabled()
    const threadBody = conversation()
    threadBody.scrollTop = 0
    Object.defineProperty(threadBody, 'scrollHeight', { configurable: true, get: () => 480 })
    await userEvent.click(send)
    expect(await within(conversation()).findByText('웹에서 한 줄 더')).toBeVisible()
    expect(within(conversation()).getByText('09:00 · 웹에서 답장')).toBeVisible()
    expect(conversation().scrollTop).toBe(480)
    await waitFor(() => expect(field).toHaveValue(''))
    expect(send).toBeDisabled()
  })

  it('Enter 로 보내고 Shift+Enter 는 줄을 바꾼다 — 보내는 동안 칸과 버튼이 잠기고, 보낸 뒤에도 칸에 포커스가 있다', async () => {
    applyScenario('messages-member')
    await openInbox()
    const field = await detail().findByRole('textbox', { name: '답장' })
    const log = recordRequests()
    const request = hold('/workspaces/ws_01/messages/threads/:threadId/replies', 'post')
    await userEvent.type(field, '첫 줄{Shift>}{Enter}{/Shift}둘째 줄')
    await settle()
    expect(field).toHaveValue('첫 줄\n둘째 줄')
    expect(log.started.some(isReply)).toBe(false)

    await userEvent.keyboard('{Enter}')
    const send = detail().getByRole('button', { name: '답장 보내기' })
    await waitFor(() => expect(request.calls()).toBe(1))
    expect(send).toHaveAttribute('aria-busy', 'true')
    expect(send).toBeDisabled()
    expect(field).toBeDisabled()

    request.resolve()
    expect(await within(conversation()).findByText('첫 줄 둘째 줄')).toBeVisible()
    await waitFor(() => expect(field).toBeEnabled())
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
  })

  it('한글 조합 중 Enter 는 보내지 않는다', async () => {
    applyScenario('messages-member')
    await openInbox()
    const field = await detail().findByRole('textbox', { name: '답장' })
    await userEvent.type(field, '안녕')
    const log = recordRequests()
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    await settle()
    expect(log.started.some(isReply)).toBe(false)
    expect(field).toHaveValue('안녕')

    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await within(conversation()).findByText('안녕')).toBeVisible()
  })

  it('1,800자를 넘으면 키 안내 자리에 글자 수를 보이고, 2,000자에 닿으면 강조색이다', async () => {
    applyScenario('messages-member')
    await openInbox()
    const field = await detail().findByRole('textbox', { name: '답장' })
    const keyHint = 'Enter 보내기 · Shift+Enter 줄 바꿈'
    expect(detail().getByText(keyHint)).toBeInTheDocument()

    fireEvent.change(field, { target: { value: '가'.repeat(1800) } })
    expect(detail().getByText(keyHint)).toBeInTheDocument()
    expect(detail().queryByText(/ \/ 2,000$/)).toBeNull()

    fireEvent.change(field, { target: { value: '가'.repeat(1801) } })
    expect(detail().queryByText(keyHint)).toBeNull()
    expect(detail().getByText('1,801 / 2,000')).not.toHaveClass('text-accent')

    fireEvent.change(field, { target: { value: '가'.repeat(2000) } })
    expect(detail().getByText('2,000 / 2,000')).toHaveClass('text-accent')
  })

  it('답장을 보내지 못하면 칸 위에 알리고 쓰던 글을 남긴다 — 다시 보내기는 지금 칸의 글을 보낸다', async () => {
    applyScenario('messages-member')
    db.messageFailures.actions = true
    await openInbox()
    const field = await detail().findByRole('textbox', { name: '답장' })
    await userEvent.type(field, '남겨 둘 답장')
    await userEvent.click(detail().getByRole('button', { name: '답장 보내기' }))
    const alert = await detail().findByRole('alert')
    expect(alert).toHaveTextContent('답장을 보내지 못했어요')
    expect(alert.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(field).toBeEnabled())
    expect(field).toHaveValue('남겨 둘 답장')

    db.messageFailures.actions = false
    await userEvent.type(field, ' 더')
    await userEvent.click(within(alert).getByRole('button', { name: '다시 보내기' }))
    expect(await within(conversation()).findByText('남겨 둘 답장 더')).toBeVisible()
    await waitFor(() => expect(field).toHaveValue(''))
    expect(detail().queryByRole('alert')).toBeNull()
  })

  it('남의 대화 주소는 찾을 수 없다고 알린다 (서버는 403)', async () => {
    applyScenario('messages-member')
    await openInbox(paths.messageThread('ws_01', 'th_01'))
    expect(await detail().findByRole('heading', { name: '대화를 찾을 수 없어요' })).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('팀원 행이 있는 PM 은 자기 대화에서만 웹으로 답장한다 (#367)', () => {
  const replyForm = () => detail().queryByRole('form', { name: '답장' })
  const footNote = () => detail().getByText(/메시지는 항상/)

  it('자기 대화에는 답장 칸이 있고, 보낸 답장은 웹에서 답장으로 대화에 남는다', async () => {
    applyScenario('messages-pm-self')
    await openInbox(paths.messageThread('ws_01', 'th_06'))
    const field = await detail().findByRole('textbox', { name: '답장' })
    expect(detail().getByText('Discord 개인 메시지 · 웹에서도 답장할 수 있어요')).toBeVisible()
    expect(detail().queryByText(/메시지는 항상/)).toBeNull()
    expect(detail().getByRole('button', { name: '답장 보내기' })).toBeDisabled()

    await userEvent.type(field, 'PM 이 웹에서 남긴 답장{Enter}')
    expect(await within(conversation()).findByText('PM 이 웹에서 남긴 답장')).toBeVisible()
    expect(within(conversation()).getByText('09:00 · 웹에서 답장')).toBeVisible()
    await waitFor(() => expect(field).toHaveValue(''))
  })

  it('남의 대화에는 답장 칸 대신 봇 안내가 있다', async () => {
    applyScenario('messages-pm-self')
    await openInbox(paths.messageThread('ws_01', 'th_01'))
    expect(await detail().findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    expect(footNote()).toBeVisible()
    expect(replyForm()).toBeNull()
  })

  // 이 칸을 넣기 전 백엔드는 member_id 를 주지 않는다. 자기 대화인지 모르면 서버가 403 으로 막을 답장 칸을 두지 않는다
  it.each([
    ['공간 응답에 member_id 가 없으면', {}],
    ['공간 응답의 member_id 가 null 이면', { member_id: null }],
  ])('%s 자기 대화도 남의 대화처럼 대화 목록에 있고 답장 칸이 없다', async (_, field) => {
    applyScenario('messages-pm-self')
    server.use(
      http.get('/api/v1/workspaces', () =>
        listResponse(
          db.workspaces
            .filter(({ workspace_id }) => isMemberOf(workspace_id))
            .map((workspace) => ({ ...workspace, ...field })),
        ),
      ),
    )
    await openInbox(paths.messageThread('ws_01', 'th_06'))
    expect(await detail().findByRole('heading', { level: 2, name: '김서연' })).toBeVisible()
    expect(footNote()).toBeVisible()
    expect(replyForm()).toBeNull()
    expect(list().queryByRole('region', { name: SELF_SECTION_TITLE })).toBeNull()
    expect(rowTexts(threadList())).toContain(
      '김서연DM 못 보냄나: 서연님, 오늘 남은 확인만 부탁드려요.09/17답장 기다리는 중',
    )
    expect(within(threadList()).getByText('답장 기다리는 중 3')).toBeInTheDocument()
  })
})

describe('PM 의 자기 대화는 목록 맨 위 구역에 따로 두고 팀원 화면 규칙으로 그린다 (#417)', () => {
  const selfList = () => list().getByRole('region', { name: SELF_SECTION_TITLE })
  const sectionTitles = () =>
    list()
      .getAllByRole('region')
      .map((region) => region.querySelector('h2')?.textContent)

  it('자기 대화는 보내기 전 확인 위 구역에만 있고, 대화와 답장 기다리는 중 N 에서 빠진다', async () => {
    applyScenario('messages-pm-self')
    await openInbox()
    expect(sectionTitles()).toEqual([SELF_SECTION_TITLE, '보내기 전 확인 3', '대화'])
    expect(rowTexts(selfList())).toEqual([
      '카테캠 3팀 봇DM 못 보냄서연님, 오늘 남은 확인만 부탁드려요.09/17',
    ])
    expect(rowTexts(threadList()).map((row) => row.slice(0, 3))).toEqual([
      '이재환',
      '박민수',
      '정하늘',
      '박지훈',
    ])
    // 자기 대화도 마지막이 봇 메시지라 남의 대화였다면 셋째로 셌다 — member_id 없음 테스트가 3 을 본다
    expect(within(threadList()).getByText('답장 기다리는 중 2')).toBeInTheDocument()
    // 자기 대화의 보낼 메시지도 PM 권한으로 그대로 확인한다
    expect(rowTexts(reviewList())).toContain('김서연09/24 마감기획서')
  })

  it('자기 대화는 봇이 왼쪽·자기 답장이 오른쪽이고, 답장 기다림 없이 답장 칸과 예정 묶음 확인하기가 있다', async () => {
    applyScenario('messages-pm-self')
    await openInbox(paths.messageThread('ws_01', 'th_06'))
    expect(await detail().findByRole('heading', { level: 2, name: '카테캠 3팀 봇' })).toBeVisible()
    expect(detail().queryByText(/답장 \d+일째 없음/)).toBeNull()
    expect(within(conversation()).queryByText(/여기서부터 답장이 없습니다/)).toBeNull()
    expect(columnOf('서연님, 이번 주 할 일을 정리해 뒀어요.')).toHaveClass('items-start')
    expect(columnOf('디스코드에서 답했어요')).toHaveClass('items-end')
    expect(detail().getByRole('textbox', { name: '답장' })).toBeVisible()
    expect(within(conversation()).getByRole('link', { name: '확인하기' })).toHaveAttribute(
      'href',
      paths.messageReview('ws_01', 'bd_05'),
    )
  })

  it('리마인드 알림을 누르면 자기 대화로 가고 맨 위 구역의 행이 골라진다', async () => {
    applyScenario('messages-pm-self')
    db.notifications = [
      {
        notification_id: 'nt_11',
        workspace_id: 'ws_01',
        member_id: 'mb_01',
        kind: 'reminder_sent',
        text: '기획서 진행 상황을 물어봤어요.',
        link: { type: 'thread', id: 'th_06' },
        read_at: null,
        created_at: '2026-09-17T18:00:00+09:00',
      },
    ]
    const app = await openInbox()
    await userEvent.click(await screen.findByRole('button', { name: '알림, 읽지 않은 알림 1개' }))
    const bell = await screen.findByRole('dialog', { name: '알림 목록' })
    await userEvent.click(within(bell).getByRole('button', { name: /기획서 진행 상황을/ }))

    await app.expectPath(paths.messageThread('ws_01', 'th_06'))
    await waitFor(() => expect(current()).toHaveLength(1))
    expect(selfList()).toContainElement(current()[0] ?? null)
    expect(
      within(threadList())
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page'),
    ).toEqual([])
  })

  it('자기 대화가 없는 PM 에게는 그 구역이 없다', async () => {
    await openInbox()
    expect(list().queryByRole('region', { name: SELF_SECTION_TITLE })).toBeNull()
    expect(sectionTitles()).toEqual(['보내기 전 확인 2', '대화'])
  })
})
