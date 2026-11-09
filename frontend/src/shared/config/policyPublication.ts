import type { PolicyKind } from './policy'

export interface PolicySection {
  readonly title: string
  readonly paragraphs: readonly [string, ...string[]]
}

export interface PublishedPolicy {
  readonly version: string
  readonly effectiveOn: string
  readonly sections: readonly [PolicySection, ...PolicySection[]]
}

export type PublishedPolicies = Readonly<Record<PolicyKind, PublishedPolicy>>

export type PolicyPublication =
  | { readonly kind: 'preparing' }
  | { readonly kind: 'published'; readonly documents: PublishedPolicies }

export const currentPolicyPublication: PolicyPublication = { kind: 'preparing' }
