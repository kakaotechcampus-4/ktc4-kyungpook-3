import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateField } from './DateField'
import type { DateFieldProps } from './DateField'

function ControlledDateField({
  initial = '',
  onChange,
  ...rest
}: Omit<DateFieldProps, 'value' | 'onChange'> & {
  initial?: string
  onChange?: (value: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <DateField
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

function hiddenDateInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type="date"]')
  if (!input) throw new Error('숨은 날짜 입력이 없다')
  return input
}

describe('DateField', () => {
  it('글로 친 값을 그대로 onChange 로 넘긴다', async () => {
    const onChange = vi.fn()
    render(<ControlledDateField label="마감" onChange={onChange} />)

    await userEvent.type(screen.getByLabelText('마감'), '2026-11-20')

    expect(screen.getByLabelText('마감')).toHaveValue('2026-11-20')
    expect(onChange).toHaveBeenLastCalledWith('2026-11-20')
  })

  it('글 입력은 날짜 입력이 아니다 — 비워 두면 미정이다', () => {
    render(<DateField label="마감" value="" onChange={() => {}} />)
    const input = screen.getByLabelText('마감')

    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('')
  })

  it('달력 버튼을 이름으로 찾을 수 있고 이름을 바꿀 수 있다', () => {
    render(<DateField label="마감" value="" onChange={() => {}} calendarLabel="마감 달력 열기" />)

    expect(screen.getByRole('button', { name: '마감 달력 열기' })).toHaveAttribute('type', 'button')
  })

  it('달력 버튼의 기본 이름은 달력 열기다', () => {
    render(<DateField label="마감" value="" onChange={() => {}} />)

    expect(screen.getByRole('button', { name: '달력 열기' })).toBeInTheDocument()
  })

  it('달력 버튼을 누르면 숨은 날짜 입력의 달력을 연다', async () => {
    const { container } = render(<DateField label="마감" value="" onChange={() => {}} />)
    const showPicker = vi.fn()
    hiddenDateInput(container).showPicker = showPicker

    await userEvent.click(screen.getByRole('button', { name: '달력 열기' }))

    expect(showPicker).toHaveBeenCalledTimes(1)
  })

  it('달력을 열 수 없는 브라우저에서도 버튼이 오류 없이 눌린다', async () => {
    const { container } = render(<DateField label="마감" value="" onChange={() => {}} />)
    const picker = hiddenDateInput(container)
    picker.showPicker = () => {
      throw new DOMException('막힘', 'NotSupportedError')
    }
    const click = vi.spyOn(picker, 'click')

    await userEvent.click(screen.getByRole('button', { name: '달력 열기' }))

    expect(click).toHaveBeenCalledTimes(1)
  })

  it('달력에서 고른 날짜를 onChange 로 넘긴다', () => {
    const onChange = vi.fn()
    const { container } = render(<ControlledDateField label="마감" onChange={onChange} />)

    fireEvent.change(hiddenDateInput(container), { target: { value: '2026-12-01' } })

    expect(onChange).toHaveBeenCalledWith('2026-12-01')
    expect(screen.getByLabelText('마감')).toHaveValue('2026-12-01')
  })

  it('숨은 날짜 입력은 올바른 날짜일 때만 지금 값으로 채운다', () => {
    const { container, rerender } = render(
      <DateField label="마감" value="2026-11-20" onChange={() => {}} />,
    )
    expect(hiddenDateInput(container)).toHaveValue('2026-11-20')

    rerender(<DateField label="마감" value="2026-11" onChange={() => {}} />)
    expect(hiddenDateInput(container)).toHaveValue('')
  })

  it('숨은 날짜 입력은 탭 순서와 접근성 트리에서 빠진다', () => {
    const { container } = render(<DateField label="마감" value="" onChange={() => {}} />)
    const picker = hiddenDateInput(container)

    expect(picker).toHaveAttribute('tabindex', '-1')
    expect(picker).toHaveAttribute('aria-hidden', 'true')
  })

  it('막힌 칸은 TextField 와 같이 라벨과 경계를 강조색으로 칠한다', () => {
    render(<DateField label="마감" labelTone="required-blocking" value="" onChange={() => {}} />)
    const input = screen.getByLabelText('마감')

    expect(screen.getByText('마감')).toHaveClass('text-accent')
    expect(input).toHaveClass('placeholder:text-accent-solid')
    expect(input.parentElement).toHaveClass(
      'border-accent',
      'has-[input:focus-visible]:outline-accent-point',
    )
  })

  it('비활성이면 달력 버튼도 막는다', () => {
    render(<DateField label="마감" value="2026-11-20" onChange={() => {}} disabled />)

    expect(screen.getByLabelText('마감')).toBeDisabled()
    expect(screen.getByRole('button', { name: '달력 열기' })).toBeDisabled()
  })

  it('ref 는 글 입력으로 간다', () => {
    let node: HTMLInputElement | null = null
    render(
      <DateField
        label="마감"
        value=""
        onChange={() => {}}
        ref={(element) => {
          node = element
        }}
      />,
    )

    expect(node).toBe(screen.getByLabelText('마감'))
  })
})
