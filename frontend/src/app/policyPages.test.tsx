import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/shared/mock/db'
import { completeMeeting } from '@/shared/mock/meetingFlow'
import { renderApp } from './test/renderApp'

const NOTICE =
  '회의록을 만들기 위해 음성과 전사 내용을 외부 서비스(Elice, pyannoteAI)로 보내요. 참석자에게 알린 뒤 올려 주세요.'

describe('공개 정책 문서 화면', () => {
  it.each([
    { authenticated: false, path: '/terms', title: '이용약관' },
    { authenticated: false, path: '/privacy', title: '개인정보처리방침' },
    { authenticated: true, path: '/terms', title: '이용약관' },
    { authenticated: true, path: '/privacy', title: '개인정보처리방침' },
  ])(
    '$authenticated 로그인 상태에서 $path를 직접 읽는다',
    async ({ authenticated, path, title }) => {
      db.authenticated = authenticated
      const app = renderApp(path)

      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
      expect(screen.getByText('문서를 준비하고 있어요.')).toBeInTheDocument()
      expect(screen.getByText('내용과 시행일은 검토가 끝난 뒤 공개할게요.')).toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /동의/ })).not.toBeInTheDocument()
      await app.expectPath(path)

      const navigation = screen.getByRole('navigation', { name: '정책 문서' })
      expect(within(navigation).getByRole('link', { name: title })).toHaveAttribute(
        'aria-current',
        'page',
      )
    },
  )

  it('문서 내 링크로 다른 문서에 이동한다', async () => {
    db.authenticated = false
    const app = renderApp('/terms')
    const navigation = await screen.findByRole('navigation', { name: '정책 문서' })
    await userEvent.click(within(navigation).getByRole('link', { name: '개인정보처리방침' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: '개인정보처리방침' }),
    ).toBeInTheDocument()
    await app.expectPath('/privacy')
  })

  it.each([
    ['이용약관', '/terms'],
    ['개인정보처리방침', '/privacy'],
  ])('랜딩 하단의 %s 링크를 열 수 있다', async (title, path) => {
    db.authenticated = false
    const app = renderApp('/')
    const footer = await screen.findByRole('contentinfo')
    const link = within(footer).getByRole('link', { name: title })
    expect(link).toHaveAttribute('href', path)
    await userEvent.click(link)

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    await app.expectPath(path)
  })
})

it('회의 올리기 제출 근처에서 외부 전송을 알리고 동의 체크를 요구하지 않는다', async () => {
  completeMeeting('mt_10')
  renderApp('/workspaces/ws_01/meetings/upload')
  const submit = await screen.findByRole('button', { name: '정리 시작하기' })
  const form = submit.closest('form')
  if (form === null) throw new Error('업로드 제출 버튼이 폼 안에 있어야 한다')

  expect(within(form).getByText(NOTICE)).toBeInTheDocument()
  expect(within(form).queryByRole('checkbox', { name: /동의/ })).not.toBeInTheDocument()
})
