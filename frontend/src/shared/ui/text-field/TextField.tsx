import { useId } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Label } from '../label/Label'
import { ErrorText } from '../error-text/ErrorText'

export type FieldTone = 'product' | 'onboarding' | 'auth'

export interface TextFieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'size'> {
  /** 화면군. 기본 'product' */
  tone?: FieldTone
  /** 없으면 라벨을 그리지 않는다 — 그때는 호출부가 `aria-label` 을 직접 넘긴다 */
  label?: string
  /** 'required-blocking' 이면 라벨과 경계가 강조색이 된다 */
  labelTone?: 'normal' | 'required-blocking'
  /** 입력 아래 보조 문구. `aria-describedby` 에 함께 묶인다 */
  description?: string
  /** 있으면 ErrorText 를 그리고 aria-invalid + aria-describedby 를 잇는다 */
  error?: string
  startAdornment?: ReactNode
  /** 비밀번호 보기 버튼, 캘린더 아이콘 등 */
  endAdornment?: ReactNode
}

/* 표는 모듈 스코프. 42px 는 §5-7 이 이미 `h-[42px]` 로 적어 둔 값이고,
   15px 는 타이포 스케일 밖이다 — docs/impl-decision/2026-09-16-values-outside-token-scale.md */

const TONE_SHAPE: Record<FieldTone, string> = {
  product: 'h-[42px] rounded-9 px-13',
  onboarding: 'h-[42px] rounded-8 px-13',
  auth: 'h-48 rounded-12 px-16',
}

const TONE_TEXT: Record<FieldTone, string> = {
  product: 'text-body',
  onboarding: 'text-body',
  auth: 'text-[15px]',
}

/** 제품만 입력 경계(선 중 가장 진한 단)를 쓴다. 온보딩·인증은 강조 테두리이고 반경도 다르다. */
const TONE_BORDER: Record<FieldTone, string> = {
  product: 'border-input-border',
  onboarding: 'border-line-strong',
  auth: 'border-line-strong',
}

/** 라벨과 입력 사이 간격 실측 — 6 / 7 / 8px */
const TONE_LABEL_GAP: Record<FieldTone, string> = {
  product: 'mb-6',
  onboarding: 'mb-7',
  auth: 'mb-8',
}

const INPUT_BASE = 'w-full border bg-surface font-normal text-ink'

const INPUT_DISABLED = 'disabled:border-line disabled:bg-surface-sunken disabled:text-faint'

/* min-w-[0px] 은 오타가 아니다 — tokens.css 가 --spacing 을 비워서 min-w-0 유틸이 없다.
   padding 은 preflight 의 `*{padding:0}` 이 이미 지운다 (p-0 도 같은 이유로 없다).
   docs/impl-decision/2026-09-16-values-outside-token-scale.md
   포커스는 래퍼가 그리므로 안쪽 input 은 끈다 — 래퍼 테두리 안쪽에 선이 하나 더 생긴다. */
const BARE_INPUT =
  'h-full w-full min-w-[0px] border-0 bg-transparent font-normal text-ink focus-visible:outline-none'

/* 래퍼는 input 포커스에만 그린다. 장식 안의 버튼은 자기 전역 선을 그린다 — 둘 다 그리면 두 겹이다.
   docs/impl-decision/2026-09-23-focus-outline-over-border.md */
const ADORNED_BOX =
  'flex w-full items-center gap-8 border bg-surface has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ink has-[input:focus-visible]:-outline-offset-1'

/**
 * 네이티브 `<input>`. Radix 를 쓰지 않는다 (§7-0).
 *
 * `id` 는 `useId()` 로 만들고 props 의 `id` 가 있으면 그걸 쓴다.
 * `label htmlFor` · `aria-describedby` · `aria-invalid` 를 내부에서 잇는다.
 *
 * 문구는 전부 props 다 — 라벨·플레이스홀더를 컴포넌트에 넣지 않는다.
 *
 * 강조색(`labelTone="required-blocking"`, `error`)은 **비우면 승인이 막히는 입력**에만 쓴다.
 * 일반 검증 실패에 쓰지 않는다.
 */
export function TextField({
  tone = 'product',
  label,
  labelTone = 'normal',
  description,
  error,
  startAdornment,
  endAdornment,
  id,
  className,
  ...rest
}: TextFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = `${fieldId}-description`
  const errorId = `${fieldId}-error`

  const blocking = labelTone === 'required-blocking'

  // 경계색·플레이스홀더색은 한 곳에서만 고른다 — 두 클래스를 같이 붙이면 CSS 순서가 이긴다
  const borderColor = error || blocking ? 'border-accent' : TONE_BORDER[tone]
  const placeholderColor =
    error || blocking ? 'placeholder:text-accent-soft' : 'placeholder:text-faint'

  const describedBy =
    [description ? descriptionId : undefined, error ? errorId : undefined]
      .filter(Boolean)
      .join(' ') || undefined

  const hasAdornment = Boolean(startAdornment) || Boolean(endAdornment)

  const inputProps = {
    id: fieldId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    ...rest,
  }

  return (
    <div className={['flex flex-col', className].filter(Boolean).join(' ')}>
      {label ? (
        <Label htmlFor={fieldId} tone={tone} blocking={blocking} className={TONE_LABEL_GAP[tone]}>
          {label}
        </Label>
      ) : null}

      {hasAdornment ? (
        <div className={[ADORNED_BOX, TONE_SHAPE[tone], TONE_TEXT[tone], borderColor].join(' ')}>
          {startAdornment}
          <input className={[BARE_INPUT, placeholderColor].join(' ')} {...inputProps} />
          {endAdornment}
        </div>
      ) : (
        <input
          className={[
            INPUT_BASE,
            INPUT_DISABLED,
            TONE_SHAPE[tone],
            TONE_TEXT[tone],
            borderColor,
            placeholderColor,
          ].join(' ')}
          {...inputProps}
        />
      )}

      {description ? (
        <p id={descriptionId} className="mt-6 text-[12px] font-normal text-dim">
          {description}
        </p>
      ) : null}

      {error ? (
        <ErrorText id={errorId} className="mt-6">
          {error}
        </ErrorText>
      ) : null}
    </div>
  )
}
