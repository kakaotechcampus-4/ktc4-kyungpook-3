import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { mergeSourceBundle } from '@/shared/mock/fixtures/message'
import { recordRequestBodies } from '@/shared/test/requests'
import { conversation, current, detail, hold, reviewList, rowTexts } from './test/messageScreen'
import { renderApp } from './test/renderApp'

/*
 * #370 보내기 전 확인의 묶은 태스크 — 하나를 빼거나 메모를 고친다 (계약 §5.7 리마인드 경로).
 * 서버(MSW)가 성공한 뒤에만 화면이 바뀐다. 빼거나 메모를 바꾸면 서버가 문구를 다시 만들고 승인을 푼다.
 * 마지막 태스크를 빼면 묶음이 닫혀 보내지 않음처럼 목록의 다음 항목으로 떠난다.
 * #394 행마다 서버가 만든 재촉 이유와 그 근거(답장·태스크 변경) 링크가 있다
 */

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

async function openBundle(bundleId: string) {
  const app = renderApp(paths.messageReview('ws_01', bundleId))
  await screen.findByRole('heading', { level: 2, name: /보낼까요|보낼 예정인/ })
  await detail().findByRole('radio', { name: /마감 하루 전/ })
  return app
}
const bundleOf = (bundleId: string) => {
  const found = db.messageBundles.find(({ bundle_id }) => bundle_id === bundleId)
  if (!found) throw new Error(`mock bundle ${bundleId} is missing`)
  return found
}
const reminderOf = (bundleId: string, reminderId: string) => {
  const found = bundleOf(bundleId).reminders.find(({ reminder_id }) => reminder_id === reminderId)
  if (!found) throw new Error(`mock reminder ${reminderId} is missing`)
  return found
}
const button = (name: string) => detail().getByRole('button', { name })
const detailPane = () => screen.getByRole('region', { name: '메시지 내용' })
const tasks = () => detail().getByRole('region', { name: /^묶은 태스크/ })
const expectLocked = (element: HTMLElement) =>
  expect(element).toHaveAttribute('aria-disabled', 'true')

