import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, within } from 'storybook/test'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MessageInbox } from './MessageInbox'

/*
 * 메시지 (M8 결정 전 부분, Messages·MessagesThread·EmptyMessages 시안). ws_01 하나에 PM 으로 로그인한 상태다.
 * 데이터는 임시 MSW handler 다 — 경로·모양은 계약이 아니다. 시작 db 는 shared/mock/scenarios.ts 의 `messages-*` 시나리오다.
 * 행동(발송·반려)은 결정 4 뒤에 붙인다
 */

const meta = {
  title: 'M8 메시지/화면',
  component: MessageInbox,
  args: { workspaceId: 'ws_01', botName: '카테캠 3팀', threadId: null, reviewId: null },
  parameters: { scenario: 'messages-default', route: paths.messages('ws_01') },
} satisfies Meta<typeof MessageInbox>

export default meta
type Story = StoryObj<typeof meta>

const detailOf = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: '메시지 내용' }))

/** 고르기 전 — 보내기 전 확인 2, 대화 4 + 채널 1, 답장 대기 1 */
export const 기본: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('보내기 전 확인 2')).toBeInTheDocument()
    await expect(canvas.getByText('답장 기다리는 중 1')).toBeInTheDocument()
    const threads = canvas.getByRole('region', { name: '대화' })
    await expect(within(threads).getAllByRole('link')).toHaveLength(5)
  },
}

/** 보내기 전 확인 항목을 골랐다 — 읽기 전용 미리보기, 행동 버튼 없음 */
export const 검토_항목: Story = {
  args: { reviewId: 'rv_01' },
  parameters: { route: paths.messageReview('ws_01', 'rv_01') },
  play: async ({ canvasElement }) => {
    const detail = detailOf(canvasElement)
    await expect(await detail.findByText('이 메시지, 보낼까요?')).toBeInTheDocument()
    await expect(detail.queryByRole('button')).toBeNull()
  },
}

/** 답장 대기 중인 사람별 대화 — 날짜 구분, 봇·상대 말풍선, 시각 */
export const 대화: Story = {
  args: { threadId: 'th_01' },
  parameters: { route: paths.messageThread('ws_01', 'th_01') },
  play: async ({ canvasElement }) => {
    const detail = detailOf(canvasElement)
    await expect(await detail.findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    await expect(detail.getAllByRole('heading', { level: 3 })).toHaveLength(2)
    await expect(detail.getByText('여기서부터 답장을 기다리고 있어요')).toBeInTheDocument()
  },
}

/** 검토도 대화도 없다 — EmptyMessages */
export const 빈_상태: Story = {
  parameters: { scenario: 'messages-empty' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('보낼 메시지가 없어요')).toBeInTheDocument()
    await expect(canvas.queryByRole('complementary')).toBeNull()
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
