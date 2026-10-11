import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { clearTrackedMeetings } from '@/entities/meeting'
import { WORKSPACE_LIST_QUERY_KEY } from '@/entities/workspace'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { handlers } from '@/shared/mock/handlers'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * M6 S4 — 확인 필요 상세·Notion 상태 (계획 §4, AC-05 실 API 분기 · AC-06 · AC-07 · AC-08).
 * Vitest 는 MSW 모드가 아니다(VITE_ENABLE_MSW 없음) — 화면은 실 API(`live`) 로 동작하고 요청만 MSW handler 가 받는다.
 * 그래서 `보완하기` 가 없고 `task_overrides` 를 보내지 않는다. 개발 MSW 의 보완 흐름은 approvalsMsw.test.tsx 가 본다.
 * 픽스처: ap_01(담당자·마감 없음) · ap_02(마감 없음) · ap_03(담당자 없음) 모두 ws_01 의 대기 생성 승인. ws_01 은 Notion 연동돼 있다.
 */

vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
})

const LIVE_UNSUPPORTED = '지금 서버는 승인 전 보완을 지원하지 않아요.'
const settle = (ms = 80) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

function approvalOf(id: string) {
  const found = db.approvals.find(({ approval_id }) => approval_id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found
}
function taskOf(id: string) {
  const found = db.tasks.find(({ task_id }) => task_id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found
}
function itemOf(id: string) {
  const found = db.extractions.flatMap(({ items }) => items).find(({ item_id }) => item_id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found
}
const patches = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method, path }) => method === 'PATCH' && path.startsWith('/approvals/'))

async function openApproval(id: string, heading = '새 태스크 확인') {
  const app = renderApp(paths.approval('ws_01', id))
  await screen.findByRole('heading', { level: 2, name: heading })
  return app
}
function field(listName: string, term: string): HTMLElement {
  const dt = within(screen.getByLabelText(listName)).getByText(term, { selector: 'dt' })
  return dt.nextElementSibling as HTMLElement
}
const approveButton = () => screen.getByRole('button', { name: '승인' })
const rejectButton = () => screen.getByRole('button', { name: '반려' })
const notionStatus = () => screen.getByTestId('notion-sync-status')

/**
 * PATCH /approvals 응답 시점을 쥔다. 원래 handler 가 처리한다.
 * `processFirst` 면 서버는 먼저 처리를 끝내고 응답만 늦게 보낸다 — 요청 중 로그아웃해도 서버 처리는 성공한 경우다
 */
function holdApprovalPatch({ processFirst = false } = {}) {
  const gate = deferred()
  server.use(
    http.patch('/api/v1/approvals/:approvalId', async ({ request }) => {
      const copy = request.clone()
      if (processFirst) {
        const response = await getResponse(handlers, copy)
        await gate.promise
        return response
      }
      await gate.promise
      return getResponse(handlers, copy)
    }),
  )
  return gate
}

/** tk_01 의 상태를 todo → done 으로 바꾸자는 변경 승인. 지금은 in_progress 라 승인하면 409 APPROVAL_CONFLICT 다 */
function addConflictingUpdate(): void {
  db.approvals.push({
    approval_id: 'ap_04',
    workspace_id: 'ws_01',
    type: 'task_update',
    payload: {
      status: 'done',
      progress: 100,
      base_values: { status: 'todo', progress: 40 },
      meeting_id: 'mt_09',
    },
    related_task_id: 'tk_01',
    requested_by: 'mb_02',
    status: 'pending',
    resolved_by: null,
    created_at: '2026-09-17T03:00:00Z',
    resolved_at: null,
  })
}

