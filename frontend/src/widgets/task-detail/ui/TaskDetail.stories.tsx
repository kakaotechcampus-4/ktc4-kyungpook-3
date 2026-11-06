import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { TaskDetail } from './TaskDetail'

/*
 * 태스크 상세 (M6 §3-5, §5-1, E-5). ws_01 하나에 로그인한 상태. tk_01 은 담당자·마감·연결 회의·이력이 있고 Notion 반영됨이다.
 * PM 만 상태·담당자·마감을 바꾼다 — 팀원 스토리는 widget 의 `isPm` 과 시나리오(tasks-member) 둘 다 팀원이다.
 * 오늘은 목 시계(MOCK_NOW)와 같은 2026-09-18 이다.
 */

const meta = {
  title: 'M6 태스크/상세',
  component: TaskDetail,
  args: { workspaceId: 'ws_01', taskId: 'tk_01', isPm: true, today: '2026-09-18' },
  parameters: { scenario: 'tasks-default', route: '/workspaces/ws_01/tasks/tk_01' },
} satisfies Meta<typeof TaskDetail>

export default meta
type Story = StoryObj<typeof meta>

/** PM — 상태 트랙, 담당자·마감 연필, 재촉 카드, 이력 */
export const PM_기본: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { level: 1, name: '로그인 API 연동' }),
    ).toBeVisible()
    const track = canvas.getByRole('radiogroup', { name: '상태 바꾸기' })
    await expect(within(track).getByRole('radio', { name: '진행 중' })).toBeChecked()
    await expect(canvas.getByRole('button', { name: '담당자 수정' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: '마감 수정' })).toBeVisible()
    await expect(canvas.queryByText('기한 지남')).toBeNull()
    await expect(canvas.queryByText('막힌 사유')).toBeNull()
    await expect(canvas.queryByText('진행률')).toBeNull()
    await expect(await canvas.findByTestId('notion-sync-status')).toHaveTextContent('반영됨')
    await expect(await canvas.findByRole('list', { name: '변경 이력' })).toBeInTheDocument()
  },
}

/** 일반 팀원(권한) — 읽기만 한다. 상태는 배지뿐이고 연필·재촉·Notion 다시 반영이 없다 */
export const 팀원_읽기: Story = {
  args: { isPm: false },
  parameters: { scenario: 'tasks-member' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '로그인 API 연동' })).toBeVisible()
    await expect(canvas.getByTestId('task-status')).toHaveTextContent('진행 중')
    await expect(canvas.queryByLabelText('상태 바꾸기')).toBeNull()
    await expect(canvas.queryByRole('button', { name: '담당자 수정' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: '마감 수정' })).toBeNull()
  },
}

/** 마감이 지났다 — 머리 줄 마감이 강조색이고 「기한 지남」 배지가 붙는다. 재촉 안내도 마감이 지났다고 말한다 */
export const 기한_지남: Story = {
  args: { today: '2026-09-22' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('기한 지남')).toBeVisible()
    await expect(canvas.getByText(/^마감이 지났어요/)).toBeVisible()
  },
}

/** 막힌 태스크만 막힌 사유를 보인다 */
export const 막힘: Story = {
  args: { taskId: 'tk_03' },
  parameters: { route: '/workspaces/ws_01/tasks/tk_03' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Notion 권한 대기')).toBeVisible()
    await expect(canvas.getByText('막힌 사유')).toBeVisible()
  },
}

/** PM 이 마감을 고치는 중 — 저장 전에는 보내지 않고 저장 줄에 바뀐 내용이 보인다 */
export const 마감_고치는_중: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: '마감 수정' }))
    const due = canvas.getByRole('textbox', { name: '마감' })
    await userEvent.clear(due)
    await userEvent.type(due, '2026-09-27')
    await expect(canvas.getByText('바뀐 내용 1개 · 마감 09/20 → 09/27')).toBeVisible()
    await expect(canvas.getByRole('button', { name: '저장' })).toBeEnabled()
  },
}

/** 담당자·마감·연결 회의·이력이 없는 기존 태스크도 읽는다 */
export const 빈_칸: Story = {
  args: { taskId: 'tk_07' },
  parameters: {
    route: '/workspaces/ws_01/tasks/tk_07',
    setup: () => {
      db.taskHistory = db.taskHistory.filter(({ task_id }) => task_id !== 'tk_07')
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '온보딩 문구 수정' })).toBeVisible()
    await expect(canvas.getByText('담당자 없음')).toBeInTheDocument()
    await expect(canvas.queryByText('진행률')).toBeNull()
    await expect(await canvas.findByTestId('notion-sync-status')).toHaveTextContent(
      '반영 상태 없음',
    )
    await expect(await canvas.findByText('아직 변경 이력이 없어요.')).toBeInTheDocument()
  },
}

