import { act, screen, within } from '@testing-library/react'
import { paths } from '@/shared/config/routes'
import { db, replaceDb } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import type { MockNotification } from '@/shared/mock/fixtures/notification'
import { createScenarioDb } from '@/shared/mock/scenarios'
import { addHistory } from '@/shared/mock/task-state'
import { renderApp } from './test/renderApp'

/*
 * #344 답장 판단은 봇이 늦게 끝낸다. 화면을 연 채 판단 결과가 오면 알림 종이 받은 판단 알림으로
 * 태스크·태스크 기록·승인 목록을 다시 받는다. 판단 실패·시간 초과도 BE 가 막힘을 풀 수 있어 태스크를 다시 받는다
 */

vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
async function until(check: () => void): Promise<void> {
  for (let waited = 0; ; waited += 20) {
    try {
      check()
      return
    } catch (error) {
      if (waited >= 2_000) throw error
      await pause(20)
    }
  }
}

function taskOf(taskId: string) {
  const found = db.tasks.find(({ task_id }) => task_id === taskId)
  if (!found) throw new Error(`mock task ${taskId} is missing`)
  return found
}

function notify(id: string, kind: string, link: MockNotification['link']) {
  db.notifications.push({
    notification_id: id,
    workspace_id: 'ws_01',
    member_id: 'mb_01',
    kind,
    text: '박민수 답장을 판단했어요',
    link,
    read_at: null,
    created_at: MOCK_NOW,
  })
}

/** PM 이 mg_05 를 회원가입 화면(tk_02)으로 고른 뒤 봇이 다시 판단해 완료로 바꿨다 */
function judgeSignupDone() {
  const task = taskOf('tk_02')
  const entry = addHistory('tk_02', 'status', task.status, 'done', null, 'reminder_reply')
  task.status = 'done'
  task.version += 1
  db.replies.changes.push({
    change_id: 'rc_05',
    message_id: 'mg_05',
    task_id: 'tk_02',
    field: 'status',
    new_value: 'done',
    evidence_status: 'certain',
    summary: '회원가입 화면을 다 했대요',
    evidence_quote: '거의 다 됐어요',
    outcome: 'applied',
    approval_id: null,
  })
  db.replies.historyLinks[entry.history_id] = 'rc_05'
}

const status = () => screen.getByTestId('task-status')
const summaryValue = (label: string) =>
  within(screen.getByLabelText('현황 요약')).getByRole('link', { name: new RegExp(`^${label} `) })

describe('답장 판단 알림으로 태스크·승인 다시 받기 (#344)', () => {
  it('태스크 상세를 연 채 판단이 끝나면 상태와 태스크 기록이 바뀐다', async () => {
    replaceDb(createScenarioDb('reply-judgment'))
    renderApp(paths.tasks('ws_01', 'tk_02'))
    await until(() => expect(status()).toHaveTextContent('할 일'))
    await pause(150)

    judgeSignupDone()
    notify('nt_40', 'reply_judged', { type: 'task', id: 'tk_02' })
    await advance(30_000)

    await until(() => expect(status()).toHaveTextContent('완료'))
    const history = screen.getByRole('list', { name: '변경 이력' })
    await until(() =>
      expect(within(history).getByText('거의 다 됐어요. 내일 오전에 올릴게요')).toBeVisible(),
    )
  })

  it('대시보드를 연 채 판단이 승인 요청을 만들면 확인 대기 수가 늘어난다', async () => {
    replaceDb(createScenarioDb('reply-judgment'))
    renderApp(paths.dashboard('ws_01'))
    await until(() => expect(summaryValue('확인 대기')).toHaveAccessibleName('확인 대기 5'))
    await pause(150)

    db.approvals.push({
      ...structuredClone(db.approvals.find(({ approval_id }) => approval_id === 'ap_31')!),
      approval_id: 'ap_33',
      related_task_id: 'tk_02',
    })
    notify('nt_41', 'reply_judged', { type: 'thread', id: 'th_02' })
    await advance(30_000)

    await until(() => expect(summaryValue('확인 대기')).toHaveAccessibleName('확인 대기 6'))
  })

  it('판단하지 못한 답장 알림에도 태스크를 다시 받는다 — 막힘이 풀렸을 수 있다', async () => {
    replaceDb(createScenarioDb('tasks-default'))
    renderApp(paths.tasks('ws_01', 'tk_03'))
    await until(() => expect(status()).toHaveTextContent('막힘'))
    await pause(150)

    taskOf('tk_03').status = 'in_progress'
    notify('nt_42', 'reply_unjudged', { type: 'thread', id: 'th_01' })
    await advance(30_000)

    await until(() => expect(status()).toHaveTextContent('진행 중'))
  })
})