describe('읽기 진입과 실 API 의 생성 승인 (AC-05)', () => {
  it('최초 진입은 읽기다. 원문 담당자·마감과 근거(인용·화자·시각)를 확정할 값과 나눠 보인다', async () => {
    await openApproval('ap_02')
    expect(screen.getByRole('heading', { level: 1, name: '확인 필요' })).toBeInTheDocument()
    // 확정할 값 — 담당자는 팀원 이름으로, 비어 있는 마감은 비어 있다고
    expect(field('확정할 값', '제목')).toHaveTextContent('테스트 계획 정리')
    await waitFor(() => expect(field('확정할 값', '담당자')).toHaveTextContent('박민수'))
    expect(field('확정할 값', '마감')).toHaveTextContent('비어 있어요')
    // 원문은 따로다
    expect(field('회의 원문', '원문 담당자')).toHaveTextContent('박민수')
    expect(field('회의 원문', '원문 마감')).toHaveTextContent('다음 주 월요일')
    const evidence = screen.getByRole('figure', { name: '근거' })
    expect(within(evidence).getByText('박민수님이 테스트 계획 정리을 맡기로 했어요.')).toBeVisible()
    expect(evidence).toHaveTextContent('화자 김서연 · 시각 02:45')
    await waitFor(() =>
      expect(within(evidence).getByRole('link', { name: '3주차 정기회의' })).toHaveAttribute(
        'href',
        paths.meetings('ws_01', 'mt_09'),
      ),
    )
    // 편집이 자동으로 열리지 않는다. 실 API 에는 보완 입력 자체가 없다
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: '보완하기' })).toBeNull()
  })

  it('필수값이 없으면 승인을 끄고 사유를 버튼 가까이에 보인다. 반려는 켜져 있고, 반려 본문은 status 뿐이다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
    const log = recordRequests()
    const before = db.tasks.length
    await openApproval('ap_01')
    const reason = `승인하려면 담당자·마감 정보를 올바르게 채워야 해요. ${LIVE_UNSUPPORTED}`
    await waitFor(() => expect(approveButton()).toHaveAccessibleDescription(reason))
    expect(approveButton()).toBeDisabled()
    expect(screen.getByText(reason)).toBeVisible()
    expect(rejectButton()).toBeEnabled()

    // 꺼진 승인은 눌러도 요청이 없다
    fireEvent.click(approveButton())
    await settle()
    expect(patches(log)).toEqual([])

    await userEvent.click(rejectButton())
    expect(await screen.findByTestId('approval-result')).toHaveTextContent('반려했어요')
    expect(screen.getByText('태스크를 만들지 않았어요.')).toBeVisible()
    expect(bodies).toEqual([{ status: 'rejected' }])
    expect(patches(log)).toHaveLength(1)
    expect(approvalOf('ap_01').status).toBe('rejected')
    expect(db.tasks).toHaveLength(before)
    expect(itemOf('it_04').task_id).toBeNull()
    // 처리된 승인에는 다시 처리할 버튼이 없다
    expect(screen.queryByRole('button', { name: '승인' })).toBeNull()
    expect(screen.queryByRole('button', { name: '반려' })).toBeNull()
  })

  it.each([
    ['담당자', 'ap_03', '승인하려면 담당자 정보를 올바르게 채워야 해요.'],
    ['마감', 'ap_02', '승인하려면 마감 정보를 올바르게 채워야 해요.'],
  ])('%s 하나만 없어도 승인할 수 없다 (%s)', async (_label, id, base) => {
    await openApproval(id)
    await waitFor(() =>
      expect(approveButton()).toHaveAccessibleDescription(`${base} ${LIVE_UNSUPPORTED}`),
    )
    expect(approveButton()).toBeDisabled()
    expect(rejectButton()).toBeEnabled()
  })

  it('필수값이 이미 있으면 보완 없이 승인한다 — 본문에 task_overrides 가 없고, 결과·태스크 링크·반영 상태가 남는다', async () => {
    approvalOf('ap_02').payload.due_date = '2026-09-30'
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_02')
    await openApproval('ap_02')
    await waitFor(() => expect(approveButton()).toBeEnabled())
    expect(approveButton()).not.toHaveAccessibleDescription()

    await userEvent.click(approveButton())
    expect(await screen.findByTestId('approval-result')).toHaveTextContent('승인했어요')
    expect(bodies).toEqual([{ status: 'approved' }])
    const created = approvalOf('ap_02').related_task_id
    expect(created).toBe('tk_90')
    const link = await within(screen.getByLabelText('처리된 태스크')).findByRole('link', {
      name: '테스트 계획 정리',
    })
    expect(link).toHaveAttribute('href', paths.tasks('ws_01', 'tk_90'))
    expect(taskOf('tk_90')).toMatchObject({
      title: '테스트 계획 정리',
      assignee_member_id: 'mb_02',
      due_date: '2026-09-30',
    })
    // 추출 항목에는 task_id 가 들어가고 approval_id 는 남는다
    expect(itemOf('it_05')).toMatchObject({ task_id: 'tk_90', approval_id: 'ap_02' })
    // 승인 성공은 반영 완료가 아니다
    await waitFor(() => expect(notionStatus()).toHaveTextContent('반영 중'))
    expect(screen.queryByText('반영됨')).toBeNull()
  })
})

