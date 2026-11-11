import { useState } from 'react'
import type { SignupStep } from '../model/signupStep'
import { SignupCodeStep } from './SignupCodeStep'
import { SignupEmailStep } from './SignupEmailStep'
import { SignupFootnote } from './SignupFootnote'
import { SignupProfileStep } from './SignupProfileStep'

const resendAtAfter = (seconds: number) => Date.now() + seconds * 1000

/** 이메일 가입: 이메일 → 코드 → 프로필. 단계 상태를 여기서만 옮긴다 */
export function SignupSteps() {
  const [step, setStep] = useState<SignupStep>({ step: 'email' })
  const [notice, setNotice] = useState<string | null>(null)

  let body
  switch (step.step) {
    case 'email':
      body = (
        <SignupEmailStep
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
            setStep({ step: 'profile', email: step.email, verificationToken })
          }
          onChangeEmail={() => setStep({ step: 'email' })}
        />
      )
      break
    case 'profile':
      body = (
        <SignupProfileStep
          profile={{
            kind: 'email',
            email: step.email,
            verificationToken: step.verificationToken,
            onChangeEmail: () => setStep({ step: 'email' }),
            onVerificationLost: (message) => {
              setNotice(message)
              setStep({ step: 'email' })
            },
          }}
        />
      )
      break
  }

  return (
    <>
      {body}
      <SignupFootnote />
    </>
  )
}
