import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { recordRequestBodies } from '@/shared/test/requests'
import { current, detail, list, reviewList, rowTexts } from './test/messageScreen'
import { renderApp } from './test/renderApp'

/*
 * #370 재촉 만들기 — 메시지 화면의 `새 재촉` 과 태스크 상세의 `재촉` (계약 §5.7 `POST …/messages/reminders`).
 * 서버(MSW)가 그 팀원·시각의 보낼 메시지에 넣는다. 같은 시각의 메시지가 있으면 합쳐 승인이 풀린다.
 * 진입점은 PM 에게만 있다
 */

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

const REMINDERS_PATH = '/workspaces/ws_01/messages/reminders'
const form = () => within(screen.getByRole('group', { name: '재촉 만들기' }))
const submit = () => form().getByRole('button', { name: '재촉 만들기' })

async function openCompose() {
  const app = renderApp(paths.messageCompose('ws_01'))
  await screen.findByRole('heading', { level: 2, name: '새 재촉' })
  return app
}

async function chooseTask(memberName: string, taskLabel: string) {
  await userEvent.selectOptions(
    await form().findByRole('combobox', { name: '받는 사람' }),
    memberName,
  )
  await userEvent.selectOptions(form().getByRole('combobox', { name: '태스크' }), taskLabel)
}