describe('승인·반려는 서버 성공 뒤에, 한 번만 (AC-05 · AC-06)', () => {
  it('요청 중에는 두 버튼이 잠기고 같은 틱의 두 번째 누름도 보내지 않는다. 응답 전에는 결과를 그리지 않는다', async () => {
    approvalOf('ap_02').payload.due_date = '2026-09-30'
    const gate = holdApprovalPatch()
    const log = recordRequests()
    await openApproval('ap_02')
    await waitFor(() => expect(approveButton()).toBeEnabled())

    act(() => {
      fireEvent.click(approveButton())
      fireEvent.click(approveButton())
      fireEvent.click(rejectButton())
    })
    await waitFor(() => expect(approveButton()).toBeDisabled())
    expect(rejectButton()).toBeDisabled()
    await settle()
    expect(patches(log)).toHaveLength(1)
    expect(screen.queryByTestId('approval-result')).toBeNull()
    expect(screen.getByText(/^확인 대기/)).toBeVisible()

    act(() => gate.resolve())
    expect(await screen.findByTestId('approval-result')).toHaveTextContent('승인했어요')
    await settle()
    expect(patches(log)).toHaveLength(1)
  })

  it('실패하면 자동으로 다시 보내지 않고 오류를 알린다. 승인은 대기 중 그대로이고 다시 누를 수 있다', async () => {
    approvalOf('ap_02').payload.due_date = '2026-09-30'
    server.use(
      http.patch('/api/v1/approvals/:approvalId', () => fail('INTERNAL_ERROR', 'boom', 500)),
    )
    const log = recordRequests()
    const before = db.tasks.length
    await openApproval('ap_02')
    await waitFor(() => expect(approveButton()).toBeEnabled())
    await userEvent.click(approveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 문제가 생겼어요')
    // 조회 재시도 간격(1초)보다 오래 기다려도 mutation 은 다시 가지 않는다
    await settle(1_300)
    expect(patches(log)).toHaveLength(1)
    expect(approvalOf('ap_02').status).toBe('pending')
    expect(db.tasks).toHaveLength(before)
    expect(screen.queryByTestId('approval-result')).toBeNull()
    expect(approveButton()).toBeEnabled()
  })

  it('이미 처리된 승인은 재처리하지 않고 지금 결과를 보여 준다', async () => {
    const log = recordRequests()
    await openApproval('ap_01')
    await waitFor(() => expect(rejectButton()).toBeEnabled())
    // 다른 PM 이 먼저 반려했다
    Object.assign(approvalOf('ap_01'), {
      status: 'rejected',
      resolved_by: 'mb_01',
      resolved_at: MOCK_NOW,
    })
    await userEvent.click(rejectButton())

    expect(await screen.findByTestId('approval-result')).toHaveTextContent('반려했어요')
    expect(screen.getByText('이미 처리된 확인 요청이에요. 지금 결과를 보여 드려요.')).toBeVisible()
    await settle(300)
    expect(patches(log)).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '반려' })).toBeNull()
  })

  it('처리된 승인으로 들어오면 결과만 보이고 처리 버튼이 없다', async () => {
    Object.assign(approvalOf('ap_03'), {
      status: 'rejected',
      resolved_by: 'mb_01',
      resolved_at: MOCK_NOW,
    })
    const log = recordRequests()
    await openApproval('ap_03')
    expect(screen.getByTestId('approval-result')).toHaveTextContent('반려했어요')
    expect(screen.getByLabelText('요청한 값')).toBeVisible()
    expect(screen.queryByRole('button', { name: '승인' })).toBeNull()
    expect(screen.queryByRole('button', { name: '반려' })).toBeNull()
    await settle()
    expect(patches(log)).toEqual([])
  })

  it('지원하지 않는 종류는 읽기 전용이고 승인 액션이 없다', async () => {
    db.approvals.push({
      ...approvalOf('ap_01'),
      approval_id: 'ap_05',
      type: 'reminder_dm',
      payload: { message: '내일까지 부탁해요' },
    })
    const log = recordRequests()
    await openApproval('ap_05', '지원하지 않는 확인 요청')
    expect(screen.getByText('reminder_dm')).toBeVisible()
    expect(screen.getByText('지원하지 않는 확인 요청이라 여기서 처리할 수 없어요.')).toBeVisible()
    expect(screen.queryByRole('button', { name: '승인' })).toBeNull()
    expect(screen.queryByRole('button', { name: '반려' })).toBeNull()
    await settle()
    expect(patches(log)).toEqual([])
  })

  it('없는 승인은 찾을 수 없다고 알린다', async () => {
    renderApp(paths.approval('ws_01', 'ap_99'))
    expect(await screen.findByRole('heading', { name: '확인 요청을 찾을 수 없어요' })).toBeVisible()
  })
})

