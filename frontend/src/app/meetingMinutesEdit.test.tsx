import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { purgeMeeting } from '@/shared/mock/meetingDeletion'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #551 회의록에서 제목과 전사 줄 고치기 (BE #669, 계약 §4.4.3). 실제 경로 표·MSW handler·request() 를 그대로 탄다.
 * ws_01 의 mt_09(3주차 정기회의) 전사문 다섯 줄을 고친다. 캐시 갱신과 세션 경계는 features/minutes-edit 의 훅 테스트가 본다
 */

vi.setConfig({ testTimeout: 15_000 })

afterEach(() => {
  clearTrackedMeetings()
})

const MT_09 = paths.meetings('ws_01', 'mt_09')
const LINE_1 = '회원가입 화면은 제가 맡겠습니다.'

type Log = ReturnType<typeof recordRequests>
const patches = (log: Log) => log.started.filter(({ method }) => method === 'PATCH')

async function openMinutes() {
  renderApp(MT_09)
  await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
}

async function openTranscript(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: /전사문/ }))
  return screen.getByRole('tabpanel')
}

function minutesList() {
  return within(screen.getByRole('complementary', { name: '회의 목록' })).getByRole('list', {
    name: '정리된 회의',
  })
}

describe('제목 고치기', () => {
  it.each(['pm', 'member'] as const)(
    '%s 도 제목을 고치면 머리·목록이 바뀌고 「고침」에서 처음 제목을 보고 되돌린다',
    async (role) => {
      setMockRole(role)
      const user = userEvent.setup()
      const requests: unknown[] = []
      server.events.on('request:start', async ({ request }) => {
        if (request.method === 'PATCH') requests.push(await request.clone().json())
      })
      onTestFinished(() => server.events.removeAllListeners('request:start'))
      await openMinutes()

      await user.click(screen.getByRole('button', { name: '제목 고치기' }))
      const input = screen.getByRole('textbox', { name: '회의 제목' })
      expect(input).toHaveFocus()
      expect(input).toHaveValue('3주차 정기회의')
      expect(
        screen.getByText('고친 제목은 회의 목록과 프로젝트 맵에도 보여요.'),
      ).toBeInTheDocument()
      await user.clear(input)
      await user.type(input, '3주차 정기 회의{Enter}')

      expect(
        await screen.findByRole('heading', { level: 2, name: '3주차 정기 회의' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '제목 고치기' })).toHaveFocus()
      await waitFor(() =>
        expect(within(minutesList()).getByText('3주차 정기 회의')).toBeInTheDocument(),
      )

      const toggle = screen.getByRole('button', { name: '고친 제목 — 처음 제목 보기' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('처음 제목: 3주차 정기회의')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '처음 제목으로 되돌리기' }))

      expect(
        await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' }),
      ).toBeInTheDocument()
      expect(await screen.findByText('처음 제목으로 되돌렸어요')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /고친 제목/ })).toBeNull()
      expect(screen.getByRole('button', { name: '제목 고치기' })).toHaveFocus()
      expect(requests).toEqual([{ title: '3주차 정기 회의' }, { title: null }])
    },
  )

  it('빈 제목은 보내지 않고 이유를 말한다. Esc 는 고치기를 닫고 단추로 돌아간다', async () => {
    const user = userEvent.setup()
    await openMinutes()
    const log = recordRequests()

    await user.click(screen.getByRole('button', { name: '제목 고치기' }))
    const input = screen.getByRole('textbox', { name: '회의 제목' })
    await user.clear(input)
    await user.type(input, '   ')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(
      expect.stringContaining('제목은 1~200자로 적어 주세요.'),
    )
    await user.type(input, '{Escape}')
    expect(screen.queryByRole('textbox', { name: '회의 제목' })).toBeNull()
    expect(screen.getByRole('button', { name: '제목 고치기' })).toHaveFocus()
    expect(patches(log)).toEqual([])
  })

  it('삭제된 회의(410)는 알리고 회의록 자리를 삭제 안내로 바꾼다', async () => {
    const user = userEvent.setup()
    await openMinutes()
    await user.click(screen.getByRole('button', { name: '제목 고치기' }))
    await user.type(screen.getByRole('textbox', { name: '회의 제목' }), ' (수정)')
    db.meetingDeletions.push({
      meeting_id: 'mt_09',
      workspace_id: 'ws_01',
      deleted_at: MOCK_NOW,
      cleanup_status: 'complete',
      deleted_meeting_ids: ['mt_09'],
    })
    purgeMeeting('mt_09')

    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByText('삭제된 회의라 고칠 수 없어요.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '삭제된 회의예요' })).toBeInTheDocument()
  })
})

