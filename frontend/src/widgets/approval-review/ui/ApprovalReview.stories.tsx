import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { fail } from '@/shared/mock/envelope'
import { ApprovalReview } from './ApprovalReview'

const meta = {
  title: 'M6 태스크/확인 필요 상세',
  component: ApprovalReview,
  args: { workspaceId: 'ws_01', approvalId: 'ap_01' },
  parameters: { scenario: 'tasks-default', route: '/workspaces/ws_01/approvals/ap_01' },
} satisfies Meta<typeof ApprovalReview>

export default meta
type Story = StoryObj<typeof meta>

export const 생성_승인: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '새 태스크 확인' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: '회의 원문' })).toBeVisible()
    await expect(canvas.getByRole('figure', { name: '근거' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: '반려' })).toBeEnabled()
    const approve = await canvas.findByRole('button', { name: '승인' })
    await waitFor(() => expect(approve).toBeEnabled())
    await expect(canvas.getByRole('button', { name: '보완하기' })).toBeEnabled()
  },
}

/** 보완 누락 — 세 값이 모두 비었다. `승인` 은 꺼지고 이유가 버튼에 연결된다. `반려` 는 누를 수 있다 */
export const 보완_누락: Story = {
  parameters: { scenario: 'approval-needs-input' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '새 태스크 확인' })).toBeVisible()
    await expect(canvas.getAllByText('미정')).toHaveLength(3)
    const approve = await canvas.findByRole('button', { name: '승인' })
    await expect(approve).toBeDisabled()
    // 팀원 목록이 오기 전에는 `팀원 목록을 불러온 뒤` 가 이유다 — 온 뒤의 이유를 기다린다
    await waitFor(() =>
      expect(approve).toHaveAccessibleDescription('승인하려면 제목 정보를 올바르게 채워야 해요.'),
    )
    await expect(canvas.getByRole('button', { name: '반려' })).toBeEnabled()
  },
}

/** 변경 승인 — 현재값과 제안값을 비교한다 */
export const 변경_승인: Story = {
  args: { approvalId: 'ap_04' },
  parameters: { scenario: 'approval-conflict', route: '/workspaces/ws_01/approvals/ap_04' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '태스크 변경 확인' })).toBeVisible()
    const table = canvas.getByRole('table', { name: '현재값과 제안값' })
    await expect(await within(table).findByText('진행 중')).toBeInTheDocument()
    await expect(within(table).getByText('완료')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: '승인' })).toBeEnabled()
  },
}

/** 범위 변경 — 바꿀 필드 없이 결정 문장과 근거만 온다. 빈 비교표 대신 안내한다 (#205) */
export const 범위_변경: Story = {
  args: { approvalId: 'ap_05' },
  parameters: { scenario: 'approval-scope', route: '/workspaces/ws_01/approvals/ap_05' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scope = await canvas.findByRole('region', { name: '범위 변경' })
    await expect(
      within(scope).getByText('소셜 로그인은 이번 범위에서 빼기로 했어요.'),
    ).toBeVisible()
    await expect(within(scope).getByRole('figure', { name: '근거' })).toBeInTheDocument()
    await expect(canvas.getByText('바꿀 항목 값은 없어요.')).toBeVisible()
    await expect(canvas.queryByRole('table', { name: '현재값과 제안값' })).toBeNull()
    await expect(canvas.getByRole('button', { name: '승인' })).toBeEnabled()
  },
}

/** 리마인드 답장에서 온 변경 — 회의 대신 팀원 답장과 AI 해석을 근거로 보인다 (#344) */
export const 답장_변경: Story = {
  args: { approvalId: 'ap_31' },
  parameters: { scenario: 'reply-judgment', route: '/workspaces/ws_01/approvals/ap_31' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const reply = await canvas.findByRole('region', { name: '팀원 답장' })
    await expect(within(reply).getByText('마감을 26일로 미루자고 했어요')).toBeVisible()
    await waitFor(() =>
      expect(within(reply).getByRole('figure', { name: '근거' })).toHaveTextContent(
        '리마인드 답장 · 이재환',
      ),
    )
  },
}

