import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Member } from '@/entities/member'
import { TaskCreateOverridesForm } from './TaskCreateOverridesForm'

/*
 * 생성 승인 보완 폼 (M6 §4-1, §4-2, §5-1). 개발 MSW 의 확인 필요 상세에서 `보완하기` 를 눌렀을 때 열린다.
 * Storybook 빌드에는 그 버튼이 없어(처리 경로 `live`) 폼만 따로 그린다. 값은 서버로 가지 않고 onConfirm 으로 넘어간다.
 */

function member(id: string, displayName: string, role: Member['role']): Member {
  return {
    id,
    workspaceId: 'ws_01',
    displayName,
    discordUserId: null,
    notionName: null,
    role,
    createdAt: '2026-09-01T00:00:00Z',
  }
}

const meta = {
  title: 'M6 태스크/보완 폼',
  component: TaskCreateOverridesForm,
  args: {
    initial: { taskTitle: '알림 문구 검토', assigneeMemberId: null, dueDate: null },
    members: [member('mb_01', '김서연', 'pm'), member('mb_02', '박민수', 'member')],
    onConfirm: fn(),
    onCancel: fn(),
  },
  parameters: { scenario: 'tasks-default', route: '/workspaces/ws_01/approvals/ap_01' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[888px] px-24 py-48">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TaskCreateOverridesForm>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('group', { name: '확정할 값 보완' })).toBeInTheDocument()
    await expect(canvas.getByLabelText('제목')).toHaveValue('알림 문구 검토')
    await expect(canvas.getByLabelText('담당자')).toHaveValue('')
  },
}

/**
 * 입력 오류 — 제목을 비우고 보완 완료. 칸마다 오류가 aria-describedby 로 연결되고 첫 오류 칸(제목)으로 포커스가 간다.
 * onConfirm 은 불리지 않는다
 */
export const 입력_오류: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByLabelText('제목')
    await userEvent.clear(title)
    await userEvent.click(canvas.getByRole('button', { name: '보완 완료' }))
    await expect(title).toHaveFocus()
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    await expect(title).toHaveAccessibleDescription('제목을 입력해 주세요.')
    const assignee = canvas.getByLabelText('담당자')
    await expect(assignee).toHaveAttribute('aria-invalid', 'true')
    await expect(assignee).toHaveAccessibleDescription(
      '이 워크스페이스의 팀원 중에서 담당자를 골라 주세요.',
    )
    await expect(canvas.getByLabelText('마감')).toHaveAccessibleDescription(
      '마감 날짜를 입력해 주세요.',
    )
    await expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

/** 승인·반려 요청 중 — 칸과 버튼이 모두 잠긴다 */
export const 잠김: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('제목')).toBeDisabled()
    await expect(canvas.getByRole('button', { name: '보완 완료' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: '취소' })).toBeDisabled()
  },
}
