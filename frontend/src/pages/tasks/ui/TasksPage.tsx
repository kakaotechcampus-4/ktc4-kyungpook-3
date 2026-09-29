import { PagePlaceholder } from '@/shared/ui/page-placeholder'

/** `/tasks` 와 `/tasks/:taskId` 가 같은 화면이다. M3 에서는 API 를 부르지 않는다 */
export function TasksPage() {
  return <PagePlaceholder title="태스크" description="태스크 화면은 M6에서 만들어요." />
}
