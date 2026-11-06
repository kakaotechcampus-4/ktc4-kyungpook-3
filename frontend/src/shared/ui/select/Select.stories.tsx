import { useId, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Label } from '../label/Label'
import { Select, SelectInitial, SelectNoneMark } from './Select'
import type { SelectProps } from './Select'
import type { SelectOption } from './options'

const MEMBERS: readonly SelectOption<string>[] = ['김서연', '박민수', '이재환', '정하늘'].map(
  (name) => ({ value: name, label: name, leading: <SelectInitial name={name} /> }),
)

const NONE = { label: '미정', leading: <SelectNoneMark /> }

type DemoProps = Omit<SelectProps<string>, 'value' | 'onValueChange'> & {
  label: string
  initialValue: string | null
}

/** 라벨은 호출부가 그린다 — 막힌 칸이면 라벨도 강조색이다 */
function Demo({ label, initialValue, ...props }: DemoProps) {
  const [value, setValue] = useState(initialValue)
  const id = useId()
  return (
    <div className="flex w-[320px] flex-col gap-8">
      <Label htmlFor={id} blocking={props.tone === 'blocking'}>
        {label}
      </Label>
      <Select id={id} label={label} value={value} onValueChange={setValue} {...props} />
    </div>
  )
}

const meta = {
  title: 'M4 공통/Select',
  component: Demo,
  args: { label: '담당자', initialValue: '박민수', options: MEMBERS, noneOption: NONE },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const 담당자: Story = {}

/** 비우면 승인이 막히는 칸 — 라벨·경계·플레이스홀더가 강조색이다 (레드 R2) */
export const 담당자_막힘: Story = {
  args: {
    label: '담당자 · 정해야 승인돼요',
    initialValue: null,
    tone: 'blocking',
    placeholder: '담당자 고르기',
    noneOption: undefined,
  },
}

export const 작은_크기: Story = { args: { size: 'sm' } }

export const 비활성: Story = { args: { disabled: true } }

export const 보조줄_비활성옵션: Story = {
  args: {
    label: '재촉할 태스크',
    initialValue: null,
    placeholder: '태스크 고르기',
    noneOption: undefined,
    options: [
      { value: 'schema', label: 'DB 스키마 정리', description: '김서연 · 11월 12일까지' },
      { value: 'login', label: '로그인 API 연동', description: '박민수 · 11월 14일까지' },
      {
        value: 'deploy',
        label: '배포 파이프라인',
        description: '완료된 태스크는 재촉할 수 없어요',
        disabled: true,
      },
    ],
  },
}

/** 키보드로 연다 — 목록은 트리거 아래로 열리고 고른 줄에 포커스가 간다 */
export const 열림: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('combobox', { name: '담당자' }).focus()
    await userEvent.keyboard('{Enter}')
    await expect(await within(document.body).findByRole('listbox')).toBeInTheDocument()
  },
}
