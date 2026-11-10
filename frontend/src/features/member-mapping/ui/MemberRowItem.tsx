import { useEffect, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import type { DiscordUser, Member } from '@/entities/member'
import { COMMON_MESSAGES } from '@/shared/api/errorMessages'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/select'
import type { SelectOption } from '@/shared/ui/select'
import { TextField } from '@/shared/ui/text-field'
import { accountOptions, writeTarget } from '../model/memberRows'
import type { AccountOption, MemberRow, RowWrite } from '../model/memberRows'
import type { MemberRowWrites } from '../model/useMemberRowWrites'
import { EDITOR_ATTRIBUTE, NAME_MAX } from './nameField'

const ROW = 'flex flex-col gap-8 border-b border-surface-selected py-12 last:border-b-0'

const HEAD = 'flex min-w-[0px] flex-wrap items-center gap-8'

/* 띄어 쓰지 않은 긴 이름도 줄 안에서 접는다 — 좁은 카드·창에서 가로로 넘치지 않는다 */
const NAME = 'min-w-[0px] text-body font-semibold wrap-anywhere text-ink'

/* 회의록 상태 배지(MeetingMinutes STATUS_BADGE)와 같은 모양이다 */
const PM_LABEL =
  'inline-flex h-18 shrink-0 items-center rounded-6 bg-control px-6 text-[10.5px] leading-none font-semibold text-sub'

const FAILURE = 'flex flex-wrap items-center gap-8 text-[12px] text-accent'

function statusText(status: AccountOption['status']): string {
  switch (status.kind) {
    case 'free':
      return '연결 안 됨'
    case 'mine':
      return '지금 연결됨'
    case 'taken':
      return `${status.holder.displayName} 님에 연결됨`
  }
}

function toSelectOption(option: AccountOption): SelectOption<string> {
  const status = statusText(option.status)
  return {
    value: option.user.discordUserId,
    label: `@${option.user.username}`,
    description: option.user.displayName ? `${option.user.displayName} · ${status}` : status,
  }
}

const isPendingFor = (pending: RowWrite | null, target: string, kind: RowWrite['kind']) =>
  pending !== null && pending.kind === kind && writeTarget(pending) === target

interface NameEditorProps {
  member: Member
  tone: 'product' | 'onboarding'
  writes: MemberRowWrites
  onClose: () => void
}

/** 그 자리 이름 고치기. Enter 저장(한글 조합의 Enter 는 빼고), Esc 취소. 고친 글자가 있으면 이탈 확인을 건다 */
function NameEditor({ member, tone, writes, onClose }: NameEditorProps) {
  const [text, setText] = useState(member.displayName)
  const input = useRef<HTMLInputElement>(null)
  useUnsavedChanges(text !== member.displayName)
  const target = `member:${member.id}`
  const failure =
    writes.failure?.target === target && writes.failure.write.kind === 'rename'
      ? writes.failure.message
      : undefined
  const saving = isPendingFor(writes.pending, target, 'rename')

  useEffect(() => {
    input.current?.focus()
  }, [])

  return (
    <form
      {...{ [EDITOR_ATTRIBUTE]: '' }}
      noValidate
      className="flex min-w-[0px] flex-1 flex-wrap items-start gap-8"
      onSubmit={(event) => {
        event.preventDefault()
        const result = writes.run(
          { kind: 'rename', memberId: member.id, displayName: text },
          onClose,
        )
        if (result === 'skipped') onClose()
      }}
    >
      <TextField
        ref={input}
        tone={tone}
        className="min-w-[0px] flex-1"
        aria-label={`${member.displayName}의 새 이름`}
        autoComplete="off"
        maxLength={NAME_MAX}
        readOnly={saving}
        value={text}
        error={failure}
        onKeyDown={(event) => {
          // 한글 조합을 확정하는 Enter 는 입력기 몫이다. Safari 는 그 Enter 를 keyCode 229 로만 보낸다
          if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
            event.preventDefault()
          if (event.key === 'Escape' && !saving) {
            event.preventDefault()
            onClose()
          }
        }}
        onChange={(event) => {
          setText(event.target.value)
          writes.clearFailure(target)
        }}
      />
      <Button type="submit" size="sm" variant="primary" className="min-h-[42px]" loading={saving}>
        저장
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="min-h-[42px]"
        disabled={saving}
        onClick={onClose}
      >
        취소
      </Button>
    </form>
  )
}

export interface MemberRowItemProps {
  row: MemberRow
  members: readonly Member[]
  /** null 이면 Discord 미연결이다. 계정 칸과 연결 풀기를 그리지 않는다 */
  discordUsers: readonly DiscordUser[] | null
  tone: 'product' | 'onboarding'
  writes: MemberRowWrites
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** 계정을 골랐다. 옮길지 묻는 것은 목록이 한다 */
  onPick: (member: Member, discordUserId: string) => void
  /** 계정 고르기 칸 — PM 줄 포커스에 쓴다 */
  accountRef?: Ref<HTMLButtonElement>
  extra?: ReactNode
}

/** 팀원 한 줄. 이름 고치기, 디스코드 계정 고르기, 연결 풀기를 바로 저장한다. 실패 문구는 그 줄에 둔다 */
export function MemberRowItem({
  row,
  members,
  discordUsers,
  tone,
  writes,
  editing,
  onEditingChange,
  onPick,
  accountRef,
  extra,
}: MemberRowItemProps) {
  const { member, account } = row
  const target = `member:${member.id}`
  const { busy, pending } = writes
  const failure = writes.failure?.target === target ? writes.failure : null
  const failureInEditor = editing && failure?.write.kind === 'rename'
  const retry = failure?.retry ?? null

  return (
    <li className={ROW}>
      <div className={HEAD}>
        {editing ? (
          <NameEditor
            member={member}
            tone={tone}
            writes={writes}
            onClose={() => onEditingChange(false)}
          />
        ) : (
          <>
            <span className={NAME}>{member.displayName}</span>
            {member.role === 'pm' ? <span className={PM_LABEL}>PM</span> : null}
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${member.displayName} 이름 고치기`}
              disabled={busy}
              onClick={() => onEditingChange(true)}
            >
              이름 고치기
            </Button>
          </>
        )}
      </div>
      {discordUsers === null ? null : (
        <div className="flex min-w-[0px] items-center gap-8">
          <div className="min-w-[0px] flex-1">
            <Select<string>
              ref={accountRef}
              size={tone === 'onboarding' ? 'md' : 'sm'}
              label={`${member.displayName}의 디스코드 계정`}
              aria-label={`${member.displayName}의 디스코드 계정`}
              placeholder={account.kind === 'gone' ? '서버에 없는 계정' : '계정 고르기'}
              value={account.kind === 'linked' ? account.user.discordUserId : null}
              options={accountOptions(discordUsers, members, member.id).map(toSelectOption)}
              disabled={busy}
              onValueChange={(next) => {
                if (next !== null) onPick(member, next)
              }}
            />
          </div>
          {account.kind === 'none' ? null : (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${member.displayName} 연결 풀기`}
              loading={isPendingFor(pending, target, 'unlink')}
              disabled={busy}
              onClick={() => writes.run({ kind: 'unlink', memberId: member.id })}
            >
              연결 풀기
            </Button>
          )}
        </div>
      )}
      {failure === null || failureInEditor ? null : (
        <div role="alert" className={FAILURE}>
          <span className="min-w-[0px] wrap-anywhere">{failure.message}</span>
          {retry === null ? null : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => writes.run(retry)}>
              {COMMON_MESSAGES.retry}
            </Button>
          )}
        </div>
      )}
      {extra}
    </li>
  )
}
