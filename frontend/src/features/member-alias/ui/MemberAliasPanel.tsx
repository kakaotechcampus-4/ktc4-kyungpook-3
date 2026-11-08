import { useState } from 'react'
import type { Member, MemberAlias } from '@/entities/member'
import { COMMON_MESSAGES } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { TextField } from '@/shared/ui/text-field'
import {
  ALIAS_EMPTY,
  ALIAS_EXISTS,
  ALIAS_LOAD_FAILED,
  ALIAS_SOURCE_LABEL,
  ALIAS_UNVERIFIED,
} from '../lib/aliasMessages'
import { useMemberAliasActions } from '../model/useMemberAliasActions'

const PANEL = 'flex flex-col gap-10 border-b border-line py-12'
const NOTE = 'text-[12px] text-dim'
const CHIPS = 'flex flex-wrap items-center gap-6'
/* 띄어 쓰지 않은 긴 별칭도 칩 안에서 줄을 바꾼다 — 휴대폰 폭에서 가로로 넘치지 않는다 */
const CHIP =
  'inline-flex max-w-full min-h-28 items-center gap-6 rounded-6 bg-control py-3 pr-4 pl-9 text-caption text-ink'
const CHIP_TEXT = 'min-w-[0px] font-semibold wrap-anywhere'
const CHIP_TAG = 'shrink-0 text-[11px] text-dim'
const CHIP_REMOVE =
  'inline-flex h-22 w-22 shrink-0 items-center justify-center rounded-6 text-dim hover:bg-line-strong disabled:text-line-strong'

/** 공간의 별칭 조회 상태. 팀 화면이 한 번 받아 팀원마다 나눠 준다 */
export type MemberAliasesState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; aliases: readonly MemberAlias[] }

export interface MemberAliasPanelProps {
  workspaceId: string
  member: Member
  state: MemberAliasesState
  /** PM 이다. 추가 칸과 지우기 단추를 붙인다 — 아니면 읽기만 한다. 서버의 별칭 추가·삭제가 PM 전용이다 */
  canManage: boolean
}

/**
 * 팀원 한 명의 별칭 (#523). 칩마다 어디서 왔는지 적는다. 잘못 배운 별칭은 고칠 수 없어 지우는 것이 바로잡는 길이다 —
 * 회의에서 배운 별칭의 안전망이다. 확인 전인 별칭(Discord 닉네임)은 출처 옆에 `미확인` 을 붙인다
 */
export function MemberAliasPanel({ workspaceId, member, state, canManage }: MemberAliasPanelProps) {
  const actions = useMemberAliasActions(workspaceId, member.id)
  const [text, setText] = useState('')

  if (state.status === 'loading')
    return (
      <div className={PANEL}>
        <p className={NOTE}>별칭을 불러오는 중이에요.</p>
      </div>
    )
  if (state.status === 'error')
    return (
      <div className={PANEL}>
        <div className="flex flex-wrap items-center gap-8">
          <span className={NOTE}>{ALIAS_LOAD_FAILED}</span>
          <Button size="sm" variant="ghost" onClick={state.retry}>
            {COMMON_MESSAGES.retry}
          </Button>
        </div>
      </div>
    )

  const feedback = actions.addFeedback
  return (
    <div className={PANEL}>
      {state.aliases.length === 0 ? (
        <p className={NOTE}>{ALIAS_EMPTY}</p>
      ) : (
        <ul className={CHIPS} aria-label={`${member.displayName}의 별칭`}>
          {state.aliases.map((alias) => (
            <li key={alias.id} className={CHIP}>
              <span className={CHIP_TEXT}>{alias.text}</span>
              <span className={CHIP_TAG}>
                {ALIAS_SOURCE_LABEL[alias.source]}
                {alias.verified ? null : ` · ${ALIAS_UNVERIFIED}`}
              </span>
              {canManage ? (
                <button
                  type="button"
                  className={CHIP_REMOVE}
                  aria-label={`'${alias.text}' 별칭 지우기`}
                  disabled={actions.removing}
                  onClick={() => actions.remove(alias)}
                >
                  <Icon name="close" size={12} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form
          className="flex items-start gap-8"
          onSubmit={(event) => {
            event.preventDefault()
            actions.add(text, () => setText(''))
          }}
        >
          <TextField
            className="min-w-[0px] flex-1"
            aria-label={`${member.displayName}의 새 별칭`}
            placeholder="새 별칭"
            autoComplete="off"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              actions.clearAddFeedback()
            }}
            error={feedback?.kind === 'failed' ? feedback.message : undefined}
            description={feedback?.kind === 'exists' ? ALIAS_EXISTS : undefined}
          />
          {/* 입력 칸(42px)과 높이를 맞춘다 */}
          <Button
            type="submit"
            size="lg"
            className="min-h-[42px]"
            disabled={text.trim() === ''}
            loading={actions.adding}
          >
            추가
          </Button>
        </form>
      ) : null}
    </div>
  )
}
