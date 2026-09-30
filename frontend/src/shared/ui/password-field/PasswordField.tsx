import { useState } from 'react'
import { Icon } from '../icon/Icon'
import { TextField } from '../text-field/TextField'
import type { TextFieldProps } from '../text-field/TextField'

export interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'endAdornment'> {
  /** 보기 버튼의 이름. 문구는 호출자가 준다 — 예: `비밀번호 보기` */
  showLabel: string
  /** 숨기기 버튼의 이름 — 예: `비밀번호 숨기기` */
  hideLabel: string
}

/* 34px 원형 버튼 — Login·Signup 실측. 아이콘 선 색은 흐림(#666666) 이다 */
const TOGGLE =
  'inline-flex h-34 w-34 shrink-0 items-center justify-center rounded-999 bg-transparent text-dim'

/**
 * 비밀번호 입력 + 보기 토글. 토글은 `aria-pressed` 로 지금 상태를 알리고 이름도 함께 바뀐다.
 * 토글은 제출 버튼이 아니다(`type="button"`). 값·검증·ref 는 TextField 에 그대로 넘긴다.
 */
export function PasswordField({ showLabel, hideLabel, ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  return (
    <TextField
      {...rest}
      type={visible ? 'text' : 'password'}
      endAdornment={
        <button
          type="button"
          className={TOGGLE}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={17} />
        </button>
      }
    />
  )
}
