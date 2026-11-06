import { useId, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { Label } from '../label/Label'
import { Combobox } from './Combobox'
import type { SelectOption } from './options'

const TASKS: readonly SelectOption<string>[] = [
  {
    value: 'login',
    label: '로그인 API 연동',
    description: <span className="text-accent">09/20 마감 · 기한 지남</span>,
  },
  { value: 'deploy', label: '배포 스크립트', description: '09/24 마감 · 진행 중' },
  { value: 'signup', label: '회원가입 화면', description: '09/26 마감 · 할 일' },
  { value: 'minutes', label: '회의록 요약 검수', description: '마감 없음 · 할 일' },
  { value: 'search', label: '검색 API', description: '09/27 마감 · 진행 중' },
  { value: 'profile', label: '프로필 화면', description: '09/28 마감 · 할 일' },
  { value: 'push', label: '푸시 알림', description: '09/30 마감 · 막힘' },
  { value: 'audit', label: '접근성 점검', description: '10/02 마감 · 할 일' },
  {
    value: 'font',
    label: '폰트 적용',
    description: '완료한 태스크는 재촉할 수 없어요',
    disabled: true,
  },
]

function Demo() {
  const [value, setValue] = useState<string | null>(null)
  const id = useId()
  return (
    <div className="flex w-[320px] flex-col gap-8">
      <Label htmlFor={id}>태스크</Label>
      <Combobox
        id={id}
        label="태스크"
        searchLabel="태스크 찾기"
        emptyText="맞는 태스크가 없어요"
        placeholder="태스크 고르기"
        value={value}
        onValueChange={setValue}
        options={TASKS}
      />
    </div>
  )
}

const meta = {
  title: 'M4 공통/Combobox',
  component: Demo,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const 닫힘: Story = {}

/** 찾기 칸에 치면 이름으로 거르고, 맞는 줄이 없으면 그렇게 알린다 */
export const 찾기: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(within(canvasElement).getByRole('combobox', { name: '태스크' }))
    const search = await body.findByRole('combobox', { name: '태스크 찾기' })
    await expect(search).toHaveFocus()
    await userEvent.keyboard('화면')
    await expect(within(body.getByRole('listbox')).getAllByRole('option')).toHaveLength(2)
    await userEvent.keyboard('없음')
    await expect(body.getByRole('status')).toHaveTextContent('맞는 태스크가 없어요')
  },
}

/** 휴대폰 폭에서는 아래 시트로 연다 */
export const 휴대폰_시트: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('combobox', { name: '태스크' }))
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('listbox', { name: '태스크' }),
    ).toBeInTheDocument()
  },
}
