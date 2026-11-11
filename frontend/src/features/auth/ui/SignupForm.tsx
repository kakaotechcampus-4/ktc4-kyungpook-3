import { useSearchParams } from 'react-router'
import { COMMON_MESSAGES, errorMessage } from '@/shared/api/errorMessages'
import { SIGNUP_PARAMS } from '@/shared/config/routes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Panel } from '@/shared/ui/panel'
import { useKakaoLink } from '../model/useKakaoLink'
import { useStartKakao } from '../model/useStartKakao'
import { SignupFootnote } from './SignupFootnote'
import { SignupProfileStep } from './SignupProfileStep'
import { SignupSteps } from './SignupSteps'

const BODY = 'text-body text-ink'

const LEAD = 'text-[14px] leading-[22px] text-dim'

const CHECKING = 'text-center text-[14px] text-dim'

/**
 * 이메일 가입은 이메일 인증을 마쳐야 끝난다 (#427). 카카오로 온 사람은 주소의 `kakao=1` 로 가르고,
 * 이메일·코드 단계 없이 아이디와 이름만 받는다 (#627). Signup 캔버스의 비밀번호 강도 표시는 이번 범위에서 뺐다.
 */
export function SignupForm() {
  const [searchParams] = useSearchParams()
  return searchParams.get(SIGNUP_PARAMS.kakao) === '1' ? <KakaoSignup /> : <SignupSteps />
}

/**
 * 카카오 동의를 마치고 온 가입. 신원은 서버 쿠키에 있고 주소에는 모드만 있어, 위조한 주소는 만료 안내만 받는다.
 * 이 계정은 이메일·비밀번호 없이 카카오로만 로그인한다. 카카오 이메일이 기존 계정과 같아도 잇지 않는다 (#627)
 */
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
            <p className={BODY}>카카오 계정으로 가입해요.</p>
            <p className={LEAD}>
              이 계정은 카카오로만 로그인해요. 이메일과 비밀번호는 만들지 않아요.
            </p>
          </Panel>
          <SignupProfileStep
            profile={{ kind: 'kakao', nickname: link.pending.nickname, onLinkExpired: expire }}
          />
          <SignupFootnote />
          {skipButton}
        </>
      )
  }
}
