import { render, screen } from '@testing-library/react'
import { ErrorText } from './ErrorText'

describe('ErrorText', () => {
  // 입력의 aria-describedby 가 읽는다. alert 까지 붙이면 두 번 읽힌다 (F-r1 #13)
  it('is not a live region — the input announces it through aria-describedby', () => {
    render(<ErrorText>이메일을 입력해 주세요</ErrorText>)

    expect(screen.getByText('이메일을 입력해 주세요')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('이메일을 입력해 주세요')).not.toHaveAttribute('aria-live')
  })

  it('renders a paragraph at 12 / 400 / accent', () => {
    render(<ErrorText>이메일을 입력해 주세요</ErrorText>)
    const text = screen.getByText('이메일을 입력해 주세요')

    expect(text.tagName).toBe('P')
    expect(text).toHaveClass('text-[12px]', 'font-normal', 'text-accent')
  })

  it('draws no icon', () => {
    const { container } = render(<ErrorText>이메일을 입력해 주세요</ErrorText>)

    expect(container.querySelector('svg')).toBeNull()
  })

  it('takes an id so the input can point at it', () => {
    render(<ErrorText id="email-error">이메일을 입력해 주세요</ErrorText>)

    expect(screen.getByText('이메일을 입력해 주세요')).toHaveAttribute('id', 'email-error')
  })

  it('appends the caller className', () => {
    render(<ErrorText className="mt-6">이메일을 입력해 주세요</ErrorText>)

    expect(screen.getByText('이메일을 입력해 주세요')).toHaveClass('mt-6', 'text-accent')
  })
})
