import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MESSAGE_BODY_MAX_LENGTH } from '@/entities/message'
import type { BodySource, Bundle } from '@/entities/message'
import { isKnownValue } from '@/shared/api/unknownValue'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { LockedButton } from '@/shared/ui/locked-button'
import { Mascot } from '@/shared/ui/mascot'
import { shortDateTime } from '../lib/format'
import { DiscordGlyph } from './DiscordGlyph'

/* Messages 캔버스 실측 — 카드 라운드 16 · 선, 머리(좌우 16 · 위아래 12 · 아래 선), 본문(위 18 · 좌우 18 · 아래 14, 간격 12),
   아바타 34(매스), 이름 줄 간격 8, 밑단(좌우 18 · 위아래 12 · 위 구분선).
   카드의 overflow-hidden 은 시안 그대로(라운드 안쪽 자르기)라 높이는 내용을 따라야 한다 — 열이 줄이지 않는다(ReviewDetail).
   봇 이름·본문은 띄어 쓰지 않은 긴 글자도 카드 폭 안에서 줄을 바꾼다(`wrap-anywhere`) — 카드가 가로로 자르지 않는다 */
const CARD = 'overflow-hidden rounded-16 border border-line bg-surface'
const CARD_HEAD = 'flex items-center gap-10 border-b border-line px-16 py-12 text-ink'
const BOT_BADGE =
  'inline-flex h-16 items-center rounded-4 bg-divider px-5 text-[9.5px] leading-none font-semibold text-sub'
const CARD_FOOT =
  'flex items-center justify-between gap-12 border-t border-divider px-18 py-12 text-[12px] text-dim'
/* 문구 다듬는 중 — AI 초안이 오는 중이라 문구가 바뀔 수 있다 */
const DRAFTING_CHIP =
  'inline-flex h-18 items-center rounded-4 bg-surface-sunken px-6 text-[10.5px] leading-none text-sub'
const TEXTAREA =
  'min-h-[112px] w-full resize-y rounded-9 border border-input-border bg-surface px-12 py-10 text-[14px] leading-[1.8] text-ink focus-visible:-outline-offset-1'

/** 문구의 출처 (계약 §5.7 `body_source`) */
const BODY_SOURCE_LABEL: Record<BodySource, string> = {
  pm: '직접 고친 문구',
  ai: 'AI 초안',
  rule: '기본 문구',
}

/** 문구가 어디서 왔는지. 모르는 출처는 다른 출처로 짐작하지 않는다 (#348) */
function bodySourceLabel(source: Bundle['bodySource']): string {
  return isKnownValue(source) ? BODY_SOURCE_LABEL[source] : '출처를 알 수 없는 문구'
}

export interface ReviewMessageCardProps {
  bundle: Bundle
  botName: string
  /** 고쳐 쓰는 중인가. 고쳐 쓰는 동안 발송·발송 시점은 잠긴다 */
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** 고친 문구를 서버에 보낸다. 성공하면 `onSaved` 를 부른다 */
  onSave: (body: string, onSaved: () => void) => void
  /** 다른 행동이 진행 중이거나 발송 시각을 고르는 중이라 고쳐 쓸 수 없다. 포커스는 남긴다(`aria-disabled`) */
  locked: boolean
  /** 잠겨도 `고쳐 쓰기` 의 모양을 바꾸지 않는다 — 발송 시점 저장처럼 짧고 이유가 다른 자리에 보이는 잠금 */
  keepLockedLook: boolean
  /** 저장 요청 중이다 */
  saving: boolean
  /** 저장 실패 알림 자리 */
  failure: ReactNode
}

/**
 * 나갈 DM 미리보기 — Discord 에서 보일 모습 그대로(봇 이름 · BOT · 나갈 시각 · 본문, 줄바꿈 그대로). 밑단의 `고쳐 쓰기` 로 문구를 고친다.
 * AI 초안이 오는 중이면 `문구 다듬는 중` 을 붙인다 — 그래도 지금 보이는 문구로 승인할 수 있다.
 * 고친 문구는 서버가 저장한 뒤에만 미리보기에 보인다 (D-137). 문구 칸을 열면 그 칸으로, 닫으면 `고쳐 쓰기` 로 포커스를 옮긴다
 */
