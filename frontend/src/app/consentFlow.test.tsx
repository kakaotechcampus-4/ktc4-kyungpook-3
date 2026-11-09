import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/shared/mock/db'
import { renderApp } from './test/renderApp'
import { enterMailedCode } from './test/walkSignup'

vi.mock(
  '@/shared/config/policyPublication',
  async () => import('../../e2e/fixtures/published-policy'),
)

async function checks() {
  await userEvent.click(await screen.findByRole('checkbox', { name: '[필수] 이용약관 동의' }))
  await userEvent.click(screen.getByRole('checkbox', { name: '[필수] 개인정보처리방침 동의' }))
}
async function signup() {
  await userEvent.type(await screen.findByLabelText('이메일'), 'consent-new@example.com')
  await userEvent.click(screen.getByRole('button', { name: '인증 코드 받기' }))
  await enterMailedCode()
  await userEvent.type(await screen.findByLabelText('이름'), '새 사용자')
  await userEvent.type(screen.getByLabelText('비밀번호'), 'pass1234')
  expect(screen.getByRole('button', { name: '계정 만들기' })).toBeDisabled()
  await checks()
  await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
}

beforeEach(() => {
  db.authenticated = false
  db.consents = []
  db.consentVersions = { terms: 'test-terms-v1', privacy: 'test-privacy-v1' }
})

it('가입 계정이 생성된 뒤 동의 저장이 실패해도 재가입하지 않고 guard에서 이어간다', async () => {
  db.consentFailure = 'write'
  const app = renderApp('/signup?next=%2Fonboarding%2Fstart')
  await signup()
  expect(await screen.findByRole('heading', { name: '서비스 이용 동의' })).toBeInTheDocument()
  expect(
    db.accounts.filter((account) => account.session.user.email === 'consent-new@example.com'),
  ).toHaveLength(1)
  expect(db.consents).toEqual([])
  expect(screen.queryByRole('button', { name: '계정 만들기' })).not.toBeInTheDocument()
  db.consentFailure = 'none'
  await checks()
  await userEvent.click(screen.getByRole('button', { name: '동의하고 계속하기' }))
  await app.expectPath('/onboarding/start')
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: '서비스 이용 동의' })).not.toBeInTheDocument(),
  )
  expect(db.consents).toHaveLength(2)
  expect(db.consents.every((row) => row.user_id === db.session.user.user_id)).toBe(true)
})

it('가입 뒤 동의 응답만 유실되면 guard GET으로 복구하고 새 계정 하나만 남긴다', async () => {
  db.consentFailure = 'response-lost'
  const app = renderApp('/signup')
  await signup()
  await app.expectPath('/onboarding/start')
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: '서비스 이용 동의' })).not.toBeInTheDocument(),
  )
  expect(
    db.accounts.filter((account) => account.session.user.email === 'consent-new@example.com'),
  ).toHaveLength(1)
  expect(db.consents).toHaveLength(2)
})

it('공개 정책과 계정 탈퇴 경로는 미동의 상태에서도 동의 폼을 거치지 않는다', async () => {
  db.authenticated = true
  const app = renderApp('/terms')
  expect(await screen.findByText('테스트 이용약관')).toBeInTheDocument()
  app.navigate('/account/withdrawal')
  expect(await screen.findByRole('heading', { name: '계정 탈퇴' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '서비스 이용 동의' })).not.toBeInTheDocument()
})
