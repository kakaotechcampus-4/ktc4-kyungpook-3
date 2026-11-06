import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { processingSignal } from '../model/processingSignal'
import type { ProcessingSignal, ProcessingSubject } from '../model/processingSignal'
import { ProcessingToastCard } from './ProcessingToastCard'

/*
 * 회의 정리 진행 토스트 (#424). 앱에서는 토스트 자리 맨 아래에 고정되고(PinnedToast), 추적기가 상태를 바꾼다 —
 * 상태 전환·역할별 노출·세션 경계는 통합 테스트(app/processingToast.test.tsx)가 본다. 여기는 상태마다 모양과 동작만 그린다.
 */

const TITLE = '3주차 정기회의'

function signalOf(subject: ProcessingSubject, role: 'pm' | 'member' = 'pm'): ProcessingSignal {
  const signal = processingSignal(subject, role)
  if (signal === null) throw new Error('이 역할에는 보이지 않는 상태다')
  return signal
}

const PROCESSING = signalOf({
  phase: 'processing',
  title: TITLE,
  progress: { audioMerged: true, transcribed: false, extracted: false },
})

const meta = {
  title: 'M5 회의/정리 진행 토스트',
  component: ProcessingToastCard,
  args: {
    signal: PROCESSING,
    collapsed: false,
    onCollapsedChange: fn(),
    onOpenProcessing: fn(),
    onAssignSpeakers: fn(),
    onOpenMinutes: fn(),
    onDismiss: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex justify-end bg-surface-sunken p-24">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProcessingToastCard>

export default meta
type Story = StoryObj<typeof meta>

/** 정리 중(펼침) — 지금 단계 문장, 3칸 진행, `자세히 보기`. 닫기는 없고 접기만 있다 */
export const 진행_중: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('음성을 텍스트로 옮기고 있어요')).toBeVisible()
    await expect(canvas.getByText('1 / 3 단계 완료')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: '닫기' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: '자세히 보기' }))
    await expect(args.onOpenProcessing).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: '접기' }))
    await expect(args.onCollapsedChange).toHaveBeenCalledWith(true)
  },
}

/** 정리 중(접힘) — `● 정리 중 n/3` 알약. 누르면 펼친다 */
export const 진행_중_접힘: Story = {
  args: { collapsed: true },
  play: async ({ args, canvasElement }) => {
    const pill = within(canvasElement).getByRole('button', { name: /펼치기/ })
    await expect(pill).toHaveTextContent('정리 중1/3')
    await userEvent.click(pill)
    await expect(args.onCollapsedChange).toHaveBeenCalledWith(false)
  },
}

/** 팀원이 보는 화자 지정 대기 — 정리 중 모양에 기다린다는 문장 */
export const 팀원_화자_지정_대기: Story = {
  args: {
    signal: signalOf(
      {
        phase: 'awaiting_speakers',
        title: TITLE,
        progress: { audioMerged: true, transcribed: false, extracted: false },
      },
      'member',
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('화자 지정을 기다리고 있어요')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: '화자 지정하기' })).toBeNull()
  },
}

/** PM 의 화자 지정 필요 — 레드 R2 주의 면. 닫기는 없고 접기만 있다 */
export const 화자_지정_필요: Story = {
  args: { signal: signalOf({ phase: 'awaiting_speakers', title: TITLE, progress: null }) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('7일 안에 정해 주세요')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: '닫기' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: '화자 지정하기' }))
    await expect(args.onAssignSpeakers).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: '접기' }))
    await expect(args.onCollapsedChange).toHaveBeenCalledWith(true)
  },
}

/** 화자 지정 필요(접힘) — `● 화자 지정이 필요해요` 알약. 상태가 바뀌면 다시 펼친다 */
export const 화자_지정_필요_접힘: Story = {
  args: {
    collapsed: true,
    signal: signalOf({ phase: 'awaiting_speakers', title: TITLE, progress: null }),
  },
  play: async ({ args, canvasElement }) => {
    const pill = within(canvasElement).getByRole('button', { name: /펼치기/ })
    await expect(pill).toHaveTextContent('화자 지정이 필요해요')
    await userEvent.click(pill)
    await expect(args.onCollapsedChange).toHaveBeenCalledWith(false)
  },
}

/** 완료 — `회의록 보기` 와 닫기. 저절로 사라지지 않는다 (D-095) */
export const 완료: Story = {
  args: { signal: signalOf({ phase: 'done', title: TITLE }) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: '회의록 보기' }))
    await expect(args.onOpenMinutes).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: '닫기' }))
    await expect(args.onDismiss).toHaveBeenCalled()
  },
}

/** PM 의 실패 — 사유별 안내와 닫기. 팀원에게는 보이지 않는다 (D-092) */
export const 실패: Story = {
  args: { signal: signalOf({ phase: 'failed', title: TITLE, failedStage: 'diarize' }) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/음성 처리 중 회의 정리를 완료하지 못했어요/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: '닫기' }))
    await expect(args.onDismiss).toHaveBeenCalled()
  },
}
