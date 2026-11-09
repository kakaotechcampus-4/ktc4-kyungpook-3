import { http, HttpResponse } from 'msw'
import { z } from 'zod'
import { db } from '../db'
import { requireAuth } from '../auth-guard'
import { fail, ok } from '../envelope'

function guard(request: Request) {
  const unauthorized = requireAuth()
  if (unauthorized) return unauthorized
  const expected = request.headers.get('X-Consent-Account-ID')
  if (expected !== null && expected !== db.session.user.user_id)
    return fail('CONSENT_ACCOUNT_CHANGED', '로그인한 계정이 바뀌었습니다.', 409)
}

function status() {
  const documents = (['terms', 'privacy'] as const).map((kind) => {
    const agreement = db.consents
      .filter((row) => row.user_id === db.session.user.user_id && row.kind === kind)
      .at(-1)
    return {
      kind,
      current_version: db.consentVersions[kind],
      agreed_version: agreement?.version ?? null,
      agreed_at: agreement?.agreed_at ?? null,
    }
  })
  return {
    required: (['terms', 'privacy'] as const).some(
      (kind) =>
        !db.consents.some(
          (row) =>
            row.user_id === db.session.user.user_id &&
            row.kind === kind &&
            row.version === db.consentVersions[kind],
        ),
    ),
    documents,
  }
}

const acceptance = z
  .object({ terms_version: z.string().min(1).max(32), privacy_version: z.string().min(1).max(32) })
  .strict()

export const consentHandlers = [
  http.get('/api/v1/consents/me', ({ request }) => {
    const error = guard(request)
    if (error) return error
    if (db.consentFailure === 'read')
      return fail('INTERNAL_ERROR', '동의 기록을 읽지 못했습니다.', 500)
    return ok(status())
  }),
  http.post('/api/v1/consents', async ({ request }) => {
    const error = guard(request)
    if (error) return error
    const body = acceptance.safeParse(await request.json().catch(() => null))
    if (!body.success) return fail('VALIDATION_ERROR', '요청을 확인해 주세요.', 422)
    if (
      body.data.terms_version !== db.consentVersions.terms ||
      body.data.privacy_version !== db.consentVersions.privacy
    )
      return fail('CONSENT_VERSION_MISMATCH', '약관 판본이 변경되었습니다.', 400)
    if (db.consentFailure === 'write')
      return fail('INTERNAL_ERROR', '동의 기록을 저장하지 못했습니다.', 500)
    for (const kind of ['terms', 'privacy'] as const) {
      if (
        !db.consents.some(
          (row) =>
            row.user_id === db.session.user.user_id &&
            row.kind === kind &&
            row.version === db.consentVersions[kind],
        )
      )
        db.consents.push({
          user_id: db.session.user.user_id,
          kind,
          version: db.consentVersions[kind],
          agreed_at: new Date().toISOString(),
        })
    }
    if (db.consentFailure === 'response-lost') {
      db.consentFailure = 'none'
      return HttpResponse.error()
    }
    return ok(status())
  }),
]
