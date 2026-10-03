import { render, screen } from '@testing-library/react'
import { FormErrorPanel } from './FormErrorPanel'

describe('FormErrorPanel', () => {
  it('문구가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<FormErrorPanel message={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('비필드 오류를 alert 로 알리고 대체 경로 버튼을 함께 둔다', () => {
    render(
      <FormErrorPanel
        message="이메일 또는 비밀번호가 올바르지 않아요."
        action={<button type="button">다시 시도</button>}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('이메일 또는 비밀번호가 올바르지 않아요.')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('유채 오류 박스가 아니라 눌린 면이다 (§7-13)', () => {
    render(<FormErrorPanel message="문제가 생겼어요." />)
    const panel = screen.getByRole('alert')
    expect(panel).toHaveClass('bg-surface-sunken')
    expect(panel.className).not.toMatch(/accent/)
  })
})
