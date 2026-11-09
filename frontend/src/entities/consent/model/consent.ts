import type { PublishedPolicies } from '@/shared/config/policyPublication'
import type { ConsentStatusDto } from '@/shared/types/api/consent'

export interface PolicyVersions {
  readonly termsVersion: string
  readonly privacyVersion: string
}

export function policyVersions(documents: PublishedPolicies): PolicyVersions {
  return { termsVersion: documents.terms.version, privacyVersion: documents.privacy.version }
}

export function toConsentStatus(data: ConsentStatusDto) {
  const [first, second] = data.documents
  const toDocument = (value: typeof first) => ({
    currentVersion: value.current_version,
    agreedVersion: value.agreed_version,
    agreedAt: value.agreed_at,
  })
  return {
    required: data.required,
    terms: toDocument(first.kind === 'terms' ? first : second),
    privacy: toDocument(first.kind === 'privacy' ? first : second),
  }
}

export type ConsentStatus = ReturnType<typeof toConsentStatus>

export function matchesPublication(status: ConsentStatus, versions: PolicyVersions): boolean {
  return (
    status.terms.currentVersion === versions.termsVersion &&
    status.privacy.currentVersion === versions.privacyVersion
  )
}
