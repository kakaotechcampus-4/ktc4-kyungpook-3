import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { NotionRequiredModal } from './NotionRequiredModal'

/*
 * 회의 올리기를 막는 모달 (M5 U3, D-097·D-100). 업로드 화면이 진입 판정으로 띄우고, 정리 실패 뒤 끊김이면 앱 계층이
 * 같은 모달을 띄운다. 모달은 body 에 그려진다 — 찾을 때 canvas 가 아니라 document.body 를 본다.
 * 연결 버튼은 설정의 Notion 영역으로 옮긴다(복귀 목적지 `next` 는 이 공간의 회의 올리기). 이동은 스토리 밖이라 여기선 보지 않는다.
 */

const meta = {
  title: 'M5 회의/Notion 차단 모달',
  component: NotionRequiredModal,
  args: { workspaceId: 'ws_01', reason: 'not_connected', onCancel: fn() },
  parameters: { scenario: 'single-workspace', route: '/workspaces/ws_01/meetings/upload' },
} satisfies Meta<typeof NotionRequiredModal>

export default meta
type Story = StoryObj<typeof meta>

/** 아직 연결하지 않았다 (D-097) — 첫 포커스는 `취소` */
export const 미연결: Story = {
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog', {
      name: 'Notion 연결이 필요해요',
    })
    const modal = within(dialog)
    await expect(modal.getByRole('button', { name: '취소' })).toHaveFocus()
    await expect(modal.getByRole('button', { name: 'Notion 연결하기' })).toBeInTheDocument()
    await userEvent.click(modal.getByRole('button', { name: '취소' }))
    await expect(args.onCancel).toHaveBeenCalled()
  },
}

/** 연결했다가 권한이 끊겼다 (D-100) — 재연결 */
export const 끊김: Story = {
  args: { reason: 'revoked' },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', {
      name: 'Notion 연결이 끊어졌어요',
    })
    await expect(
      within(dialog).getByRole('button', { name: 'Notion 다시 연결하기' }),
    ).toBeInTheDocument()
  },
}

/** 막을 까닭이 없다 — 모달이 없다 */
export const 닫힘: Story = {
  args: { reason: null },
  play: async () => {
    await expect(within(document.body).queryByRole('dialog')).toBeNull()
  },
}
