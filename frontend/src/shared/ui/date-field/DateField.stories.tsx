import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { DateField } from './DateField'
import type { DateFieldProps } from './DateField'

type DemoProps = Omit<DateFieldProps, 'value' | 'onChange'> & { initialValue: string }

function Demo({ initialValue, ...props }: DemoProps) {
  const [value, setValue] = useState(initialValue)
  return (
    <div className="w-[320px]">
      <DateField {...props} value={value} onChange={setValue} />
    </div>
  )
}

const meta = {
  title: 'M4 공통/DateField',
  component: Demo,
  args: {
    label: '마감',
    initialValue: '2026-11-20',
    placeholder: 'YYYY-MM-DD 또는 미정이면 비워 두세요',
  },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText('마감')
    await userEvent.clear(input)
    await userEvent.type(input, '2026-12-01')
    await expect(input).toHaveValue('2026-12-01')
  },
}

/** 비워 두면 미정이다 — 글 입력이라 빈 값을 그대로 둔다 */
export const 미정: Story = { args: { initialValue: '' } }

/** 비우면 승인이 막히는 칸 — 라벨·경계·플레이스홀더가 강조색이다 (레드 R2) */
export const 막힘: Story = {
  args: { label: '마감 · 정해야 승인돼요', initialValue: '', labelTone: 'required-blocking' },
}

export const 비활성: Story = { args: { disabled: true } }
