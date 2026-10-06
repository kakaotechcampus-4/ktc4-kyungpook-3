import { screen, waitFor } from '@testing-library/react'
import { createRoutesFromElements, matchRoutes } from 'react-router'
import { paths } from '@/shared/config/routes'
import { completeMeeting } from '@/shared/mock/meetingFlow'
import { setMockRole } from '@/shared/mock/sessions'
import { businessRequests, recordRequests } from '@/shared/test/requests'
import { renderApp } from '../test/renderApp'
import { appRoutes } from './routes'

/* <Routes> 가 안에서 하는 변환과 같다. 경로 표가 주소를 어떻게 읽는지 직접 본다 */
const tree = createRoutesFromElements(appRoutes)

/** 주소에 걸리는 가장 안쪽 경로 패턴과 그 경로 파라미터 */
function resolve(pathname: string) {
  const matches = matchRoutes(tree, pathname) ?? []
  const patterns = matches.map(({ route }) => route.path).filter((path) => path !== undefined)
  return { pattern: patterns.at(-1), params: matches.at(-1)?.params ?? {} }
}

describe('회의 경로 해석', () => {
  it('upload 는 회의 ID 가 아니라 업로드 경로다', () => {
    const { pattern, params } = resolve(paths.meetingUpload('ws_01'))
    expect(pattern).toBe('meetings/upload')
    expect(params).not.toHaveProperty('meetingId')
  })

  it('처리 경로는 회의 ID 를 읽는다', () => {
    expect(resolve(paths.meetingProcessing('ws_01', 'mt_10'))).toMatchObject({
      pattern: 'meetings/:meetingId/processing',
      params: { workspaceId: 'ws_01', meetingId: 'mt_10' },
    })
  })

  it('기존 meetings/:meetingId? 는 그대로다 — 목록과 상세가 같은 경로다', () => {
    expect(resolve(paths.meetings('ws_01'))).toMatchObject({ pattern: 'meetings/:meetingId?' })
    expect(resolve(paths.meetings('ws_01', 'mt_09'))).toMatchObject({
      pattern: 'meetings/:meetingId?',
      params: { meetingId: 'mt_09' },
    })
  })

  it('upload 뒤에 조각이 더 붙으면 회의 경로가 아니다', () => {
    expect(resolve('/workspaces/ws_01/meetings/upload/extra').pattern).toBe('*')
  })
})

describe('회의 올리기 — PM 전용', () => {
  it('PM 은 업로드 화면에 머문다', async () => {
    // U3: 정리 중 회의(픽스처 mt_10)가 있으면 처리 화면으로 가므로 먼저 끝내 둔다. 제목은 Upload 캔버스 문구다
    completeMeeting('mt_10')
    const app = renderApp(paths.meetingUpload('ws_01'))
    expect(await screen.findByRole('heading', { name: '회의를 올려 주세요' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/meetings/upload')
  })

  it('일반 팀원은 업무 API 0회로 태스크 목록에 가고 접근 권한 토스트를 본다', async () => {
    setMockRole('member')
    const log = recordRequests()
    const app = renderApp(paths.meetingUpload('ws_01'))

    expect(await screen.findByRole('heading', { name: '태스크' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/tasks')
    await waitFor(() =>
      expect(document.querySelectorAll('[data-toast-key="access-denied"]')).toHaveLength(1),
    )
    expect(businessRequests(log.started)).toEqual([])
    expect(screen.queryByRole('heading', { name: '회의를 올려 주세요' })).toBeNull()
  })
})

describe('회의 정리 중 — 팀원 모두', () => {
  it.each(['pm', 'member'] as const)('%s 는 처리 화면을 본다', async (role) => {
    setMockRole(role)
    const app = renderApp(paths.meetingProcessing('ws_01', 'mt_10'))
    // U4 가 자리표시자 제목(`회의 정리 중`)을 Processing 캔버스 제목의 실제 화면으로 바꿨다
    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/meetings/mt_10/processing')
  })
})
