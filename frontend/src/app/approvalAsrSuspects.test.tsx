import { screen, waitFor, within } from '@testing-library/react'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db, replaceDb } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { createScenarioDb } from '@/shared/mock/scenarios'
import { renderApp } from './test/renderApp'

/*
 * #643 생성 승인 카드가 왜 확인해야 하는지에 전사 오인식 의심을 더한다. 태스크 목록의 확인 필요 카드와 승인 상세의
 * 「확인이 필요한 이유」를 실제 경로·MSW handler 로 본다. 문구 규칙 자체는 entities/approval/lib/asrSuspect.test.ts 가 본다.
 * approval-asr-suspects: ap_01(알림 문구 검토, 보류) 고칠 후보 · ap_02(테스트 계획 정리) 확인 실패 · ap_03(배포 문서 보완) null
 */

vi.mock('@/shared/config/env', () => ({
  config: { apiBaseUrl: '/api/v1', mswEnabled: true },
}))

vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
})

const CANDIDATE = "'애포'는 '배포'일 수 있어요"
const CHECK_FAILED = '전사 확인을 하지 못했어요'
/** 상세는 앞에 「전사」 라벨이 있어 라벨을 되풀이하지 않는다 */
const CHECK_FAILED_LABELED = '확인하지 못했어요'

function payloadOf(id: string) {
  const found = db.approvals.find(({ approval_id }) => approval_id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found.payload
}

/** 태스크 목록의 확인 필요 카드. 제목 링크가 담긴 카드다 */
async function openCards() {
  renderApp(paths.tasks('ws_01'))
  const list = await screen.findByRole('list', { name: '확인 필요 목록' }, { timeout: 3000 })
  return (title: string) => {
    const card = within(list).getByRole('link', { name: title }).closest('article')
    if (!(card instanceof HTMLElement)) throw new Error(`card ${title} is missing`)
    return card
  }
}

async function openReasons(id: string) {
  renderApp(paths.approval('ws_01', id))
  await screen.findByRole('heading', { level: 1, name: '이 태스크, 승인할까요?' })
}
const reasons = () => screen.queryByRole('region', { name: '확인이 필요한 이유' })
const suspectRows = () =>
  within(screen.getByRole('region', { name: '확인이 필요한 이유' }))
    .getAllByRole('listitem')
    .map((row) => row.textContent ?? '')
    .filter((row) => row.startsWith('전사'))

describe('태스크 목록의 확인 필요 카드', () => {
  it('고칠 후보와 확인 실패를 카드마다 한 줄로 보이고, 확인하지 않은 옛 카드(null)에는 없다', async () => {
    replaceDb(createScenarioDb('approval-asr-suspects'))
    const cardOf = await openCards()

    const hold = within(cardOf('알림 문구 검토')).getByRole('list', { name: '전사 확인' })
    expect(
      within(hold)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([CANDIDATE])
    const failed = within(cardOf('테스트 계획 정리')).getByRole('list', { name: '전사 확인' })
    expect(
      within(failed)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([CHECK_FAILED])
    expect(within(cardOf('배포 문서 보완')).queryByRole('list', { name: '전사 확인' })).toBeNull()
  })

  it('확인했고 의심이 없으면([]) 어느 카드에도 전사 줄이 없다', async () => {
    const cardOf = await openCards()
    for (const title of ['알림 문구 검토', '테스트 계획 정리', '배포 문서 보완'])
      expect(within(cardOf(title)).queryByRole('list', { name: '전사 확인' })).toBeNull()
  })

  it('모르는 출처는 버리고 같은 카드의 다른 의심은 보인다', async () => {
    replaceDb(createScenarioDb('approval-asr-suspects'))
    Object.assign(payloadOf('ap_02'), {
      asr_suspects: [
        { word: '애포', source: 'future', candidates: ['배포'] },
        { word: '폴런', source: 'evidence', candidates: ['풀런', '폴른'] },
      ],
    })
    const cardOf = await openCards()
    const rows = within(cardOf('테스트 계획 정리')).getByRole('list', { name: '전사 확인' })
    expect(
      within(rows)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(["'폴런'은 '풀런', '폴른' 중 하나일 수 있어요"])
  })

  it('모양이 틀린 의심은 카드를 깨지 않는다 — 제목과 승인 버튼이 그대로다', async () => {
    replaceDb(createScenarioDb('approval-asr-suspects'))
    Object.assign(payloadOf('ap_02'), { asr_suspects: 'garbage' })
    Object.assign(payloadOf('ap_03'), {
      asr_suspects: [{ word: 3, source: 'title', candidates: [] }, 'oops'],
    })
    const cardOf = await openCards()
    for (const title of ['테스트 계획 정리', '배포 문서 보완']) {
      const card = cardOf(title)
      expect(within(card).getByRole('button', { name: '승인' })).toBeInTheDocument()
      expect(within(card).queryByRole('list', { name: '전사 확인' })).toBeNull()
    }
    expect(
      within(cardOf('알림 문구 검토')).getByRole('list', { name: '전사 확인' }),
    ).toHaveTextContent(CANDIDATE)
  })
})

describe('승인 상세의 「확인이 필요한 이유」', () => {
  it('빠진 값 다음에 전사 줄을 둔다', async () => {
    replaceDb(createScenarioDb('approval-asr-suspects'))
    await openReasons('ap_01')
    await waitFor(() => expect(reasons()).not.toBeNull())
    const rows = within(reasons()!)
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '')
    expect(rows.map((row) => row.slice(0, 2))).toEqual(['담당', '마감', '전사'])
    expect(rows.at(-1)).toBe(`전사${CANDIDATE}`)
  })

  it('확인 실패는 라벨 「전사」를 되풀이하지 않고 알린다', async () => {
    replaceDb(createScenarioDb('approval-asr-suspects'))
    await openReasons('ap_02')
    await waitFor(() => expect(suspectRows()).toEqual([`전사${CHECK_FAILED_LABELED}`]))
  })

  it('빠진 값이 없어도 의심이 있으면 이유를 보인다', async () => {
    replaceDb(createScenarioDb('approval-asr-suspects'))
    Object.assign(payloadOf('ap_02'), { due_date: '2026-09-30' })
    await openReasons('ap_02')
    await waitFor(() =>
      expect(
        within(reasons()!)
          .getAllByRole('listitem')
          .map((row) => row.textContent),
      ).toEqual([`전사${CHECK_FAILED_LABELED}`]),
    )
  })

  it.each([
    ['확인하지 않은 옛 카드(null)', 'approval-asr-suspects'],
    ['의심이 없는 카드([])', 'tasks-default'],
  ] as const)('%s 는 전사 줄이 없다', async (_, scenario) => {
    replaceDb(createScenarioDb(scenario))
    await openReasons('ap_03')
    await waitFor(() => expect(reasons()).not.toBeNull())
    expect(suspectRows()).toEqual([])
  })

  it('빠진 값도 의심도 없으면 이유가 없다', async () => {
    Object.assign(payloadOf('ap_02'), { due_date: '2026-09-30' })
    await openReasons('ap_02')
    await waitFor(() => expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument())
    expect(reasons()).toBeNull()
  })
})
