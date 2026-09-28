import { useQuery } from '@tanstack/react-query'
import { memberListQueryOptions } from '@/entities/member'
import { useRouteId } from '@/shared/lib/url'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'

const LIST = 'flex flex-col gap-6 text-body text-ink'

/** 가드 뒤 업무 조회·인라인 오류·다시 시도·공간 전환을 보여 주는 최소 화면이다. 실제 화면은 이후 마일스톤이다 */
export function MembersPage() {
  const workspaceId = useRouteId('workspaceId')
  return (
    <PagePlaceholder title="팀원" description="팀원 화면은 이후 마일스톤에서 만들어요.">
      {workspaceId === null ? null : <MemberNames workspaceId={workspaceId} />}
    </PagePlaceholder>
  )
}

function MemberNames({ workspaceId }: { workspaceId: string }) {
  const members = useQuery(memberListQueryOptions(workspaceId))

  if (members.data === undefined) {
    return members.isError ? (
      <QueryErrorState error={members.error} onRetry={() => void members.refetch()} />
    ) : (
      <div aria-busy="true">
        <Skeleton lines={3} />
      </div>
    )
  }
  return (
    <ul className={LIST}>
      {members.data.map((member) => (
        <li key={member.id}>{member.displayName}</li>
      ))}
    </ul>
  )
}
