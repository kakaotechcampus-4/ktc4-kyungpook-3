import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { memberListQueryOptions, pmsOf } from '@/entities/member'
import type { DiscordUser, Member } from '@/entities/member'
import { Button } from '@/shared/ui/button'
import { ErrorText } from '@/shared/ui/error-text'
import { Label } from '@/shared/ui/label'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { TextField } from '@/shared/ui/text-field'
import {
  accountMemberName,
  buildMemberRows,
  planPick,
  unlinkedAccounts,
  writeTarget,
} from '../model/memberRows'
import type { RowWrite } from '../model/memberRows'
import { useMemberRowWrites } from '../model/useMemberRowWrites'
import type { MemberRowWrites } from '../model/useMemberRowWrites'
import { MemberRowItem } from './MemberRowItem'
import { MoveConfirm } from './MoveConfirm'
import { NAME_MAX } from './nameField'

type Tone = 'product' | 'onboarding'

/* 라벨과 칸 사이 간격은 TextField 의 화면군 간격(제품 6 · 온보딩 7)과 같다 */
const LABEL_GAP = { product: 'mb-6', onboarding: 'mb-7' } as const

const SECTION_TITLE = 'text-caption font-semibold text-sub'

const ACCOUNT_ROW =
  'flex flex-wrap items-center gap-8 border-b border-surface-selected py-8 last:border-b-0'

/** Discord 를 연결한 공간에서 이름 추가 칸 위에 둔다 (#660) */
const NOT_IN_DISCORD_SERVER =
  'Discord 서버에 없는 팀원은 이름으로 추가할 수 있어요. 서버에 들어와 이어 주기 전까지는 그 팀원의 Discord 회의 발화가 잡히지 않아요.'

const isPending = (pending: RowWrite | null, target: string) =>
  pending !== null && writeTarget(pending) === target

interface UnlinkedAccountsProps {
  users: readonly DiscordUser[]
  writes: MemberRowWrites
  onAdded: (member: Member) => void
}

