import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import type { MessageReview, MessageReviewAction, MessageSendTiming } from '@/entities/message'
import { todayInSeoul } from '@/shared/lib/date'
import { Button } from '@/shared/ui/button'
import { fromSeoulInputValue, initialCustomTime, nowLabel, shortDateTime } from '../lib/format'
import { LockedButton } from './LockedButton'

/* Messages 캔버스 실측 — 라벨 12.5 보조, 카드 3열 간격 9, 카드(위아래 13 · 좌우 15 · 라운드 16 · 선), 고른 카드는 먹 면 흰 글자.
   라디오는 숨기고 카드 전체가 라벨이다. 포커스 선은 카드에 긋는다 — 디자인 시스템대로 테두리 위(offset -1),
   고른 먹 면 카드는 면 안쪽 흰 선(offset -3)이다. 캔버스의 offset 4px 는 옮기지 않는다 (design-system §3-3) */
const CARD =
  'flex cursor-pointer flex-col items-start gap-2 rounded-16 border border-line bg-surface px-15 py-13 text-left has-[input:checked]:border-ink has-[input:checked]:bg-ink has-[input:disabled]:cursor-not-allowed has-[input[aria-disabled=true]]:cursor-not-allowed has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-1 has-[input:focus-visible]:outline-ink has-[input:checked]:has-[input:focus-visible]:-outline-offset-3 has-[input:checked]:has-[input:focus-visible]:outline-surface'
const CARD_TITLE = 'text-body font-semibold text-sub group-has-[input:checked]:text-surface'
const CARD_DETAIL = 'mono text-meta text-dim group-has-[input:checked]:text-surface'
/* 고를 수 없는 카드(마감이 없는 항목의 `마감 하루 전`)는 눌린 면에 흐린 글자다 — 고를 수 있는 카드와 구분한다 */
const UNAVAILABLE = 'bg-surface-sunken [&>span]:text-faint'
const CUSTOM_INPUT =
  'h-36 rounded-9 border border-input-border bg-surface px-10 text-body text-ink focus-visible:-outline-offset-1'

/** 카드 사이 화살표 이동의 방향. 화살표는 포커스만 옮기고 고르지 않는다 — 고르면 바로 서버에 저장되기 때문이다 */
const ARROW_STEP: Readonly<Partial<Record<string, 1 | -1>>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

export interface SendTimingPickerProps {
  review: MessageReview
  /** 다른 행동이 진행 중이거나 문구를 고치는 중이라 고를 수 없다. 포커스는 남긴다(`aria-disabled`) */
  locked: boolean
  /** 발송 시점을 저장하는 중이다 */
  saving: boolean
  /** 직접 정하는 시각 칸이 열려 있다 — 화면에 골라진 시점이 아직 서버 값이 아니다 */
  customOpen: boolean
  onCustomOpenChange: (open: boolean) => void
  /** 서버에 새 발송 시점을 요청한다. 성공하면 `onSaved` 를 부른다 */
  onChange: (
    action: Extract<MessageReviewAction, { kind: 'schedule' }>,
    onSaved: () => void,
  ) => void
  /** 변경 실패 알림 자리 */
  failure: ReactNode
}

/**
 * 언제 보낼까요? — 마감 하루 전 · 지금 바로 · 직접 정하기 (Messages 시안). 고른 카드는 서버가 저장한 값이다 —
 * 누르면 요청하고 성공한 뒤에 카드가 바뀐다 (D-137). `직접 정하기` 는 시각을 고르는 칸을 열 뿐이고, 시각을 정해야 요청한다.
 * 저장한 시각도 그 카드를 다시 눌러 고친다. 마감이 없는 항목은 `마감 하루 전` 을 고를 수 없다.
 * 화살표 키는 카드 사이로 포커스만 옮긴다 — 고르기(Space·누름)와 나눠 지나가는 카드가 저장되지 않게 한다
 */
