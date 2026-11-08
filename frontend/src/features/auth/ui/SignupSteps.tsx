import { useState } from 'react'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import type { SignupStep } from '../model/signupStep'
import { useAuthNext } from '../model/useAuthNext'
import { SignupCodeStep } from './SignupCodeStep'
import { SignupEmailStep } from './SignupEmailStep'
import { SignupProfileStep } from './SignupProfileStep'

const FOOTNOTE = 'text-center text-[14px] text-dim'

const FOOTNOTE_LINK = 'font-semibold text-ink underline underline-offset-3'

const resendAtAfter = (seconds: number) => Date.now() + seconds * 1000

interface SignupStepsProps {
  first: SignupStep
  linkKakao: boolean
  defaultName: string
  onLinkExpired: (error: unknown) => void
}

/** 이메일 → 코드 → 프로필. 단계 상태를 여기서만 옮긴다 */
export function SignupSteps({ first, linkKakao, defaultName, onLinkExpired }: SignupStepsProps) {
  const [step, setStep] = useState(first)
  const [notice, setNotice] = useState<string | null>(null)
  const next = useAuthNext()

  let body
  switch (step.step) {
    case 'email':
      body = (
        <SignupEmailStep
          linkKakao={linkKakao}
          notice={notice}
          onSent={(email, resendAfter) => {
            setNotice(null)
            setStep({ step: 'code', email, resendAt: resendAtAfter(resendAfter) })
          }}
        />
      )
      break
    case 'code':
      body = (
        <SignupCodeStep
          email={step.email}
          resendAt={step.resendAt}
          onResent={(resendAfter) => setStep({ ...step, resendAt: resendAtAfter(resendAfter) })}
          onConfirmed={(verificationToken) =>
            setStep({
              step: 'profile',
              email: step.email,
              verificationToken,
              emailLocked: false,
            })
          }
          onChangeEmail={() => setStep({ step: 'email' })}
        />
      )
      break
    case 'profile':
      body = (
        <SignupProfileStep
          step={step}
          linkKakao={linkKakao}
          defaultName={defaultName}
          onChangeEmail={() => setStep({ step: 'email' })}
          onVerificationLost={(message) => {
            setNotice(message)
            setStep({ step: 'email' })
          }}
          onLinkExpired={onLinkExpired}
        />
      )
      break
  }

  return (
    <>
      {body}
      <p className={FOOTNOTE}>
        이미 계정이 있으신가요?{' '}
        <GuardedLink to={paths.login(next)} className={FOOTNOTE_LINK}>
          로그인
        </GuardedLink>
      </p>
    </>
  )
}
