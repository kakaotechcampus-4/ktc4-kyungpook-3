import { createRef } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stubViewport } from '@/shared/test/viewport'
import { Select, SelectInitial, SelectNoneMark } from './Select'
import type { SelectProps } from './Select'
import type { SelectOption } from './options'

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
      label="담당자"
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

describe('Select — 휴대폰 폭(560px 미만)', () => {
  async function openSheet(props: Partial<SelectProps<Member>> = {}) {
    stubViewport(true)
    const rendered = renderSelect(props)
    await userEvent.click(rendered.trigger)
    const sheet = await screen.findByRole('dialog', { name: '담당자' })
    const listbox = within(sheet).getByRole('listbox', { name: '담당자' })
    return { ...rendered, sheet, listbox }
  }

  function activeOption(listbox: HTMLElement) {
    const id = listbox.getAttribute('aria-activedescendant')
    return id === null ? null : document.getElementById(id)
  }

  it('칸 이름이 제목인 시트로 열리고, 목록이 포커스를 받아 고른 줄을 짚는다', async () => {
    const { trigger, listbox } = await openSheet()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(listbox).toHaveFocus())
    const park = within(listbox).getByRole('option', { name: '박민수' })
    expect(park).toHaveAttribute('aria-selected', 'true')
    expect(activeOption(listbox)).toBe(park)
    const names = ['미정', '김서연', '박민수', /^이재환/, '정하늘']
    const rows = within(listbox).getAllByRole('option')
    expect(rows).toHaveLength(names.length)
    names.forEach((name, index) => expect(rows[index]).toHaveAccessibleName(name))
  })

  it('↓ 는 비활성 줄을 건너뛰고, Enter 로 고르면 닫혀 트리거로 포커스가 돌아온다', async () => {
    const { trigger, listbox, onValueChange } = await openSheet()
    await waitFor(() => expect(listbox).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    expect(activeOption(listbox)).toHaveTextContent('정하늘')
    await userEvent.keyboard('{Home}')
    expect(activeOption(listbox)).toHaveTextContent('미정')
    await userEvent.keyboard('{End}{Enter}')
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('jung')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('글자를 치면 그 글자로 시작하는 줄을 짚고, 미정 줄을 누르면 null 을 낸다', async () => {
    const { listbox, onValueChange } = await openSheet()
    await waitFor(() => expect(listbox).toHaveFocus())
    await userEvent.keyboard('김')
    expect(activeOption(listbox)).toHaveTextContent('김서연')
    await userEvent.click(within(listbox).getByRole('option', { name: '미정' }))
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('Esc 로 닫으면 값을 바꾸지 않는다', async () => {
    const { trigger, onValueChange } = await openSheet()
    await userEvent.keyboard('{ArrowDown}{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('비활성 줄은 눌러도 고르지 않는다', async () => {
    const { listbox, onValueChange } = await openSheet()
    await userEvent.click(within(listbox).getByRole('option', { name: /이재환/ }))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('트리거에서 ↓ 로도 열린다', async () => {
    stubViewport(true)
    const { trigger } = renderSelect()
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(await screen.findByRole('dialog', { name: '담당자' })).toBeInTheDocument()
  })

  it('폭이 560 경계를 넘으면 떠 있는 목록과 시트가 바뀐다', async () => {
    const viewport = stubViewport(false)
    const { trigger } = renderSelect()
    await openWithKeyboard(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

    viewport.resize(true)
    await userEvent.click(screen.getByRole('combobox', { name: '담당자' }))
    expect(await screen.findByRole('dialog', { name: '담당자' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    viewport.resize(false)
    await openWithKeyboard(screen.getByRole('combobox', { name: '담당자' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ref·aria-invalid 는 시트 트리거에도 간다', () => {
    stubViewport(true)
    const ref = createRef<HTMLButtonElement>()
    const { trigger } = renderSelect({ ref, 'aria-invalid': true })
    expect(ref.current).toBe(trigger)
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
  })
})
