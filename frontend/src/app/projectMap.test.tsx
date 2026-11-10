import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { focusManager, onlineManager } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { paths } from '@/shared/config/routes'
import { COMPACT_QUERY } from '@/shared/lib/compact-screen'
import { fail, ok } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { stubViewport } from '@/shared/test/viewport'
import { renderApp } from './test/renderApp'

/*
 * #551 프로젝트 맵. 픽스처 ws_01 은 주제 넷(로그인·계정, 디자인 정리, 회의 요약 품질, 배포·인프라)과 태스크 열이고
 * 토큰 정리(tk_10)만 주제가 없다. 로그인·계정의 첫 결정(dc_01)은 둘째 결정(dc_02)이 뒤집었다
 */

vi.setConfig({ testTimeout: 15_000 })
const FIRST_PAINT = { timeout: 5_000 }
const WS = 'ws_01'

const graph = () => screen.findByRole('img', { name: /그래프/ }, FIRST_PAINT)
const panel = () => screen.getByRole('complementary', { name: '고른 항목' })

async function openList() {
  const app = renderApp(`${paths.projectMap(WS)}?view=list`)
  await screen.findByRole('heading', { level: 2, name: '로그인·계정' }, FIRST_PAINT)
  return app
}

/** 그래프가 이 너비(px)로 그려진 것처럼 잰다. jsdom 은 늘 0 이다 */
function stubGraphWidth(width: number) {
  const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    return this instanceof SVGSVGElement ? new DOMRect(0, 0, width, (width * 5) / 8) : new DOMRect()
  })
  onTestFinished(() => spy.mockRestore())
}

