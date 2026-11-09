import { agreeConsents, fetchConsents, consentKey } from './api/consents'
import { consentStatusSchema } from '@/shared/types/api/consent'
import { db } from '@/shared/mock/db'
import { saveDb, loadSavedDb } from '@/shared/mock/persistence'
import { request } from '@/shared/api/client'
import { onUnauthorized } from '@/shared/api/client'
import { endSessionScope } from '@/shared/api/sessionScope'
import { server } from '@/shared/mock/server'
import { fail } from '@/shared/mock/envelope'
import { deferred } from '@/shared/test/deferred'
import { http } from 'msw'
import { waitFor } from '@testing-library/react'

const scope = { userId: 'us_01', termsVersion: '2026-11-10', privacyVersion: '2026-11-10' }

beforeEach(() => {
  db.consents = []
})
describe('동의 계약과 계정 경계', () => {
  it.each([
    { required: false, agreedVersion: null, agreedAt: null },
    { required: false, agreedVersion: 'old', agreedAt: '2000-01-01T00:00:00Z' },
    { required: true, agreedVersion: 'v1', agreedAt: '2000-01-01T00:00:00Z' },
  ])(
    '동의 기록과 required가 모순인 응답을 거절한다 (%#)',
    ({ required, agreedVersion, agreedAt }) => {
      const documents = ['terms', 'privacy'].map((kind) => ({
        kind,
        current_version: 'v1',
        agreed_version: agreedVersion,
        agreed_at: agreedAt,
      }))
      expect(consentStatusSchema.safeParse({ required, documents }).success).toBe(false)
    },
  )
  it('이전 세션의 늦은 동의 GET 401은 새 세션 만료를 알리지 않는다', async () => {
    const response = deferred()
    let started = false
    const unauthorized = vi.fn()
    const off = onUnauthorized(unauthorized)
    server.use(
      http.get('/api/v1/consents/me', async () => {
        started = true
        await response.promise
        return fail('UNAUTHENTICATED', '끝난 세션', 401)
      }),
    )
    try {
      const result = fetchConsents(scope.userId)
      const rejected = expect(result).rejects.toMatchObject({ status: 401 })
      await waitFor(() => expect(started).toBe(true))
      endSessionScope()
      response.resolve()
      await rejected
      expect(unauthorized).not.toHaveBeenCalled()
    } finally {
      off()
    }
  })
  it('현재 두 문서와 동의 시각을 엄격하게 해석한다', async () => {
    const initial = await fetchConsents(scope.userId)
    expect(initial.required).toBe(true)
    const accepted = await agreeConsents(scope)
    expect(accepted.required).toBe(false)
    expect(accepted.terms.agreedVersion).toBe(scope.termsVersion)
    expect(accepted.privacy.agreedAt).toEqual(expect.any(String))
    const first = structuredClone(db.consents)
    await agreeConsents(scope)
    expect(db.consents).toEqual(first)
  })
  it('다른 쿠키 계정은 GET·POST 모두 거절하고 기록을 남기지 않는다', async () => {
    db.session.user.user_id = 'us_other'
    await expect(fetchConsents(scope.userId)).rejects.toMatchObject({
      code: 'CONSENT_ACCOUNT_CHANGED',
      status: 409,
    })
    await expect(agreeConsents(scope)).rejects.toMatchObject({
      code: 'CONSENT_ACCOUNT_CHANGED',
      status: 409,
    })
    expect(db.consents).toEqual([])
  })
  it('이전 API 호출자는 기대 계정 헤더 없이도 호환된다', async () => {
    await expect(request('/consents/me')).resolves.toMatchObject({ required: true })
  })
  it('판본 불일치는 두 문서 모두 무저장이다', async () => {
    await expect(agreeConsents({ ...scope, privacyVersion: 'old' })).rejects.toMatchObject({
      code: 'CONSENT_VERSION_MISMATCH',
      status: 400,
    })
    expect(db.consents).toEqual([])
  })
  it('기록과 판본을 새로고침 저장본에서 복원한다', async () => {
    await agreeConsents(scope)
    saveDb(sessionStorage)
    expect(loadSavedDb(sessionStorage)?.consents).toEqual(db.consents)
    expect(loadSavedDb(sessionStorage)?.consentVersions).toEqual(db.consentVersions)
  })
  it('탈퇴하면 본인 동의만 지우고 다른 계정의 기록은 유지한다', async () => {
    await agreeConsents(scope)
    db.consents.push({
      user_id: 'other',
      kind: 'terms',
      version: 'v1',
      agreed_at: '2000-01-01T00:00:00Z',
    })
    db.workspaces = []
    await request('/auth/me', {
      method: 'DELETE',
      headers: { 'X-Withdrawal-Key': 'c'.repeat(64), 'X-Withdrawal-Account-ID': scope.userId },
    })
    expect(db.consents).toEqual([
      { user_id: 'other', kind: 'terms', version: 'v1', agreed_at: '2000-01-01T00:00:00Z' },
    ])
  })
  it('계정과 두 판본 중 하나가 달라져도 캐시를 공유하지 않는다', () => {
    const original = consentKey(scope)
    expect(consentKey({ ...scope, userId: 'other' })).not.toEqual(original)
    expect(consentKey({ ...scope, termsVersion: 'next' })).not.toEqual(original)
    expect(consentKey({ ...scope, privacyVersion: 'next' })).not.toEqual(original)
  })
  it.each(
    [
      [],
      [{ kind: 'terms', current_version: 'v1', agreed_version: null, agreed_at: null }],
      Array.from({ length: 2 }, () => ({
        kind: 'terms',
        current_version: 'v1',
        agreed_version: null,
        agreed_at: null,
      })),
      [
        { kind: 'terms', current_version: 'v1', agreed_version: 'v1', agreed_at: null },
        { kind: 'privacy', current_version: 'v1', agreed_version: null, agreed_at: null },
      ],
    ].map((documents) => ({ documents })),
  )('불완전한 문서 응답을 거절한다 (%#)', ({ documents }) => {
    expect(consentStatusSchema.safeParse({ required: false, documents }).success).toBe(false)
  })
})
