import { errorMessage } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { TextField } from '@/shared/ui/text-field'
import type { TextFieldProps } from '@/shared/ui/text-field'
import { USERNAME_HINT, USERNAME_MESSAGES } from '../model/username'
import type { UsernameCheck } from '../model/username'
import type { UsernameCheckControl } from '../model/useUsernameCheck'

const STATUS = 'mt-6 text-[12px] text-dim'

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
export function UsernameField({ control, disabled, ...input }: UsernameFieldProps) {
  const { check, run } = control
  const checking = check.status === 'checking'
  const status = checking
    ? USERNAME_MESSAGES.checking
    : check.status === 'available'
      ? USERNAME_MESSAGES.available
      : null
  return (
    <div className="flex flex-col">
      <TextField
        label="아이디"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        description={USERNAME_HINT}
        error={problemOf(check)}
        disabled={disabled}
        endAdornment={
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={disabled || checking || check.status === 'available'}
            onClick={run}
          >
            중복 확인
          </Button>
        }
        {...input}
      />
      <p role="status" className={status === null ? 'sr-only' : STATUS}>
        {status}
      </p>
    </div>
  )
}