describe('프로젝트 맵 화면 (#551)', () => {
  it('넓은 화면은 헤더 탭으로 오고 그래프로 열린다. 목록 보기로 바꾸면 주소에 남는다', async () => {
    const app = renderApp(paths.dashboard(WS))
    const nav = await screen.findByRole('navigation', { name: '주요 화면' })
    await userEvent.click(within(nav).getByRole('link', { name: '프로젝트 맵' }))
    await app.expectPath(paths.projectMap(WS))
    expect(await screen.findByRole('heading', { level: 1, name: '프로젝트 맵' })).toBeVisible()
    expect(screen.getByRole('tab', { name: '그래프' })).toHaveAttribute('aria-selected', 'true')
    expect(await graph()).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: '목록 보기' }))
    await app.expectSearch('?view=list')
    expect(screen.queryByRole('img', { name: /그래프/ })).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: '주제 없는 태스크' })).toBeVisible()
    expect(screen.getByRole('button', { name: /토큰 정리/ })).toBeVisible()
  })

  it('목록의 주제를 누르면 설명·결정·태스크·나온 회의가 패널에 나오고, 회의를 누르면 회의록으로 간다', async () => {
    const app = await openList()
    await userEvent.click(screen.getByRole('button', { name: '로그인·계정' }))
    const aside = panel()
    expect(within(aside).getByRole('heading', { level: 2, name: '로그인·계정' })).toHaveFocus()
    expect(
      await within(aside).findByText('이메일 인증 뒤 가입과 카카오 로그인을 만든다.'),
    ).toBeVisible()

    const decisions = within(within(aside).getByRole('region', { name: '결정' })).getAllByRole(
      'listitem',
    )
    expect(decisions[0]).toHaveTextContent('이메일 인증 전에는 계정을 만들지 않는다')
    expect(within(decisions[0]).getByText('뒤집힘')).toBeVisible()
    expect(within(decisions[0]).getByText('다른 결정으로 바뀌었어요.')).toBeVisible()
    expect(decisions[1]).toHaveTextContent('카카오 로그인은 인증 없이 바로 계정을 만든다')
    expect(within(decisions[1]).queryByText('뒤집힘')).toBeNull()

    const tasks = within(aside).getByRole('region', { name: '태스크' })
    expect(within(tasks).getByRole('button', { name: /^회원가입 화면\s*할 일$/ })).toBeVisible()

    const meetings = within(aside).getByRole('region', { name: '나온 회의' })
    expect(
      within(meetings)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['2주차 정기회의', '3주차 정기회의'])
    await userEvent.click(within(meetings).getByRole('link', { name: '3주차 정기회의' }))
    await app.expectPath(paths.meetings(WS, 'mt_09'))
  })

  it('목록의 태스크를 누르면 상태·담당·마감·막힘·나온 회의가 패널에 나온다. 닫으면 그 줄로 돌아간다', async () => {
    await openList()
    const row = screen.getByRole('button', { name: /DB 스키마 정리/ })
    await userEvent.click(row)
    const aside = panel()
    expect(within(aside).getByRole('heading', { name: 'DB 스키마 정리' })).toBeVisible()
    expect(aside.querySelector('dl')).toHaveTextContent(
      '상태막힘담당이재환마감2026-09-22막힘Notion 권한 대기',
    )
    expect(within(aside).getByRole('link', { name: '3주차 정기회의' })).toHaveAttribute(
      'href',
      paths.meetings(WS, 'mt_09'),
    )

    await userEvent.click(screen.getByRole('button', { name: /온보딩 문구 수정/ }))
    expect(within(panel()).getByRole('heading', { name: '온보딩 문구 수정' })).toBeVisible()
    expect(panel().querySelector('dl')).toHaveTextContent('상태할 일담당담당 없음마감2026-09-10')
    expect(panel().querySelector('dl')).not.toHaveTextContent('막힘')

    await userEvent.click(within(panel()).getByRole('button', { name: '패널 닫기' }))
    expect(screen.queryByRole('complementary', { name: '고른 항목' })).toBeNull()
    expect(row).toHaveFocus()
  })

  it('그래프의 노드를 누르면 목록과 같은 패널이 열린다', async () => {
    renderApp(paths.projectMap(WS))
    await userEvent.click(within(await graph()).getByText('배포·인프라'))
    const aside = panel()
    expect(within(aside).getByRole('heading', { name: '배포·인프라' })).toBeVisible()
    expect(await within(aside).findByText('배포는 스크립트 하나로 한다')).toBeVisible()
  })

  it('휴대폰 폭(350px)으로 그려져도 태스크 점은 화면에서 지름 24px 이상을 누를 수 있고, 누르면 패널이 열린다', async () => {
    const width = 350
    stubGraphWidth(width)
    renderApp(paths.projectMap(WS))
    const svg = await graph()
    const hit = svg.querySelector<SVGCircleElement>('circle[data-node-id="tk_10"]')
    expect(hit).not.toBeNull()
    expect(Number(hit!.getAttribute('r'))).toBeGreaterThanOrEqual((12 * 960) / width)

    await userEvent.click(hit!)
    expect(within(panel()).getByRole('heading', { name: '토큰 정리' })).toBeVisible()
  })

  it('확대하면 태스크 이름이 보이고 전체 보기는 처음 배율로 돌아간다', async () => {
    renderApp(paths.projectMap(WS))
    const svg = await graph()
    expect(within(svg).getByText('로그인·계정')).toBeInTheDocument()
    expect(within(svg).queryByText('회원가입 화면')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '확대' }))
    await userEvent.click(screen.getByRole('button', { name: '확대' }))
    expect(within(svg).getByText('회원가입 화면')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '축소' }))
    expect(within(svg).queryByText('회원가입 화면')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '확대' }))
    await userEvent.click(screen.getByRole('button', { name: '전체 보기' }))
    expect(within(svg).queryByText('회원가입 화면')).toBeNull()
  })

  it('재생은 나온 순서대로 하나씩 보이고, 멈추기는 바로 전부를 보인다', async () => {
    renderApp(paths.projectMap(WS))
    const svg = await graph()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.click(screen.getByRole('button', { name: '재생' }))
      expect(within(svg).queryByText('로그인·계정')).toBeNull()
      // 노드 14개라 한 칸이 6000/14ms 다. 앞의 셋은 2주차 정기회의에서 먼저 나온 태스크(tk_07, tk_08, tk_09)다
      for (let step = 0; step < 4; step += 1)
        act(() => {
          vi.advanceTimersByTime(6000 / 14)
        })
      expect(within(svg).getByText('로그인·계정')).toBeInTheDocument()
      expect(within(svg).queryByText('디자인 정리')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: '멈추기' }))
      expect(within(svg).getByText('디자인 정리')).toBeInTheDocument()
      expect(within(svg).getByText('배포·인프라')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '재생' })).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('재생은 끝까지 가면 저절로 멈춘다', async () => {
    renderApp(paths.projectMap(WS))
    const svg = await graph()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.click(screen.getByRole('button', { name: '재생' }))
      for (let step = 0; step < 14; step += 1)
        act(() => {
          vi.advanceTimersByTime(6000 / 14)
        })
      expect(within(svg).getByText('배포·인프라')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '재생' })).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('태스크 패널은 그래프에서 선으로 이어진 태스크를 단추로 보이고, 누르면 그 태스크로 바뀐다', async () => {
    await openList()
    await userEvent.click(screen.getByRole('button', { name: /폰트 적용/ }))
    const related = within(panel()).getByRole('region', { name: '이어진 태스크' })
    expect(within(related).getAllByRole('button')).toHaveLength(1)

    await userEvent.click(within(related).getByRole('button', { name: /토큰 정리/ }))
    expect(within(panel()).getByRole('heading', { level: 2, name: '토큰 정리' })).toHaveFocus()
    expect(
      within(within(panel()).getByRole('region', { name: '이어진 태스크' })).getByRole('button', {
        name: /폰트 적용/,
      }),
    ).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /회원가입 화면/ }))
    expect(within(panel()).queryByRole('region', { name: '이어진 태스크' })).toBeNull()
  })

  it('주제가 없어도 태스크 패널에서 이어진 태스크로 옮겨 간다', async () => {
    applyScenario('project-map-no-topics')
    renderApp(`${paths.projectMap(WS)}?view=list`)
    const loose = await screen.findByRole('region', { name: '주제 없는 태스크' }, FIRST_PAINT)
    await userEvent.click(within(loose).getByRole('button', { name: /DB 스키마 정리/ }))
    const related = within(panel()).getByRole('region', { name: '이어진 태스크' })
    await userEvent.click(within(related).getByRole('button', { name: /배포 스크립트/ }))
    expect(within(panel()).getByRole('heading', { level: 2, name: '배포 스크립트' })).toHaveFocus()
    expect(within(panel()).getByRole('region', { name: '이어진 태스크' })).toHaveTextContent(
      'DB 스키마 정리',
    )
  })

  it('담당 이름이 길면 줄 안에서 말줄임하고 전체 이름을 툴팁으로 둔다', async () => {
    const name = '아주아주긴이름을가진팀원의디스코드표시이름'
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/project-map', () =>
        ok({
          meetings: [],
          nodes: [
            {
              id: 'tk_long',
              kind: 'task',
              label: '긴 이름 태스크',
              status: 'todo',
              due_date: '2026-09-22',
              assignee_name: name,
              blocker: null,
              meeting_ids: [],
              appeared_at: '2026-09-01T00:00:00Z',
            },
          ],
          edges: [],
        }),
      ),
    )
    renderApp(`${paths.projectMap(WS)}?view=list`)
    const row = await screen.findByRole('button', { name: /긴 이름 태스크/ }, FIRST_PAINT)
    const assignee = within(row).getByText(name)
    expect(assignee).toHaveClass('truncate')
    expect(assignee).toHaveAttribute('title', name)
  })

  it('태스크도 주제도 없으면 빈 상태다', async () => {
    applyScenario('project-map-empty')
    renderApp(paths.projectMap(WS))
    expect(
      await screen.findByRole('heading', { name: '아직 프로젝트 맵이 비어 있어요' }, FIRST_PAINT),
    ).toBeVisible()
    expect(screen.getByText('회의에서 태스크가 생기면 여기에 나와요.')).toBeVisible()
  })

  it('주제가 아직 없으면 안내를 두고 태스크만으로 그래프와 목록을 보인다', async () => {
    applyScenario('project-map-no-topics')
    const app = renderApp(paths.projectMap(WS))
    expect(await graph()).toBeInTheDocument()
    expect(
      screen.getByText('아직 주제가 없어요. 회의 요약이 만들어지면 주제와 결정이 생겨요.'),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('tab', { name: '목록 보기' }))
    await app.expectSearch('?view=list')
    const loose = screen.getByRole('region', { name: '주제 없는 태스크' })
    expect(within(loose).getAllByRole('button')).toHaveLength(10)
  })

  it('모르는 노드 종류가 오면 맵 전체를 읽지 못했다고 알리고 창 포커스·연결 복귀에도 다시 묻지 않는다', async () => {
    let requests = 0
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/project-map', () => {
        requests += 1
        return ok({
          meetings: [],
          nodes: [
            { id: 'x', kind: 'decision', label: '결정', appeared_at: '2026-09-01T00:00:00Z' },
          ],
          edges: [],
        })
      }),
    )
    renderApp(paths.projectMap(WS))
    const alert = await screen.findByRole('alert', {}, FIRST_PAINT)
    expect(alert).toHaveTextContent('응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeVisible()
    const before = requests
    try {
      act(() => {
        focusManager.setFocused(false)
        focusManager.setFocused(true)
        onlineManager.setOnline(false)
        onlineManager.setOnline(true)
      })
      await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
      expect(requests).toBe(before)
    } finally {
      focusManager.setFocused(undefined)
      onlineManager.setOnline(true)
    }
  })

  it('지워진 주제를 열면 패널에 그 안내만 보인다', async () => {
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/topics/:topicId', () =>
        fail('TOPIC_NOT_FOUND', '주제를 찾을 수 없습니다.', 404),
      ),
    )
    await openList()
    await userEvent.click(screen.getByRole('button', { name: '배포·인프라' }))
    expect(
      await within(panel()).findByText('주제를 찾을 수 없어요. 지워졌을 수 있어요.'),
    ).toBeVisible()
    expect(within(panel()).queryByRole('button', { name: '다시 시도' })).toBeNull()
  })
})

