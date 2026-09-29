import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { fetchDto } from '@/shared/test/api'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import { db } from '../db'
import { MOCK_DB_STORAGE_KEY } from '../persistence'
import { applyScenario } from '../scenarios'
import { MockOAuthPage } from './MockOAuthPage'

const RETURN = '/onboarding/ws_03/connect_discord'

function renderMockOAuth(path: string) {
  const redirect = vi.fn<(url: string) => void>()
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/__mock/oauth/:workspaceId/:provider"
          element={<MockOAuthPage redirect={redirect} />}
        />
      </Routes>
    </MemoryRouter>,
  )
  return redirect
}

const start = (provider: string, state: string = RETURN) =>
  `/__mock/oauth/ws_03/${provider}?${new URLSearchParams({ state }).toString()}`

const discordStatus = async () =>
  (await fetchDto<IntegrationsDto>('/workspaces/ws_03/integrations')).discord.status

beforeEach(() => {
  applyScenario('incomplete-workspace')
})

afterEach(() => {
  sessionStorage.clear()
})

describe('모의 OAuth 화면', () => {
  it('연결 허용: 연동을 connected 로 만들고 state 의 단계로 success 를 들고 돌아간다', async () => {
    const redirect = renderMockOAuth(start('discord'))
    expect(screen.getByRole('heading', { name: '모의 Discord 연결' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '연결 허용' }))

    expect(redirect).toHaveBeenCalledExactlyOnceWith(`${RETURN}?oauth=discord&oauth_result=success`)
    await expect(discordStatus()).resolves.toBe('connected')
  })

  it('현재 탭을 옮기기 전에 sessionStorage 에 쓴다 — 복귀 뒤 새 페이지가 이 상태로 시작한다', async () => {
    const redirect = renderMockOAuth(start('discord'))
    redirect.mockImplementation(() => {
      const stored = JSON.parse(sessionStorage.getItem(MOCK_DB_STORAGE_KEY) ?? 'null') as {
        db: typeof db
      }
      expect(stored.db.integrations.ws_03.discord.status).toBe('connected')
    })
    await userEvent.click(screen.getByRole('button', { name: '연결 허용' }))
    expect(redirect).toHaveBeenCalledOnce()
  })

  it('취소: 연동을 바꾸지 않고 cancelled 를 들고 돌아간다', async () => {
    const redirect = renderMockOAuth(start('notion', '/onboarding/ws_03/connect_notion'))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      '/onboarding/ws_03/connect_notion?oauth=notion&oauth_result=cancelled',
    )
    await expect(
      fetchDto<IntegrationsDto>('/workspaces/ws_03/integrations'),
    ).resolves.toMatchObject({ notion: { status: 'not_connected' } })
  })

  it('실패 재현: 연동을 바꾸지 않고 failed 를 들고 돌아간다', async () => {
    const redirect = renderMockOAuth(start('discord'))
    await userEvent.click(screen.getByRole('button', { name: '실패 재현' }))
    expect(redirect).toHaveBeenCalledExactlyOnceWith(`${RETURN}?oauth=discord&oauth_result=failed`)
    await expect(discordStatus()).resolves.toBe('not_connected')
  })

  it('소속이 아닌 공간은 허용해도 failed 다', async () => {
    applyScenario('no-workspace')
    const redirect = renderMockOAuth(start('discord'))
    await userEvent.click(screen.getByRole('button', { name: '연결 허용' }))
    expect(redirect).toHaveBeenCalledExactlyOnceWith(`${RETURN}?oauth=discord&oauth_result=failed`)
    expect(db.integrations.ws_03).toBeUndefined()
  })

  it('앱 밖으로 나가는 state 는 따르지 않고 처음으로 보낸다', async () => {
    const redirect = renderMockOAuth(start('discord', 'https://evil.example/steal'))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/')
  })

  it('모르는 provider 는 버튼 없이 안내만 한다', () => {
    renderMockOAuth('/__mock/oauth/ws_03/slack?state=%2F')
    expect(
      screen.getByRole('heading', { name: '모의 OAuth 주소가 올바르지 않아요' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
