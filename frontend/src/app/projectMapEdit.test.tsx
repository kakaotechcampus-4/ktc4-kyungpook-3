import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { workspaceKey } from '@/shared/api/queryKeys'
import { endSessionScope } from '@/shared/api/sessionScope'
import { paths } from '@/shared/config/routes'
import { COMPACT_QUERY } from '@/shared/lib/compact-screen'
import { fail, ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { stubViewport } from '@/shared/test/viewport'
import { renderApp } from './test/renderApp'

/*
 * #551 묶음 B — 프로젝트 맵 주제 패널에서 주제·결정 고치기. 픽스처 ws_01 의 배포·인프라(tp_02)는 결정 둘(dc_03 유효,
 * dc_04 팀원이 유효하지 않다고 표시)과 태스크 둘(DB 스키마 정리, 배포 스크립트)이다. 로그인·계정(tp_01)의 dc_01 은 dc_02 가 뒤집었다
 */

vi.setConfig({ testTimeout: 15_000 })
const FIRST_PAINT = { timeout: 5_000 }
const WS = 'ws_01'
const SERVER_ERROR = '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'

const panel = () => screen.getByRole('complementary', { name: '고른 항목' })
const decisionRow = (text: string) =>
  within(within(panel()).getByRole('region', { name: '결정' }))
    .getByText(text)
    .closest('li')!
const menuOf = (text: string) =>
  within(panel()).getByRole('button', { name: `결정 고치기: ${text}` })

async function openTopic(name: string) {
  const app = renderApp(`${paths.projectMap(WS)}?view=list`)
  await screen.findByRole('heading', { level: 2, name: '로그인·계정' }, FIRST_PAINT)
  await userEvent.click(screen.getByRole('button', { name }))
  await within(panel()).findByRole('region', { name: '결정' })
  return app
}

/** 이 테스트 동안 GET 이 아닌 요청의 JSON 본문 */
function recordBodies(): { method: string; path: string; body: unknown }[] {
  const bodies: { method: string; path: string; body: unknown }[] = []
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'GET') return
    const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '')
    void request
      .clone()
      .text()
      .then((text) =>
        bodies.push({ method: request.method, path, body: text ? JSON.parse(text) : null }),
      )
  }
  server.events.on('request:start', listener)
  onTestFinished(() => server.events.removeListener('request:start', listener))
  return bodies
}

async function rename(name: string) {
  await userEvent.click(within(panel()).getByRole('button', { name: '이름·설명 고치기' }))
  const field = within(panel()).getByRole('textbox', { name: '이름' })
  expect(field).toHaveFocus()
  await userEvent.clear(field)
  await userEvent.type(field, name)
  await userEvent.click(within(panel()).getByRole('button', { name: '저장' }))
}

async function chooseMenu(decision: string, item: string) {
  await userEvent.click(menuOf(decision))
  await userEvent.click(await screen.findByRole('menuitem', { name: item }))
}