describe('휴대폰의 프로젝트 맵 (D-180)', () => {
  it('아래 탭 막대는 다섯 칸 그대로이고 계정 메뉴에서 연다. 목록으로 열리고 패널은 아래 시트다', async () => {
    stubViewport(true, COMPACT_QUERY)
    const app = renderApp(paths.dashboard(WS))
    const bar = await screen.findByRole('navigation', { name: '주요 화면' })
    expect(
      within(bar)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['홈', '회의록', '태스크', '메시지', '팀'])

    await userEvent.click(screen.getByRole('button', { name: /^내 계정/ }))
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      '프로젝트 맵',
      '설정',
      '로그아웃',
      '계정 탈퇴',
    ])
    await userEvent.click(items[0])
    await app.expectPath(paths.projectMap(WS))
    expect(await screen.findByRole('tab', { name: '목록 보기' }, FIRST_PAINT)).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await userEvent.click(await screen.findByRole('button', { name: /회원가입 화면/ }))
    const sheet = await screen.findByRole('dialog', { name: '회원가입 화면' })
    expect(sheet).toHaveTextContent('담당박민수')
    expect(screen.queryByRole('complementary', { name: '고른 항목' })).toBeNull()
  })

  it('시트를 Esc 로 닫으면 연 목록 줄로 포커스가 돌아온다', async () => {
    stubViewport(true, COMPACT_QUERY)
    const user = userEvent.setup()
    renderApp(paths.projectMap(WS))
    const row = await screen.findByRole('button', { name: /DB 스키마 정리/ }, FIRST_PAINT)
    row.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'DB 스키마 정리' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(row).toHaveFocus())
  })

  it('시트 안에서 주제의 태스크를 키보드로 열면 포커스가 그 태스크 제목으로 간다', async () => {
    stubViewport(true, COMPACT_QUERY)
    const user = userEvent.setup()
    renderApp(paths.projectMap(WS))
    const topic = await screen.findByRole('button', { name: '로그인·계정' }, FIRST_PAINT)
    topic.focus()
    await user.keyboard('{Enter}')
    const sheet = await screen.findByRole('dialog', { name: '로그인·계정' })
    const task = await within(sheet).findByRole('button', { name: /^회원가입 화면\s*할 일$/ })
    task.focus()
    await user.keyboard('{Enter}')

    const titled = await screen.findByRole('dialog', { name: '회원가입 화면' })
    expect(within(titled).getByRole('heading', { name: '회원가입 화면' })).toHaveFocus()
  })

  it('넓은 화면의 계정 메뉴에는 프로젝트 맵이 없다', async () => {
    renderApp(paths.dashboard(WS))
    await userEvent.click(await screen.findByRole('button', { name: /^내 계정/ }, FIRST_PAINT))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: '프로젝트 맵' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: '설정' })).toBeVisible()
  })
})
