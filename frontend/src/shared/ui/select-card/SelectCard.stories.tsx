import type { Meta, StoryObj } from '@storybook/react-vite'
import { SelectCard, SelectCardGroup } from './SelectCard'

function Demo({ disabled }: { disabled?: boolean }) {
  return (
    <SelectCardGroup aria-label="반영 방식" defaultValue="approve" className="w-[420px]">
      <SelectCard
        value="approve"
        title="확인 후 반영"
        description="승인한 것만 Notion 에 올려요."
      />
      <SelectCard
        value="auto"
        title="자동 반영"
        description="확실한 건 바로 올려요."
        disabled={disabled}
      />
    </SelectCardGroup>
  )
}

const meta = {
  title: 'M2 공통 UI/SelectCard',
  component: Demo,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 비활성: Story = { args: { disabled: true } }
