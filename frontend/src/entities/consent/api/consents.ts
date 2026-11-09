import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { consentStatusSchema } from '@/shared/types/api/consent'
import { toConsentStatus } from '../model/consent'
import type { PolicyVersions } from '../model/consent'

interface ConsentScope extends PolicyVersions {
  readonly userId: string
}

export const consentKey = ({ userId, termsVersion, privacyVersion }: ConsentScope) =>
  ['consents', userId, termsVersion, privacyVersion] as const

export async function fetchConsents(userId: string, signal?: AbortSignal) {
  return toConsentStatus(
    parseResponse(
      consentStatusSchema,
      await request<unknown>('/consents/me', {
        headers: { 'X-Consent-Account-ID': userId },
        signal,
      }),
      'consent',
    ),
  )
}

export async function agreeConsents(scope: ConsentScope, signal?: AbortSignal) {
  return toConsentStatus(
    parseResponse(
      consentStatusSchema,
      await request<unknown>('/consents', {
        method: 'POST',
        headers: { 'X-Consent-Account-ID': scope.userId },
        body: { terms_version: scope.termsVersion, privacy_version: scope.privacyVersion },
        signal,
      }),
      'consent',
    ),
  )
}

export function consentQueryOptions(scope: ConsentScope) {
  return queryOptions({
    queryKey: consentKey(scope),
    queryFn: ({ signal }) => fetchConsents(scope.userId, signal),
    staleTime: 0,
  })
}