describe('주제 이름·설명 고치기 (#551)', () => {
  it('이름을 고치면 패널이 응답으로 바뀌고 맵·회의록을 다시 받는다. 포커스는 고치기 단추에 남는다', async () => {
    const app = await openTopic('배포·인프라')
    const minutes = workspaceKey(WS, 'minutes', 'mt_09')
    app.queryClient.setQueryData(minutes, { cached: true })
    const log = recordRequests()
    const bodies = recordBodies()

    await rename('  배포 절차 ')
    expect(await within(panel()).findByText('팀원이 고친 주제예요.')).toBeVisible()
    const edit = within(panel()).getByRole('button', { name: '이름·설명 고치기' })
    expect(edit).toHaveFocus()
    expect(
      await within(panel()).findByRole('heading', { level: 2, name: '배포 절차' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '배포 절차' })).toBeVisible()
    expect(edit).toHaveFocus()

    expect(bodies).toEqual([
      { method: 'PATCH', path: '/workspaces/ws_01/topics/tp_02', body: { name: '배포 절차' } },
    ])
    expect(log.started).toContainEqual({ method: 'GET', path: '/workspaces/ws_01/project-map' })
    expect(app.queryClient.getQueryState(minutes)?.isInvalidated).toBe(true)
  })

  it('설명만 고치면 설명만 보내고 회의록은 그대로 둔다. 바뀐 것이 없으면 보내지 않고 닫는다', async () => {
    const app = await openTopic('배포·인프라')
    const minutes = workspaceKey(WS, 'minutes', 'mt_09')
    app.queryClient.setQueryData(minutes, { cached: true })
    const bodies = recordBodies()

    await userEvent.click(within(panel()).getByRole('button', { name: '이름·설명 고치기' }))
    await userEvent.click(within(panel()).getByRole('button', { name: '저장' }))
    expect(within(panel()).queryByRole('form', { name: '주제 고치기' })).toBeNull()

    await userEvent.click(within(panel()).getByRole('button', { name: '이름·설명 고치기' }))
    const description = within(panel()).getByRole('textbox', { name: '설명' })
    await userEvent.clear(description)
    await userEvent.type(description, '배포 절차만 다룬다.')
    await userEvent.click(within(panel()).getByRole('button', { name: '저장' }))
    expect(await within(panel()).findByText('배포 절차만 다룬다.')).toBeVisible()

    expect(bodies).toEqual([
      {
        method: 'PATCH',
        path: '/workspaces/ws_01/topics/tp_02',
        body: { description: '배포 절차만 다룬다.' },
      },
    ])
    expect(app.queryClient.getQueryState(minutes)?.isInvalidated).toBe(false)
  })

  it('빈 이름은 보내지 않고 칸에 알린다. 취소하면 고치기 단추로 돌아온다', async () => {
    await openTopic('배포·인프라')
    const bodies = recordBodies()
    await rename(' ')
    expect(within(panel()).getByRole('textbox', { name: '이름' })).toHaveAccessibleDescription(
      '이름을 써 주세요.',
    )
    await userEvent.click(within(panel()).getByRole('button', { name: '취소' }))
    expect(within(panel()).getByRole('button', { name: '이름·설명 고치기' })).toHaveFocus()
    expect(bodies).toEqual([])
  })

  it('다른 주제가 쓰는 이름이면 그 주제를 알리고, 이 주제와 합치기로 그 주제에 합친다', async () => {
    await openTopic('배포·인프라')
    const log = recordRequests()
    await rename('로그인 계정')
    expect(await within(panel()).findByRole('alert')).toHaveTextContent(
      '「로그인·계정」 주제가 이미 있어요.',
    )

    await userEvent.click(within(panel()).getByRole('button', { name: '이 주제와 합치기' }))
    let dialog = await screen.findByRole('dialog', { name: '다른 주제와 합칠까요?' })
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(panel()).getByRole('textbox', { name: '이름' })).toHaveValue('로그인 계정')
    const suggest = within(panel()).getByRole('button', { name: '이 주제와 합치기' })
    await waitFor(() => expect(suggest).toHaveFocus())

    await userEvent.click(suggest)
    dialog = await screen.findByRole('dialog', { name: '다른 주제와 합칠까요?' })
    expect(within(dialog).getByRole('combobox', { name: '합칠 주제' })).toHaveTextContent(
      '로그인·계정',
    )
    const merged = log.started.length
    await userEvent.click(within(dialog).getByRole('button', { name: '합치기' }))

    expect(await screen.findByText('주제를 합쳤어요.')).toBeInTheDocument()
    const heading = within(panel()).getByRole('heading', { level: 2, name: '로그인·계정' })
    expect(heading).toHaveFocus()
    expect(await within(panel()).findByText('배포는 스크립트 하나로 한다')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('button', { name: '배포·인프라' })).toBeNull())
    expect(log.started.slice(merged)).toContainEqual({
      method: 'POST',
      path: '/workspaces/ws_01/topics/tp_02/merge',
    })
    expect(log.started.slice(merged)).not.toContainEqual({
      method: 'GET',
      path: '/workspaces/ws_01/topics/tp_02',
    })
  })

  it('응답을 읽지 못하면 실패라 하지 않고 확인 알림을 띄운다. 새로고침은 맵을 다시 받는다', async () => {
    server.use(http.patch('/api/v1/workspaces/:ws/topics/:id', () => ok({ topic_id: 1 })))
    await openTopic('배포·인프라')
    const log = recordRequests()
    await rename('배포 절차')
    const notice = (await screen.findByText('변경 결과를 확인하지 못했어요')).closest('li')!
    expect(within(panel()).queryByRole('alert')).toBeNull()

    const before = log.started.length
    fireEvent.click(within(notice).getByRole('button', { name: '새로고침' }))
    await waitFor(() =>
      expect(log.started.slice(before)).toContainEqual({
        method: 'GET',
        path: '/workspaces/ws_01/project-map',
      }),
    )
  })
})