/** 답장이 말한 담당자를 팀원에서 찾지 못한 카드 — 담당자를 고르기 전에는 승인이 막힌다 (#344, BE #460 합의 대기) */
export const 답장_담당자_고르기: Story = {
  args: { approvalId: 'ap_32' },
  parameters: { scenario: 'reply-judgment', route: '/workspaces/ws_01/approvals/ap_32' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        '답장에서 말한 담당자 민지를 팀원에서 찾지 못했어요. 담당자를 골라 주세요.',
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: '승인' })).toBeDisabled()
    const select = canvas.getByRole('combobox', { name: '담당자' })
    await waitFor(() => expect(select).toBeEnabled())
    await userEvent.selectOptions(select, '박민수')
    await expect(canvas.getByRole('button', { name: '승인' })).toBeEnabled()
  },
}

/** 충돌 — 승인하면 409. 기준값·현재값·제안값과 충돌 필드를 보이고, 다시 승인은 PM 이 누를 때만이다 */
export const 충돌: Story = {
  args: { approvalId: 'ap_04' },
  parameters: { scenario: 'approval-conflict', route: '/workspaces/ws_01/approvals/ap_04' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const approve = await canvas.findByRole('button', { name: '승인' })
    await within(canvas.getByRole('table', { name: '현재값과 제안값' })).findByText('진행 중')
    await userEvent.click(approve)
    const alert = await canvas.findByRole('alert', { name: '변경 충돌' })
    const conflicts = within(alert).getByRole('table', { name: '충돌한 항목' })
    await expect(within(conflicts).getByRole('rowheader', { name: '상태' })).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: '지금 값을 확인했어요, 다시 승인' }),
    ).toBeEnabled()
  },
}

/** 처리 결과(승인) — 생성된 태스크 링크와 그 태스크의 Notion 상태. 승인만으로 `반영됨` 이 아니다 */
export const 처리_결과_승인: Story = {
  args: { approvalId: 'ap_02' },
  parameters: { scenario: 'approval-resolved', route: '/workspaces/ws_01/approvals/ap_02' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('approval-result')).toHaveTextContent('승인했어요')
    await expect(canvas.getByText('생성된 태스크')).toBeInTheDocument()
    await expect(await canvas.findByRole('link', { name: '테스트 계획 정리' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/workspaces\/ws_01\/tasks\/tk_\d+$/),
    )
    await expect(await canvas.findByTestId('notion-sync-status')).toHaveTextContent('반영 중')
    await expect(canvas.queryByRole('button', { name: '승인' })).toBeNull()
  },
}

/** 처리 결과(반려) — 태스크를 만들지 않았다 */
export const 처리_결과_반려: Story = {
  parameters: { scenario: 'approval-rejected' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('approval-result')).toHaveTextContent('반려했어요')
    await expect(canvas.getByText('태스크를 만들지 않았어요.')).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: '반려' })).toBeNull()
  },
}

export const 로딩: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/approvals/:approvalId', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: '← 태스크 목록' })).toBeInTheDocument()
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
    await expect(canvas.queryByRole('button', { name: '승인' })).toBeNull()
  },
}

/** 조회 실패 — 다시 시도. 400 은 다시 묻지 않아 바로 오류가 보인다 */
export const 오류: Story = {
  parameters: {
    msw: [http.get('/api/v1/approvals/:approvalId', () => fail('INVALID_REQUEST', 'x', 400))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('확인 요청을 불러오지 못했어요')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  },
}

/** 없는 확인 요청 — 목록으로 돌려보낸다 */
export const 찾을_수_없음: Story = {
  args: { approvalId: 'ap_99' },
  parameters: { route: '/workspaces/ws_01/approvals/ap_99' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('확인 요청을 찾을 수 없어요')).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: '태스크 목록으로' })).toBeInTheDocument()
  },
}