export function ReviewMessageCard({
  bundle,
  botName,
  editing,
  onEditingChange,
  onSave,
  locked,
  keepLockedLook,
  saving,
  failure,
}: ReviewMessageCardProps) {
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef(false)
  // 문구 칸이 닫히며 그 안의 버튼이 사라진다 — 포커스를 연 자리(`고쳐 쓰기`)로 돌린다
  useEffect(() => {
    if (editing || !returnFocusRef.current) return
    returnFocusRef.current = false
    editButtonRef.current?.focus()
  }, [editing])
  const closeEditor = () => {
    returnFocusRef.current = true
    onEditingChange(false)
  }

  return (
    <section aria-label="보낼 메시지 미리보기" className={CARD}>
      <div className={CARD_HEAD}>
        <DiscordGlyph />
        <span className="flex-1 text-caption wrap-anywhere">
          Discord 개인 메시지 · {botName} 봇
        </span>
        <span className="mono text-meta text-dim">미리보기</span>
      </div>
      <div className="flex gap-12 px-18 pt-18 pb-14">
        <Mascot size={34} className="shrink-0" />
        <div className="flex min-w-[0px] flex-1 flex-col gap-7">
          <div className="flex flex-wrap items-baseline gap-8">
            <span className="text-body font-semibold wrap-anywhere text-ink">{botName}</span>
            <span className={BOT_BADGE}>BOT</span>
            <span className="mono text-[11px] text-dim">
              {shortDateTime(bundle.scheduledAt)} 예정
            </span>
            {bundle.drafting ? <span className={DRAFTING_CHIP}>문구 다듬는 중</span> : null}
          </div>
          {editing ? (
            <BodyEditor
              initialBody={bundle.body}
              onClose={closeEditor}
              onSave={onSave}
              saving={saving}
              failure={failure}
            />
          ) : (
            <p className="text-[14px] leading-[1.8] wrap-anywhere whitespace-pre-line text-ink">
              {bundle.body}
            </p>
          )}
        </div>
      </div>
      {editing ? null : (
        <div className={CARD_FOOT}>
          <span>{bodySourceLabel(bundle.bodySource)} · 문구는 그대로 고칠 수 있어요</span>
          <LockedButton
            ref={editButtonRef}
            size="message-edit"
            startIcon={<Icon name="edit" size={13} />}
            locked={locked}
            keepLook={keepLockedLook}
            onClick={() => onEditingChange(true)}
          >
            고쳐 쓰기
          </LockedButton>
        </div>
      )}
    </section>
  )
}

function BodyEditor({
  initialBody,
  onClose,
  onSave,
  saving,
  failure,
}: {
  initialBody: string
  onClose: () => void
  onSave: (body: string, onSaved: () => void) => void
  saving: boolean
  failure: ReactNode
}) {
  const fieldId = useId()
  const errorId = useId()
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  // 열리면 바로 고칠 수 있게 문구 칸으로 포커스를 옮긴다
  useEffect(() => {
    fieldRef.current?.focus()
  }, [])
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
      onClose()
      return
    }
    onSave(body, () => {
      unsaved.release()
      onClose()
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <label htmlFor={fieldId} className="sr-only">
        보낼 문구
      </label>
      <textarea
        ref={fieldRef}
        id={fieldId}
        className={TEXTAREA}
        value={draft}
        maxLength={MESSAGE_BODY_MAX_LENGTH}
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
          {draft.length}/{MESSAGE_BODY_MAX_LENGTH}
        </span>
        <div className="flex items-center gap-8">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            취소
          </Button>
          <LockedButton aria-busy={saving || undefined} locked={saving} onClick={save}>
            저장
          </LockedButton>
        </div>
      </div>
      {failure}
    </div>
  )
}
