import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { integrationsQueryOptions } from '@/entities/integration'
import { discordUsersQueryOptions, memberListQueryOptions } from '@/entities/member'
import { taskListQueryOptions } from '@/entities/task'
import { MemberInviteControl } from '@/features/member-invite'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { firstAttention, inactiveMemberIds, tasksByMember, unlinkedDiscordUsers } from '../lib/team'
import { MemberConnectDialog } from './MemberConnectDialog'
import type { MappingSource } from './MemberConnectDialog'
import { MemberSection } from './MemberList'
import { AttentionCard, UnlinkedAccountsCard } from './SideCards'
import type { UnlinkedAccountsState } from './SideCards'
import { WeekAhead } from './WeekAhead'

/* Team 시안 — main 패딩 48/48/72, 블록 사이 22px, 본문은 `1fr | 336px` 두 단(간격 100px) */
const MAIN = 'mx-auto flex w-full max-w-shell flex-1 flex-col gap-22 px-48 pt-48 pb-72'
const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink'
const LEAD = 'text-body text-sub'
const COLUMNS = 'grid grid-cols-[minmax(0px,1fr)_336px] items-start gap-[100px]'
const EMPTY_TASKS: never[] = []

function isNotConnected(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR_CODES.INTEGRATION_NOT_CONNECTED
}

export interface TeamOverviewProps {
  workspaceId: string
  /** 소속 목록의 역할이 PM 이다. 팀원 연결(`팀원 관리`·`연결`)과 초대는 PM 만 한다 — 서버의 팀원 생성·수정·초대가 PM 전용이다 */
  isPm: boolean
  /** 서울 오늘 */
  today: string
  /** 팀원 연결 창이 열려 있다. 주소(`connect=members`)가 쥔다 — 설정의 Discord 연결 성공이 이 상태로 온다 (D-074) */
  connectOpen: boolean
  onConnectOpenChange: (open: boolean) => void
}

/**
 * 팀 화면 (Team 캔버스). 팀원별 상태와 맡은 일 · 먼저 챙길 것 · 연결되지 않은 계정 · 앞으로 7일.
 * 제목에 인원수를 쓰지 않는다 (D-076). 조회는 함께 시작하고, 영역마다 자기 조회의 로딩·실패를 그린다.
 * Discord 사용자는 연동 상태를 몰라도 함께 부른다 — 미연결이면 409 `INTEGRATION_NOT_CONNECTED` 를 미연결 안내로 받는다
 */
export function TeamOverview({
  workspaceId,
  isPm,
  today,
  connectOpen,
  onConnectOpenChange,
}: TeamOverviewProps) {
  const members = useQuery(memberListQueryOptions(workspaceId))
  const tasks = useQuery(taskListQueryOptions(workspaceId))
  const integrations = useQuery(integrationsQueryOptions(workspaceId))
  const discordStatus = integrations.data?.discord.status
  const discordUsers = useQuery({
    ...discordUsersQueryOptions(workspaceId),
    enabled: discordStatus === undefined || discordStatus === 'connected',
  })
  const discordMissing =
    (discordStatus !== undefined && discordStatus !== 'connected') ||
    isNotConnected(discordUsers.error)

  const grouped = useMemo(() => tasksByMember(tasks.data ?? EMPTY_TASKS), [tasks.data])
  const names = useMemo(
    () => new Map((members.data ?? []).map(({ id, displayName }) => [id, displayName])),
    [members.data],
  )
  const inactive = useMemo(
    () =>
      discordUsers.data === undefined || members.data === undefined || discordMissing
        ? new Set<string>()
        : inactiveMemberIds(discordUsers.data, members.data),
    [discordUsers.data, members.data, discordMissing],
  )
  const attention = useMemo(
    () =>
      members.data === undefined || tasks.data === undefined
        ? null
        : firstAttention(members.data, tasks.data, today),
    [members.data, tasks.data, today],
  )

  const retryDiscord = () => {
    void integrations.refetch()
    void discordUsers.refetch()
  }
  const retryMembers = () => void members.refetch()
  // 받은 자료가 없을 때의 실패만 오류다 — 다시 받다 실패해도 열린 창의 입력을 지우지 않는다.
  // 팀원 조회 실패도 본다. 팀원 없이는 줄을 만들 수 없어 창이 뼈대에 머문다
  const mappingSource: MappingSource = discordMissing
    ? { status: 'not_connected' }
    : members.data === undefined && members.error
      ? { status: 'error', error: members.error, retry: retryMembers }
      : discordUsers.data === undefined && discordUsers.error
        ? { status: 'error', error: discordUsers.error, retry: retryDiscord }
        : discordUsers.data === undefined || members.data === undefined
          ? { status: 'loading' }
          : { status: 'ready', discordUsers: discordUsers.data, members: members.data }
  const unlinked: UnlinkedAccountsState =
    mappingSource.status === 'ready'
      ? {
          status: 'ready',
          users: unlinkedDiscordUsers(mappingSource.discordUsers, mappingSource.members),
        }
      : mappingSource

  const listError = members.error ?? tasks.error
  const retryList = () => {
    if (members.isError) void members.refetch()
    if (tasks.isError) void tasks.refetch()
  }

  return (
    <main className={MAIN}>
      <header className="flex items-end justify-between gap-24">
        <div className="flex flex-col gap-5">
          <h1 className={TITLE}>팀</h1>
          <p className={LEAD}>
            진행률은 팀원이 직접 말한 값입니다. 옆에 적힌 기준 날짜를 함께 보세요.
          </p>
        </div>
        {isPm ? (
          <Button
            size="md-compact"
            // 캔버스는 `height:34px; min-height:36px`, 아이콘 간격 7px 이다. 공용 `md-compact` 는 34px·6px 이라 둘을 채운다
            className="min-h-[36px] gap-7"
            startIcon={<Icon name="users" size={15} className="text-sub" />}
            onClick={() => onConnectOpenChange(true)}
          >
            팀원 관리
          </Button>
        ) : null}
      </header>

      <div className={COLUMNS}>
        <div className="flex flex-col gap-[38px]">
          {members.data !== undefined && tasks.data !== undefined ? (
            members.data.map((member) => (
              <MemberSection
                key={member.id}
                member={member}
                tasks={grouped.get(member.id) ?? EMPTY_TASKS}
                today={today}
                inactive={inactive.has(member.id)}
                invite={
                  isPm ? <MemberInviteControl workspaceId={workspaceId} member={member} /> : null
                }
              />
            ))
          ) : listError ? (
            <QueryErrorState error={listError} onRetry={retryList} />
          ) : (
            <div aria-busy="true" className="py-14">
              <Skeleton lines={4} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-14">
          {attention === null ? null : (
            <AttentionCard workspaceId={workspaceId} attention={attention} />
          )}
          {members.isError ? null : (
            <UnlinkedAccountsCard
              workspaceId={workspaceId}
              state={unlinked}
              onConnect={isPm ? () => onConnectOpenChange(true) : null}
            />
          )}
        </div>
      </div>

      {tasks.data === undefined || members.data === undefined ? null : (
        <WeekAhead tasks={tasks.data} names={names} today={today} />
      )}

      {isPm ? (
        <MemberConnectDialog
          workspaceId={workspaceId}
          open={connectOpen}
          onOpenChange={onConnectOpenChange}
          source={mappingSource}
        />
      ) : null}
    </main>
  )
}
