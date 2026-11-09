import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { memberListQueryOptions } from '@/entities/member'
import { failureNotice } from '@/shared/api/errorMessages'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { avatarText } from '../lib/format'
import { useOpenThread } from '../model/useOpenThread'
import { COMPOSE_COLUMN, COMPOSE_PAGE, COMPOSE_TITLE } from './frame'

const MEMBER_ROW =
  'flex w-full items-center gap-10 rounded-10 px-12 py-9 text-left hover:bg-surface-sunken disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent'
const AVATAR =
  'inline-flex size-30 shrink-0 items-center justify-center rounded-999 bg-divider text-[11px] font-semibold text-ink'
const FAILURE = 'text-[12.5px] leading-[1.6] text-accent'

export interface StartThreadDetailProps {
  workspaceId: string
  /** 보는 PM 의 팀원 행. 자기 자신은 고를 수 없다 */
  viewerMemberId: string | null
  /** 스크롤 끝에 둘 여백(px). 마지막 행을 정리 중 토스트 위로 꺼낼 수 있게 한다. 토스트가 없으면 0 */
  toastClearance: number
  onOpened: (threadId: string) => void
}

/** 새 대화 — PM 이 팀원 한 명을 골라 대화를 연다. 있으면 그 대화로, 없으면 빈 대화를 만들어 간다 */
export function StartThreadDetail({
  workspaceId,
  viewerMemberId,
  toastClearance,
  onOpened,
}: StartThreadDetailProps) {
  const headingId = useId()
  const opening = useOpenThread(workspaceId)
  const members = useQuery(memberListQueryOptions(workspaceId))
  const choices = (members.data ?? []).filter(({ id }) => id !== viewerMemberId)
  return (
    <div
      className={COMPOSE_PAGE}
      style={toastClearance > 56 ? { paddingBottom: toastClearance } : undefined}
    >
      <section aria-labelledby={headingId} className={COMPOSE_COLUMN}>
        <div className="flex flex-col gap-8">
          <h2 id={headingId} className={COMPOSE_TITLE}>
            새 대화
          </h2>
          <p className="text-[14px] text-sub">대화할 팀원을 골라 주세요.</p>
        </div>
        <OpenThreadFailure failure={opening.failure} />
        {members.data === undefined && members.error !== null ? (
          <QueryErrorState
            error={members.error}
            title="팀원 목록을 불러오지 못했어요"
            onRetry={() => void members.refetch()}
          />
        ) : (
          <ul aria-label="팀원" className="flex flex-col gap-4">
            {choices.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  className={MEMBER_ROW}
                  disabled={opening.pending}
                  onClick={() => opening.open(member.id, (thread) => onOpened(thread.id))}
                >
                  <span aria-hidden="true" className={AVATAR}>
                    {avatarText(member.displayName)}
                  </span>
                  <span className="text-control font-semibold wrap-anywhere text-ink">
                    {member.displayName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** 대화를 열지 못했다. 취소된 요청은 알리지 않는다 — 다시 누르면 다시 연다 */
export function OpenThreadFailure({ failure }: { failure: unknown }) {
  const text = failure === null ? null : failureNotice(failure)
  if (text === null) return null
  return (
    <p role="alert" className={FAILURE}>
      대화를 열지 못했어요. {text}
    </p>
  )
}
