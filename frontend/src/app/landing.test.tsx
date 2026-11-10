import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/shared/mock/db'
import { businessRequests, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

async function openLanding() {
  db.authenticated = false
  const app = renderApp('/')
  await screen.findByRole('heading', { level: 1, name: /회의에서 나온 일을/ })
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
    await screen.findByRole('heading', { level: 1, name: /회의에서 나온 일을/ })
    expect(businessRequests(log.started)).toEqual([])
  })

  it('제품 미리보기는 누를 곳 없는 그림 한 장이다', async () => {
    await openLanding()
    const preview = screen.getByRole('img', { name: /제품 화면 미리보기/ })
    expect(within(preview).queryAllByRole('button')).toHaveLength(0)
    expect(within(preview).queryAllByRole('link')).toHaveLength(0)
  })

  it('제품 미리보기는 실제 태스크 화면의 메뉴와 상태·담당자·마감을 보여 준다', async () => {
    await openLanding()
    const preview = within(screen.getByRole('img', { name: /제품 화면 미리보기/ }))
    for (const label of ['대시보드', '프로젝트 맵']) {
      expect(preview.getAllByText(label)).toHaveLength(1)
    }
    for (const label of ['회의록', '메시지', '팀']) {
      expect(preview.getAllByText(label)).toHaveLength(2)
    }
    expect(preview.getAllByText('태스크')).toHaveLength(3)
    expect(preview.getByText('카테캠 3팀')).toBeInTheDocument()
    expect(preview.getByText('진호')).toBeInTheDocument()
    for (const label of ['전체', '확인 필요', '완료']) {
      expect(preview.getByText(label)).toBeInTheDocument()
    }
    expect(preview.getAllByText('진행 중')).toHaveLength(2)
    for (const label of [
      '온보딩 문구 수정',
      '회원가입 화면',
      'STT 정확도 측정',
      '담당자 없음',
      '박민수',
      '정하늘',
      '09/10',
      '09/16',
      '09/19',
    ]) {
      expect(preview.getByText(label)).toBeInTheDocument()
    }
    expect(preview.getAllByText('할 일')).toHaveLength(2)
    expect(preview.getAllByText('기한 지남')).toHaveLength(2)
    expect(preview.getByText('7일 안에 마감')).toBeInTheDocument()
  })

  it('회의록 수정·프로젝트 맵·태스크 보기·웹 답장을 소개한다', async () => {
    await openLanding()
    expect(
      screen.getByRole('heading', { name: '회의록은 팀이 확인한 내용으로.' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/제목과 전사문을 직접 고치고/)).toBeInTheDocument()
    expect(screen.getByText(/태스크는 리스트·보드·캘린더·간트로/)).toBeInTheDocument()
    expect(screen.getByText(/프로젝트 맵에서는 주제와 태스크의 연결/)).toBeInTheDocument()
    expect(screen.getByText(/웹에서 답장을 주고받으며/)).toBeInTheDocument()
  })

  it('요약은 웹과 파일로, 태스크는 Notion으로 안내한다', async () => {
    await openLanding()
    const integrations = screen.getByRole('region', { name: '연동' })
    expect(
      within(integrations).getByText(/회의에서 정한 태스크를 팀의 Notion에 반영/),
    ).toBeInTheDocument()
    expect(
      within(integrations).getByText('회의 요약은 웹에서 읽거나 Markdown 파일로 가져가세요.'),
    ).toBeInTheDocument()
    expect(
      within(integrations).getByText(/Discord로 새 메시지를 알리고 답장은 웹 대화에서 확인/),
    ).toBeInTheDocument()
  })

  it('마스코트 매스의 이름과 함께하는 순간을 소개한다', async () => {
    await openLanding()
    const introduction = screen.getByRole('region', { name: '함께 일할 매스예요.' })
    expect(
      within(introduction).getByRole('heading', { level: 2, name: '함께 일할 매스예요.' }),
    ).toBeInTheDocument()
    expect(within(introduction).getByRole('img', { name: '마스코트 매스' })).toBeInTheDocument()
    expect(
      within(introduction).getByText(/Manager's Manager의 마스코트, 매스예요/),
    ).toBeInTheDocument()
    expect(
      within(introduction).getByText(/회의 정리를 기다릴 때, 확인할 메시지를 살펴볼 때/),
    ).toBeInTheDocument()
  })

  it('요금제 절을 뺐으니 푸터에도 `요금제` 가 없고 `[상태 페이지]` 자리표시도 없다', async () => {
    await openLanding()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).queryByText('요금제')).not.toBeInTheDocument()
    expect(within(footer).queryByText(/상태 페이지/)).not.toBeInTheDocument()
  })

  it('연결되지 않는 문의 버튼 없이 실제 정책 문서로 이동한다', async () => {
    await openLanding()
    expect(screen.queryByRole('button', { name: '문의하기' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '이용약관' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: '개인정보처리방침' })).toHaveAttribute(
      'href',
      '/privacy',
    )
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
