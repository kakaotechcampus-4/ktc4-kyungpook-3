import { useSearchParams } from 'react-router'
import { COMMON_MESSAGES, errorMessage } from '@/shared/api/errorMessages'
import { SIGNUP_PARAMS } from '@/shared/config/routes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Panel } from '@/shared/ui/panel'
import { firstSignupStep } from '../model/signupStep'
import { useKakaoLink } from '../model/useKakaoLink'
import { useStartKakao } from '../model/useStartKakao'
import { SignupSteps } from './SignupSteps'

const BODY = 'text-body text-ink'

const LEAD = 'text-[14px] leading-[22px] text-dim'

const CHECKING = 'text-center text-[14px] text-dim'

const noLinkExpiry = () => undefined

/**
 * 가입은 이메일 인증을 마쳐야 끝난다 (#427). 카카오로 온 사람은 주소의 `kakao=1` 로 가른다.
 * Signup 캔버스의 비밀번호 강도 표시와 약관 동의는 이번 범위에서 뺐다 — 규칙 안내 한 줄만 남긴다.
 */
export function SignupForm() {
  const [searchParams] = useSearchParams()
  return searchParams.get(SIGNUP_PARAMS.kakao) === '1' ? (
    <KakaoSignup />
  ) : (
    <SignupSteps
      first={firstSignupStep(null)}
      linkKakao={false}
      defaultName=""
      onLinkExpired={noLinkExpiry}
    />
  )
}

/** 카카오 동의를 마치고 온 가입. 신원은 서버 쿠키에 있고 주소에는 모드만 있어, 위조한 주소는 만료 안내만 받는다 */
function KakaoSignup() {
  const { link, expire } = useKakaoLink()
  const [, setSearchParams] = useSearchParams()
  const startKakao = useStartKakao()

  const skipKakao = () =>
    setSearchParams(
      (params) => {
        params.delete(SIGNUP_PARAMS.kakao)
        return params
      },
      { replace: true },
    )
  const skipButton = (
    <Button variant="text" size="auth" onClick={skipKakao}>
      카카오 없이 가입
    </Button>
  )

  switch (link.status) {
    case 'checking':
      return (
        <p role="status" className={CHECKING}>
          카카오 정보를 확인하고 있어요.
        </p>
      )
    case 'expired':
      return (
        <>
          <FormErrorPanel
            message={errorMessage(link.error)}
            action={
              <Button size="sm" onClick={startKakao}>
                카카오로 다시 시작
              </Button>
            }
          />
          {skipButton}
        </>
      )
    case 'failed':
      return (
        <>
          <FormErrorPanel
            message={errorMessage(link.error)}
            action={
              <Button size="sm" onClick={link.retry}>
                {COMMON_MESSAGES.retry}
              </Button>
            }
          />
          {skipButton}
        </>
      )
    case 'ready':
      return (
        <>
          <Panel>
            <p className={BODY}>가입을 마치면 카카오 계정이 연결돼요.</p>
            <p className={LEAD}>다음부터 이메일과 카카오 모두로 로그인할 수 있어요.</p>
          </Panel>
          <SignupSteps
            first={firstSignupStep(link.pending)}
            linkKakao
            defaultName={link.pending.nickname ?? ''}
            onLinkExpired={expire}
          />
          {skipButton}
        </>
      )
  }
}
