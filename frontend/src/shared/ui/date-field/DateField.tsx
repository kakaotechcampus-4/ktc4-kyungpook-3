import { useRef } from 'react'
import { Icon } from '../icon/Icon'
import { TextField } from '../text-field/TextField'
import type { TextFieldProps } from '../text-field/TextField'

export interface DateFieldProps extends Omit<
  TextFieldProps,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'endAdornment'
> {
  /** 'YYYY-MM-DD' 또는 '' (미정) */
  value: string
  onChange: (value: string) => void
  /** 달력 버튼 aria-label. 기본 '달력 열기' */
  calendarLabel?: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/* 아이콘 오른쪽 끝을 Select 의 chevron 자리(테두리 안쪽 13px)에 맞춘다 — 28px 버튼에서 16px 아이콘의 여백 6px 만큼 당긴다 */
const CALENDAR_BUTTON =
  'inline-flex h-28 w-28 shrink-0 -mr-6 items-center justify-center rounded-6 bg-transparent text-dim disabled:text-line-strong'

/**
 * 날짜 입력. 비우면 「미정」이라 `type="date"` 를 쓰지 않고 글로 받는다 — 형식 검증은 호출부가 한다.
 * 달력 버튼은 보이지 않는 `<input type="date">` 의 브라우저 달력을 열고, 고른 날짜를 `onChange` 로 넘긴다.
 * `ref` 는 글 입력으로 간다 (React Hook Form 포커스).
 */
export function DateField({
  value,
  onChange,
  calendarLabel = '달력 열기',
  disabled,
  readOnly,
  ...rest
}: DateFieldProps) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const locked = Boolean(disabled) || Boolean(readOnly)

  const openPicker = () => {
    const picker = pickerRef.current
    if (!picker) return
    try {
      picker.showPicker()
    } catch {
      // showPicker 가 없거나(구형 브라우저·jsdom) 막힌 환경 — 숨은 입력을 직접 누른다
      picker.click()
    }
  }

  return (
    <TextField
      {...rest}
      type="text"
      disabled={disabled}
      readOnly={readOnly}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      endAdornment={
        <span className="relative inline-flex shrink-0">
          <button
            type="button"
            className={CALENDAR_BUTTON}
            aria-label={calendarLabel}
            disabled={locked}
            onClick={openPicker}
          >
            <Icon name="calendar" size={16} />
          </button>
          <input
            ref={pickerRef}
            type="date"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            disabled={locked}
            value={ISO_DATE.test(value) ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
        </span>
      }
    />
  )
}
