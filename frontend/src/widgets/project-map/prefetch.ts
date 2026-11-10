import type { QueryClient } from '@tanstack/react-query'
import { projectMapQueryOptions } from '@/entities/project-map'

/**
 * 프로젝트 맵의 첫 화면 조회를 미리 받는다 (#536, #551).
 * 이 파일은 화면 코드와 따로 부를 수 있는 입구다 — 셸이 정적으로 가져와도 맵 화면과 배치 라이브러리(d3-force)가 첫 번들에 끼지 않는다.
 * 주제 패널은 노드를 골라야 열려 받지 않는다. 이미 받은 값은 다시 받지 않고(`prefetchQuery`) 실패는 삼킨다
 */
export async function prefetchProjectMap(
  queryClient: QueryClient,
  { workspaceId }: { workspaceId: string },
): Promise<void> {
  await queryClient.prefetchQuery(projectMapQueryOptions(workspaceId))
}
