import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { MessageReview } from '@/entities/message'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { Mascot } from '@/shared/ui/mascot'
import { shortDateTime } from '../lib/format'
import { DiscordGlyph } from './DiscordGlyph'

/* Messages 캔버스 실측 — 카드 라운드 16 · 선, 머리(좌우 16 · 위아래 12 · 아래 선), 본문(위 18 · 좌우 18 · 아래 14, 간격 12),
   아바타 34(매스), 이름 줄 간격 8, 밑단(좌우 18 · 위아래 12 · 위 구분선) */
const CARD = 'overflow-hidden rounded-16 border border-line bg-surface'
const CARD_HEAD = 'flex items-center gap-10 border-b border-line px-16 py-12 text-ink'
const BOT_BADGE =
  'inline-flex h-16 items-center rounded-4 bg-divider px-5 text-[9.5px] leading-none font-semibold text-sub'
const CARD_FOOT =
  'flex items-center justify-between gap-12 border-t border-divider px-18 py-12 text-[12px] text-dim'
const TEXTAREA =
  'min-h-[112px] w-full resize-y rounded-9 border border-input-border bg-surface px-12 py-10 text-[14px] leading-[1.8] text-ink focus-visible:-outline-offset-1'

/** Discord DM 한 건의 글자 수 한도. 서버도 같은 한도로 다시 확인한다 */
export const BODY_MAX_LENGTH = 2000

export interface ReviewMessageCardProps {
  review: MessageReview
  botName: string
  /** 고쳐 쓰는 중인가. 고쳐 쓰는 동안 발송·발송 시점은 잠긴다 */
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** 고친 문구를 서버에 보낸다. 성공하면 `onSaved` 를 부른다 */
  onSave: (body: string, onSaved: () => void) => void
  /** 다른 행동이 진행 중이다 */
  busy: boolean
  /** 저장 요청 중이다 */
  saving: boolean
  /** 저장 실패 알림 자리 */
  failure: ReactNode
}

/**
 * 나갈 DM 미리보기 — Discord 에서 보일 모습 그대로(봇 이름 · BOT · 나갈 시각 · 본문). 밑단의 `고쳐 쓰기` 로 문구를 고친다.
 * 고친 문구는 서버가 저장한 뒤에만 미리보기에 보인다 (D-137)
 */
export function ReviewMessageCard({
  review,
  botName,
  editing,
  onEditingChange,
  onSave,
  busy,
  saving,
  failure,
}: ReviewMessageCardProps) {
  return (
    <section aria-label="보낼 메시지 미리보기" className={CARD}>
      <div className={CARD_HEAD}>
        <DiscordGlyph />
        <span className="flex-1 text-caption">Discord 개인 메시지 · {botName} 봇</span>
        <span className="mono text-meta text-dim">미리보기</span>
      </div>
      <div className="flex gap-12 px-18 pt-18 pb-14">
        <Mascot size={34} className="shrink-0" />
        <div className="flex min-w-[0px] flex-1 flex-col gap-7">
          <div className="flex flex-wrap items-baseline gap-8">
            <span className="text-body font-semibold text-ink">{botName}</span>
            <span className={BOT_BADGE}>BOT</span>
            <span className="mono text-[11px] text-dim">
              {review.scheduledAt === null
                ? '바로 발송'
                : `${shortDateTime(review.scheduledAt)} 예정`}
            </span>
          </div>
          {editing ? (
            <BodyEditor
              initialBody={review.body}
              onCancel={() => onEditingChange(false)}
              onSave={onSave}
              saving={saving}
              failure={failure}
            />
          ) : (
            <p className="text-[14px] leading-[1.8] whitespace-pre-line text-ink">{review.body}</p>
          )}
        </div>
      </div>
      {editing ? null : (
        <div className={CARD_FOOT}>
          <span>문구는 그대로 고칠 수 있어요</span>
          <Button
            size="sm"
            className="text-[12px]"
            startIcon={<Icon name="edit" size={13} />}
            disabled={busy}
            onClick={() => onEditingChange(true)}
          >
            고쳐 쓰기
          </Button>
        </div>
      )}
    </section>
  )
}

function BodyEditor({
  initialBody,
  onCancel,
  onSave,
  saving,
  failure,
}: {
  initialBody: string
  onCancel: () => void
  onSave: (body: string, onSaved: () => void) => void
  saving: boolean
  failure: ReactNode
}) {
  const fieldId = useId()
  const errorId = useId()
  const [draft, setDraft] = useState(initialBody)
  const [empty, setEmpty] = useState(false)
  const changed = draft.trim() !== initialBody
  const unsaved = useUnsavedChanges(changed)

  const save = () => {
    const body = draft.trim()
    if (body.length === 0) {
      setEmpty(true)
      return
    }
    if (body === initialBody) {
      onCancel()
      return
    }
    onSave(body, () => {
      unsaved.release()
      onCancel()
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <label htmlFor={fieldId} className="sr-only">
        보낼 문구
      </label>
      <textarea
        id={fieldId}
        className={TEXTAREA}
        value={draft}
        maxLength={BODY_MAX_LENGTH}
        disabled={saving}
        aria-invalid={empty || undefined}
        aria-describedby={empty ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          setEmpty(false)
        }}
      />
      {empty ? (
        <p id={errorId} className="text-caption text-accent">
          보낼 문구를 입력해 주세요.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-12">
        <span className="mono text-meta text-dim">
          {draft.length}/{BODY_MAX_LENGTH}
        </span>
        <div className="flex items-center gap-8">
          <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
            취소
          </Button>
          <Button size="sm" loading={saving} onClick={save}>
            저장
          </Button>
        </div>
      </div>
      {failure}
    </div>
  )
}
