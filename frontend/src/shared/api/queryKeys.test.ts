import { QueryClient } from '@tanstack/react-query'
import { WORKSPACE_SCOPE, workspaceKey } from './queryKeys'

it('두 번째 칸이 workspaceId 다', () => {
  expect(workspaceKey('ws_01', 'members')).toEqual([WORKSPACE_SCOPE, 'ws_01', 'members'])
})

it('한 공간의 key 로 다른 공간의 캐시를 건드리지 않는다', () => {
  const client = new QueryClient()
  client.setQueryData(workspaceKey('ws_01', 'members'), ['김서연'])
  client.setQueryData(workspaceKey('ws_02', 'members'), ['외부인'])

  expect(client.getQueriesData({ queryKey: workspaceKey('ws_02') })).toEqual([
    [workspaceKey('ws_02', 'members'), ['외부인']],
  ])
  client.removeQueries({ queryKey: workspaceKey('ws_01') })
  expect(client.getQueryData(workspaceKey('ws_02', 'members'))).toEqual(['외부인'])
})
