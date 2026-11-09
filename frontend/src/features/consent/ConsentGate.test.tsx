import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConsentGate } from './ui/ConsentGate'
import { db } from '@/shared/mock/db'
import { currentPolicyPublication } from '../../../e2e/fixtures/published-policy'
import { endSessionScope } from '@/shared/api/sessionScope'
import { http } from 'msw'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { ok } from '@/shared/mock/envelope'

function open() {
  if (currentPolicyPublication.kind !== 'published')
    throw new Error('synthetic fixture must be published')
  db.consentVersions = { terms: 'test-terms-v1', privacy: 'test-privacy-v1' }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const logout = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <ConsentGate
        userId="us_01"
        documents={currentPolicyPublication.documents}
        onLogout={logout}
        logoutPending={false}
        logoutError={null}
      >
        <h2>업무 화면</h2>
      </ConsentGate>
    </QueryClientProvider>,
  )
  return { queryClient, logout }
}
it('required와 실제 기록이 모순인 응답은 업무 화면을 열지 않는다', async () => {
  server.use(
    http.get('/api/v1/consents/me', () =>
      ok({
        required: false,
        documents: [
          {
            kind: 'terms',
            current_version: 'test-terms-v1',
            agreed_version: null,
            agreed_at: null,
          },
          {
            kind: 'privacy',
            current_version: 'test-privacy-v1',
            agreed_version: null,
            agreed_at: null,
          },
        ],
      }),
    ),
  )
  open()
  expect(await screen.findByRole('alert')).toHaveTextContent('확인하지 못했어요')
  expect(screen.queryByRole('heading', { name: '업무 화면' })).not.toBeInTheDocument()
})
async function accept() {
  await userEvent.click(await screen.findByRole('checkbox', { name: '[필수] 이용약관 동의' }))
  await userEvent.click(screen.getByRole('checkbox', { name: '[필수] 개인정보처리방침 동의' }))
  await userEvent.click(screen.getByRole('button', { name: '동의하고 계속하기' }))
}
it('둘 다 동의해야 업무 화면이 열리고 새로 렌더해도 저장 결과를 쓴다', async () => {
  open()
  expect(await screen.findByRole('button', { name: '동의하고 계속하기' })).toBeDisabled()
  expect(screen.queryByRole('heading', { name: '업무 화면' })).not.toBeInTheDocument()
  await accept()
  expect(await screen.findByRole('heading', { name: '업무 화면' })).toBeInTheDocument()
  expect(db.consents).toHaveLength(2)
})
it('저장 오류는 체크를 비우고 다시 동의를 요구한다', async () => {
  db.consentFailure = 'write'
  open()
  await accept()
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '[필수] 이용약관 동의' })).not.toBeChecked()
  expect(db.consents).toEqual([])
})
it('응답만 유실된 경우 재조회로 완료를 복구한다', async () => {
  db.consentFailure = 'response-lost'
  open()
  await accept()
  expect(await screen.findByRole('heading', { name: '업무 화면' })).toBeInTheDocument()
  expect(db.consents).toHaveLength(2)
})
it('열어 둔 폼과 실제 계정이 달라지면 새 계정에 기록하지 않는다', async () => {
  open()
  await screen.findByRole('checkbox', { name: '[필수] 이용약관 동의' })
  db.session.user.user_id = 'us_other'
  await accept()
  expect(await screen.findByRole('alert')).toHaveTextContent('계정이 바뀌었어요')
  expect(db.consents).toEqual([])
  expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument()
})
it('판본이 바뀐 POST는 체크를 버리고 새 판본을 자동 수락하지 않는다', async () => {
  open()
  await screen.findByRole('checkbox', { name: '[필수] 이용약관 동의' })
  db.consentVersions.terms = 'server-new-terms'
  await accept()
  expect(await screen.findByRole('alert')).toHaveTextContent('판본이 달라요')
  expect(db.consents).toEqual([])
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
it('로그아웃 뒤 늦은 동의 응답은 이전 캐시와 화면을 성공으로 바꾸지 않는다', async () => {
  const response = deferred()
  let finished = false
  server.use(
    http.post('/api/v1/consents', async () => {
      await response.promise
      finished = true
      return ok({
        required: false,
        documents: [
          {
            kind: 'terms',
            current_version: 'test-terms-v1',
            agreed_version: 'test-terms-v1',
            agreed_at: '2000-01-01T00:00:00Z',
          },
          {
            kind: 'privacy',
            current_version: 'test-privacy-v1',
            agreed_version: 'test-privacy-v1',
            agreed_at: '2000-01-01T00:00:00Z',
          },
        ],
      })
    }),
  )
  const { queryClient } = open()
  await accept()
  endSessionScope()
  response.resolve()
  await waitFor(() => expect(finished).toBe(true))
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: '업무 화면' })).not.toBeInTheDocument(),
  )
  expect(
    queryClient.getQueryData(['consents', 'us_01', 'test-terms-v1', 'test-privacy-v1']),
  ).toMatchObject({ required: true })
})
