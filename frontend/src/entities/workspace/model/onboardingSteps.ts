import { parseEnumParam } from '@/shared/lib/url'
import type { OnboardingStep } from './types'

/** 서버 순서 그대로다. mapper 와 URL 의 `:step` 이 같은 목록을 쓴다 */
export const ONBOARDING_STEPS = [
  'create_workspace',
  'connect_discord',
  'connect_notion',
  'connect_members',
] as const satisfies readonly OnboardingStep[]

/** 아는 단계면 그 값, 아니면 null */
export function readOnboardingStep(value: string | undefined): OnboardingStep | null {
  return parseEnumParam(value, ONBOARDING_STEPS)
}