export function SendTimingPicker({
  review,
  locked,
  saving,
  customOpen,
  onCustomOpenChange,
  onChange,
  failure,
}: SendTimingPickerProps) {
  const name = useId()
  const cardsRef = useRef<HTMLDivElement>(null)
  const customRadioRef = useRef<HTMLInputElement>(null)
  const selected: MessageSendTiming = customOpen ? 'custom' : review.sendTiming

  const choose = (timing: MessageSendTiming) => {
    if (locked) return
    if (timing === 'custom') onCustomOpenChange(true)
    else {
      onCustomOpenChange(false)
      if (timing !== review.sendTiming) onChange({ kind: 'schedule', timing }, () => undefined)
    }
  }

  // 시각 칸이 닫히면 그 칸의 버튼이 사라진다 — 포커스를 연 자리(직접 정하기 카드)로 돌린다
  const closeCustom = () => {
    onCustomOpenChange(false)
    customRadioRef.current?.focus()
  }

  const moveFocus = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = ARROW_STEP[event.key]
    const cards = cardsRef.current
    if (step === undefined || cards === null) return
    event.preventDefault()
    const radios = [
      ...cards.querySelectorAll<HTMLInputElement>('input[type="radio"]:not(:disabled)'),
    ]
    const from = radios.indexOf(event.currentTarget)
    radios.at((from + step) % radios.length)?.focus()
  }

  const card = {
    name,
    selected,
    locked,
    onChoose: choose,
    onArrowKey: moveFocus,
  }

  return (
    <fieldset className="flex flex-col gap-10">
      <legend className="pb-10 text-caption text-sub">언제 보낼까요?</legend>
      <div ref={cardsRef} className="grid grid-cols-3 gap-9">
        <TimingCard
          {...card}
          value="day_before_deadline"
          title="마감 하루 전"
          detail={
            review.deadlineSendAt === null ? '마감 없음' : shortDateTime(review.deadlineSendAt)
          }
          unavailable={review.deadlineSendAt === null}
        />
        <TimingCard {...card} value="now" title="지금 바로" detail={nowLabel(new Date())} />
        <TimingCard
          {...card}
          value="custom"
          inputRef={customRadioRef}
          title="직접 정하기"
          detail={
            review.sendTiming === 'custom' && review.scheduledAt !== null
              ? shortDateTime(review.scheduledAt)
              : '날짜 · 시각'
          }
        />
      </div>
      {customOpen ? (
        <CustomTimeForm
          initialValue={initialCustomTime(
            review.sendTiming === 'custom' ? review.scheduledAt : null,
            todayInSeoul(),
          )}
          saving={saving}
          onCancel={closeCustom}
          onSubmit={(scheduledAt) =>
            onChange({ kind: 'schedule', timing: 'custom', scheduledAt }, closeCustom)
          }
        />
      ) : null}
      {failure}
    </fieldset>
  )
}

function TimingCard({
  name,
  value,
  selected,
  locked,
  title,
  detail,
  unavailable = false,
  inputRef,
  onChoose,
  onArrowKey,
}: {
  name: string
  value: MessageSendTiming
  selected: MessageSendTiming
  locked: boolean
  title: string
  detail: string
  unavailable?: boolean
  inputRef?: Ref<HTMLInputElement>
  onChoose: (timing: MessageSendTiming) => void
  onArrowKey: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <label className={unavailable ? `group ${CARD} ${UNAVAILABLE}` : `group ${CARD}`}>
      <input
        ref={inputRef}
        type="radio"
        className="sr-only"
        name={name}
        value={value}
        checked={selected === value}
        disabled={unavailable}
        aria-disabled={locked || undefined}
        onChange={() => onChoose(value)}
        // 이미 골라진 라디오는 change 를 내지 않는다 — 저장한 시각을 다시 열 수 있게 누름(Space 포함)도 받는다
        onClick={value === 'custom' ? () => onChoose(value) : undefined}
        onKeyDown={onArrowKey}
      />
      <span className={CARD_TITLE}>{title}</span>
      <span className={CARD_DETAIL}>{detail}</span>
    </label>
  )
}

function CustomTimeForm({
  initialValue,
  saving,
  onCancel,
  onSubmit,
}: {
  initialValue: string
  saving: boolean
  onCancel: () => void
  onSubmit: (scheduledAt: string) => void
}) {
  const inputId = useId()
  const errorId = useId()
  const [value, setValue] = useState(initialValue)
  const [invalid, setInvalid] = useState(false)

  const submit = () => {
    const scheduledAt = fromSeoulInputValue(value)
    if (scheduledAt === null || Date.parse(scheduledAt) <= Date.now()) {
      setInvalid(true)
      return
    }
    onSubmit(scheduledAt)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-8">
        <label htmlFor={inputId} className="text-caption text-sub">
          보낼 날짜와 시각
        </label>
        <input
          id={inputId}
          type="datetime-local"
          className={CUSTOM_INPUT}
          value={value}
          disabled={saving}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setInvalid(false)
          }}
        />
        <LockedButton aria-busy={saving || undefined} locked={saving} onClick={submit}>
          이 시각으로 정하기
        </LockedButton>
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          취소
        </Button>
      </div>
      {invalid ? (
        <p id={errorId} className="text-caption text-accent">
          지금 이후의 날짜와 시각을 골라 주세요.
        </p>
      ) : null}
    </div>
  )
}