describe('발화 고치기', () => {
  it('줄을 눌러 고치면 그 줄에 「고침」이 붙고, 원문을 펼쳐 되돌린다', async () => {
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)

    expect(
      within(panel).getByText('발화를 누르면 잘못 적힌 이름이나 용어를 고칠 수 있어요.'),
    ).toBeInTheDocument()
    const line = within(panel).getByRole('button', { name: LINE_1 })
    expect(line).toHaveAccessibleDescription(
      '발화를 누르면 잘못 적힌 이름이나 용어를 고칠 수 있어요.',
    )
    await user.click(line)
    const field = within(panel).getByRole('textbox', { name: '발화 고치기' })
    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription(
      '원문은 남아요. 이름을 고쳐도 팀원 별칭은 바뀌지 않아요.',
    )
    await user.clear(field)
    await user.type(field, '회원가입 화면은 민수가 맡겠습니다.')
    await user.click(within(panel).getByRole('button', { name: '저장' }))

    const edited = await within(panel).findByRole('button', {
      name: '회원가입 화면은 민수가 맡겠습니다.',
    })
    expect(edited).toHaveFocus()
    const toggle = within(panel).getByRole('button', { name: '고친 발화 — 원문 보기' })
    await user.click(toggle)
    expect(within(panel).getByText(LINE_1)).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: '원래 문장으로 되돌리기' }))

    expect(await within(panel).findByRole('button', { name: LINE_1 })).toHaveFocus()
    expect(within(panel).queryByRole('button', { name: /고친 발화/ })).toBeNull()
    expect(await screen.findByText('원래 문장으로 되돌렸어요')).toBeInTheDocument()
  })

  it('Ctrl+Enter 로 저장하고, 바꾸지 않고 저장하면 보내지 않고 닫는다', async () => {
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    const log = recordRequests()

    await user.click(within(panel).getByRole('button', { name: LINE_1 }))
    await user.click(within(panel).getByRole('button', { name: '저장' }))
    expect(within(panel).queryByRole('textbox')).toBeNull()
    expect(patches(log)).toEqual([])

    await user.click(within(panel).getByRole('button', { name: LINE_1 }))
    await user.type(within(panel).getByRole('textbox'), ' 확인할게요.{Control>}{Enter}{/Control}')
    expect(
      await within(panel).findByRole('button', { name: `${LINE_1} 확인할게요.` }),
    ).toBeInTheDocument()
  })

  it.each([
    [
      '공백만',
      () => undefined,
      '   ',
      '발화를 비워 둘 수 없어요. 고치지 않으려면 취소를 눌러 주세요.',
    ],
    [
      'Python 이 지우는 공백(U+001C)만',
      () => undefined,
      '',
      '발화를 비워 둘 수 없어요. 고치지 않으려면 취소를 눌러 주세요.',
    ],
    [
      '서버 길이 오류(400)',
      () =>
        server.use(
          http.patch('/api/v1/meetings/:meetingId/transcript/:seq', () =>
            fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400),
          ),
        ),
      '고친 문장',
      '발화는 1~10,000자로 적어 주세요.',
    ],
    [
      '없는 줄(404)',
      () =>
        server.use(
          http.patch('/api/v1/meetings/:meetingId/transcript/:seq', () =>
            fail('TRANSCRIPT_LINE_NOT_FOUND', '해당 발화를 찾을 수 없습니다.', 404),
          ),
        ),
      '고친 문장',
      '발화를 찾을 수 없어요. 회의록을 다시 불러왔어요.',
    ],
  ])('%s 은 고치던 글을 두고 문구를 남긴다', async (_label, arrange, text, message) => {
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    arrange()

    await user.click(within(panel).getByRole('button', { name: LINE_1 }))
    const field = within(panel).getByRole('textbox', { name: '발화 고치기' })
    await user.clear(field)
    await user.type(field, text)
    await user.click(within(panel).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(field).toHaveAccessibleDescription(expect.stringContaining(message)))
    expect(field).toHaveValue(text)
  })

  it('응답을 읽지 못하면 실패라 하지 않고 새로고침을 권한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    server.use(http.patch('/api/v1/meetings/:meetingId/transcript/:seq', () => ok({ seq: 'one' })))

    await user.click(within(panel).getByRole('button', { name: LINE_1 }))
    await user.type(within(panel).getByRole('textbox'), '!')
    await user.click(within(panel).getByRole('button', { name: '저장' }))

    expect(
      await screen.findByText('변경 결과를 확인하지 못했어요', {}, { timeout: 5_000 }),
    ).toBeInTheDocument()
    expect(within(panel).queryByRole('alert')).toBeNull()
  })

  it('줄 번호가 없는 줄은 글만 보이고 누를 수 없다', async () => {
    const minutes = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!
    server.use(
      http.get('/api/v1/meetings/:meetingId/minutes', () =>
        ok({
          ...minutes,
          transcript: minutes.transcript.map((line) => ({ ...line, seq: undefined })),
          permissions: { can_review: true, can_undo: true },
        }),
      ),
    )
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)

    expect(within(panel).getByText(LINE_1).tagName).toBe('P')
    expect(within(panel).queryByRole('button', { name: LINE_1 })).toBeNull()
    expect(within(panel).queryByText(/발화를 누르면/)).toBeNull()
  })
})

