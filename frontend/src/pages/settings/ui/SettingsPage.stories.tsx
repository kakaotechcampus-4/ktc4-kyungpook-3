import type { Meta, StoryObj } from '@storybook/react-vite'
import { Route, Routes } from 'react-router'
import { expect, within } from 'storybook/test'
import { SettingsPage } from './SettingsPage'

/*
 * 설정 화면 (M8-B, Settings 캔버스). 목차 · 일반 · 연결(Discord·Notion 카드) · 자동 반영 기준 · 알림 · 이 팀 삭제하기.
 * settings-unmapped 는 ws_01 의 PM 이고 두 연동이 연결돼 있다. settings-discord-skipped 는 ws_03 Discord 미연결,
 * settings-member 는 ws_01 의 일반 팀원이다
 */

function Page() {
  return (
    <Routes>
      <Route path="/workspaces/:workspaceId/settings" element={<SettingsPage />} />
    </Routes>
  )
}

const meta = {
  title: 'M8 설정/화면',
  component: Page,
  parameters: { scenario: 'settings-unmapped', route: '/workspaces/ws_01/settings' },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

/** PM — 연결된 두 카드에 관리 버튼, 자동 반영 기준 가운데 선택, 알림은 서버 기본값(세 토글 켜짐·재촉 자동 승인 꺼짐·하루 전 09:00·PM 알림 방식 둘 다), 팀 삭제 */
export const PM_연결됨: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const notion = within(await canvas.findByTestId('notion-connection'))
    await expect(await notion.findByText('연결됨')).toBeInTheDocument()
    await expect(notion.getByRole('button', { name: '속성 다시 맞추기' })).toBeInTheDocument()
    await expect(
      canvas.getByRole('radio', { name: /담당자·마감이 분명한 건만 자동으로/ }),
    ).toBeChecked()
    await expect(canvas.getByRole('button', { name: '팀 삭제' })).toBeInTheDocument()
    await expect(
      await canvas.findByRole('switch', { name: '마감 하루 전 09:00에 담당자에게 DM' }),
    ).toBeChecked()
    await expect(canvas.getByRole('combobox', { name: '재촉 보낼 시각' })).toBeEnabled()
  },
}

/** Discord 를 건너뛴 공간 — Discord 카드에 연결 버튼 */
export const PM_Discord_미연결: Story = {
  parameters: { scenario: 'settings-discord-skipped', route: '/workspaces/ws_03/settings' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const discord = within(await canvas.findByTestId('discord-connection'))
    await expect(
      await discord.findByRole('button', { name: 'Discord 연결하기' }),
    ).toBeInTheDocument()
    await expect(
      await canvas.findByText('Discord가 연결되지 않아 웹으로만 알려요'),
    ).toBeInTheDocument()
  },
}

/** 일반 팀원 — 상태만 읽는다. 관리 버튼·팀 삭제가 없고 선택지·토글·재촉 규칙은 꺼져 있다 */
export const 팀원: Story = {
  parameters: { scenario: 'settings-member' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Notion 연결은 PM이 관리해요.')).toBeInTheDocument()
    await expect(
      await canvas.findByText('Discord가 연결되지 않아 웹으로만 알려요'),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: '연결 끊기' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: '팀 삭제' })).toBeNull()
    for (const toggle of canvas.getAllByRole('switch')) await expect(toggle).toBeDisabled()
    for (const select of canvas.getAllByRole('combobox')) await expect(select).toBeDisabled()
  },
}
