import type { DiscordUser } from '@/entities/member'
import { paths } from '@/shared/config/routes'
import { monthDayOf } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import type { Attention } from '../lib/team'
import { LINK_BUTTON, SIDE_CARD, SIDE_TITLE, SMALL_BUTTON } from './teamStyles'

const BODY = 'text-[13px] leading-[1.7] text-ink'
const NOTE = 'text-caption leading-[1.65] text-dim'

/** `먼저 챙길 것` 문장. 조사가 붙는 자리에 태스크 제목을 두지 않는다 */
function AttentionSentence({ attention }: { attention: Attention }) {
  const { kind, member, task, quietSince } = attention
  const due = task.dueDate === null ? null : monthDayOf(task.dueDate)
  return (
    <p className={BODY}>
      <strong className="font-semibold">{member.displayName}</strong>의 {task.title}
      {kind === 'blocked' ? ' 작업이 막혀 있어요.' : null}
      {kind !== 'blocked' && due !== null ? (
        <>
          {' 마감('}
          <span className="tabular-nums">{due}</span>
          {kind === 'overdue' ? ')이 지났어요.' : ')이 다가와요.'}
        </>
      ) : null}
      {quietSince === null ? null : (
        <>
          {' '}
          <span className="tabular-nums">{monthDayOf(quietSince)}</span> 이후 소식이 없어요.
        </>
      )}
    </p>
  )
}

export interface AttentionCardProps {
  workspaceId: string
  attention: Attention
}

/** 먼저 챙길 것 (Team 캔버스). 가장 급한 일 하나와 메시지 화면으로 가는 길이다. 메시지 초안은 메시지 화면이 맡는다 (D-171) */
export function AttentionCard({ workspaceId, attention }: AttentionCardProps) {
  return (
    <section aria-labelledby="team-attention" className={`${SIDE_CARD} gap-14 border-line-strong`}>
      <div className="flex items-center gap-8">
        <Icon name="alert" size={15} className="text-ink" />
        <h2 id="team-attention" className={SIDE_TITLE}>
          먼저 챙길 것
        </h2>
      </div>
      <div className="flex flex-col gap-8">
        <AttentionSentence attention={attention} />
        <GuardedLink to={paths.messages(workspaceId)} className={LINK_BUTTON}>
          메시지 초안 보기
        </GuardedLink>
      </div>
    </section>
  )
}

/** 연결되지 않은 계정 영역의 내용. Discord 미연결·조회 중·실패·목록 */
export type UnlinkedAccountsState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'not_connected' }
  | { status: 'ready'; users: DiscordUser[] }

export interface UnlinkedAccountsCardProps {
  workspaceId: string
  state: UnlinkedAccountsState
  /** PM 만 잇는다. 없으면 `연결` 버튼이 없다 */
  onConnect: (() => void) | null
}

/**
 * 연결되지 않은 계정 (Team 캔버스, D-076). 팀원과 잇지 않은 Discord 사용자다 — 새로 들어온 사람도 여기 보인다 (D-030).
 * 제목에 인원수를 쓰지 않는다 (D-076). `연결` 은 팀원 연결 창을 연다 (D-075 재진입)
 */
export function UnlinkedAccountsCard({ workspaceId, state, onConnect }: UnlinkedAccountsCardProps) {
  return (
    <section aria-labelledby="team-unlinked" className={`${SIDE_CARD} gap-12 border-line`}>
      <h2 id="team-unlinked" className={SIDE_TITLE}>
        연결되지 않은 계정
      </h2>
      {state.status === 'loading' ? (
        <div aria-busy="true">
          <Skeleton lines={2} />
        </div>
      ) : state.status === 'error' ? (
        <QueryErrorState
          error={state.error}
          title="Discord 계정을 불러오지 못했어요"
          onRetry={state.retry}
        />
      ) : state.status === 'not_connected' ? (
        <>
          <p className={NOTE}>Discord를 연결하지 않아 서버의 계정을 불러올 수 없어요.</p>
          {onConnect === null ? null : (
            <GuardedLink to={paths.settings(workspaceId)} className={LINK_BUTTON}>
              설정에서 Discord 연결하기
            </GuardedLink>
          )}
        </>
      ) : state.users.length === 0 ? (
        <p className={NOTE}>모든 Discord 계정이 팀원과 연결돼 있어요.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-12" aria-label="연결되지 않은 Discord 계정">
            {state.users.map((user) => (
              <li key={user.discordUserId} className="flex items-center gap-10">
                <span
                  aria-hidden="true"
                  className="inline-flex h-26 w-26 shrink-0 items-center justify-center rounded-999 border border-faint bg-surface text-[12px] leading-none text-ink"
                >
                  ?
                </span>
                <span className="min-w-[0px] flex-1 truncate text-caption text-sub tabular-nums">
                  {user.username}
                </span>
                {onConnect === null ? null : (
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    aria-label={`연결 — ${user.username}`}
                    onClick={onConnect}
                  >
                    연결
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className={NOTE}>
            이 계정에는 DM을 보낼 수 없어요. 이름을 연결해 두면 회의에서 언급될 때 자동으로
            맞춥니다.
          </p>
        </>
      )}
    </section>
  )
}