/** 답장 기록 (#344) — 이재환의 답장이 상태를 완료로 자동 반영했고 마감 변경은 승인 대기다. PM 은 자동 반영을 되돌린다 */
export const 답장_기록: Story = {
  args: { taskId: 'tk_03' },
  parameters: { scenario: 'reply-judgment', route: '/workspaces/ws_01/tasks/tk_03' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const history = await canvas.findByRole('list', { name: '변경 이력' })
    await expect(
      await within(history).findByText('이재환 답장 · Discord · 2026-09-17 10:00'),
    ).toBeVisible()
    await expect(within(history).getByText('상태: 완료')).toBeVisible()
    await expect(within(history).getByText('승인 대기')).toBeVisible()
    await userEvent.click(within(history).getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(canvas.getByTestId('task-status')).toHaveTextContent('막힘'))
    await waitFor(() => expect(within(history).getByText('되돌림')).toBeVisible())
  },
}

/** 답장 기록을 일반 팀원이 본다 — 답장 글 대신 안내가 보이고 되돌리기가 없다 */
export const 답장_기록_팀원: Story = {
  args: { taskId: 'tk_03', isPm: false },
  parameters: { scenario: 'reply-judgment-member', route: '/workspaces/ws_01/tasks/tk_03' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('답장 내용은 PM과 답장한 팀원만 볼 수 있어요.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: '되돌리기' })).toBeNull()
  },
}

export const 로딩: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/tasks/:taskId', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: '태스크 목록' })).toBeInTheDocument()
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
    await expect(canvas.queryByRole('heading', { name: '로그인 API 연동' })).toBeNull()
  },
}

/** 조회 실패 — 다시 시도. 400 은 다시 묻지 않아 바로 오류가 보인다 */
export const 오류: Story = {
  parameters: {
    msw: [http.get('/api/v1/tasks/:taskId', () => fail('INVALID_REQUEST', 'x', 400))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('태스크를 불러오지 못했어요')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  },
}

/** 갱신 실패 스토리의 서버 — 첫 조회만 기본 handler 가 받고, 회복하기 전의 재조회는 500 이다. 스토리를 열 때마다 처음으로 */
const refetchServer = { requests: 0, recovered: false }

/**
 * 갱신 실패 (#236) — 반영 중(tk_04)이라 3초마다 다시 묻다가 재조회가 실패했다(기본 재시도 1회 포함).
 * 이전 본문·반영 상태는 그대로 두고 안내 하나와 다시 시도를 둔다. 서버가 회복한 뒤 다시 시도하면 안내가 사라진다
 */
export const 갱신_실패: Story = {
  args: { taskId: 'tk_04' },
  parameters: {
    scenario: 'notion-sync-pending',
    route: '/workspaces/ws_01/tasks/tk_04',
    setup: () => {
      refetchServer.requests = 0
      refetchServer.recovered = false
    },
    msw: [
      http.get('/api/v1/tasks/:taskId', () => {
        refetchServer.requests += 1
        // 아무것도 돌려주지 않으면 기본 handler 가 받는다
        if (refetchServer.requests > 1 && !refetchServer.recovered)
          return fail('INTERNAL_ERROR', 'boom', 500)
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '배포 스크립트' })).toBeVisible()
    await expect(await canvas.findByTestId('notion-sync-status')).toHaveTextContent('반영 중')

    // polling 3초 + 재시도 1초 뒤에 안내가 나온다
    const notice = await canvas.findByRole('alert', {}, { timeout: 10_000 })
    await expect(notice).toHaveTextContent('최신 상태를 받지 못했어요')
    await expect(canvas.getAllByRole('alert')).toHaveLength(1)
    await expect(canvas.getByRole('heading', { name: '배포 스크립트' })).toBeVisible()
    await expect(canvas.getByTestId('notion-sync-status')).toHaveTextContent('반영 중')
    await expect(canvas.queryByText('태스크를 불러오지 못했어요')).toBeNull()

    refetchServer.recovered = true
    await userEvent.click(within(notice).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(canvas.queryByRole('alert')).toBeNull())
    await expect(canvas.getByRole('heading', { name: '배포 스크립트' })).toBeVisible()
  },
}

/** 없는 태스크 — 다시 시도해도 같아서 목록으로 돌려보낸다 */
export const 볼_수_없음: Story = {
  args: { taskId: 'tk_99' },
  parameters: { route: '/workspaces/ws_01/tasks/tk_99' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('이 태스크를 볼 수 없어요')).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: '태스크 목록으로' })).toHaveAttribute(
      'href',
      '/workspaces/ws_01/tasks',
    )
  },
}
