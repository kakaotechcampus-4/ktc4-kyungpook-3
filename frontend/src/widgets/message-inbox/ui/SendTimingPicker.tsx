import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { MessageReview, MessageReviewAction, MessageSendTiming } from '@/entities/message'
import { todayInSeoul } from '@/shared/lib/date'
import { Button } from '@/shared/ui/button'
import { fromSeoulInputValue, initialCustomTime, nowLabel, shortDateTime } from '../lib/format'

/* Messages 캔버스 실측 — 라벨 12.5 보조, 카드 3열 간격 9, 카드(위아래 13 · 좌우 15 · 라운드 16 · 선), 고른 카드는 먹 면 흰 글자.
   라디오는 숨기고 카드 전체가 라벨이다. 포커스 선은 카드에 긋는다 */
const CARD =
  'flex cursor-pointer flex-col items-start gap-2 rounded-16 border border-line bg-surface px-15 py-13 text-left has-[input:checked]:border-ink has-[input:checked]:bg-ink has-[input:disabled]:cursor-not-allowed has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-4 has-[input:focus-visible]:outline-ink'
const CARD_TITLE = 'text-body font-semibold text-sub group-has-[input:checked]:text-surface'
const CARD_DETAIL = 'mono text-meta text-dim group-has-[input:checked]:text-surface'
/* 고를 수 없는 카드(마감이 없는 항목의 `마감 하루 전`)는 눌린 면에 흐린 글자다 — 고를 수 있는 카드와 구분한다 */
const UNAVAILABLE = 'bg-surface-sunken [&>span]:text-faint'
const CUSTOM_INPUT =
  'h-36 rounded-9 border border-input-border bg-surface px-10 text-body text-ink focus-visible:-outline-offset-1'

export interface SendTimingPickerProps {
  review: MessageReview
  /** 다른 행동이 진행 중이거나 문구를 고치는 중이라 고를 수 없다 */
  disabled: boolean
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
 * 마감이 없는 항목은 `마감 하루 전` 을 고를 수 없다
 */
export function SendTimingPicker({ review, disabled, onChange, failure }: SendTimingPickerProps) {
  const name = useId()
  const [customOpen, setCustomOpen] = useState(false)
  const selected: MessageSendTiming = customOpen ? 'custom' : review.sendTiming

  const choose = (timing: MessageSendTiming) => {
    if (timing === 'custom') setCustomOpen(true)
    else {
      setCustomOpen(false)
      if (timing !== review.sendTiming) onChange({ kind: 'schedule', timing }, () => undefined)
    }
  }

  return (
    <fieldset className="flex flex-col gap-10" disabled={disabled}>
      <legend className="pb-10 text-caption text-sub">언제 보낼까요?</legend>
      <div className="grid grid-cols-3 gap-9">
        <TimingCard
          name={name}
          value="day_before_deadline"
          selected={selected}
          title="마감 하루 전"
          detail={
            review.deadlineSendAt === null ? '마감 없음' : shortDateTime(review.deadlineSendAt)
          }
          unavailable={review.deadlineSendAt === null}
          onChoose={choose}
        />
        <TimingCard
          name={name}
          value="now"
          selected={selected}
          title="지금 바로"
          detail={nowLabel(new Date())}
          onChoose={choose}
        />
        <TimingCard
          name={name}
          value="custom"
          selected={selected}
          title="직접 정하기"
          detail={
            review.sendTiming === 'custom' && review.scheduledAt !== null
              ? shortDateTime(review.scheduledAt)
              : '날짜 · 시각'
          }
          onChoose={choose}
        />
      </div>
      {customOpen ? (
        <CustomTimeForm
          initialValue={initialCustomTime(
            review.sendTiming === 'custom' ? review.scheduledAt : null,
            todayInSeoul(),
          )}
          onCancel={() => setCustomOpen(false)}
          onSubmit={(scheduledAt) =>
            onChange({ kind: 'schedule', timing: 'custom', scheduledAt }, () =>
              setCustomOpen(false),
            )
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
  title,
  detail,
  unavailable = false,
  onChoose,
}: {
  name: string
  value: MessageSendTiming
  selected: MessageSendTiming
  title: string
  detail: string
  unavailable?: boolean
  onChoose: (timing: MessageSendTiming) => void
}) {
  return (
    <label className={unavailable ? `group ${CARD} ${UNAVAILABLE}` : `group ${CARD}`}>
      <input
        type="radio"
        className="sr-only"
        name={name}
        value={value}
        checked={selected === value}
        disabled={unavailable}
        onChange={() => onChoose(value)}
      />
      <span className={CARD_TITLE}>{title}</span>
      <span className={CARD_DETAIL}>{detail}</span>
    </label>
  )
}

function CustomTimeForm({
  initialValue,
  onCancel,
  onSubmit,
}: {
  initialValue: string
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
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setInvalid(false)
          }}
        />
        <Button size="sm" onClick={submit}>
          이 시각으로 정하기
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
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
