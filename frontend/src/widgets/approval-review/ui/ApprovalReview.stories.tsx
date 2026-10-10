import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { fail } from '@/shared/mock/envelope'
import { ApprovalReview } from './ApprovalReview'

/*
 * 확인 필요 상세 (M6 §4, §5-1). ws_01 하나에 PM 으로 로그인한 상태. 화면은 PM 가드 뒤라 권한 차단은 E2E 가 본다.
 * Storybook 빌드는 개발 MSW 가 아니라서 승인 처리 경로가 `live` 다 (features/approval-resolve/model/transport.ts) —
 * `보완하기` 가 없고, 보완이 필요한 생성 승인은 `승인` 이 꺼진 채 이유를 보인다. 보완 폼은 `M6 태스크/보완 폼` 스토리에 있다.
 * - approval-needs-input: ap_01 의 제목·담당자·마감이 모두 비었다
 * - approval-conflict: ap_04 는 tk_01 을 todo → done 으로 바꾸자는 변경 승인인데 tk_01 이 이미 in_progress 다
 * - approval-resolved: ap_02 를 승인해 태스크가 생겼고 Notion 은 반영 대기다
 * - approval-rejected: ap_01 을 반려했다
 */

const meta = {
  title: 'M6 태스크/확인 필요 상세',
  component: ApprovalReview,
  args: { workspaceId: 'ws_01', approvalId: 'ap_01' },
  parameters: { scenario: 'tasks-default', route: '/workspaces/ws_01/approvals/ap_01' },
} satisfies Meta<typeof ApprovalReview>

export default meta
type Story = StoryObj<typeof meta>

/** 생성 승인 — 원문 담당자·마감과 근거를 확정할 값과 나눠 보인다. 담당자가 없어 승인이 꺼져 있다 */
export const 생성_승인: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '새 태스크 확인' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: '회의 원문' })).toBeVisible()
    await expect(canvas.getByRole('figure', { name: '근거' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: '반려' })).toBeEnabled()
    const approve = await canvas.findByRole('button', { name: '승인' })
    await expect(approve).toBeDisabled()
    await waitFor(() =>
      expect(approve).toHaveAccessibleDescription(/^승인하려면 담당자·마감 정보를/),
    )
    await expect(canvas.queryByRole('button', { name: '보완하기' })).toBeNull()
  },
}

/** 보완 누락 — 세 값이 모두 비었다. `승인` 은 꺼지고 이유가 버튼에 연결된다. `반려` 는 누를 수 있다 */
export const 보완_누락: Story = {
  parameters: { scenario: 'approval-needs-input' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '새 태스크 확인' })).toBeVisible()
    await expect(canvas.getAllByText('비어 있어요')).toHaveLength(3)
    const approve = await canvas.findByRole('button', { name: '승인' })
    await expect(approve).toBeDisabled()
    // 팀원 목록이 오기 전에는 `팀원 목록을 불러온 뒤` 가 이유다 — 온 뒤의 이유를 기다린다
    await waitFor(() =>
      expect(approve).toHaveAccessibleDescription(
        '승인하려면 제목·담당자·마감 정보를 올바르게 채워야 해요. 지금 서버는 승인 전 보완을 지원하지 않아요.',
      ),
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
