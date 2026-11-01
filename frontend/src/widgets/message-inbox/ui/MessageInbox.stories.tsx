import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, within } from 'storybook/test'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MessageInbox } from './MessageInbox'

/*
 * 메시지 (M8, Messages·MessagesThread·EmptyMessages 시안 그대로). ws_01 하나에 PM 으로 로그인한 상태다.
 * 데이터는 임시 MSW handler 다 — 경로·모양은 계약이 아니다. 시작 db 는 shared/mock/scenarios.ts 의 `messages-*` 시나리오다.
 * 행동(발송·보내지 않음·고쳐 쓰기·발송 시점·승인·반려)은 MSW 목이 성공한 뒤에만 화면을 바꾼다 (D-137).
 * Storybook 은 시계를 MOCK_NOW 로 고정하지 않는다 — 오늘 기준 상대 표기(`3일 전`, `답장 N일째 없음`)의 숫자는 단언하지 않는다
 */

const meta = {
  title: 'M8 메시지/화면',
  component: MessageInbox,
  args: { workspaceId: 'ws_01', botName: '카테캠 3팀', threadId: null, reviewId: undefined },
  parameters: { scenario: 'messages-default', route: paths.messages('ws_01') },
} satisfies Meta<typeof MessageInbox>

export default meta
type Story = StoryObj<typeof meta>

const detailOf = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: '메시지 내용' }))

/** 들어온 그대로 — Messages 시안처럼 첫 보내기 전 확인 항목이 골라져 있다. 보내기 전 확인 2, 대화 4 + 채널 1, 답장 대기 1 */
export const 기본: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('보내기 전 확인 2')).toBeInTheDocument()
    await expect(canvas.getByText('답장 기다리는 중 1')).toBeInTheDocument()
    await expect(canvas.getByText('09/24 마감')).toBeInTheDocument()
    const threads = canvas.getByRole('region', { name: '대화' })
    await expect(within(threads).getAllByRole('link')).toHaveLength(5)
    await expect(
      await detailOf(canvasElement).findByText('이 메시지, 보낼까요?'),
    ).toBeInTheDocument()
  },
}

/** 보내기 전 확인 — 미리보기(매스·BOT·예정 시각)·고쳐 쓰기·왜 보내려 하나요·언제 보낼까요·보내지 않음·이대로 발송 */
export const 검토_항목: Story = {
  args: { reviewId: 'rv_01' },
  parameters: { route: paths.messageReview('ws_01', 'rv_01') },
  play: async ({ canvasElement }) => {
    const detail = detailOf(canvasElement)
    await expect(await detail.findByText('이 메시지, 보낼까요?')).toBeInTheDocument()
    await expect(detail.getByText('09/23 09:00 예정')).toBeInTheDocument()
    await expect(detail.getByRole('button', { name: '고쳐 쓰기' })).toBeEnabled()
    await expect(detail.getByText('왜 보내려 하나요')).toBeInTheDocument()
    await expect(detail.getByRole('radio', { name: /마감 하루 전/ })).toBeChecked()
    await expect(detail.getByRole('button', { name: '보내지 않음' })).toBeEnabled()
    await expect(detail.getByRole('button', { name: '이대로 발송' })).toBeEnabled()
  },
}

