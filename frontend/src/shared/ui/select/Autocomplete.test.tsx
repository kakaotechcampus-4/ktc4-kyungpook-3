import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { stubViewport } from '@/shared/test/viewport'
import { Modal } from '../modal/Modal'
import { Autocomplete } from './Autocomplete'

const NAMES = ['김서연', '박민수', '이재환', '김민지']

function Field({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(value)
      }}
    >
      <Autocomplete
        aria-label="팀원 이름"
        value={value}
        onValueChange={setValue}
        suggestions={NAMES}
        listLabel="미리 추가한 팀원"
      />
    </form>
  )
}

function renderField() {
  const onSubmit = vi.fn<(value: string) => void>()
  const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
  render(<Field onSubmit={onSubmit} />)
  return { user, onSubmit, input: screen.getByRole('combobox', { name: '팀원 이름' }) }
}

const listbox = () => screen.queryByRole('listbox', { name: '미리 추가한 팀원' })

const optionTexts = () =>
  within(screen.getByRole('listbox', { name: '미리 추가한 팀원' }))
    .getAllByRole('option')
    .map((option) => option.textContent)

function active(input: HTMLElement) {
  const id = input.getAttribute('aria-activedescendant')
  return id === null ? null : document.getElementById(id)
}

describe('Autocomplete', () => {
  it('입력 칸이 제안 목록을 가리키는 combobox 이고, 입력하면 그 글자가 든 제안만 열린다', async () => {
    const { user, input } = renderField()
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).not.toHaveAttribute('aria-controls')
    expect(listbox()).toBeNull()

    await user.type(input, '김')
    expect(optionTexts()).toEqual(['김서연', '김민지'])
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', listbox()?.id)
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(input).toHaveFocus()
  })

  it('↓↑ 로 짚고 끝에서 멈추며, Enter 로 고르면 칸이 그 글자가 되고 닫힌다', async () => {
    const { user, input, onSubmit } = renderField()
    await user.type(input, '김')
    await user.keyboard('{ArrowDown}')
    expect(active(input)).toHaveAccessibleName('김서연')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(active(input)).toHaveAccessibleName('김민지')
    await user.keyboard('{ArrowUp}{Enter}')

    expect(input).toHaveValue('김서연')
    await waitFor(() => expect(listbox()).toBeNull())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveFocus()
  })

  it('닫혀 있으면 ↓ 가 열고 첫 줄을 짚는다', async () => {
    const { user, input } = renderField()
    await user.click(input)
    expect(listbox()).toBeNull()
    await user.keyboard('{ArrowDown}')
    expect(optionTexts()).toEqual(NAMES)
    expect(active(input)).toHaveAccessibleName('김서연')
  })

  it('짚은 줄이 없으면 Enter 는 폼을 제출한다', async () => {
    const { user, input, onSubmit } = renderField()
    await user.type(input, '박{Enter}')
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('박')
  })

  it('Esc 는 목록만 닫고 글자는 그대로 둔다', async () => {
    const { user, input } = renderField()
    await user.type(input, '이{ArrowDown}{Escape}')
    await waitFor(() => expect(listbox()).toBeNull())
    expect(input).toHaveValue('이')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('창 안에서 목록이 열려 있으면 Esc 가 목록만 닫고, 닫혀 있으면 창을 닫는다', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    function InModal() {
      const [open, setOpen] = useState(true)
      const [value, setValue] = useState('')
      return (
        <Modal open={open} onOpenChange={setOpen} title="팀원 연결">
          <Autocomplete
            aria-label="팀원 이름"
            value={value}
            onValueChange={setValue}
            suggestions={NAMES}
            listLabel="미리 추가한 팀원"
          />
        </Modal>
      )
    }
    render(<InModal />)
    const input = await screen.findByRole('combobox', { name: '팀원 이름' })
    await user.type(input, '이')
    expect(listbox()).not.toBeNull()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(listbox()).toBeNull())
    expect(screen.getByRole('dialog', { name: '팀원 연결' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('한글 조합 중의 Enter·화살표는 짚거나 고르지 않는다', async () => {
    const { user, input, onSubmit } = renderField()
    await user.type(input, '김{ArrowDown}')
    fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(input).toHaveValue('김')
    expect(active(input)).toHaveAccessibleName('김서연')
    expect(onSubmit).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')
    expect(input).toHaveValue('김서연')
  })

  it('줄을 누르면 고르고 포커스는 칸에 남는다', async () => {
    const { user, input } = renderField()
    await user.type(input, '민')
    await user.click(screen.getByRole('option', { name: '박민수' }))
    expect(input).toHaveValue('박민수')
    expect(input).toHaveFocus()
    await waitFor(() => expect(listbox()).toBeNull())
  })

  it('맞는 제안이 없거나 칸 글자가 유일한 제안과 같으면 닫힌다', async () => {
    const { user, input } = renderField()
    await user.type(input, '최')
    expect(listbox()).toBeNull()
    await user.clear(input)
    await user.type(input, '이재')
    expect(optionTexts()).toEqual(['이재환'])
    await user.type(input, '환')
    await waitFor(() => expect(listbox()).toBeNull())
  })

  it('칸을 벗어나면 닫힌다', async () => {
    const { user, input } = renderField()
    await user.type(input, '김')
    expect(listbox()).not.toBeNull()
    await user.tab()
    await waitFor(() => expect(listbox()).toBeNull())
  })

  it('ref 는 입력 칸이다 — 폼 라이브러리가 오류 칸으로 포커스를 옮길 때 쓴다', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <Autocomplete
        ref={ref}
        aria-label="팀원 이름"
        value=""
        onValueChange={() => {}}
        suggestions={NAMES}
        listLabel="미리 추가한 팀원"
      />,
    )
    expect(ref.current).toBe(screen.getByRole('combobox', { name: '팀원 이름' }))
  })

  it('휴대폰 폭에서도 시트가 아니라 칸 아래 목록이다', async () => {
    stubViewport(true)
    const { user, input } = renderField()
    await user.type(input, '김')
    expect(optionTexts()).toEqual(['김서연', '김민지'])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(input).toHaveFocus()
  })
})
