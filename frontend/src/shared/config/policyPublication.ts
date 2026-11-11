import type { PolicyKind } from './policy'
import { publishedPolicies } from './publishedPolicies'

export interface PolicySection {
  readonly title: string
  readonly paragraphs: readonly [string, ...string[]]
}

export interface PublishedPolicy {
  readonly version: string
  readonly effectiveOn: string
  readonly sections: readonly [PolicySection, ...PolicySection[]]
  readonly references: readonly { readonly label: string; readonly href: string }[]
}

export type PublishedPolicies = Readonly<Record<PolicyKind, PublishedPolicy>>

export type PolicyPublication =
  | { readonly kind: 'preparing' }
  | { readonly kind: 'published'; readonly documents: PublishedPolicies }

export const currentPolicyPublication: PolicyPublication = {
  kind: 'published',
  documents: publishedPolicies,
}
