import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { Task } from '@/entities/task'
import { failureNotice } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { useTaskCreate } from '../model/useTaskCreate'

/** 서버 `TaskCreateRequest.title` 의 최대 길이 */
const TITLE_MAX = 300

/* TasksBoard 시안의 `직접 추가` — 높이 38, 1px 점선(#BDBDBD), 둥글기 12, 12px 600 흐림 글자, 14px 더하기(#949494) */
const TRIGGER =
  'inline-flex h-[38px] w-full items-center justify-center gap-6 rounded-12 border border-dashed bg-transparent text-[12px] leading-none font-semibold text-dim hover:bg-surface-sunken'
/* 펼친 칸은 시안 카드와 같은 틀이다 (패딩 12·13, 둥글기 12). 입력에 포커스가 있으면 전역 포커스 규칙처럼 테두리 위에
   2px 먹 outline(-1px)을 겹쳐 테두리가 먹으로 두꺼워진다 — 입력 자체는 틀 안이라 따로 선을 긋지 않는다.
   버튼(취소·추가)은 자기 포커스 표시가 있어 입력일 때만 그린다 (docs/plan/m2/basis-for-decision/2026-09-23-focus-outline-over-border.md) */
const FORM =
  'flex flex-col gap-10 rounded-12 border border-line-strong bg-surface px-13 py-12 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ink has-[input:focus-visible]:-outline-offset-1'
const INPUT =
  'w-full min-w-[0px] bg-transparent text-[13px] leading-[1.45] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-dim'

export interface TaskQuickAddProps {
  workspaceId: string
  /** 만들 태스크의 상태. 보드 칸의 기본 상태다 (시작 전 todo · 진행 중 in_progress · 완료 done) */
  status: Task['status']
  /** 칸 이름. 버튼·폼·입력의 읽는 이름에 붙여 칸마다 다른 이름이 되게 한다 */
  columnLabel: string
  /** 담당자 조건으로 걸러 보는 중이면 그 팀원. 만든 태스크가 지금 보는 보드에서 사라지지 않게 담당자로 넣는다 */
  assigneeMemberId: string | null
}

/**
 * 보드 칸 아래의 `직접 추가` (TasksBoard 시안). 누르면 그 자리에서 제목 한 줄을 받고, 서버가 만든 뒤에만 카드가 생긴다.
 * Enter·`추가` 로 보내고 Esc·`취소` 로 닫는다. 빈 제목은 보내지 않는다. 실패하면 입력을 그대로 두고 알린다.
 */
export function TaskQuickAdd({
  workspaceId,
  status,
  columnLabel,
  assigneeMemberId,
}: TaskQuickAddProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const wasOpen = useRef(false)
  const errorId = useId()
  const { create, pending, error, reset } = useTaskCreate(workspaceId, status)
  const notice = error === null ? null : failureNotice(error)
  const trimmed = title.trim()

  // 펼치면 입력으로, 닫으면 다시 그려진 `직접 추가` 로 포커스를 옮긴다. 처음 그릴 때는 옮기지 않는다
  useEffect(() => {
    if (open) input.current?.focus()
    else if (wasOpen.current) trigger.current?.focus()
    wasOpen.current = open
  }, [open])

  const close = () => {
    setOpen(false)
    setTitle('')
    reset()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (trimmed.length === 0 || pending) return
    create({ title: trimmed, status, assigneeMemberId }, close)
  }

  // 폼 안 어디서든(입력·취소·추가) Esc 로 닫는다. 보내는 중에는 닫지 않는다 — 응답이 오면 스스로 닫히거나 오류를 보인다
  const cancelOnEscape = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape' || pending) return
    event.preventDefault()
    close()
  }

  if (!open)
    return (
      <button
        ref={trigger}
        type="button"
        aria-label={`${columnLabel}에 직접 추가`}
        className={TRIGGER}
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size={14} strokeWidth={1.8} className="text-input-border" />
        직접 추가
      </button>
    )

  return (
    // 폼은 안의 입력·버튼에서 올라온 Esc 만 받는다 — 폼 자체가 포커스를 받거나 조작되지는 않는다
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      aria-label={`${columnLabel}에 직접 추가`}
      aria-busy={pending}
      className={FORM}
      onSubmit={submit}
      onKeyDown={cancelOnEscape}
    >
      <input
        ref={input}
        aria-label={`${columnLabel} 새 태스크 제목`}
        aria-invalid={notice !== null}
        aria-describedby={notice === null ? undefined : errorId}
        placeholder="할 일 제목"
        maxLength={TITLE_MAX}
        readOnly={pending}
        value={title}
        className={INPUT}
        onChange={(event) => {
          setTitle(event.target.value)
          if (error !== null) reset()
        }}
      />
      {notice === null ? null : (
        <p id={errorId} role="alert" className="text-[12px] leading-[1.5] text-accent">
          태스크를 추가하지 못했어요. {notice}
        </p>
      )}
      <div className="flex justify-end gap-6">
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={close}>
          취소
        </Button>
        <Button type="submit" size="sm" loading={pending} disabled={trimmed.length === 0}>
          추가
        </Button>
      </div>
    </form>
  )
}
