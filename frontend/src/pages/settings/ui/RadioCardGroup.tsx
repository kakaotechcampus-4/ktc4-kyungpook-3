import { useId } from 'react'
import { OPTION_CARD, OPTION_DESCRIPTION, OPTION_TITLE } from './settingsStyles'

export interface RadioCardOption<V extends string> {
  value: V
  title: string
  description: string
  /** 고를 수 없는 선택지. 캔버스가 `지원하지 않습니다` 로 그린 것이다 */
  unsupported?: boolean
}

export interface RadioCardGroupProps<V extends string> {
  labelledBy: string
  describedBy?: string
  options: readonly RadioCardOption<V>[]
  value: V
  onChange: (value: V) => void
  disabled: boolean
}

const OPTION =
  'flex cursor-pointer items-start gap-13 px-18 py-16 has-[:disabled]:cursor-default has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-1 has-[:focus-visible]:outline-ink'
const RADIO =
  'mt-3 inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-999 border leading-none'

/** 설정 절의 라디오 카드. 자동 반영 기준과 PM 알림 방식이 같은 마크업을 쓴다 */
export function RadioCardGroup<V extends string>({
  labelledBy,
  describedBy,
  options,
  value,
  onChange,
  disabled,
}: RadioCardGroupProps<V>) {
  const name = useId()
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="contents"
    >
      {options.map((option) => {
        const checked = value === option.value
        return (
          <label
            key={option.value}
            className={`${OPTION_CARD} ${OPTION} ${checked ? 'border-line-strong' : 'border-line'}`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled || option.unsupported === true}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={`${RADIO} ${option.unsupported ? 'border-line-strong' : 'border-input-border'}`}
            >
              {checked ? <span className="h-8 w-8 rounded-999 bg-ink-solid" /> : null}
            </span>
            <span className="flex-1">
              <span className={`${OPTION_TITLE} ${option.unsupported ? 'text-dim' : 'text-ink'}`}>
                {option.title}
              </span>
              <span className={`${OPTION_DESCRIPTION} ${checked ? 'text-sub' : 'text-dim'}`}>
                {option.description}
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
