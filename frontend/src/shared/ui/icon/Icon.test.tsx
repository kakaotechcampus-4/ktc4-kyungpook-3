import { render, screen } from '@testing-library/react'
import { Icon } from './Icon'

describe('Icon', () => {
  it('기본은 장식이라 스크린리더에 없다', () => {
    const { container } = render(<Icon name="check" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '16')
    // 색은 부모 글자색을 따른다 — 캔버스의 16진수를 옮겨 적지 않는다
    expect(svg).toHaveAttribute('stroke', 'currentColor')
  })

  it('label 을 주면 이름 있는 그림이다', () => {
    render(<Icon name="settings" label="설정" size={14} />)
    expect(screen.getByRole('img', { name: '설정' })).toHaveAttribute('width', '14')
  })

  it('캔버스 선 굵기를 쓰고 필요한 자리만 바꾼다', () => {
    const { container, rerender } = render(<Icon name="chevron-down" />)
    expect(container.querySelector('svg')).toHaveAttribute('stroke-width', '1.9')
    rerender(<Icon name="check" strokeWidth={2.4} />)
    expect(container.querySelector('svg')).toHaveAttribute('stroke-width', '2.4')
  })
})
