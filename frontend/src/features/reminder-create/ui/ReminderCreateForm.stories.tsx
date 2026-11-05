import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Task } from '@/entities/task'
import { ReminderCreateForm } from './ReminderCreateForm'

/*
 * 재촉 만들기 (#370, 계약 §5.7). ws_01 의 PM 이다. 데이터는 메시지·팀원·태스크 MSW handler 이고 시작 db 는 `messages-default` 다.
 * 보낼 시각의 마감 기준 카드는 기본 재촉 규칙(하루 전 09:00)과 목의 고정 시각(MOCK_NOW, 9/18 09:00)으로 정한다
 */

/** 태스크 목록 응답과 같은 값 — 김서연(Discord 연결됨)이 맡은 tk_01 */
const loginTask: Task = {
  id: 'tk_01',
  workspaceId: 'ws_01',
  meetingId: 'mt_09',
  title: '로그인 API 연동',
  assigneeMemberId: 'mb_01',
  status: 'in_progress',
  blocker: null,
  dueDate: '2026-09-20',
  startDate: '2026-09-15',
  notionPageId: 'notion_tk_01',
  version: 1,
  notionSyncStatus: 'synced',
  createdAt: '2026-09-15T04:00:00Z',
  updatedAt: '2026-09-17T04:00:00Z',
}

/** 이재환(Discord 미연결)이 맡은 tk_03 */
const schemaTask: Task = {
  ...loginTask,
  id: 'tk_03',
  title: 'DB 스키마 정리',
  assigneeMemberId: 'mb_03',
  status: 'blocked',
  blocker: 'Notion 권한 대기',
  dueDate: '2026-09-22',
  startDate: '2026-09-16',
  notionPageId: null,
  notionSyncStatus: null,
}

const meta = {
  title: 'M8 메시지/재촉 만들기',
  component: ReminderCreateForm,
  args: {
    workspaceId: 'ws_01',
    target: { kind: 'task', task: loginTask },
    onCreated: fn(),
    onCancel: fn(),
  },
  parameters: { scenario: 'messages-default', route: '/workspaces/ws_01/tasks/tk_01' },
} satisfies Meta<typeof ReminderCreateForm>

export default meta
type Story = StoryObj<typeof meta>

/** 태스크 상세에서 — 받는 사람은 담당자로 정해져 있고, 마감 기준 시각이 골라져 있다 */
export const 태스크_담당자에게: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('김서연')).toBeVisible()
    await expect(
      await canvas.findByRole('radio', { name: '마감 하루 전09/19 09:00', checked: true }),
    ).toBeInTheDocument()
    await expect(canvas.queryByText(/Discord가 연결되지 않아/)).toBeNull()
    await expect(canvas.getByRole('button', { name: '재촉 만들기' })).not.toHaveAttribute(
      'aria-disabled',
    )
  },
}

/** Discord 가 연결되지 않은 담당자 — 막지 않고, 보낼 시각 전에 팀 화면에서 연결하라고 알린다 */
export const Discord_미연결: Story = {
  args: { target: { kind: 'task', task: schemaTask } },
  parameters: { route: '/workspaces/ws_01/tasks/tk_03' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(/이재환님은 Discord가 연결되지 않아 지금은 DM이 나가지 않아요/),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: '팀 화면' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: '재촉 만들기' })).not.toHaveAttribute(
      'aria-disabled',
    )
  },
}

/** 메시지 화면의 새 재촉 — 팀원을 고르면 그 팀원이 맡은 끝나지 않은 태스크를 고른다 */
export const 팀원과_태스크_고르기: Story = {
  args: { target: { kind: 'choose' } },
  parameters: { route: '/workspaces/ws_01/messages?new=reminder' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('받을 팀원을 골라 주세요.')).toBeVisible()
    await userEvent.selectOptions(
      await canvas.findByRole('combobox', { name: '받는 사람' }),
      '이재환',
    )
    const taskField = canvas.getByRole('combobox', { name: '태스크' })
    await expect(
      await within(taskField).findByRole('option', { name: 'DB 스키마 정리 · 09/22 마감' }),
    ).toBeInTheDocument()
    await expect(within(taskField).queryByRole('option', { name: /랜딩 카피/ })).toBeNull()
    await userEvent.selectOptions(taskField, 'DB 스키마 정리 · 09/22 마감')
    await expect(
      await canvas.findByRole('radio', { name: '마감 하루 전09/21 09:00', checked: true }),
    ).toBeInTheDocument()
  },
}
