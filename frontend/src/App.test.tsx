import { render, screen } from '@testing-library/react'
import App from './App'

/* M2 는 라우터가 없다. App 은 shared/ui 를 눈으로 훑는 임시 갤러리이고,
   이 테스트는 그 갤러리가 실제로 그려지는지만 본다 — M3 에서 라우터와 함께 갈아엎는다. */

/** 갤러리 칸 제목은 컴포넌트 이름이다. 제품 문구가 아니라 페이지 크롬이다. */
const SECTIONS = [
  'Button — variant',
  'Button — size',
  'Label · ErrorText',
  'TextField',
  'Card',
  'Panel',
  'Skeleton',
  'Checkbox',
  'SelectCard',
  'Segmented',
  'Modal',
  'Toast',
  'Mascot',
  'EmptyState',
]

describe('App', () => {
  it('renders the temporary M2 gallery instead of an empty root', () => {
    const { container } = render(<App />)

    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByRole('heading', { level: 1, name: 'M2 gallery' })).toBeInTheDocument()
  })

  it('draws one section per shared/ui component', () => {
    render(<App />)

    const titles = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)
    expect(titles).toEqual(SECTIONS)
  })

  it('keeps the overlay components closed until the demo opens them', () => {
    render(<App />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'open modal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'toast' })).toBeInTheDocument()
  })
})
