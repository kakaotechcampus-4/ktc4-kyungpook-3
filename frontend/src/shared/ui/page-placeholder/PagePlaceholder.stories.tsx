import type { Meta, StoryObj } from '@storybook/react-vite'
import { TextField } from '../text-field/TextField'
import { PagePlaceholder } from './PagePlaceholder'

/* M3 최소 화면의 틀. 제목·설명·본문 칸만 그린다 — 실제 화면은 M4 이후에 이 틀을 걷어 낸다 */

const meta = {
  title: 'M3 공통/PagePlaceholder',
  component: PagePlaceholder,
  args: { title: '태스크', description: '태스크 화면은 M6에서 만들어요.' },
} satisfies Meta<typeof PagePlaceholder>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

/** 설명이 없으면 제목만 그린다 */
export const 제목만: Story = { args: { description: undefined } }

/** 본문 칸 — 호출자가 준 내용을 설명 아래에 그린다 (설정 화면의 이탈 확인 점검 칸) */
export const 본문: Story = {
  args: {
    title: '설정',
    description: '설정 화면은 M8에서 만들어요. 지금은 이탈 확인을 점검하는 입력 한 칸만 있어요.',
    children: <TextField label="워크스페이스 이름" defaultValue="카테캠 3팀" />,
  },
}
