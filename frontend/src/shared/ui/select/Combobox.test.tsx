import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { stubViewport } from '@/shared/test/viewport'
import { Combobox } from './Combobox'
import type { ComboboxProps } from './Combobox'
import type { SelectOption } from './options'

const TASKS: readonly SelectOption<string>[] = [
  { value: 'login', label: '로그인 API 연동', description: '09/20 마감 · 기한 지남' },
  { value: 'deploy', label: '배포 스크립트', description: '09/24 마감 · 진행 중' },
  { value: 'signup', label: '회원가입 화면' },
  { value: 'minutes', label: '회의록 요약 검수' },
  { value: 'search', label: '검색 API' },
  { value: 'profile', label: '프로필 화면' },
  { value: 'push', label: '푸시 알림' },
  { value: 'audit', label: '접근성 점검' },
  {
    value: 'font',
    label: '폰트 적용',
    disabled: true,
    description: '완료한 태스크는 재촉할 수 없어요',
  },
]

function renderCombobox(props: Partial<ComboboxProps<string>> = {}) {
  const onValueChange = vi.fn<(value: string) => void>()
  const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
  render(
    <Combobox
      aria-label="태스크"
      label="태스크"
      searchLabel="태스크 찾기"
      emptyText="맞는 태스크가 없어요"
      placeholder="태스크 고르기"
      value={null}
      onValueChange={onValueChange}
      options={TASKS}
      {...props}
    />,
  )
  return { user, onValueChange, trigger: screen.getByRole('combobox', { name: '태스크' }) }
}

async function open(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement) {
  await user.click(trigger)
  const search = await screen.findByRole('combobox', { name: '태스크 찾기' })
  await waitFor(() => expect(search).toHaveFocus())
  return { search, listbox: screen.getByRole('listbox', { name: '태스크' }) }
}

function active(search: HTMLElement) {
  const id = search.getAttribute('aria-activedescendant')
  return id === null ? null : document.getElementById(id)
}

describe('Combobox', () => {
  it('열면 찾기 칸에 포커스가 가고, 칸이 목록을 가리킨다', async () => {
    const { user, trigger } = renderCombobox()
    expect(trigger).toHaveTextContent('태스크 고르기')
    const { search, listbox } = await open(user, trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(search).toHaveAttribute('aria-controls', listbox.id)
    expect(search).toHaveAttribute('aria-expanded', 'true')
    expect(active(search)).toHaveAccessibleName(/^로그인 API 연동/)
  })

  it('↑↓ 는 고를 수 없는 줄을 건너뛰고, Enter 로 고르면 닫혀 트리거로 포커스가 돌아온다', async () => {
    const { user, trigger, onValueChange } = renderCombobox()
    const { search } = await open(user, trigger)
    await user.keyboard('{ArrowUp}')
    expect(active(search)).toHaveAccessibleName(/^로그인 API 연동/)
    for (let step = 0; step < 9; step += 1) await user.keyboard('{ArrowDown}')
    expect(active(search)).toHaveAccessibleName('접근성 점검')
    await user.keyboard('{ArrowUp}{Enter}')
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('push')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('찾기 칸에 치면 이름에 그 글자가 든 줄만 남고, 첫 줄을 짚는다', async () => {
    const { user, trigger, onValueChange } = renderCombobox()
    const { search, listbox } = await open(user, trigger)
    await user.keyboard('화면')
    const rows = within(listbox).getAllByRole('option')
    expect(rows.map((row) => row.textContent)).toEqual(['회원가입 화면', '프로필 화면'])
    expect(active(search)).toBe(rows[0])
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('profile')
  })

  it('맞는 줄이 없으면 안내를 보이고 Enter 는 아무것도 고르지 않는다', async () => {
    const { user, trigger, onValueChange } = renderCombobox()
    const { search, listbox } = await open(user, trigger)
    await user.keyboard('없는 태스크')
    expect(screen.getByRole('status')).toHaveTextContent('맞는 태스크가 없어요')
    expect(within(listbox).queryAllByRole('option')).toHaveLength(0)
    expect(search).not.toHaveAttribute('aria-activedescendant')
    await user.keyboard('{Enter}')
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('고른 값이 있으면 그 줄이 굵은 체크 줄이고 처음 짚는 줄이다. 다시 열면 찾기 칸이 비어 있다', async () => {
    const { user, trigger } = renderCombobox({ value: 'deploy' })
    expect(trigger).toHaveTextContent('배포 스크립트')
    let { search, listbox } = await open(user, trigger)
    const deploy = within(listbox).getByRole('option', { name: /^배포 스크립트/ })
    expect(deploy).toHaveAttribute('aria-selected', 'true')
    expect(active(search)).toBe(deploy)

    await user.keyboard('배포{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    ;({ search, listbox } = await open(user, trigger))
    expect(search).toHaveValue('')
    expect(within(listbox).getAllByRole('option')).toHaveLength(TASKS.length)
  })

  it('Esc 로 닫으면 값을 바꾸지 않고 트리거로 포커스가 돌아온다', async () => {
    const { user, trigger, onValueChange } = renderCombobox()
    await open(user, trigger)
    await user.keyboard('{ArrowDown}{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('줄을 누르면 고르고, 고를 수 없는 줄은 눌러도 그대로다', async () => {
    const { user, trigger, onValueChange } = renderCombobox()
    const { listbox } = await open(user, trigger)
    await user.click(within(listbox).getByRole('option', { name: /^폰트 적용/ }))
    expect(onValueChange).not.toHaveBeenCalled()
    await user.click(within(listbox).getByRole('option', { name: '검색 API' }))
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('search')
  })

  it('바깥을 누르면 닫힌다', async () => {
    const { user, trigger } = renderCombobox()
    await open(user, trigger)
    await user.click(document.body)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('잠긴 트리거는 열리지 않는다', async () => {
    const { user, trigger } = renderCombobox({ disabled: true })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('휴대폰 폭에서는 칸 이름이 제목인 시트에 찾기 칸과 목록이 열린다', async () => {
    stubViewport(true)
    const { user, trigger, onValueChange } = renderCombobox()
    const { search } = await open(user, trigger)
    const sheet = screen.getByRole('dialog', { name: '태스크' })
    expect(sheet).toContainElement(search)
    await user.keyboard('푸시{Enter}')
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('push')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})
