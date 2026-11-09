import { paths } from './routes'

export const policyDocuments = {
  terms: { title: '이용약관', to: paths.terms() },
  privacy: { title: '개인정보처리방침', to: paths.privacy() },
} satisfies Record<'terms' | 'privacy', Readonly<{ title: string; to: string }>>

export type PolicyKind = keyof typeof policyDocuments