describe('메시지 화면의 새 재촉', () => {
  it('팀원과 그 팀원의 태스크를 고르면 마감 기준 시각이 골라지고, 만들면 그 보낼 메시지로 옮겨 간다', async () => {
    const app = await openCompose()
    const bodies = recordRequestBodies('POST', REMINDERS_PATH)
    expect(list().getByRole('link', { name: '새 재촉' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('group', { name: '재촉 만들기' })).toHaveFocus()
    expect(form().getByText('받을 팀원을 골라 주세요.')).toBeVisible()
    expect(submit()).toHaveAttribute('aria-disabled', 'true')

    await chooseTask('이재환', 'DB 스키마 정리 · 09/22 마감')
    expect(
      await form().findByRole('radio', { name: '마감 하루 전09/21 09:00', checked: true }),
    ).toBeInTheDocument()
    // 이재환은 Discord 가 연결되지 않았다 — 막지 않고 알린다
    expect(
      form().getByText(/이재환님은 Discord가 연결되지 않아 지금은 DM이 나가지 않아요/),
    ).toBeVisible()
    expect(form().getByRole('link', { name: '팀 화면' })).toHaveAttribute(
      'href',
      paths.membersConnect('ws_01'),
    )
    expect(submit()).not.toHaveAttribute('aria-disabled')

    await userEvent.type(
      form().getByRole('textbox', { name: '메모 (선택)' }),
      '  스키마 공유 부탁해요 ',
    )
    await userEvent.click(submit())

    expect(
      await screen.findByText('재촉을 만들었어요. 메시지 화면에서 확인하고 승인해야 나가요.'),
    ).toBeInTheDocument()
    await app.expectSearch('?review=bd_03')
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(
      await detail().findByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' }),
    ).toBeVisible()
    expect(rowTexts(reviewList())).toHaveLength(3)
    expect(current()[0]).toHaveTextContent('이재환')
    expect(bodies).toEqual([
      {
        member_id: 'mb_03',
        task_id: 'tk_03',
        scheduled_at: '2026-09-21T09:00:00+09:00',
        note: '스키마 공유 부탁해요',
      },
    ])
  })

  it('같은 사람·같은 시각의 메시지가 있으면 거기에 넣고 승인이 풀렸다고 알린다', async () => {
    Object.assign(db.messageBundles[0], {
      approved: true,
      approved_at: '2026-09-17T10:00:00+09:00',
    })
    const app = await openCompose()
    await chooseTask('이재환', 'DB 스키마 정리 · 09/22 마감')
    await userEvent.click(await form().findByRole('radio', { name: /직접 정하기/ }))
    fireEvent.change(form().getByLabelText('보낼 날짜와 시각'), {
      target: { value: '2026-09-23T09:00' },
    })
    await userEvent.click(form().getByRole('button', { name: '이 시각으로 정하기' }))
    expect(
      form().getByRole('radio', { name: '직접 정하기09/23 09:00', checked: true }),
    ).toBeInTheDocument()
    await userEvent.click(submit())

    expect(
      await screen.findByText(
        '같은 시각에 이재환님에게 보낼 메시지에 넣었어요. 승인이 풀렸으니 다시 확인하고 승인해 주세요.',
      ),
    ).toBeInTheDocument()
    await app.expectSearch('?review=bd_01')
    expect(await detail().findByText('묶은 태스크 2')).toBeVisible()
    expect(rowTexts(reviewList())).toHaveLength(2)
  })

  it('팀원을 바꾸면 태스크를 비우고, 맡은 진행 중인 태스크가 없으면 그렇게 알린다', async () => {
    db.tasks.find(({ task_id }) => task_id === 'tk_06')!.status = 'done'
    await openCompose()
    await chooseTask('이재환', 'DB 스키마 정리 · 09/22 마감')
    await userEvent.selectOptions(form().getByRole('combobox', { name: '받는 사람' }), '정하늘')
    expect(form().getByRole('combobox', { name: '태스크' })).toHaveValue('')
    expect(form().getByText('정하늘님이 맡은 진행 중인 태스크가 없어요.')).toBeVisible()
    expect(form().getByText('재촉할 태스크를 골라 주세요.')).toBeVisible()
    expect(form().queryByRole('group', { name: '언제 보낼까요?' })).toBeNull()
  })

  it('마감이 지난 태스크는 시각을 직접 골라야 만들 수 있다', async () => {
    await openCompose()
    await chooseTask('박민수', '회원가입 화면 · 09/16 마감')
    expect(await form().findByRole('radio', { name: /마감 하루 전.*지남/ })).toBeDisabled()
    expect(form().getByText('보낼 시각을 골라 주세요.')).toBeVisible()
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
  })

  it('서버가 지난 시각으로 거절하면 다시 시도 없이 시각을 다시 고르라고 알린다', async () => {
    server.use(
      http.post(`/api/v1${REMINDERS_PATH}`, () =>
        fail('REMINDER_SCHEDULED_AT_PASSED', '예정 시각이 지났어요. 시각을 다시 골라 주세요.', 409),
      ),
    )
    const app = await openCompose()
    await chooseTask('이재환', 'DB 스키마 정리 · 09/22 마감')
    await form().findByRole('radio', { name: /마감 하루 전/, checked: true })
    await userEvent.click(submit())

    const alert = await form().findByRole('alert')
    expect(alert).toHaveTextContent('재촉을 만들지 못했어요')
    expect(alert).toHaveTextContent('보낼 시각이 지났어요. 시각을 다시 골라 주세요.')
    expect(within(alert).queryByRole('button', { name: '다시 시도' })).toBeNull()
    await app.expectSearch('?new=reminder')
  })

  it('취소하면 목록으로 돌아간다', async () => {
    const app = await openCompose()
    await userEvent.click(form().getByRole('button', { name: '취소' }))
    await app.expectSearch('')
    expect(screen.queryByRole('group', { name: '재촉 만들기' })).toBeNull()
  })

  it('보낼 메시지도 대화도 없는 빈 화면에서도 새 재촉 만들기로 간다', async () => {
    applyScenario('messages-empty')
    renderApp(paths.messages('ws_01'))
    await userEvent.click(await screen.findByRole('link', { name: '새 재촉 만들기' }))
    expect(await screen.findByRole('heading', { level: 2, name: '새 재촉' })).toBeVisible()
    expect(screen.getByRole('group', { name: '재촉 만들기' })).toBeVisible()
  })
})

describe('태스크 상세의 재촉', () => {
  async function openTask(taskId: string, title: string) {
    renderApp(paths.tasks('ws_01', taskId))
    await screen.findByRole('heading', { level: 2, name: title })
    return within(await screen.findByRole('region', { name: '재촉' }))
  }

  it('담당자에게 보낼 재촉을 만들면 폼을 접고 그 자리에 결과와 메시지 화면 링크를 알린다', async () => {
    const section = await openTask('tk_03', 'DB 스키마 정리')
    const bodies = recordRequestBodies('POST', REMINDERS_PATH)
    await userEvent.click(section.getByRole('button', { name: '재촉 만들기' }))
    expect(form().getByText('이재환')).toBeVisible()
    expect(form().queryByRole('combobox')).toBeNull()
    await form().findByRole('radio', { name: '마감 하루 전09/21 09:00', checked: true })
    await userEvent.click(submit())

    const status = await section.findByRole('status')
    await waitFor(() =>
      expect(status).toHaveTextContent(
        '재촉을 만들었어요. 메시지 화면에서 확인하고 승인해야 나가요.',
      ),
    )
    expect(within(status).getByRole('link', { name: '메시지 화면에서 확인하기' })).toHaveAttribute(
      'href',
      paths.messageReview('ws_01', 'bd_03'),
    )
    expect(screen.queryByRole('group', { name: '재촉 만들기' })).toBeNull()
    expect(section.getByRole('button', { name: '재촉 만들기' })).toHaveFocus()
    expect(bodies).toEqual([
      {
        member_id: 'mb_03',
        task_id: 'tk_03',
        scheduled_at: '2026-09-21T09:00:00+09:00',
        note: null,
      },
    ])
  })

  it('취소하면 폼을 접고 재촉 만들기로 포커스가 돌아간다', async () => {
    const section = await openTask('tk_03', 'DB 스키마 정리')
    await userEvent.click(section.getByRole('button', { name: '재촉 만들기' }))
    await userEvent.click(form().getByRole('button', { name: '취소' }))
    expect(section.getByRole('button', { name: '재촉 만들기' })).toHaveFocus()
  })

  it('담당자가 없거나 완료한 태스크는 만들 수 없는 이유만 보인다', async () => {
    const unassigned = await openTask('tk_07', '온보딩 문구 수정')
    expect(
      unassigned.getByText('담당자가 없어 재촉을 만들 수 없어요. 담당자를 정하면 만들 수 있어요.'),
    ).toBeVisible()
    expect(unassigned.queryByRole('button')).toBeNull()
  })

  it('완료한 태스크는 재촉을 만들지 않는다', async () => {
    const done = await openTask('tk_08', '랜딩 카피')
    expect(done.getByText('완료한 태스크라 재촉을 만들지 않아요.')).toBeVisible()
    expect(done.queryByRole('button')).toBeNull()
  })
})

describe('팀원에게는 진입점이 없다', () => {
  it('메시지 화면에 새 재촉이 없고, 만들기 주소로 와도 평소 화면이다', async () => {
    applyScenario('messages-member')
    renderApp(paths.messageCompose('ws_01'))
    expect(await screen.findByRole('heading', { level: 2, name: '카테캠 3팀 봇' })).toBeVisible()
    expect(screen.queryByRole('link', { name: '새 재촉' })).toBeNull()
    expect(screen.queryByRole('group', { name: '재촉 만들기' })).toBeNull()
  })

  it('태스크 상세에 재촉 영역이 없다', async () => {
    setMockRole('member')
    renderApp(paths.tasks('ws_01', 'tk_03'))
    await screen.findByRole('heading', { level: 2, name: 'DB 스키마 정리' })
    await screen.findByRole('region', { name: '변경 이력' })
    expect(screen.queryByRole('region', { name: '재촉' })).toBeNull()
    expect(screen.queryByRole('button', { name: '재촉 만들기' })).toBeNull()
  })
})
