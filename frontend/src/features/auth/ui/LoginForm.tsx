import { useState } from 'react'
import { login } from '@/entities/user'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { useCompactScreen } from '@/shared/lib/compact-screen'
import { useAppForm } from '@/shared/lib/form'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Panel } from '@/shared/ui/panel'
import { PasswordField } from '@/shared/ui/password-field'
import { TextField } from '@/shared/ui/text-field'
import { applyServerError } from '../lib/serverError'
import { loginSchema } from '../model/schemas'
import { useAuthNext } from '../model/useAuthNext'
import { useEnterSession } from '../model/useEnterSession'
import { useLoginNotice } from '../model/useLoginNotice'
import { AlternativeAuth } from './AlternativeAuth'

const FORM = 'flex flex-col gap-16'

/* 휴대폰 로그인(H-1): 칸 사이 12px, 맨 아래 한 줄에 재설정(왼쪽)·가입(오른쪽). 글자 링크는 위아래 12px 로 누를 자리를 넓힌다 */
const PHONE_FORM = 'flex flex-col gap-12'

const PHONE_LINKS = 'flex justify-between pt-4'

const PHONE_FORGOT = 'py-12 text-[14px] text-sub hover:text-ink'

const PHONE_SIGNUP = 'py-12 text-[14px] font-bold text-ink'

const FORGOT = 'text-[13px] text-dim hover:text-sub'

const NOTICE = 'text-body text-ink'

const FOOTNOTE = 'text-center text-[14px] text-dim'

const FOOTNOTE_LINK = 'font-semibold text-ink underline underline-offset-3'

/**
 * 429 뒤의 재설정 안내 (#554). 있는 이메일과 없는 이메일의 응답이 같아 계정이 잠겼다고 말하지 않는다.
 * 재설정은 그 이메일의 막힘만 풀고 IP 막힘은 못 풀어 풀린다고 약속하지 않는다
 */
const RESET_HINT = '비밀번호가 기억나지 않으면 재설정해 주세요.'

interface LoginFailure {
  message: string
  offerReset: boolean
}

function loginFailure(error: unknown, message: string): LoginFailure {
  const offerReset = error instanceof ApiError && error.code === ERROR_CODES.TOO_MANY_LOGIN_ATTEMPTS
  return { message: offerReset ? `${message} ${RESET_HINT}` : message, offerReset }
}

/**
 * 이메일·비밀번호 로그인. 이메일 형식과 비밀번호 빈 값만 검사한다.
 * 잘못된 자격 증명은 어느 칸의 잘못인지 알 수 없어 폼 상단의 비필드 오류다.
 * 회원가입은 여기의 링크로만 간다 — 랜딩에서 바로 가지 않는다 (D-004).
 */
export function LoginForm() {
  const { form, submit } = useAppForm(loginSchema, { email: '', password: '' })
  const {
    register,
    setError,
    formState: { errors, isSubmitting },
  } = form
  const enterSession = useEnterSession()
  // 비밀번호를 바꾸고 온 경우와 카카오에서 돌아온 경우의 안내. 한 번 읽고 기록에서 지운다 — 새로고침·뒤로가기에 다시 뜨지 않는다
  const notice = useLoginNotice()
  const [failure, setFailure] = useState<LoginFailure | null>(
    notice.error === null ? null : { message: notice.error, offerReset: false },
  )
  const next = useAuthNext()
  // 휴대폰 폭은 시안 H-1 배치다. 넓은 화면(Login 캔버스)은 그대로 둔다
  const phone = useCompactScreen()

  const onSubmit = submit(async (values) => {
    setFailure(null)
    try {
      await enterSession({ session: await login(values), acceptance: null })
    } catch (error) {
      const message = applyServerError(error, setError, {})
      setFailure(message === null ? null : loginFailure(error, message))
    }
  })

  return (
    <>
      <form
        noValidate
        className={phone ? PHONE_FORM : FORM}
        onSubmit={(event) => void onSubmit(event)}
      >
        {notice.status === null ? null : (
          <Panel role="status">
            <p className={NOTICE}>{notice.status}</p>
          </Panel>
        )}
        <FormErrorPanel
          message={failure?.message}
          action={
            failure?.offerReset ? (
              <GuardedLink to={paths.forgotPassword()} className={FOOTNOTE_LINK}>
                비밀번호 재설정하기
              </GuardedLink>
            ) : undefined
          }
        />
        <TextField
          tone={phone ? 'auth-phone' : 'auth'}
          type="email"
          label="이메일"
          placeholder={phone ? '이메일' : undefined}
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordField
          tone={phone ? 'auth-phone' : 'auth'}
          label="비밀번호"
          placeholder={phone ? '비밀번호' : undefined}
          autoComplete="current-password"
          showLabel="비밀번호 보기"
          hideLabel="비밀번호 숨기기"
          labelEnd={
            phone ? undefined : (
              <GuardedLink to={paths.forgotPassword()} className={FORGOT}>
                비밀번호를 잊으셨나요?
              </GuardedLink>
            )
          }
          error={errors.password?.message}
          {...register('password')}
        />
        <Button
          type="submit"
          variant="primary"
          size={phone ? 'auth-phone' : 'auth'}
          loading={isSubmitting}
          className={phone ? undefined : 'mt-8'}
        >
          로그인
        </Button>
      </form>
      <AlternativeAuth phone={phone} />
      {phone ? (
        <div className={PHONE_LINKS}>
          <GuardedLink to={paths.forgotPassword()} className={PHONE_FORGOT}>
            비밀번호를 잊으셨나요?
          </GuardedLink>
          <GuardedLink to={paths.signup({ next })} className={PHONE_SIGNUP}>
            가입하기
          </GuardedLink>
        </div>
      ) : (
        <p className={FOOTNOTE}>
          처음이신가요?{' '}
          <GuardedLink to={paths.signup({ next })} className={FOOTNOTE_LINK}>
            회원가입
          </GuardedLink>
        </p>
      )}
    </>
  )
}
