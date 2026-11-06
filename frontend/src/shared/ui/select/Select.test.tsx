import { createRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select, SelectInitial, SelectNoneMark } from './Select'
import type { SelectOption, SelectProps } from './Select'

type Member = 'kim' | 'park' | 'lee' | 'jung'

const MEMBERS: readonly SelectOption<Member>[] = [
  { value: 'kim', label: '김서연', leading: <SelectInitial name="김서연" /> },
  { value: 'park', label: '박민수', leading: <SelectInitial name="박민수" /> },
  { value: 'lee', label: '이재환', disabled: true, description: '이번 주 휴가' },
  { value: 'jung', label: '정하늘' },
]

function renderSelect(props: Partial<SelectProps<Member>> = {}) {
  const onValueChange = vi.fn<(value: Member | null) => void>()
  render(
    <Select<Member>
      aria-label="담당자"
      value="park"
      onValueChange={onValueChange}
      options={MEMBERS}
      noneOption={{ label: '미정', leading: <SelectNoneMark /> }}
      {...props}
    />,
  )
  return { onValueChange, trigger: screen.getByRole('combobox', { name: '담당자' }) }
}

async function openWithKeyboard(trigger: HTMLElement, key = '{Enter}') {
  trigger.focus()
  await userEvent.keyboard(key)
  return screen.findByRole('listbox')
}

describe('Select', () => {
  it('트리거에 고른 값의 글자가 보이고 보조줄은 보이지 않는다', () => {
    const { trigger } = renderSelect({ value: 'lee' })
    expect(trigger).toHaveTextContent('이재환')
    expect(trigger).not.toHaveTextContent('이번 주 휴가')
  })

  it('Enter 로 열면 고른 줄에 포커스가 가고, 화살표는 비활성 줄을 건너뛰며, Enter 로 고르면 닫힌다', async () => {
    const { trigger, onValueChange } = renderSelect()
    await openWithKeyboard(trigger)
    const park = screen.getByRole('option', { name: '박민수' })
    await waitFor(() => expect(park).toHaveFocus())
    expect(park).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: '정하늘' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(park).toHaveFocus()

    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('jung')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('ArrowDown 으로도 열린다', async () => {
    const { trigger } = renderSelect()
    expect(await openWithKeyboard(trigger, '{ArrowDown}')).toBeInTheDocument()
  })

  it('Esc 로 닫으면 값을 바꾸지 않고 트리거로 포커스가 돌아온다', async () => {
    const { trigger, onValueChange } = renderSelect()
    await openWithKeyboard(trigger)
    await userEvent.keyboard('{ArrowDown}{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('글자를 치면 앞 아이콘이 아니라 줄 글자로 찾는다', async () => {
    const { trigger } = renderSelect()
    await openWithKeyboard(trigger)
    await userEvent.keyboard('미')
    expect(screen.getByRole('option', { name: '미정' })).toHaveFocus()
  })

  it('미정 줄을 고르면 null 을 낸다', async () => {
    const { trigger, onValueChange } = renderSelect()
    await openWithKeyboard(trigger)
    await userEvent.click(screen.getByRole('option', { name: '미정' }))
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('값이 null 이고 플레이스홀더가 있으면 플레이스홀더를 보인다', () => {
    const { trigger } = renderSelect({ value: null, placeholder: '담당자 고르기' })
    expect(trigger).toHaveTextContent('담당자 고르기')
    expect(trigger).not.toHaveTextContent('미정')
  })

  it('값이 null 이고 플레이스홀더가 없으면 미정 줄이 고른 값이다', async () => {
    const { trigger } = renderSelect({ value: null })
    expect(trigger).toHaveTextContent('미정')
    await openWithKeyboard(trigger)
    expect(screen.getByRole('option', { name: '미정' })).toHaveAttribute('aria-selected', 'true')
  })

  it('고른 값이 없으면(플레이스홀더) Enter 로 열 때 맨 위 미정 줄에 포커스가 간다', async () => {
    const { trigger } = renderSelect({ value: null, placeholder: '담당자 고르기' })
    await openWithKeyboard(trigger)
    await waitFor(() => expect(screen.getByRole('option', { name: '미정' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: '김서연' })).toHaveFocus()
  })

  it('aria-invalid 는 true 일 때만 트리거에 붙는다', () => {
    const { trigger } = renderSelect({ 'aria-invalid': true })
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
  })

  it('aria-invalid 가 false 면 속성을 붙이지 않는다', () => {
    const { trigger } = renderSelect({ 'aria-invalid': false })
    expect(trigger).not.toHaveAttribute('aria-invalid')
  })

  it('ref 는 트리거 버튼을 가리키고, 트리거를 떠나면 onBlur 를 부른다', async () => {
    const ref = createRef<HTMLButtonElement>()
    const onBlur = vi.fn()
    const { trigger } = renderSelect({ ref, onBlur })
    expect(ref.current).toBe(trigger)
    trigger.focus()
    await userEvent.tab()
    expect(onBlur).toHaveBeenCalledOnce()
  })

  it('비활성 트리거는 열리지 않는다', async () => {
    const { trigger } = renderSelect({ disabled: true })
    expect(trigger).toBeDisabled()
    await userEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('목록은 트리거 아래로 연다', async () => {
    const { trigger } = renderSelect()
    const listbox = await openWithKeyboard(trigger)
    expect(listbox).toHaveAttribute('data-side', 'bottom')
    expect(listbox).toHaveAttribute('data-align', 'start')
  })
})