describe('다른 주제와 합치기 (#551)', () => {
  it('취소하면 아무것도 보내지 않고 연 단추로 돌아온다. 서버가 거절하면 창 안에 알린다', async () => {
    await openTopic('배포·인프라')
    const bodies = recordBodies()
    const open = within(panel()).getByRole('button', { name: '다른 주제와 합치기' })
    await userEvent.click(open)
    let dialog = await screen.findByRole('dialog', { name: '다른 주제와 합칠까요?' })
    expect(dialog).toHaveTextContent('되돌릴 수 없어요.')
    expect(within(dialog).getByRole('button', { name: '합치기' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(open).toHaveFocus())
    expect(bodies).toEqual([])

    server.use(
      http.post('/api/v1/workspaces/:ws/topics/:id/merge', () =>
        fail('INTERNAL_ERROR', 'boom', 500),
      ),
    )
    await userEvent.click(open)
    dialog = await screen.findByRole('dialog', { name: '다른 주제와 합칠까요?' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: '합칠 주제' }))
    await userEvent.click(await screen.findByRole('option', { name: '회의 요약 품질' }))
    await userEvent.click(within(dialog).getByRole('button', { name: '합치기' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(SERVER_ERROR)
    expect(dialog).toBeInTheDocument()
  })
})

describe('태스크 떼기 (#551)', () => {
  it('확인하면 패널과 맵에서 그 태스크가 빠진다. 취소하면 아무것도 보내지 않는다', async () => {
    await openTopic('로그인·계정')
    const bodies = recordBodies()
    const detach = within(panel()).getByRole('button', { name: '회원가입 화면 떼기' })
    await userEvent.click(detach)
    let dialog = await screen.findByRole('dialog', { name: '이 주제에서 태스크를 뗄까요?' })
    expect(dialog).toHaveTextContent('「회원가입 화면」')
    expect(dialog).toHaveTextContent('이 화면에서는 다시 붙일 수 없어요.')
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(detach).toHaveFocus())
    expect(bodies).toEqual([])

    await userEvent.click(detach)
    dialog = await screen.findByRole('dialog', { name: '이 주제에서 태스크를 뗄까요?' })
    await userEvent.click(within(dialog).getByRole('button', { name: '떼기' }))
    expect(await screen.findByText('태스크를 뗐어요.')).toBeInTheDocument()
    const tasks = within(panel()).getByRole('region', { name: '태스크' })
    expect(within(tasks).queryByText('회원가입 화면')).toBeNull()
    expect(within(tasks).getByRole('heading', { name: '태스크' })).toHaveFocus()
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: '주제 없는 태스크' })).getByRole('button', {
          name: /회원가입 화면/,
        }),
      ).toBeVisible(),
    )
  })

  it('지워진 태스크면 창 안에 알리고 맵을 다시 받는다', async () => {
    server.use(
      http.delete('/api/v1/workspaces/:ws/topics/:id/tasks/:taskId', () =>
        fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404),
      ),
    )
    await openTopic('로그인·계정')
    const log = recordRequests()
    await userEvent.click(within(panel()).getByRole('button', { name: '회원가입 화면 떼기' }))
    const dialog = await screen.findByRole('dialog', { name: '이 주제에서 태스크를 뗄까요?' })
    await userEvent.click(within(dialog).getByRole('button', { name: '떼기' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('태스크를 찾을 수 없어요.')
    await waitFor(() =>
      expect(log.started).toContainEqual({ method: 'GET', path: '/workspaces/ws_01/project-map' }),
    )
  })
})