describe('변경 승인의 비교와 충돌 재확인 (AC-06)', () => {
  function conflictRows(): string[][] {
    return within(screen.getByRole('table', { name: '충돌한 항목' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''))
  }

  it('현재값과 제안값을 비교한다', async () => {
    addConflictingUpdate()
    await openApproval('ap_04', '태스크 변경 확인')
    const table = screen.getByRole('table', { name: '현재값과 제안값' })
    await waitFor(() =>
      expect(
        within(table)
          .getAllByRole('row')
          .map((row) => row.textContent),
      ).toEqual(['항목현재값제안값', '상태진행 중완료', '진행률40%100%']),
    )
    expect(screen.getByRole('link', { name: '로그인 API 연동' })).toHaveAttribute(
      'href',
      paths.tasks('ws_01', 'tk_01'),
    )
  })

  it('충돌은 기준값·현재값·제안값과 충돌 필드를 보이고, PM 이 다시 누를 때만 서버 버전을 보낸다. 다시 충돌하면 새 충돌을 보이고 자동으로 보내지 않는다', async () => {
    addConflictingUpdate()
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_04')
    const log = recordRequests()
    await openApproval('ap_04', '태스크 변경 확인')
    await waitFor(() => expect(approveButton()).toBeEnabled())
    const firstVersion = taskOf('tk_01').version

    // 1) 첫 승인 — 충돌
    await userEvent.click(approveButton())
    expect(
      await screen.findByRole('heading', { name: '제안한 뒤에 태스크가 바뀌었어요' }),
    ).toBeVisible()
    expect(conflictRows()).toEqual([['상태', '할 일', '진행 중', '완료']])
    await settle(300)
    expect(bodies).toEqual([{ status: 'approved' }])
    expect(patches(log)).toHaveLength(1)
    expect(approvalOf('ap_04').status).toBe('pending')

    // 그 사이 누군가 다시 바꿨다
    Object.assign(taskOf('tk_01'), { status: 'blocked', version: firstVersion + 1 })

    // 2) 확인하고 재승인 — 서버가 준 버전을 싣는다. 다시 충돌한다
    await userEvent.click(screen.getByRole('button', { name: '지금 값을 확인했어요, 다시 승인' }))
    await waitFor(() => expect(conflictRows()).toEqual([['상태', '할 일', '막힘', '완료']]))
    await settle(300)
    expect(bodies).toEqual([
      { status: 'approved' },
      { status: 'approved', confirm_task_version: firstVersion },
    ])
    expect(patches(log)).toHaveLength(2)
    expect(taskOf('tk_01').status).toBe('blocked')

    // 3) 새 충돌을 확인하고 다시 승인 — 새 버전으로 성공한다
    await userEvent.click(screen.getByRole('button', { name: '지금 값을 확인했어요, 다시 승인' }))
    expect(await screen.findByTestId('approval-result')).toHaveTextContent('승인했어요')
    expect(bodies.at(-1)).toEqual({ status: 'approved', confirm_task_version: firstVersion + 1 })
    expect(patches(log)).toHaveLength(3)
    expect(taskOf('tk_01')).toMatchObject({ status: 'done', progress: 100 })
    expect(within(screen.getByLabelText('처리된 태스크')).getByText('변경된 태스크')).toBeVisible()
    expect(screen.queryByRole('table', { name: '충돌한 항목' })).toBeNull()
  })

  it('충돌 뒤 반려하면 버전 없이 반려만 보내고 태스크는 그대로다', async () => {
    addConflictingUpdate()
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_04')
    await openApproval('ap_04', '태스크 변경 확인')
    await waitFor(() => expect(approveButton()).toBeEnabled())
    await userEvent.click(approveButton())
    await screen.findByRole('table', { name: '충돌한 항목' })
    await userEvent.click(rejectButton())
    expect(await screen.findByTestId('approval-result')).toHaveTextContent('반려했어요')
    expect(bodies).toEqual([{ status: 'approved' }, { status: 'rejected' }])
    expect(taskOf('tk_01').status).toBe('in_progress')
  })
})

describe('승인 뒤 목록·회의록 일관성 (AC-07)', () => {
  it('성공 뒤 태스크 목록·회의록이 다시 받아져 닫힌 승인은 확인 필요에서 빠진다 — approval_id 가 남아도', async () => {
    approvalOf('ap_02').payload.due_date = '2026-09-30'
    const user = userEvent.setup()
    const app = renderApp(paths.meetings('ws_01', 'mt_09'))
    await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
    await user.click(screen.getByRole('tab', { name: /추출된 일/ }))
    expect(
      await within(screen.getByRole('tabpanel')).findByRole('heading', {
        name: '확인이 필요한 일 3',
      }),
    ).toBeVisible()

    act(() => app.navigate(paths.tasks('ws_01')))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^확인 필요/ })).toHaveTextContent('3'),
    )

    act(() => app.navigate(paths.approval('ws_01', 'ap_02')))
    await waitFor(() => expect(approveButton()).toBeEnabled())
    await user.click(approveButton())
    expect(await screen.findByTestId('approval-result')).toHaveTextContent('승인했어요')
    expect(itemOf('it_05')).toMatchObject({ task_id: 'tk_90', approval_id: 'ap_02' })

    // 태스크 목록 — 승인은 빠지고 새 태스크가 들어온다
    act(() => app.navigate(paths.tasks('ws_01')))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^확인 필요/ })).toHaveTextContent('2'),
    )
    const list = screen.getByRole('list', { name: '태스크 목록' })
    expect(within(list).getByRole('link', { name: /테스트 계획 정리/ })).toHaveAttribute(
      'href',
      paths.tasks('ws_01', 'tk_90'),
    )

    // 회의록 — 확인이 필요한 일에서 빠지고 반영된 것으로 한 번만 보인다
    act(() => app.navigate(paths.meetings('ws_01', 'mt_09')))
    await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
    await user.click(screen.getByRole('tab', { name: /추출된 일/ }))
    const tasks = screen.getByRole('tabpanel')
    expect(await within(tasks).findByRole('heading', { name: '확인이 필요한 일 2' })).toBeVisible()
    expect(within(tasks).getAllByText('테스트 계획 정리')).toHaveLength(1)
    expect(within(tasks).getByRole('link', { name: '테스트 계획 정리' })).toHaveAttribute(
      'href',
      paths.tasks('ws_01', 'tk_90'),
    )
  })

  it('성공 뒤 승인 목록·상세, 태스크, 추출 캐시를 무효화한다', async () => {
    approvalOf('ap_02').payload.due_date = '2026-09-30'
    const app = await openApproval('ap_02')
    await waitFor(() => expect(approveButton()).toBeEnabled())
    // 지금 그리지 않는 캐시도 미리 채워 둔다 — 활성 관찰자가 없어 무효화는 낡음 표시만 한다
    const keys = [
      ['workspace', 'ws_01', 'extractions', 'ex_01'],
      ['workspace', 'ws_01', 'tasks', 'list'],
      ['workspace', 'ws_01', 'tasks', 'detail', 'tk_02'],
      ['workspace', 'ws_01', 'tasks', 'history', 'tk_02'],
      ['workspace', 'ws_01', 'approvals', { status: 'pending' }],
    ]
    await act(async () => {
      for (const queryKey of keys)
        await app.queryClient.prefetchQuery({ queryKey, queryFn: () => 'old' })
    })
    for (const queryKey of keys)
      expect(app.queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false)
    await userEvent.click(approveButton())
    await screen.findByTestId('approval-result')
    for (const queryKey of keys)
      expect(app.queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
    expect(
      app.queryClient.getQueryData(['workspace', 'ws_01', 'approvals', 'ap_02']),
    ).toMatchObject({ status: 'approved', relatedTaskId: 'tk_90' })
  })

  it('요청 중 로그아웃하면 늦은 성공이 캐시를 다시 만들지 않는다', async () => {
    approvalOf('ap_02').payload.due_date = '2026-09-30'
    const gate = holdApprovalPatch({ processFirst: true })
    const log = recordRequests()
    const app = await openApproval('ap_02')
    await waitFor(() => expect(approveButton()).toBeEnabled())
    await userEvent.click(approveButton())
    await waitFor(() => expect(approvalOf('ap_02').status).toBe('approved'))

    await userEvent.click(screen.getByRole('button', { name: /^내 계정/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await waitFor(() =>
      expect(app.queryClient.getQueryData(WORKSPACE_LIST_QUERY_KEY)).toBeUndefined(),
    )

    act(() => gate.resolve())
    await waitFor(() => expect(log.answered.some(({ method }) => method === 'PATCH')).toBe(true))
    await settle(200)
    expect(
      app.queryClient.getQueryData(['workspace', 'ws_01', 'approvals', 'ap_02']),
    ).toBeUndefined()
    expect(app.queryClient.getQueryData(['workspace', 'ws_01', 'tasks', 'list'])).toBeUndefined()
    // 늦은 성공이 무효화로 다시 조회하지 않는다
    const answered = log.timeline.indexOf('answer PATCH /approvals/ap_02')
    expect(log.timeline.slice(answered + 1).filter((line) => line.startsWith('start'))).toEqual([])
  })
})

describe('Notion 반영 문구 (AC-07)', () => {
  it.each([
    ['pending', '반영 중'],
    ['synced', '반영됨'],
    ['failed', '반영 실패'],
    [null, '반영 상태 없음'],
  ] as const)(
    'notion_sync_status %s → %s. 페이지 ID 가 있어도 문구는 상태만 따른다',
    async (status, label) => {
      Object.assign(taskOf('tk_05'), { notion_sync_status: status, notion_page_id: 'notion_tk_05' })
      renderApp(paths.tasks('ws_01', 'tk_05'))
      await screen.findByRole('heading', { level: 2, name: '회의록 요약 검수' })
      await waitFor(() => expect(notionStatus()).toHaveTextContent(label))
      expect(notionStatus().textContent).toBe(label)
    },
  )

  it('일반 팀원은 반영 실패를 보지만 다시 요청할 수 없다', async () => {
    taskOf('tk_04').notion_sync_status = 'failed'
    setMockRole('member')
    renderApp(paths.tasks('ws_01', 'tk_04'))
    await waitFor(() => expect(notionStatus()).toHaveTextContent('반영 실패'))
    expect(screen.queryByRole('button', { name: '다시 반영하기' })).toBeNull()
  })
})

describe('비인가 승인 URL (AC-08)', () => {
  it('일반 팀원의 승인 URL 은 승인 상세 조회 전에 목록으로 보내고 접근 권한이 없다고 알린다 — 승인 상세 요청 0회', async () => {
    setMockRole('member')
    const log = recordRequests()
    const app = renderApp(paths.approval('ws_01', 'ap_01'))
    await app.expectPath(paths.tasks('ws_01'))
    expect(await screen.findByRole('heading', { level: 1, name: '태스크' })).toBeVisible()
    await waitFor(() =>
      expect(document.querySelector('[data-toast-key="access-denied"]')).toHaveTextContent(
        '접근 권한이 없어요',
      ),
    )
    await settle(300)
    expect(log.started.filter(({ path }) => path === '/approvals/ap_01')).toEqual([])
    expect(log.started.filter(({ path }) => path.startsWith('/approvals'))).toEqual([])
    // 승인 화면을 한 번도 그리지 않았다
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([
      paths.approval('ws_01', 'ap_01'),
      paths.tasks('ws_01'),
    ])
  })

  it('보는 중에 PM 이 아니게 되면 목록으로 가고 승인 상세를 더 묻지 않는다', async () => {
    const log = recordRequests()
    const app = await openApproval('ap_01')
    setMockRole('member')
    await act(() => app.queryClient.refetchQueries({ queryKey: WORKSPACE_LIST_QUERY_KEY }))
    await app.expectPath(paths.tasks('ws_01'))
    const seen = log.started.filter(({ path }) => path === '/approvals/ap_01').length
    await settle(300)
    expect(log.started.filter(({ path }) => path === '/approvals/ap_01')).toHaveLength(seen)
    expect(screen.queryByRole('button', { name: '반려' })).toBeNull()
  })
})