/** 고쳐 쓰는 중 — 문구 칸이 열려 포커스를 받고, 발송은 잠긴다(포커스를 남기는 aria-disabled) */
export const 고쳐_쓰기: Story = {
  args: { reviewId: 'rv_01' },
  parameters: { route: paths.messageReview('ws_01', 'rv_01') },
  play: async ({ canvasElement }) => {
    const detail = detailOf(canvasElement)
    await userEvent.click(await detail.findByRole('button', { name: '고쳐 쓰기' }))
    const field = detail.getByRole('textbox', { name: '보낼 문구' })
    await expect(field).toBeVisible()
    await expect(field).toHaveFocus()
    await expect(detail.getByRole('button', { name: '이대로 발송' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/** 발송이 실패했다 — 화면은 그대로이고 그 자리에 다시 시도를 알린다 */
export const 발송_실패: Story = {
  args: { reviewId: 'rv_01' },
  parameters: { scenario: 'messages-send-fail', route: paths.messageReview('ws_01', 'rv_01') },
  play: async ({ canvasElement }) => {
    const detail = detailOf(canvasElement)
    await userEvent.click(await detail.findByRole('button', { name: '이대로 발송' }))
    const alert = await detail.findByRole('alert', {}, { timeout: 4_000 })
    await expect(alert).toHaveTextContent('메시지를 보내지 못했어요')
    await expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeEnabled()
    await expect(within(canvasElement).getByText('보내기 전 확인 2')).toBeInTheDocument()
  },
}

/** 답장이 없는 사람별 대화 — 머리 부제·답장 없음 배지·Discord에서 열기, 시각 줄, 답장 없음 칩, 승인 대기 점선 말풍선, 안내 바 */
export const 대화: Story = {
  args: { threadId: 'th_01' },
  parameters: { route: paths.messageThread('ws_01', 'th_01') },
  play: async ({ canvasElement }) => {
    const detail = detailOf(canvasElement)
    await expect(await detail.findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    await expect(detail.getByText(/백엔드 · Discord 개인 메시지/)).toBeInTheDocument()
    await expect(detail.getByText(/^답장 \d+일째 없음$/)).toBeInTheDocument()
    await expect(detail.getByRole('link', { name: /Discord에서 열기/ })).toBeInTheDocument()
    await expect(detail.getByText('09:02 · 자동 발송')).toBeInTheDocument()
    await expect(detail.getByText(/여기서부터 답장이 없습니다/)).toBeInTheDocument()
    await expect(detail.getByRole('button', { name: '승인' })).toBeEnabled()
    await expect(detail.getByRole('link', { name: '확인하기' })).toBeInTheDocument()
  },
}

/** 승인 대기를 승인했다 — 서버가 성공한 뒤 점선 말풍선이 예약 메시지가 된다 */
export const 대화_승인: Story = {
  args: { threadId: 'th_01' },
  parameters: { route: paths.messageThread('ws_01', 'th_01') },
  play: async ({ canvasElement }) => {
    const detail = detailOf(canvasElement)
    await userEvent.click(await detail.findByRole('button', { name: '승인' }))
    await expect(await detail.findByText(/발송 예정 · 최진호 승인/)).toBeInTheDocument()
    await expect(detail.queryByRole('button', { name: '승인' })).toBeNull()
  },
}

/** 검토도 대화도 없다 — EmptyMessages, `알림 규칙 보기` 는 팀 설정으로 간다 */
export const 빈_상태: Story = {
  parameters: { scenario: 'messages-empty' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('보낼 메시지가 없어요')).toBeInTheDocument()
    await expect(canvas.queryByRole('complementary')).toBeNull()
    await expect(canvas.getByRole('link', { name: '알림 규칙 보기' })).toBeInTheDocument()
  },
}

/** 목록과 대화 조회가 늦다 — 칸마다 스켈레톤 */
export const 로딩: Story = {
  args: { threadId: 'th_01' },
  parameters: {
    route: paths.messageThread('ws_01', 'th_01'),
    msw: [
      http.get('/api/v1/workspaces/:workspaceId/messages', async () => {
        await delay('infinite')
      }),
      http.get('/api/v1/workspaces/:workspaceId/messages/threads/:threadId', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('message-list-skeleton')).toBeInTheDocument()
    await expect(canvas.getByTestId('message-thread-skeleton')).toBeInTheDocument()
  },
}

/** 목록만 실패 — 목록 칸의 다시 시도, 고른 대화는 그대로 */
export const 목록_오류: Story = {
  args: { threadId: 'th_02' },
  parameters: { scenario: 'messages-list-error', route: paths.messageThread('ws_01', 'th_02') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = within(canvas.getByRole('complementary', { name: '메시지 목록' }))
    await expect(
      await list.findByText('메시지 목록을 불러오지 못했어요', {}, { timeout: 4_000 }),
    ).toBeInTheDocument()
    await expect(
      await detailOf(canvasElement).findByRole('heading', { level: 2, name: '박민수' }),
    ).toBeVisible()
  },
}

/** 이재환과의 대화만 실패 — 상세 칸의 다시 시도, 목록은 그대로 */
export const 대화_오류: Story = {
  args: { threadId: 'th_01' },
  parameters: { scenario: 'messages-thread-error', route: paths.messageThread('ws_01', 'th_01') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await detailOf(canvasElement).findByText('대화를 불러오지 못했어요', {}, { timeout: 4_000 }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('보내기 전 확인 2')).toBeInTheDocument()
  },
}

/* 긴 문구 — 여러 줄 본문, 줄바꿈 기회가 없는 긴 주소, 띄어 쓰지 않은 긴 이름 (전역 `keep-all` 이라 한글도 끊기지 않는다) */
const UNBROKEN_URL = `https://discord.com/channels/@me/${'a1b2c3d4'.repeat(16)}`
const LONG_NAME = '알렉산더막시밀리안몽고메리김백엔드리드개발자'
const LONG_BOT_NAME = '카카오테크캠퍼스경북대학교3기세번째팀프로젝트공간'
const LONG_BODY = [
  ...Array.from(
    { length: 12 },
    (_, index) =>
      `${index + 1}번째 줄이에요. 카드 폭보다 길게 써서 자동 줄바꿈이 일어나도 내용이 잘리지 않는지 봅니다.`,
  ),
  UNBROKEN_URL,
].join('\n')

const fillLongMessages = () => {
  const review = db.messageReviews.find(({ review_id }) => review_id === 'rv_01')
  const thread = db.messageThreads.find(({ thread_id }) => thread_id === 'th_01')
  if (!review || !thread) throw new Error('mock review rv_01 or thread th_01 is missing')
  review.recipient_name = LONG_NAME
  review.body = LONG_BODY
  review.reason = `${review.reason} ${UNBROKEN_URL}`
  thread.name = LONG_NAME
  thread.messages.push({
    message_id: 'mg_80',
    sender: 'counterpart',
    body: `링크 남겨요\n${UNBROKEN_URL}`,
    sent_at: '2026-09-16T19:00:00+09:00',
    status: 'sent',
    delivery: null,
    approved_by: null,
  })
}

/** 내용이 칸을 넘지 않는다 — 레이아웃은 jsdom 이 재지 못해 브라우저에서 실측한다 */
const expectNoOverflow = async (element: Element) => {
  await expect(element.scrollHeight).toBeLessThanOrEqual(element.clientHeight)
  await expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth)
}
const expectNoHorizontalOverflow = async (element: Element) => {
  await expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth)
}

/** 긴 문구의 Discord DM 미리보기 — 카드가 본문 높이만큼 늘어나고 긴 주소·이름은 칸 안에서 줄을 바꾼다 */
export const 긴_문구_미리보기: Story = {
  args: { reviewId: 'rv_01', botName: LONG_BOT_NAME },
  parameters: { route: paths.messageReview('ws_01', 'rv_01'), setup: fillLongMessages },
  play: async ({ canvasElement }) => {
    const detail = detailOf(canvasElement)
    const card = await detail.findByRole('region', { name: '보낼 메시지 미리보기' })
    const body = await within(card).findByText(/12번째 줄이에요/)
    await expectNoOverflow(card)
    await expectNoHorizontalOverflow(body)
    // 상세 칸은 세로로만 스크롤한다 — 가로로 넘치는 글자가 없다
    const page = card.closest('article')?.parentElement
    if (!page) throw new Error('review detail scroll pane is missing')
    await expectNoHorizontalOverflow(page)
  },
}

/** 며칠에 걸친 긴 대화 — 대화 칸만 세로로 스크롤하고 가장 최근 메시지부터 보인다 */
export const 긴_대화: Story = {
  args: { threadId: 'th_02' },
  parameters: {
    route: paths.messageThread('ws_01', 'th_02'),
    setup: () => {
      const thread = db.messageThreads.find(({ thread_id }) => thread_id === 'th_02')
      if (!thread) throw new Error('mock thread th_02 is missing')
      for (let index = 0; index < 30; index += 1) {
        const day = String(10 + Math.floor(index / 4)).padStart(2, '0')
        thread.messages.push({
          message_id: `mg_${String(50 + index)}`,
          sender: index % 3 === 0 ? 'counterpart' : 'bot',
          body:
            index % 3 === 0
              ? `${index + 1}번째 답장이에요. 확인했습니다.`
              : `${index + 1}번째 메시지예요. 진행 상황을 한 번 더 알려 주세요 🙂\n막히는 부분이 있으면 편하게 말해 주세요.`,
          sent_at: `2026-09-${day}T${String(9 + (index % 4)).padStart(2, '0')}:00:00+09:00`,
          status: 'sent',
          delivery: index % 3 === 0 ? null : 'auto',
          approved_by: null,
        })
      }
    },
  },
  play: async ({ canvasElement }) => {
    const detail = detailOf(canvasElement)
    await expect(await detail.findByText(/30번째 메시지예요/)).toBeInTheDocument()
    const conversation = detail.getByRole('region', { name: '대화 내용' })
    await expect(conversation.scrollHeight).toBeGreaterThan(conversation.clientHeight)
    await expect(conversation.scrollTop).toBeGreaterThan(0)
  },
}
