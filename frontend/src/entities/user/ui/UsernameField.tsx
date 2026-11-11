import { useId } from 'react'
import { errorMessage } from '@/shared/api/errorMessages'
import { Label } from '@/shared/ui/label'
import { TextField } from '@/shared/ui/text-field'
import type { TextFieldProps } from '@/shared/ui/text-field'
import { USERNAME_HINT, USERNAME_MESSAGES } from '../model/username'
import type { UsernameCheck } from '../model/username'
import type { UsernameCheckControl } from '../model/useUsernameCheck'

const STATUS = 'mt-6 text-[12px] text-dim'
const LABEL_GAP = {
  product: 'mb-6',
  onboarding: 'mb-7',
  auth: 'mb-8',
  'auth-phone': 'sr-only',
}
const BUTTON_HEIGHT = {
  product: 'h-[42px]',
  onboarding: 'h-[42px]',
  auth: 'h-48',
  'auth-phone': 'h-[52px]',
}

function problemOf(check: UsernameCheck): string | undefined {
  switch (check.status) {
    case 'unavailable':
      return USERNAME_MESSAGES[check.reason]
    case 'failed':
      return errorMessage(check.error)
    default:
      return undefined
  }
}

export interface UsernameFieldProps extends Omit<
  TextFieldProps,
  'label' | 'description' | 'error' | 'endAdornment'
> {
  control: UsernameCheckControl
}

/**
 * 아이디 칸과 `중복 확인` 버튼. 쓸 수 있으면 조용한 상태 문구, 쓸 수 없거나 확인하지 못하면 칸 오류다.
 * 가입과 설정의 아이디 변경이 함께 쓴다. 값은 호출부의 폼이 쥔다
 */
export function UsernameField({
  control,
  disabled,
  id,
  tone = 'product',
  size,
  className,
  ...input
}: UsernameFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const { check, run } = control
  const checking = check.status === 'checking'
  const status = checking
    ? USERNAME_MESSAGES.checking
    : check.status === 'available'
      ? USERNAME_MESSAGES.available
      : null
  return (
    <div className={['flex flex-col', className].filter(Boolean).join(' ')}>
      <Label
        htmlFor={fieldId}
        tone={tone === 'auth-phone' ? 'auth' : tone}
        className={LABEL_GAP[tone]}
      >
        아이디
      </Label>
      <div className="flex items-start gap-8">
        <TextField
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          {...input}
          id={fieldId}
          tone={tone}
          size={size}
          className="min-w-0 flex-1"
          description={USERNAME_HINT}
          error={problemOf(check)}
          disabled={disabled}
        />
        <button
          type="button"
          className={[
            'inline-flex shrink-0 items-center justify-center rounded-9 border border-transparent bg-control px-16 text-body leading-none font-semibold whitespace-nowrap text-ink hover:bg-line-strong active:bg-inactive disabled:bg-surface-selected disabled:text-faint',
            size === 'lg' ? 'h-44' : BUTTON_HEIGHT[tone],
          ].join(' ')}
          disabled={disabled || checking || check.status === 'available'}
          onClick={run}
        >
          중복 확인
        </button>
      </div>
      <p role="status" className={status === null ? 'sr-only' : STATUS}>
        {status}
      </p>
    </div>
  )
}