describe('결정 고치기 (#551)', () => {
  it('유효하지 않은 결정은 흐리게 표시와 안내가 붙고, 유효로 되돌리면 바로 바뀐다', async () => {
    const app = await openTopic('배포·인프라')
    const minutes = workspaceKey(WS, 'minutes', 'mt_09')
    app.queryClient.setQueryData(minutes, { cached: true })
    const text = '운영 DB 는 매일 새벽에 백업한다'
    const row = decisionRow(text)
    expect(within(row).getByText(text)).toHaveClass('text-dim')
    expect(within(row).getByText('유효하지 않음')).toBeVisible()
    expect(within(row).getByText('팀원이 유효하지 않다고 표시했어요.')).toBeVisible()
    expect(within(row).getByText('고침')).toBeVisible()
    expect(within(decisionRow('배포는 스크립트 하나로 한다')).queryByText('고침')).toBeNull()

    await chooseMenu(text, '유효로 되돌리기')
    await waitFor(() => expect(within(decisionRow(text)).queryByText('유효하지 않음')).toBeNull())
    expect(within(decisionRow(text)).getByText(text)).toHaveClass('text-ink')
    expect(within(decisionRow(text)).getByText('고침')).toBeVisible()
    expect(app.queryClient.getQueryState(minutes)?.isInvalidated).toBe(true)

    await chooseMenu('배포는 스크립트 하나로 한다', '유효하지 않음으로 표시')
    expect(
      await within(decisionRow('배포는 스크립트 하나로 한다')).findByText('유효하지 않음'),
    ).toBeVisible()
  })

  it('문장을 키보드로 고치면 고친 문장과 고침 표시가 보이고 메뉴 단추로 돌아온다', async () => {
    const user = userEvent.setup()
    await openTopic('배포·인프라')
    const text = '배포는 스크립트 하나로 한다'
    menuOf(text).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menuitem', { name: '문장 고치기' })).toHaveFocus()
    await user.keyboard('{Enter}')
    const field = await within(panel()).findByRole('textbox', { name: '결정 문장' })
    await waitFor(() => expect(field).toHaveFocus())
    await user.clear(field)
    await user.type(field, '배포는 스크립트 하나로 하고 롤백도 넣는다')
    await user.click(within(panel()).getByRole('button', { name: '저장' }))

    const fixed = '배포는 스크립트 하나로 하고 롤백도 넣는다'
    expect(await within(panel()).findByText(fixed)).toBeVisible()
    expect(within(decisionRow(fixed)).getByText('고침')).toBeVisible()
    await waitFor(() => expect(menuOf(fixed)).toHaveFocus())
  })

  it('지워진 결정이면 폼 안에 알린다', async () => {
    server.use(
      http.patch('/api/v1/workspaces/:ws/decisions/:id', () =>
        fail('DECISION_NOT_FOUND', '결정을 찾을 수 없습니다.', 404),
      ),
    )
    await openTopic('배포·인프라')
    await chooseMenu('배포는 스크립트 하나로 한다', '문장 고치기')
    const field = await within(panel()).findByRole('textbox', { name: '결정 문장' })
    await userEvent.type(field, '!')
    await userEvent.click(within(panel()).getByRole('button', { name: '저장' }))
    expect(
      await within(within(panel()).getByRole('form', { name: '결정 고치기' })).findByRole('alert'),
    ).toHaveTextContent('결정을 찾을 수 없어요. 지워졌을 수 있어요.')
  })

  it('지우기는 확인한 뒤 결정을 빼고, 그 결정이 뒤집었던 결정이 다시 유효해진다', async () => {
    await openTopic('로그인·계정')
    const bodies = recordBodies()
    const text = '카카오 로그인은 인증 없이 바로 계정을 만든다'
    await chooseMenu(text, '지우기')
    let dialog = await screen.findByRole('dialog', { name: '결정을 지울까요?' })
    expect(dialog).toHaveTextContent(
      '이 결정이 뒤집었던 결정은, 그 결정을 뒤집은 다른 결정이 없으면 다시 유효해져요.',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(menuOf(text)).toHaveFocus())
    expect(bodies).toEqual([])

    await chooseMenu(text, '지우기')
    dialog = await screen.findByRole('dialog', { name: '결정을 지울까요?' })
    await userEvent.click(within(dialog).getByRole('button', { name: '지우기' }))
    await waitFor(() => expect(within(panel()).queryByText(text)).toBeNull())
    expect(
      within(decisionRow('이메일 인증 전에는 계정을 만들지 않는다')).queryByText('뒤집힘'),
    ).toBeNull()
    expect(
      within(within(panel()).getByRole('region', { name: '결정' })).getByRole('heading', {
        name: '결정',
      }),
    ).toHaveFocus()
  })

  it('보낸 뒤 세션이 끝나면 응답이 와도 화면·캐시를 바꾸지 않고 알리지 않는다', async () => {
    const gate = deferred()
    server.use(
      http.patch('/api/v1/workspaces/:ws/decisions/:id', async () => {
        await gate.promise
      }),
    )
    const app = await openTopic('배포·인프라')
    const text = '배포는 스크립트 하나로 한다'
    await chooseMenu(text, '유효하지 않음으로 표시')
    endSessionScope()
    gate.resolve()
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)))

    expect(within(decisionRow(text)).queryByText('유효하지 않음')).toBeNull()
    expect(
      app.queryClient
        .getQueryData<{ decisions: { decisionId: string; state: string }[] }>(
          workspaceKey(WS, 'project-map', 'topic', 'tp_02'),
        )
        ?.decisions.find(({ decisionId }) => decisionId === 'dc_03')?.state,
    ).toBe('valid')
    expect(within(panel()).queryByRole('alert')).toBeNull()
    expect(screen.queryByText('변경 결과를 확인하지 못했어요')).toBeNull()
  })
})

