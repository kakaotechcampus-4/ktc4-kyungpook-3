import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Toast, ToastProvider, ToastViewport } from '@/shared/ui/toast'
import {
  PROCESSING_DONE_ACTION,
  PROCESSING_DONE_TITLE,
  PROCESSING_FAILED_TITLE,
} from '../model/notices'

/*
 * 정리 결과 전역 토스트 (M5 U4, D-092·D-095). 앱 계층 추적기가 회의마다 한 번 띄운다 — 어느 화면에 있든 같은 자리다.
 * 추적기의 판정·중복 방지는 통합 테스트(app/meetingProcessing.test.tsx)가 본다. 여기는 문구와 모양만 그린다.
 * 토스트는 body 의 알림 영역에 그려진다 — 찾을 때 document.body 를 본다.
 */

const meta = {
  title: 'M5 회의/정리 알림',
  component: Toast,
  args: { open: true, title: PROCESSING_DONE_TITLE, duration: 1_000_000 },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
        <ToastViewport />
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof Toast>

export default meta
type Story = StoryObj<typeof meta>

/** 정리가 끝났다 — `회의록 보기` 로 그 회의록에 간다 (D-095) */
export const 완료: Story = {
  args: { action: { label: PROCESSING_DONE_ACTION, onClick: fn() } },
  play: async ({ args }) => {
    const body = within(document.body)
    await expect(await body.findAllByText(PROCESSING_DONE_TITLE)).not.toHaveLength(0)
    await userEvent.click(body.getByRole('button', { name: PROCESSING_DONE_ACTION }))
    await expect(args.action?.onClick).toHaveBeenCalled()
  },
}

/** 일반 실패 — 다시 올려 달라는 안내만 있다. 끊김 실패는 토스트 대신 재연결 모달이다 (D-092·D-100) */
export const 실패: Story = {
  args: { title: PROCESSING_FAILED_TITLE },
  play: async () => {
    const body = within(document.body)
    await expect(await body.findAllByText(PROCESSING_FAILED_TITLE)).not.toHaveLength(0)
    await expect(body.queryByRole('button', { name: PROCESSING_DONE_ACTION })).toBeNull()
  },
}