describe('저장하지 않은 글 (D-138)', () => {
  it('고치던 발화가 있으면 탭·다른 줄·다른 회의로 옮기기 전에 묻는다', async () => {
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    await user.click(within(panel).getByRole('button', { name: LINE_1 }))
    await user.type(within(panel).getByRole('textbox'), ' 추가')

    await user.click(screen.getByRole('tab', { name: /요약/ }))
    await user.click(await screen.findByRole('button', { name: '계속 작성하기' }))
    expect(screen.getByRole('tab', { name: /전사문/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(panel).getByRole('textbox')).toHaveValue(`${LINE_1} 추가`)

    await user.click(within(panel).getByRole('button', { name: '다음 주까지 확인할게요.' }))
    await user.click(await screen.findByRole('button', { name: '계속 작성하기' }))
    expect(within(panel).getByRole('textbox')).toHaveValue(`${LINE_1} 추가`)

    await user.click(within(minutesList()).getByRole('link', { name: /2주차 정기회의/ }))
    await user.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))
    expect(
      await screen.findByRole('heading', { level: 2, name: '2주차 정기회의' }),
    ).toBeInTheDocument()
  })

  it('고치지 않고 연 칸은 묻지 않고 옮긴다', async () => {
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    await user.click(within(panel).getByRole('button', { name: LINE_1 }))

    await user.click(within(panel).getByRole('button', { name: '다음 주까지 확인할게요.' }))

    expect(screen.queryByRole('button', { name: '계속 작성하기' })).toBeNull()
    expect(within(panel).getByRole('textbox')).toHaveValue('다음 주까지 확인할게요.')
  })
})

