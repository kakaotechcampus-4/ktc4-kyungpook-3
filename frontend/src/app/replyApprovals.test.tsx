import { screen, waitFor, within } from '@testing-library/react'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { replaceDb } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { createScenarioDb } from '@/shared/mock/scenarios'
import { renderApp } from './test/renderApp'

vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
  replaceDb(createScenarioDb('reply-judgment'))
})
afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
})

describe('리마인드 답장에서 온 변경 승인 (#344)', () => {
  it('회의 대신 팀원 답장을 근거로 보이고, 회의 링크·회의 시각을 만들지 않는다', async () => {
    renderApp(paths.approval('ws_01', 'ap_31'))
    await screen.findByRole('heading', { level: 2, name: '태스크 변경 확인' })

    const reply = screen.getByRole('region', { name: '팀원 답장' })
    expect(within(reply).getByText('마감을 26일로 미루자고 했어요')).toBeVisible()
    const evidence = within(reply).getByRole('figure', { name: '근거' })
    expect(evidence).toHaveTextContent('마감은 26일까지 미뤄도 될까요?')
    await waitFor(() => expect(evidence).toHaveTextContent('리마인드 답장 · 이재환'))
    expect(evidence).not.toHaveTextContent('시각')
    expect(within(evidence).queryByRole('link')).toBeNull()

    const table = screen.getByRole('table', { name: '현재값과 제안값' })
    expect(within(table).getByText('2026-09-26')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '승인' })).toBeEnabled()
  })

  it('회의에서 온 변경 승인에는 답장 근거 칸이 없다', async () => {
    replaceDb(createScenarioDb('approval-conflict'))
    renderApp(paths.approval('ws_01', 'ap_04'))
    await screen.findByRole('heading', { level: 2, name: '태스크 변경 확인' })
    expect(screen.queryByRole('region', { name: '팀원 답장' })).toBeNull()
  })
})
