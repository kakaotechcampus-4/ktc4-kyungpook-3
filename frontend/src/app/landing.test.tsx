import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/shared/mock/db'
import { businessRequests, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

async function openLanding() {
  db.authenticated = false
  const app = renderApp('/')
  await screen.findByRole('heading', { level: 1, name: /한 번의 클릭으로/ })
  return app
}

describe('랜딩 (U2-1)', () => {
  it('`시작하기` 는 모두 로그인으로 간다 — 헤더·히어로·마지막 CTA (D-003)', async () => {
    await openLanding()
    const starts = screen.getAllByRole('link', { name: '시작하기' })
    expect(starts).toHaveLength(3)
    for (const link of starts) expect(link).toHaveAttribute('href', '/login')
  })

  it('`시작하기` 를 누르면 로그인 화면이다', async () => {
    const app = await openLanding()
    await userEvent.click(
      within(screen.getByRole('banner')).getByRole('link', { name: '시작하기' }),
    )
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
  })

  it('회원가입으로 바로 가는 링크가 없다 (D-004)', async () => {
    await openLanding()
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toBe('/signup')
    }
    expect(screen.queryByRole('link', { name: /회원가입|계정 만들기/ })).not.toBeInTheDocument()
  })

  it('데모 버튼과 `무료로 시작하기` 가 없다 (D-002, D-003)', async () => {
    await openLanding()
    expect(screen.queryByText(/데모/)).not.toBeInTheDocument()
    expect(screen.queryByText('무료로 시작하기')).not.toBeInTheDocument()
  })

  it('정적 화면이다 — 부팅 조회 말고는 요청하지 않는다', async () => {
    db.authenticated = false
    const log = recordRequests()
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: /한 번의 클릭으로/ })
    expect(businessRequests(log.started)).toEqual([])
  })

  it('제품 미리보기는 누를 곳 없는 그림 한 장이다', async () => {
    await openLanding()
    const preview = screen.getByRole('img', { name: /회의록 화면 미리보기/ })
    expect(within(preview).queryAllByRole('button')).toHaveLength(0)
    expect(within(preview).queryAllByRole('link')).toHaveLength(0)
  })

  it('매스 포즈 칸을 누르면 그림과 설명이 함께 바뀐다', async () => {
    await openLanding()
    const done = screen.getByRole('button', { name: '완료' })
    await userEvent.click(done)
    expect(done).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: '확인이 끝나면 눈을 접습니다' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '매스 완료' })).toBeInTheDocument()
  })

  it('매스 그림의 이름은 내부 포즈 키가 아니라 칸 이름이다', async () => {
    await openLanding()
    expect(screen.getByRole('img', { name: '매스 대기' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '묻는 중' }))
    expect(screen.getByRole('img', { name: '매스 묻는 중' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /idle|upRight|squint|left/ })).not.toBeInTheDocument()
  })

  it('요금제 절을 뺐으니 푸터에도 `요금제` 가 없고 `[상태 페이지]` 자리표시도 없다', async () => {
    await openLanding()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).queryByText('요금제')).not.toBeInTheDocument()
    expect(within(footer).queryByText(/상태 페이지/)).not.toBeInTheDocument()
  })

  it('`문의하기` 는 연결할 창구가 없어 비활성이다', async () => {
    await openLanding()
    for (const button of screen.getAllByRole('button', { name: '문의하기' })) {
      expect(button).toHaveAttribute('aria-disabled', 'true')
    }
  })
})

describe('로그인 → 회원가입 (U2-1)', () => {
  it('로그인 화면의 `회원가입` 링크로 회원가입에 간다. 회원가입에서는 로그인으로 돌아간다', async () => {
    db.authenticated = false
    const app = renderApp('/login')
    await userEvent.click(await screen.findByRole('link', { name: '회원가입' }))
    expect(await screen.findByRole('heading', { name: '회원가입' })).toBeInTheDocument()
    await app.expectPath('/signup')

    await userEvent.click(screen.getByRole('link', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
  })
})
