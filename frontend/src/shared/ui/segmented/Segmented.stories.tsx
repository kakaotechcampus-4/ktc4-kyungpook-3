import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Segmented, SegmentedItem } from './Segmented'

function Demo({ disabled }: { disabled?: boolean }) {
  const [value, setValue] = useState('list')
  return (
    <Segmented aria-label="태스크 보기" value={value} onValueChange={setValue}>
      <SegmentedItem value="list">리스트</SegmentedItem>
      <SegmentedItem value="board">보드</SegmentedItem>
      <SegmentedItem value="gantt" disabled={disabled}>
        간트
      </SegmentedItem>
      <SegmentedItem value="calendar">캘린더</SegmentedItem>
    </Segmented>
  )
}

const meta = {
  title: 'M2 공통 UI/Segmented',
  component: Demo,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 비활성_항목: Story = { args: { disabled: true } }
