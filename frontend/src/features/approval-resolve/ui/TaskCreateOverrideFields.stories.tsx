import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { TaskCreateApproval } from '@/entities/approval'
import type { Member } from '@/entities/member'
import { useTaskCreateOverrides } from '../model/useTaskCreateOverrides'
import { TaskCreateOverrideFields } from './TaskCreateOverrideFields'

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

const MEMBERS = [member('mb_01', '김서연', 'pm'), member('mb_02', '박민수', 'member')]

const APPROVAL: TaskCreateApproval = {
  id: 'ap_01',
  workspaceId: 'ws_01',
  kind: 'task_create',
  status: 'pending',
  relatedTaskId: null,
  requestedBy: null,
  resolvedBy: null,
  createdAt: '2026-09-15T06:00:00Z',
  resolvedAt: null,
  title: '알림 문구 검토',
  assigneeMemberId: null,
  assigneeRaw: '민수',
  dueDate: null,
  dueRaw: '다음 주 월요일',
  missing: ['assignee', 'due'],
  evidence: { quote: null, speaker: null, speakerMemberId: null, atMs: null },
  meetingId: 'mt_09',
  extractionItemId: 'it_04',
  gate: 'hold',
}

interface HarnessProps {
  approval: TaskCreateApproval
  members: readonly Member[] | undefined
  disabled: boolean
  onInputChange: () => void
}

/** 폼은 화면(ApprovalReview)이 쥔다. 스토리는 같은 훅으로 감싼다 */
function Harness({ approval, members, disabled, onInputChange }: HarnessProps) {
  const overrides = useTaskCreateOverrides(
    approval,
    (members ?? []).map(({ id }) => id),
  )
  return (
    <TaskCreateOverrideFields
      overrides={overrides}
      members={members}
      disabled={disabled}
      autoFocusFirstEmpty={false}
      onInputChange={onInputChange}
    />
  )
}

const meta = {
  title: 'M6 태스크/확인 필요 입력 칸',
  component: Harness,
  args: { approval: APPROVAL, members: MEMBERS, disabled: false, onInputChange: fn() },
  parameters: { scenario: 'tasks-default', route: '/workspaces/ws_01/approvals/ap_01' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[864px] px-24 py-48">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

/** 빠진 담당자·마감 — 라벨에 「· 미정」, 레드 R2 경계. 세 칸은 44px 한 줄이다 */
export const 빠진_값: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: '태스크명' })).toHaveValue('알림 문구 검토')
    await expect(canvas.getByRole('combobox', { name: '담당자 · 미정' })).toHaveTextContent(
      '담당자 고르기',
    )
    await expect(canvas.getByRole('textbox', { name: '마감 · 미정' })).toHaveValue('')
    for (const element of [
      canvas.getByRole('combobox', { name: '담당자 · 미정' }),
      canvas.getByRole('textbox', { name: '마감 · 미정' }).parentElement,
    ])
      await expect(element).toHaveClass('border-accent')
  },
}

/** 담당자를 고르면 빠진 값 표시가 사라진다. 바뀔 때마다 앞 충돌 확인을 지운다 */
export const 담당자_고르기: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: '담당자 · 미정' }))
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole('option', { name: '박민수' }),
    )
    await expect(canvas.getByRole('combobox', { name: '담당자' })).toHaveTextContent('박민수')
    await expect(args.onInputChange).toHaveBeenCalled()
  },
}

/** 제목을 비우고 칸을 떠나면 제목 칸의 오류다 */
export const 입력_오류: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('textbox', { name: '태스크명' })
    await userEvent.clear(title)
    await userEvent.tab()
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    await expect(title).toHaveAccessibleDescription('제목을 입력해 주세요.')
  },
}

/** 승인·반려 요청 중 — 세 칸이 모두 잠긴다 */
export const 잠김: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: '태스크명' })).toBeDisabled()
    await expect(canvas.getByRole('combobox', { name: '담당자 · 미정' })).toBeDisabled()
    await expect(canvas.getByRole('textbox', { name: '마감 · 미정' })).toBeDisabled()
  },
}