/** 아직 어느 팀원에도 연결되지 않은 계정. 디스코드 표시 이름으로 바로 팀원을 만든다 */
function UnlinkedAccounts({ users, writes, onAdded }: UnlinkedAccountsProps) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="pt-14">
      <h3 id={titleId} className={SECTION_TITLE}>
        아직 팀원에 연결되지 않은 디스코드 계정 {users.length}개
      </h3>
      {users.length === 0 ? (
        <p className="pt-6 text-body text-dim">모든 디스코드 계정이 팀원에 연결됐어요.</p>
      ) : (
        <ul className="pt-6">
          {users.map((user) => {
            const target = `account:${user.discordUserId}`
            const failure = writes.failure?.target === target ? writes.failure.message : null
            return (
              <li key={user.discordUserId} className={ACCOUNT_ROW}>
                <span className="min-w-[0px] flex-1 text-body wrap-anywhere text-ink">
                  @{user.username}
                  {user.displayName ? (
                    <span className="text-dim"> ({user.displayName})</span>
                  ) : null}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  aria-label={`@${user.username} 팀원으로 추가`}
                  loading={isPending(writes.pending, target)}
                  disabled={writes.busy}
                  onClick={() =>
                    writes.run(
                      {
                        kind: 'create',
                        displayName: accountMemberName(user),
                        discordUserId: user.discordUserId,
                      },
                      onAdded,
                    )
                  }
                >
                  팀원으로 추가
                </Button>
                {failure === null ? null : (
                  <ErrorText role="alert" className="w-full">
                    {failure}
                  </ErrorText>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

interface NameAddFormProps {
  tone: Tone
  writes: MemberRowWrites
  /** 칸 위의 안내. Discord 를 연결한 공간이 서버에 없는 사람을 이름으로 추가한다고 알린다 (#660) */
  notice?: string
}

/** Discord 없이 이름만으로 팀원을 추가한다 (#613). 추가한 팀원은 위 목록의 새 줄로 나타난다 */
function NameAddForm({ tone, writes, notice }: NameAddFormProps) {
  const [text, setText] = useState('')
  const fieldId = useId()
  const failure = writes.failure?.target === 'new' ? writes.failure.message : undefined
  const adding = isPending(writes.pending, 'new')

  return (
    <form
      noValidate
      className="pt-14"
      onSubmit={(event) => {
        event.preventDefault()
        writes.run({ kind: 'create', displayName: text, discordUserId: null }, () => setText(''))
      }}
    >
      {notice === undefined ? null : <p className="pb-10 text-body text-dim">{notice}</p>}
      <Label htmlFor={fieldId} tone={tone} className={LABEL_GAP[tone]}>
        팀원 이름
      </Label>
      <div className="flex items-start gap-8">
        <TextField
          id={fieldId}
          tone={tone}
          className="min-w-[0px] flex-1"
          placeholder="이름"
          autoComplete="off"
          maxLength={NAME_MAX}
          // 보내는 동안 고친 글자를 성공 뒤 비우기가 지우지 않게, 포커스는 두되 고칠 수 없게 한다
          readOnly={adding}
          value={text}
          onKeyDown={(event) => {
            // 한글 조합을 확정하는 Enter 는 입력기 몫이다. Safari 는 그 Enter 를 keyCode 229 로만 보낸다
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
              event.preventDefault()
          }}
          onChange={(event) => {
            setText(event.target.value)
            writes.clearFailure('new')
          }}
          error={failure}
        />
        {/* 입력 칸(42px)과 높이를 맞춘다 */}
        <Button
          type="submit"
          size={tone === 'onboarding' ? 'lg-onboarding' : 'lg'}
          className="min-h-[42px] shrink-0"
          disabled={text.trim() === '' || (writes.busy && !adding)}
          loading={adding}
        >
          추가
        </Button>
      </div>
    </form>
  )
}

export interface MemberRowsProps {
  workspaceId: string
  /** null 이면 Discord 미연결이다. 계정 칸과 연결 안 된 계정 영역을 숨긴다 */
  discordUsers: readonly DiscordUser[] | null
  /** 칸 모양. 온보딩 카드는 `onboarding`, 팀원 관리 창은 `product` 다 */
  tone: Tone
  /** 줄 아래에 덧붙일 것 — 팀원 관리 창의 초대 상태와 조작 */
  rowExtra?: (member: Member) => ReactNode
  /** 워크스페이스를 만든 PM 줄의 계정 고르기 칸. PM 연결을 요구하는 화면이 포커스를 옮긴다 (#228) */
  pmAccountRef?: Ref<HTMLButtonElement>
}

/**
 * 팀원 한 명이 한 줄인 팀원 목록 (#647). 팀원 관리 창과 온보딩 팀원 연결이 함께 쓴다.
 * 줄마다 바로 저장한다 — 이름 고치기, 계정 고르기, 연결 옮기기·풀기, 연결 안 된 계정이나 이름으로 팀원 추가.
 * 팀원은 살아 있는 캐시를 읽는다 — 저장할 때마다 줄이 서버가 돌려준 팀원으로 바뀐다.
 */
export function MemberRows({
  workspaceId,
  discordUsers,
  tone,
  rowExtra,
  pmAccountRef,
}: MemberRowsProps) {
  const members = useQuery(memberListQueryOptions(workspaceId))
  const writes = useMemberRowWrites(workspaceId)
  const [editing, setEditing] = useState<ReadonlySet<string>>(() => new Set())
  const [moving, setMoving] = useState<{
    from: Member
    memberId: string
    discordUserId: string
  } | null>(null)

  if (members.data === undefined)
    return members.isError ? (
      <QueryErrorState error={members.error} onRetry={() => void members.refetch()} />
    ) : (
      <Skeleton lines={3} className="pt-6" />
    )

  const list = members.data
  const creator = pmsOf(list)[0]
  const setRowEditing = (memberId: string, next: boolean) =>
    setEditing((current) => {
      const updated = new Set(current)
      if (next) updated.add(memberId)
      else updated.delete(memberId)
      return updated
    })

  const pick = (member: Member, discordUserId: string) => {
    const plan = planPick(member.id, discordUserId, list)
    if (plan.kind === 'link') writes.run({ kind: 'link', memberId: member.id, discordUserId })
    else if (plan.kind === 'move')
      setMoving({ from: plan.from, memberId: member.id, discordUserId })
  }

  return (
    <>
      <ul aria-label="팀원" className="pt-6">
        {buildMemberRows(list, discordUsers).map((row) => (
          <MemberRowItem
            key={row.member.id}
            row={row}
            members={list}
            discordUsers={discordUsers}
            tone={tone}
            writes={writes}
            editing={editing.has(row.member.id)}
            onEditingChange={(next) => setRowEditing(row.member.id, next)}
            onPick={pick}
            accountRef={row.member.id === creator?.id ? pmAccountRef : undefined}
            extra={rowExtra?.(row.member)}
          />
        ))}
      </ul>
      {discordUsers === null ? null : (
        <UnlinkedAccounts
          users={unlinkedAccounts(discordUsers, list)}
          writes={writes}
          onAdded={(member) => setRowEditing(member.id, true)}
        />
      )}
      <NameAddForm
        tone={tone}
        writes={writes}
        notice={discordUsers === null ? undefined : NOT_IN_DISCORD_SERVER}
      />
      <MoveConfirm
        fromName={moving?.from.displayName ?? null}
        onCancel={() => setMoving(null)}
        onConfirm={() => {
          if (moving === null) return
          setMoving(null)
          writes.run({
            kind: 'move',
            fromId: moving.from.id,
            memberId: moving.memberId,
            discordUserId: moving.discordUserId,
          })
        }}
      />
    </>
  )
}
