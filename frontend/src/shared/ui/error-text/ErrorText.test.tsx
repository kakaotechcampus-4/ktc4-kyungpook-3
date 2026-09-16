import { render, screen } from '@testing-library/react'
import { ErrorText } from './ErrorText'

describe('ErrorText', () => {
  it('announces the message through role=alert', () => {
    render(<ErrorText>이메일을 입력해 주세요</ErrorText>)

    expect(screen.getByRole('alert')).toHaveTextContent('이메일을 입력해 주세요')
  })

  it('renders a paragraph at 12 / 400 / accent', () => {
    render(<ErrorText>이메일을 입력해 주세요</ErrorText>)
    const alert = screen.getByRole('alert')

    expect(alert.tagName).toBe('P')
    expect(alert).toHaveClass('text-[12px]', 'font-normal', 'text-accent')
  })

  it('draws no icon', () => {
    const { container } = render(<ErrorText>이메일을 입력해 주세요</ErrorText>)

    expect(container.querySelector('svg')).toBeNull()
  })

  it('takes an id so the input can point at it', () => {
    render(<ErrorText id="email-error">이메일을 입력해 주세요</ErrorText>)

    expect(screen.getByRole('alert')).toHaveAttribute('id', 'email-error')
  })

  it('appends the caller className', () => {
    render(<ErrorText className="mt-6">이메일을 입력해 주세요</ErrorText>)

    expect(screen.getByRole('alert')).toHaveClass('mt-6', 'text-accent')
  })
})
