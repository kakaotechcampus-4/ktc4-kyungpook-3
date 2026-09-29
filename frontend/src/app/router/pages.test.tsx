import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { businessRequests, recordRequests } from '@/shared/test/requests'
import { renderApp } from '../test/renderApp'

describe('예상할 수 있는 조회 실패', () => {
  it('레이아웃은 둔 채 인라인 안내와 다시 시도를 보여 주고, 다시 시도하면 회복한다', async () => {
    server.use(
      http.get('/api/v1/members', () => fail('FORBIDDEN', 'Forbidden: member check failed', 403), {
        once: true,
      }),
    )
    const user = userEvent.setup()
    renderApp('/workspaces/ws_01/members')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('접근 권한이 없어요.')
    expect(alert).not.toHaveTextContent('member check failed')
    // 앱 셸(M4 헤더)이 그대로 남는다
    expect(screen.getByRole('navigation', { name: '주요 화면' })).toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('김서연')).toBeInTheDocument()
  })

  it('5xx 는 1초 뒤 한 번 더 요청한 다음 인라인 안내를 보여 준다', async () => {
    server.use(
      http.get('/api/v1/members', () =>
        fail('INTERNAL_ERROR', 'Traceback (most recent call last)', 500),
      ),
    )
    const log = recordRequests()
    renderApp('/workspaces/ws_01/members')

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert).toHaveTextContent('서버에 문제가 생겼어요')
    expect(alert).not.toHaveTextContent('Traceback')
    expect(businessRequests(log.started)).toHaveLength(2)
  })
})

describe('앱 안의 이탈 확인', () => {
  it('저장하지 않은 설정은 내부 링크 이동을 묻는다', async () => {
    const user = userEvent.setup()
    const app = renderApp('/workspaces/ws_01/settings')
    await user.type(await screen.findByLabelText('워크스페이스 이름'), ' 새 이름')

    await user.click(screen.getByRole('link', { name: '대시보드' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('저장하지 않은 변경 내용이 있어요')
    await user.click(screen.getByRole('button', { name: '계속 작성하기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await app.expectPath('/workspaces/ws_01/settings')
    expect(screen.getByLabelText('워크스페이스 이름')).toHaveValue('카테캠 3팀 새 이름')
    // 대시보드에 들렀다 온 것도 아니다
    expect(screen.getByRole('heading', { name: '설정' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '대시보드' })).not.toBeInTheDocument()
    expect(app.visited().map(({ pathname }) => pathname)).toEqual(['/workspaces/ws_01/settings'])
  })

  it('워크스페이스 목록으로 나가는 이동도 묻고, 버리고 나가면 이어 간다', async () => {
    const user = userEvent.setup()
    renderApp('/workspaces/ws_01/settings')
    await user.type(await screen.findByLabelText('워크스페이스 이름'), ' 새 이름')

    // 워크스페이스 목록은 헤더의 워크스페이스 메뉴 안에 있다 (M4)
    await user.click(screen.getByRole('button', { name: /^워크스페이스 바꾸기/ }))
    await user.click(await screen.findByRole('menuitem', { name: '워크스페이스 목록' }))
    await user.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
  })

  it('다른 공간으로 가는 코드 이동도 관문에서 묻는다', async () => {
    const user = userEvent.setup()
    const app = renderApp('/workspaces/ws_01/settings')
    await user.type(await screen.findByLabelText('워크스페이스 이름'), ' 새 이름')

    act(() => app.navigate('/workspaces/ws_02/dashboard'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await app.expectPath('/workspaces/ws_01/settings')
    expect(screen.getByLabelText('워크스페이스 이름')).toHaveValue('카테캠 3팀 새 이름')
  })

  it('되돌리면 더 묻지 않는다', async () => {
    const user = userEvent.setup()
    renderApp('/workspaces/ws_01/settings')
    await user.type(await screen.findByLabelText('워크스페이스 이름'), ' 새 이름')
    await user.click(screen.getByRole('button', { name: '되돌리기' }))

    await user.click(screen.getByRole('link', { name: '대시보드' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
