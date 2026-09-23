import { render, screen } from '@testing-library/react'
import { TextField } from './TextField'

describe('TextField', () => {
  it('wires the label to the input with a generated id', () => {
    render(<TextField label="이메일" />)
    const input = screen.getByLabelText('이메일')

    expect(input).toBeInTheDocument()
    expect(input.id).not.toBe('')
  })

  it('uses the id given by the caller instead of the generated one', () => {
    render(<TextField id="email" label="이메일" />)

    expect(screen.getByLabelText('이메일')).toHaveAttribute('id', 'email')
  })

  it('draws no label when none is given and leans on aria-label', () => {
    const { container } = render(<TextField aria-label="이메일" />)

    expect(container.querySelector('label')).toBeNull()
    expect(screen.getByLabelText('이메일')).toBeInTheDocument()
  })

  it('marks the input invalid and points it at the error', () => {
    render(<TextField id="email" label="이메일" error="이메일을 입력해 주세요" />)
    const input = screen.getByLabelText('이메일')

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'email-error')
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'email-error')
    expect(screen.getByRole('alert')).toHaveTextContent('이메일을 입력해 주세요')
  })

  it('leaves the error wiring off when there is no error', () => {
    render(<TextField id="email" label="이메일" />)
    const input = screen.getByLabelText('이메일')

    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('describes the input with both the description and the error', () => {
    render(
      <TextField
        id="email"
        label="이메일"
        description="회사 메일을 씁니다"
        error="이메일을 입력해 주세요"
      />,
    )

    expect(screen.getByLabelText('이메일')).toHaveAttribute(
      'aria-describedby',
      'email-description email-error',
    )
    expect(screen.getByText('회사 메일을 씁니다')).toHaveAttribute('id', 'email-description')
  })

  it('describes the input with the description alone', () => {
    render(<TextField id="email" label="이메일" description="회사 메일을 씁니다" />)

    expect(screen.getByLabelText('이메일')).toHaveAttribute('aria-describedby', 'email-description')
  })

  it('paints label and border with the accent for a blocking field', () => {
    render(<TextField label="담당자" labelTone="required-blocking" />)

    expect(screen.getByText('담당자')).toHaveClass('text-accent')
    expect(screen.getByLabelText('담당자')).toHaveClass(
      'border-accent',
      'placeholder:text-accent-soft',
    )
  })

  it('paints the border with the accent when an error is shown', () => {
    render(<TextField label="담당자" error="담당자를 골라 주세요" />)

    expect(screen.getByLabelText('담당자')).toHaveClass('border-accent')
  })

  it('draws the product tone by default', () => {
    render(<TextField label="담당자" />)

    expect(screen.getByLabelText('담당자')).toHaveClass(
      'h-[42px]',
      'rounded-9',
      'px-13',
      'text-body',
      'border-input-border',
    )
  })

  it('draws the onboarding tone at radius 8 with the strong line', () => {
    render(<TextField tone="onboarding" label="팀 이름" />)

    expect(screen.getByLabelText('팀 이름')).toHaveClass(
      'h-[42px]',
      'rounded-8',
      'border-line-strong',
    )
  })

  it('draws the auth tone at 48px and radius 12', () => {
    render(<TextField tone="auth" label="이메일" />)

    expect(screen.getByLabelText('이메일')).toHaveClass(
      'h-48',
      'rounded-12',
      'text-[15px]',
      'border-line-strong',
    )
  })

  it('keeps the label wiring when an adornment wraps the input', () => {
    render(
      <TextField
        tone="auth"
        type="password"
        label="비밀번호"
        endAdornment={<button type="button" aria-label="비밀번호 보기" />}
      />,
    )

    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '비밀번호 보기' })).toBeInTheDocument()
  })

  it('appends the caller className to the field wrapper', () => {
    const { container } = render(<TextField className="mt-16" label="이메일" />)

    expect(container.firstElementChild).toHaveClass('mt-16', 'flex', 'flex-col')
  })

  it('moves the focus line to the wrapper when an adornment wraps the input', () => {
    render(
      <TextField
        label="비밀번호"
        endAdornment={<button type="button" aria-label="비밀번호 보기" />}
      />,
    )
    const input = screen.getByLabelText('비밀번호')
    const wrapper = input.parentElement

    expect(input).toHaveClass('focus-visible:outline-none')
    expect(wrapper).toHaveClass(
      'has-[input:focus-visible]:outline-2',
      'has-[input:focus-visible]:outline-ink',
      'has-[input:focus-visible]:-outline-offset-1',
    )
  })

  it('keeps the plain input on the global focus line', () => {
    render(<TextField label="이메일" />)

    expect(screen.getByLabelText('이메일').className).not.toMatch(/outline/)
  })

  it('draws the focus line in the accent when an error is shown', () => {
    render(<TextField label="담당자" error="담당자를 골라 주세요" />)
    const input = screen.getByLabelText('담당자')

    expect(input).toHaveClass('focus-visible:outline-accent')
    expect(input.className).not.toMatch(/outline-ink/)
  })

  it('draws the focus line in the accent for a blocking field', () => {
    render(<TextField label="담당자" labelTone="required-blocking" />)
    const input = screen.getByLabelText('담당자')

    expect(input).toHaveClass('focus-visible:outline-accent')
    expect(input.className).not.toMatch(/outline-ink/)
  })

  it('leaves the accent focus line off a plain input', () => {
    render(<TextField label="이메일" />)

    expect(screen.getByLabelText('이메일')).not.toHaveClass('focus-visible:outline-accent')
  })

  it.each([
    ['an error is shown', { error: '비밀번호를 입력해 주세요' }],
    ['the field is blocking', { labelTone: 'required-blocking' as const }],
  ])('draws the wrapper focus line in the accent when %s', (_, props) => {
    render(
      <TextField
        label="비밀번호"
        {...props}
        endAdornment={<button type="button" aria-label="비밀번호 보기" />}
      />,
    )
    const input = screen.getByLabelText('비밀번호')
    const wrapper = input.parentElement

    expect(wrapper).toHaveClass('has-[input:focus-visible]:outline-accent')
    expect(wrapper).not.toHaveClass('has-[input:focus-visible]:outline-ink')
    expect(input).toHaveClass('focus-visible:outline-none')
    expect(input).not.toHaveClass('focus-visible:outline-accent')
  })
})