describe('리뷰 #672 반영', () => {
  it('앞 줄의 저장이 끝나도 그 사이 새로 연 줄의 초안과 포커스는 그대로다', async () => {
    const gate = deferred()
    server.use(
      http.patch('/api/v1/meetings/:meetingId/transcript/:seq', async ({ params }) => {
        await gate.promise
        return ok({
          seq: Number(params.seq),
          text: '앞 줄 고침',
          original_text: LINE_1,
          edited: true,
        })
      }),
    )
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    await user.click(within(panel).getByRole('button', { name: LINE_1 }))
    const first = within(panel).getByRole('textbox', { name: '발화 고치기' })
    await user.clear(first)
    await user.type(first, '앞 줄 고침')
    await user.click(within(panel).getByRole('button', { name: '저장' }))

    await user.click(within(panel).getByRole('button', { name: '다음 주까지 확인할게요.' }))
    await user.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))
    const next = within(panel).getByRole('textbox', { name: '발화 고치기' })
    await user.type(next, ' 새 초안')
    gate.resolve()

    expect(await within(panel).findByRole('button', { name: '앞 줄 고침' })).toBeInTheDocument()
    expect(within(panel).getByRole('textbox', { name: '발화 고치기' })).toHaveValue(
      '다음 주까지 확인할게요. 새 초안',
    )
    expect(within(panel).getByRole('textbox', { name: '발화 고치기' })).toHaveFocus()
  })

  it('고치는 칸을 연 채 원문으로 되돌리면 칸을 닫고, 바꾼 글이 있으면 먼저 묻는다', async () => {
    const stored = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!.transcript[1]
    Object.assign(stored, { text: '이미 고친 문장', edited: true, original_text: LINE_1 })
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    await user.click(within(panel).getByRole('button', { name: '고친 발화 — 원문 보기' }))
    await user.click(within(panel).getByRole('button', { name: '이미 고친 문장' }))
    await user.type(within(panel).getByRole('textbox', { name: '발화 고치기' }), ' 더')

    await user.click(within(panel).getByRole('button', { name: '원래 문장으로 되돌리기' }))
    await user.click(await screen.findByRole('button', { name: '계속 작성하기' }))
    expect(within(panel).getByRole('textbox', { name: '발화 고치기' })).toHaveValue(
      '이미 고친 문장 더',
    )
    expect(stored.edited).toBe(true)

    await user.click(within(panel).getByRole('button', { name: '원래 문장으로 되돌리기' }))
    await user.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))

    expect(await within(panel).findByRole('button', { name: LINE_1 })).toHaveFocus()
    expect(within(panel).queryByRole('textbox')).toBeNull()
    expect(stored).toMatchObject({ text: LINE_1, edited: false })
  })

  it('제목 없던 회의를 되돌리면 회의 상세를 다시 받기 전에도 머리가 제목 없는 회의다', async () => {
    db.meetings.find(({ meeting_id }) => meeting_id === 'mt_09')!.title = null
    db.meetingSummaries.find(({ meeting_id }) => meeting_id === 'mt_09')!.title = null
    db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!.title = null
    const user = userEvent.setup()
    renderApp(MT_09)
    await screen.findByRole('heading', { level: 2, name: '제목 없는 회의' })
    await user.click(screen.getByRole('button', { name: '제목 고치기' }))
    await user.type(screen.getByRole('textbox', { name: '회의 제목' }), '붙인 제목{Enter}')
    await screen.findByRole('heading', { level: 2, name: '붙인 제목' })

    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.get('/api/v1/meetings/:meetingId', async () => {
        await gate.promise
        return fail('INTERNAL_ERROR', '서버 오류', 500)
      }),
    )
    await user.click(screen.getByRole('button', { name: '고친 제목 — 처음 제목 보기' }))
    expect(screen.getByText('처음 제목: 제목 없음')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '처음 제목으로 되돌리기' }))

    expect(await screen.findByText('처음 제목으로 되돌렸어요')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '제목 없는 회의' })).toBeInTheDocument()
  })

  it('Python 이 지우는 공백만인 제목은 보내지 않는다', async () => {
    const user = userEvent.setup()
    await openMinutes()
    const log = recordRequests()
    await user.click(screen.getByRole('button', { name: '제목 고치기' }))
    const input = screen.getByRole('textbox', { name: '회의 제목' })
    await user.clear(input)
    await user.type(input, '')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(patches(log)).toEqual([])
  })
})

