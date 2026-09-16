import { render, screen } from '@testing-library/react'
import { Label } from './Label'

describe('Label', () => {
  it('renders the text given as children', () => {
    render(<Label>이메일</Label>)

    expect(screen.getByText('이메일')).toBeInTheDocument()
  })

  it('hands focus to the input through htmlFor', () => {
    render(
      <>
        <Label htmlFor="email">이메일</Label>
        <input id="email" />
      </>,
    )

    expect(screen.getByLabelText('이메일')).toBeInTheDocument()
  })

  it('stays at weight 400 in every tone', () => {
    const { rerender } = render(<Label>이메일</Label>)
    expect(screen.getByText('이메일')).toHaveClass('font-normal')
    expect(screen.getByText('이메일')).not.toHaveClass('font-semibold')

    rerender(<Label tone="onboarding">이메일</Label>)
    expect(screen.getByText('이메일')).toHaveClass('font-normal')

    rerender(<Label tone="auth">이메일</Label>)
    expect(screen.getByText('이메일')).toHaveClass('font-normal')
  })

  it('draws each tone in its own size and colour', () => {
    const { rerender } = render(<Label>이메일</Label>)
    expect(screen.getByText('이메일')).toHaveClass('text-[12px]', 'text-sub')

    rerender(<Label tone="onboarding">이메일</Label>)
    expect(screen.getByText('이메일')).toHaveClass('text-[12px]', 'text-dim')

    rerender(<Label tone="auth">이메일</Label>)
    expect(screen.getByText('이메일')).toHaveClass('text-[13px]', 'text-dim')
  })

  it('swaps the tone colour for the accent when blocking', () => {
    render(<Label blocking>담당자</Label>)
    const label = screen.getByText('담당자')

    expect(label).toHaveClass('text-accent')
    expect(label).not.toHaveClass('text-sub')
  })

  it('appends the caller className', () => {
    render(<Label className="mb-6">이메일</Label>)

    expect(screen.getByText('이메일')).toHaveClass('mb-6', 'text-sub')
  })
})
