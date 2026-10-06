import { useId } from 'react'
import type { Ref } from 'react'
import type { Member } from '@/entities/member'
import { ErrorText } from '@/shared/ui/error-text'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Icon } from '@/shared/ui/icon'

export interface AttendeePickerProps {
  /** 이 공간에 등록된 팀원. 후보는 이 목록뿐이다 — 외부 이름을 직접 넣지 않는다 (D-086) */
  members: readonly Member[]
  value: readonly string[]
  onChange: (next: string[]) => void
  error?: string
  disabled?: boolean
  /** `추가` 버튼. 참석자 없이 제출하면 폼이 여기로 포커스를 옮긴다 */
  triggerRef?: Ref<HTMLButtonElement>
}

/* Upload 캔버스의 참석자 칩과 `추가` */
const LEGEND = 'mb-8 text-[12px] font-normal text-sub'
const CHIPS = 'flex flex-wrap items-center gap-7'
const CHIP =
  'inline-flex h-30 items-center gap-7 rounded-6 bg-control pr-4 pl-4 text-caption font-semibold text-sub'
const AVATAR =
  'inline-flex h-22 w-22 items-center justify-center rounded-999 bg-surface-selected text-[10px] text-ink'
const CHIP_REMOVE =
  'inline-flex h-22 w-22 items-center justify-center rounded-6 text-dim hover:bg-line-strong disabled:text-line-strong'
const ADD =
  'inline-flex h-30 items-center gap-6 rounded-9 border border-transparent bg-control px-12 text-caption font-semibold text-ink hover:bg-line-strong disabled:bg-surface-selected disabled:text-faint'
const HINT = 'mt-8 text-[12px] text-dim'

/** 이름의 첫 글자. 캔버스의 동그란 머리글자 */
function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '?'
}

/**
 * 참석자 고르기. 고른 팀원은 칩으로, 남은 팀원은 `추가` 메뉴로 고른다.
 * 메뉴는 Radix 라 화살표·Enter·Esc 와 닫을 때의 포커스 복귀가 된다. 칩마다 `빼기` 버튼이 있다.
 */
export function AttendeePicker({
  members,
  value,
  onChange,
  error,
  disabled = false,
  triggerRef,
}: AttendeePickerProps) {
  const legendId = useId()
  const errorId = useId()
  const hintId = useId()
  const chosen = value
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Member => member !== undefined)
  const rest = members.filter((member) => !value.includes(member.id))

  return (
    <div role="group" aria-labelledby={legendId} aria-describedby={hintId}>
      <p id={legendId} className={LEGEND}>
        참석자
      </p>
      <ul className={CHIPS} aria-label="고른 참석자">
        {chosen.map((member) => (
          <li key={member.id} className={CHIP}>
            <span className={AVATAR} aria-hidden="true">
              {initialOf(member.displayName)}
            </span>
            {member.displayName}
            <button
              type="button"
              className={CHIP_REMOVE}
              aria-label={`${member.displayName} 빼기`}
              disabled={disabled}
              onClick={() => onChange(value.filter((id) => id !== member.id))}
            >
              <Icon name="close" size={12} />
            </button>
          </li>
        ))}
        <li>
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={triggerRef}
              className={ADD}
              disabled={disabled || rest.length === 0}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={error === undefined ? undefined : errorId}
            >
              <Icon name="plus" size={13} />
              추가
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" aria-label="참석자 추가">
              <DropdownMenuLabel>팀원 {rest.length}</DropdownMenuLabel>
              {rest.map((member) => (
                <DropdownMenuItem
                  key={member.id}
                  onSelect={() => onChange([...value, member.id])}
                  className="text-body text-ink"
                >
                  <span className={AVATAR} aria-hidden="true">
                    {initialOf(member.displayName)}
                  </span>
                  {member.displayName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ul>
      {error === undefined ? null : (
        <ErrorText id={errorId} className="mt-6">
          {error}
        </ErrorText>
      )}
      <p id={hintId} className={HINT}>
        참석자를 알려주면 목소리와 이름을 더 정확히 맞출 수 있어요.
      </p>
    </div>
  )
}