describe('고치기는 보기와 화면 폭에 상관없이 같다 (#551)', () => {
  it('그래프에서 연 주제 패널에도 같은 고치기가 있다', async () => {
    renderApp(paths.projectMap(WS))
    await userEvent.click(
      within(await screen.findByRole('img', { name: /그래프/ }, FIRST_PAINT)).getByText(
        '배포·인프라',
      ),
    )
    const aside = panel()
    expect(await within(aside).findByRole('button', { name: '이름·설명 고치기' })).toBeVisible()
    expect(within(aside).getByRole('button', { name: '다른 주제와 합치기' })).toBeVisible()
    expect(within(aside).getByRole('button', { name: '배포 스크립트 떼기' })).toBeVisible()
    expect(menuOf('배포는 스크립트 하나로 한다')).toBeVisible()
  })

  it('휴대폰 시트 안에서 이름이 겹친 주제를 키보드만으로 합친다', async () => {
    stubViewport(true, COMPACT_QUERY)
    const user = userEvent.setup()
    renderApp(paths.projectMap(WS))
    const topic = await screen.findByRole('button', { name: '배포·인프라' }, FIRST_PAINT)
    topic.focus()
    await user.keyboard('{Enter}')
    const sheet = await screen.findByRole('dialog', { name: '배포·인프라' })
    const edit = await within(sheet).findByRole('button', { name: '이름·설명 고치기' })
    edit.focus()
    await user.keyboard('{Enter}')
    const name = within(sheet).getByRole('textbox', { name: '이름' })
    await waitFor(() => expect(name).toHaveFocus())
    await user.clear(name)
    await user.type(name, '로그인 계정{Enter}')

    const suggest = await within(sheet).findByRole('button', { name: '이 주제와 합치기' })
    suggest.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '다른 주제와 합칠까요?' })
    const confirm = within(dialog).getByRole('button', { name: '합치기' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await user.tab()
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.keyboard('{Enter}')

    const merged = await screen.findByRole('dialog', { name: '로그인·계정' })
    await waitFor(() =>
      expect(within(merged).getByRole('heading', { name: '로그인·계정' })).toHaveFocus(),
    )
    expect(await within(merged).findByText('배포는 스크립트 하나로 한다')).toBeVisible()
  })
})