describe('리뷰 #672 재리뷰 반영', () => {
  function holdLinePatch() {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.patch('/api/v1/meetings/:meetingId/transcript/:seq', async ({ request, params }) => {
        await gate.promise
        const { text } = (await request.json()) as { text: string | null }
        return ok({
          seq: Number(params.seq),
          text: text ?? LINE_1,
          original_text: text === null ? null : LINE_1,
          edited: text !== null,
        })
      }),
    )
    return gate
  }

  it('되돌리기 응답 전에는 그 줄을 다시 열 수 없고, 응답 뒤 열면 원문이 초안이다', async () => {
    const stored = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!.transcript[1]
    Object.assign(stored, { text: '이미 고친 문장', edited: true, original_text: LINE_1 })
    const gate = holdLinePatch()
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    await user.click(within(panel).getByRole('button', { name: '이미 고친 문장' }))
    await user.click(within(panel).getByRole('button', { name: '고친 발화 — 원문 보기' }))
    await user.click(within(panel).getByRole('button', { name: '원래 문장으로 되돌리기' }))

    const pending = within(panel).getByRole('button', { name: '이미 고친 문장' })
    expect(pending).toHaveAttribute('aria-disabled', 'true')
    expect(pending).toHaveAccessibleDescription('이 발화를 저장하고 있어요.')
    await user.click(pending)
    expect(within(panel).queryByRole('textbox')).toBeNull()

    gate.resolve()
    await user.click(await within(panel).findByRole('button', { name: LINE_1 }))
    expect(within(panel).getByRole('textbox', { name: '발화 고치기' })).toHaveValue(LINE_1)
  })

  it('되돌리기 응답 전에 탭을 갔다 와도 그 줄은 잠겨 있고 저장 중이라고 읽힌다', async () => {
    const stored = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!.transcript[1]
    Object.assign(stored, { text: '이미 고친 문장', edited: true, original_text: LINE_1 })
    const gate = holdLinePatch()
    const user = userEvent.setup()
    await openMinutes()
    let panel = await openTranscript(user)
    await user.click(within(panel).getByRole('button', { name: '고친 발화 — 원문 보기' }))
    await user.click(within(panel).getByRole('button', { name: '원래 문장으로 되돌리기' }))

    await user.click(screen.getByRole('tab', { name: /요약/ }))
    panel = await openTranscript(user)
    const pending = within(panel).getByRole('button', { name: '이미 고친 문장' })
    expect(pending).toHaveAttribute('aria-disabled', 'true')
    expect(pending).toHaveAccessibleDescription('이 발화를 저장하고 있어요.')
    await user.click(pending)
    expect(within(panel).queryByRole('textbox')).toBeNull()

    gate.resolve()
    const reverted = await within(panel).findByRole('button', { name: LINE_1 })
    await waitFor(() => expect(reverted).not.toHaveAttribute('aria-disabled'))
    expect(reverted).toHaveAccessibleDescription(
      '발화를 누르면 잘못 적힌 이름이나 용어를 고칠 수 있어요.',
    )
    await user.click(reverted)
    expect(within(panel).getByRole('textbox', { name: '발화 고치기' })).toHaveValue(LINE_1)
  })

  it('저장 중에는 Esc 로 고치는 칸을 닫지 않는다', async () => {
    holdLinePatch()
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    await user.click(within(panel).getByRole('button', { name: LINE_1 }))
    const field = within(panel).getByRole('textbox', { name: '발화 고치기' })
    await user.type(field, '!')
    await user.click(within(panel).getByRole('button', { name: '저장' }))

    await user.type(field, '{Escape}')

    expect(within(panel).getByRole('textbox', { name: '발화 고치기' })).toHaveValue(`${LINE_1}!`)
  })

  it('저장 응답 전에 다른 줄로 갔다가 돌아와도 저장 중인 줄은 열리지 않는다', async () => {
    const gate = holdLinePatch()
    const user = userEvent.setup()
    await openMinutes()
    const panel = await openTranscript(user)
    await user.click(within(panel).getByRole('button', { name: LINE_1 }))
    const field = within(panel).getByRole('textbox', { name: '발화 고치기' })
    await user.clear(field)
    await user.type(field, '저장 중인 문장')
    await user.click(within(panel).getByRole('button', { name: '저장' }))
    await user.click(within(panel).getByRole('button', { name: '다음 주까지 확인할게요.' }))
    await user.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))
    await user.click(within(panel).getByRole('button', { name: '취소' }))

    const saving = within(panel).getByRole('button', { name: LINE_1 })
    expect(saving).toHaveAttribute('aria-disabled', 'true')
    await user.click(saving)
    expect(within(panel).queryByRole('textbox')).toBeNull()

    gate.resolve()
    await user.click(await within(panel).findByRole('button', { name: '저장 중인 문장' }))
    expect(within(panel).getByRole('textbox', { name: '발화 고치기' })).toHaveValue(
      '저장 중인 문장',
    )
  })
})

describe('리뷰 #672 마지막 반영', () => {
  it('탭을 떠난 사이 실패한 되돌리기는 돌아와도 그 줄 아래 실패 문구가 있고, 다시 열면 지운다', async () => {
    const stored = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!.transcript[1]
    Object.assign(stored, { text: '이미 고친 문장', edited: true, original_text: LINE_1 })
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.patch('/api/v1/meetings/:meetingId/transcript/:seq', async () => {
        await gate.promise
        return fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400)
      }),
    )
    const user = userEvent.setup()
    await openMinutes()
    let panel = await openTranscript(user)
    await user.click(within(panel).getByRole('button', { name: '고친 발화 — 원문 보기' }))
    await user.click(within(panel).getByRole('button', { name: '원래 문장으로 되돌리기' }))
    await user.click(screen.getByRole('tab', { name: /요약/ }))
    gate.resolve()

    panel = await openTranscript(user)
    const line = within(panel).getByRole('button', { name: '이미 고친 문장' })
    await waitFor(() => expect(line).not.toHaveAttribute('aria-disabled'))
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      '발화는 1~10,000자로 적어 주세요.',
    )

    await user.click(line)
    expect(within(panel).queryByRole('alert')).toBeNull()
    await user.click(within(panel).getByRole('button', { name: '취소' }))
    expect(within(panel).queryByRole('alert')).toBeNull()
  })
})