describe('태스크 빼기', () => {
  it('확인한 뒤에만 빼고, 남은 태스크로 다시 만든 묶음을 그린다', async () => {
    await openBundle('bd_02')
    await userEvent.click(button("'퍼블리싱' 빼기"))

    const confirm = detail().getByRole('group', {
      name: '빼면 남은 태스크로 문구를 다시 만들어요.',
    })
    expect(confirm).toHaveFocus()
    expect(button("'퍼블리싱' 빼기")).toHaveAttribute('aria-expanded', 'true')
    expectLocked(button('이대로 발송'))
    expectLocked(button('보내지 않음'))
    expectLocked(button('고쳐 쓰기'))
    expectLocked(button("'발표 자료' 메모 고치기"))
    expect(detail().getByText('태스크를 뺄지 정한 뒤에 보낼 수 있어요.')).toBeVisible()
    expect(reminderOf('bd_02', 'rm_02').status).toBe('scheduled')

    const request = hold('/workspaces/ws_01/messages/reminders/rm_02/cancel', 'post')
    await userEvent.click(within(confirm).getByRole('button', { name: '빼기' }))
    await waitFor(() =>
      expect(within(confirm).getByRole('button', { name: '빼기' })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    )
    expect(within(tasks()).getAllByRole('listitem')).toHaveLength(2)
    act(() => request.resolve())

    expect(
      await screen.findByText(
        "'퍼블리싱'을 뺐어요. 문구를 다시 만들었으니 확인하고 승인해 주세요.",
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(within(tasks()).getAllByRole('listitem')).toHaveLength(1))
    expect(detail().getByText('묶은 태스크 1')).toHaveFocus()
    expect(reminderOf('bd_02', 'rm_02').status).toBe('cancelled')
    expect(bundleOf('bd_02')).toMatchObject({ status: 'scheduled', draft_version: 2 })
    expect(button('이대로 발송')).not.toHaveAttribute('aria-disabled')
  })

  it('승인한 묶음이면 승인이 풀린다고 먼저 알리고, 취소하면 그 행의 빼기로 포커스가 돌아간다', async () => {
    Object.assign(bundleOf('bd_02'), { approved: true, approved_at: '2026-09-17T10:00:00+09:00' })
    await openBundle('bd_02')
    await userEvent.click(button("'퍼블리싱' 빼기"))
    expect(
      detail().getByRole('group', {
        name: '빼면 남은 태스크로 문구를 다시 만들어요. 승인이 풀려 다시 승인해야 해요.',
      }),
    ).toBeVisible()

    await userEvent.click(button('취소'))
    expect(detail().queryByRole('group', { name: /^빼면/ })).toBeNull()
    expect(button("'퍼블리싱' 빼기")).toHaveFocus()
    expect(button("'퍼블리싱' 빼기")).toHaveAttribute('aria-expanded', 'false')
    expect(reminderOf('bd_02', 'rm_02').status).toBe('scheduled')
  })

  it('마지막 태스크를 빼면 보내지 않음처럼 묶음이 닫히고 목록의 다음 메시지로 떠난다', async () => {
    const app = await openBundle('bd_01')
    await userEvent.click(button("'API 명세서' 빼기"))
    const confirm = detail().getByRole('group', {
      name: '마지막 태스크예요. 빼면 이재환님에게 이 메시지를 보내지 않아요.',
    })
    await userEvent.click(within(confirm).getByRole('button', { name: '빼고 보내지 않기' }))

    expect(
      await screen.findByText(
        '마지막 태스크를 빼서 이재환님에게 보낼 메시지를 보내지 않기로 했어요.',
      ),
    ).toBeInTheDocument()
    await app.expectSearch('')
    await waitFor(() => expect(rowTexts(reviewList())).toHaveLength(1))
    expect(current()[0]).toHaveTextContent('정하늘')
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(detailPane()).toHaveFocus()
    expect(bundleOf('bd_01').status).toBe('cancelled')
  })

  it('실패하면 묶은 태스크 아래에 다시 시도를 알리고 아무것도 빠지지 않는다', async () => {
    db.messageFailures.actions = true
    await openBundle('bd_02')
    await userEvent.click(button("'퍼블리싱' 빼기"))
    await userEvent.click(
      within(detail().getByRole('group', { name: /^빼면/ })).getByRole('button', { name: '빼기' }),
    )

    const alert = await within(tasks()).findByRole('alert')
    expect(alert).toHaveTextContent('태스크를 빼지 못했어요')
    expect(within(tasks()).getAllByRole('listitem')).toHaveLength(2)
    expect(reminderOf('bd_02', 'rm_02').status).toBe('scheduled')

    db.messageFailures.actions = false
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(within(tasks()).getAllByRole('listitem')).toHaveLength(1))
  })
})

describe('메모 고치기', () => {
  it('지금 메모로 채운 칸을 열고, 바꾼 메모만 저장한다. 저장하면 다시 만든 문구와 승인 풀림을 알린다', async () => {
    Object.assign(bundleOf('bd_02'), { approved: true, approved_at: '2026-09-17T10:00:00+09:00' })
    await openBundle('bd_02')
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_01/messages/reminders/rm_02')
    expect(
      detail().getByRole('heading', { level: 2, name: '보낼 예정인 메시지예요' }),
    ).toBeVisible()
    await userEvent.click(button("'퍼블리싱' 메모 고치기"))

    const field = detail().getByRole('textbox', { name: "'퍼블리싱' 메모" })
    expect(field).toHaveFocus()
    expect(field).toHaveValue('시안 2차 반영분까지')
    expect(field).toHaveAccessibleDescription(/메모를 바꾸면 문구를 다시 만들고 승인이 풀려요\./)
    expectLocked(button('저장'))
    expectLocked(button('보내지 않음'))
    expect(detail().getByText('고친 메모를 저장하거나 취소한 뒤에 보낼 수 있어요.')).toBeVisible()

    await userEvent.clear(field)
    await userEvent.type(field, '  시안 3차까지  ')
    await userEvent.click(button('저장'))

    expect(
      await screen.findByText('메모를 고쳤어요. 문구를 다시 만들었으니 확인하고 승인해 주세요.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(detail().queryByRole('textbox')).toBeNull())
    // 목은 문구를 다시 만들 때 태스크의 지금 제목을 읽는다 — 픽스처의 tk_04 는 '배포 스크립트' 다
    expect(button("'배포 스크립트' 메모 고치기")).toHaveFocus()
    expect(bodies).toEqual([{ note: '시안 3차까지' }])
    expect(await detail().findByText('메모: 시안 3차까지')).toBeVisible()
    expect(
      await detail().findByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' }),
    ).toBeVisible()
    expect(bundleOf('bd_02')).toMatchObject({ approved: false, draft_version: 2 })
  })

  it('비우고 저장하면 메모를 지운다(null)', async () => {
    await openBundle('bd_02')
    const bodies = recordRequestBodies('PATCH', '/workspaces/ws_01/messages/reminders/rm_02')
    await userEvent.click(button("'퍼블리싱' 메모 고치기"))
    await userEvent.clear(detail().getByRole('textbox', { name: "'퍼블리싱' 메모" }))
    await userEvent.click(button('저장'))

    await waitFor(() => expect(reminderOf('bd_02', 'rm_02').note).toBeNull())
    expect(bodies).toEqual([{ note: null }])
  })

  it('없어진 리마인드면 이미 처리됐다고 알리고 다시 받는다', async () => {
    await openBundle('bd_02')
    await userEvent.click(button("'퍼블리싱' 메모 고치기"))
    // 다른 창에서 그 태스크를 이미 뺐다
    reminderOf('bd_02', 'rm_02').status = 'cancelled'
    await userEvent.type(detail().getByRole('textbox', { name: "'퍼블리싱' 메모" }), ' 추가')
    await userEvent.click(button('저장'))

    expect(
      await screen.findByText('이미 처리된 메시지예요. 목록을 다시 불러올게요.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(within(tasks()).getAllByRole('listitem')).toHaveLength(1))
    expect(detail().queryByRole('textbox')).toBeNull()
  })
})

describe('재촉 이유와 근거', () => {
  const rows = () => within(tasks()).getAllByRole('listitem')

  it('태스크 하나인 묶음은 이유 아래에 근거 링크를 둔다 — 태스크 변경이면 그 태스크 상세로 간다', async () => {
    const app = await openBundle('bd_01')
    const [row] = rows()
    expect(
      within(row).getByText(
        "'API 명세서' 마감이 9/24(목)인데, 9/16(수) 이후로 진행 소식이 없어요.",
      ),
    ).toBeVisible()
    const link = within(row).getByRole('link', { name: "'API 명세서' 변경 보기" })
    expect(link).toHaveTextContent('변경 보기')

    await userEvent.click(link)
    await app.expectPath(paths.tasks('ws_01', 'tk_01'))
    expect(await screen.findByLabelText('태스크 정보')).toBeVisible()
  })

  it('여러 태스크 묶음은 행마다 제 이유를 보이고, 진행 소식이 없던 행에는 근거 링크가 없다', async () => {
    await openBundle('bd_02')
    const [publishing, slides] = rows()
    expect(
      within(publishing).getByText('9/16(수)에 태스크를 만든 뒤로 진행 소식이 없어요.'),
    ).toBeVisible()
    expect(
      within(slides).getByText(
        '김서연님이 직접 만든 재촉이에요. 9/15(화)에 태스크를 만든 뒤로 진행 소식이 없어요.',
      ),
    ).toBeVisible()
    expect(within(tasks()).queryByRole('link')).toBeNull()
  })

  it('지운 태스크의 행에는 이유 줄이 없다', async () => {
    Object.assign(reminderOf('bd_02', 'rm_03'), { task_id: null, task_title: null, due_date: null })
    await openBundle('bd_02')
    const [publishing, deleted] = rows()
    expect(within(deleted).getByText('지워진 태스크')).toBeVisible()
    expect(within(deleted).queryByText(/진행 소식이 없어요/)).toBeNull()
    expect(within(publishing).getByText(/진행 소식이 없어요/)).toBeVisible()
  })

  it('답장 보기는 그 대화를 열고 맨 아래 대신 그 답장을 보인다', async () => {
    db.messageBundles.push(structuredClone(mergeSourceBundle))
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    onTestFinished(() => scrolled.mockRestore())
    const app = await openBundle('bd_07')
    const link = within(rows()[0]).getByRole('link', { name: "'ERD 정리' 답장 보기" })
    expect(within(rows()[0]).getByText(/9\/15\(화\) 이후로 진행 소식이 없어요\./)).toBeVisible()

    await userEvent.click(link)
    await app.expectPath(paths.messageThread('ws_01', 'th_01'))
    await app.expectSearch('?message=mg_02')
    expect(await detail().findByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
    const reply = within(conversation()).getByText(/네 확인했습니다\./)
    const shown = scrolled.mock.contexts.filter(
      (element): element is Element => element instanceof Element && element.contains(reply),
    )
    expect(shown).toHaveLength(1)
    expect(shown[0]).not.toHaveTextContent('명세서 작업은 시작하셨나요?')
    expect(scrolled).toHaveBeenCalledWith({ block: 'center' })
  })

  it('같은 대화에서 주소의 메시지가 바뀌면 그 메시지를, 빠지면 맨 아래를 보인다', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    onTestFinished(() => scrolled.mockRestore())
    const app = renderApp(paths.messageThread('ws_01', 'th_01', 'mg_02'))
    const body = await screen.findByRole('region', { name: '대화 내용' })
    const target = (text: RegExp) =>
      scrolled.mock.contexts.filter(
        (element): element is Element =>
          element instanceof Element && element.contains(within(body).getByText(text)),
      )
    await waitFor(() => expect(target(/네 확인했습니다\./)).toHaveLength(1))

    act(() => app.navigate(paths.messageThread('ws_01', 'th_01', 'mg_03')))
    await app.expectSearch('?message=mg_03')
    await waitFor(() => expect(target(/명세서 작업은 시작하셨나요\?/)).toHaveLength(1))

    // jsdom 은 배치를 계산하지 않는다 — 칸의 높이를 주고 맨 아래로 내렸는지 본다
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 640 })
    act(() => app.navigate(paths.messageThread('ws_01', 'th_01')))
    await app.expectSearch('')
    await waitFor(() => expect(body.scrollTop).toBe(640))
  })
})
