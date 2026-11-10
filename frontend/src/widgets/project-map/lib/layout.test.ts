import type { MapEdge, MapNode } from '@/entities/project-map'
import { createLayout } from './layout'
import { replayIntervalMs, replayReducer, shownCount, REPLAY_IDLE } from './replay'
import type { Replay } from './replay'
import { TASK_LABEL_ZOOM, VIEW_HEIGHT, VIEW_WIDTH, fitViewport, toScreen, zoomAt } from './viewport'

/** BE 가 잰 500 태스크 응답 규모 — 주제 36 · 태스크 500 · 선 1,173 */
function largeGraph(): { nodes: MapNode[]; edges: MapEdge[] } {
  const topics: MapNode[] = Array.from({ length: 36 }, (_, index) => ({
    kind: 'topic',
    id: `tp_${String(index)}`,
    label: `주제 ${String(index)}`,
    appearedAt: '2026-09-01T00:00:00Z',
  }))
  const tasks: MapNode[] = Array.from({ length: 500 }, (_, index) => ({
    kind: 'task',
    id: `tk_${String(index)}`,
    label: `태스크 ${String(index)}`,
    status: 'todo',
    dueDate: null,
    assigneeName: null,
    blocker: null,
    meetingIds: [],
    appearedAt: '2026-09-02T00:00:00Z',
  }))
  const edges: MapEdge[] = tasks.slice(0, 470).map(({ id }, index) => ({
    source: `tp_${String(index % 36)}`,
    target: id,
  }))
  for (let index = 0; edges.length < 1173; index += 1)
    edges.push({
      source: `tk_${String(index % 500)}`,
      target: `tk_${String((index * 7 + 3) % 500)}`,
    })
  return { nodes: [...topics, ...tasks], edges }
}

/** 부를 때마다 1ms 가는 시계 */
function tickingClock() {
  let time = 0
  return () => (time += 1)
}

describe('배치', () => {
  it('큰 맵을 시간 한도로 나눠 여러 번에 걸쳐 배치하고, 같은 입력이면 같은 자리다', () => {
    const { nodes, edges } = largeGraph()
    const run = () => {
      const layout = createLayout(nodes, edges, tickingClock())
      let calls = 1
      while (!layout.step(10)) calls += 1
      return { calls, positions: layout.positions(), bounds: layout.bounds() }
    }
    const first = run()
    expect(first.calls).toBeGreaterThan(10)
    expect(first.positions.size).toBe(536)
    expect([...first.positions.values()].every(({ x, y }) => Number.isFinite(x + y))).toBe(true)
    expect(run().positions).toEqual(first.positions)

    const fitted = fitViewport(first.bounds)
    for (const point of first.positions.values()) {
      const { x, y } = toScreen(point, fitted)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(VIEW_WIDTH)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(VIEW_HEIGHT)
    }
  })

  it('노드가 없어도 끝난다', () => {
    const layout = createLayout([], [])
    expect(layout.step(10)).toBe(true)
    expect(layout.positions().size).toBe(0)
  })
})

describe('보기 배율', () => {
  it('작은 맵은 전체 보기에서 키우지 않아 태스크 이름이 숨고, 확대하면 가리킨 점이 제자리에 있다', () => {
    const fitted = fitViewport({ minX: -50, minY: -40, maxX: 50, maxY: 40 })
    expect(fitted.k).toBe(1)
    expect(fitted.k).toBeLessThan(TASK_LABEL_ZOOM)
    const anchor = { x: 200, y: 100 }
    const zoomed = zoomAt(fitted, 2, anchor)
    expect(zoomed.k).toBe(2)
    const before = { x: (anchor.x - fitted.x) / fitted.k, y: (anchor.y - fitted.y) / fitted.k }
    expect(toScreen(before, zoomed)).toEqual(anchor)
    expect(zoomAt(zoomed, 100, anchor).k).toBe(6)
  })
})

describe('재생', () => {
  it('하나씩 더하다 다 보이면 멈춘다. 멈추기는 바로 전부를 보인다', () => {
    let replay: Replay = REPLAY_IDLE
    expect(shownCount(replay, 3)).toBe(3)
    replay = replayReducer(replay, { type: 'play' })
    expect(shownCount(replay, 3)).toBe(0)
    replay = replayReducer(replay, { type: 'tick', total: 3 })
    replay = replayReducer(replay, { type: 'tick', total: 3 })
    expect(shownCount(replay, 3)).toBe(2)
    replay = replayReducer(replay, { type: 'tick', total: 3 })
    expect(replay).toEqual(REPLAY_IDLE)

    replay = replayReducer(replayReducer(replay, { type: 'play' }), { type: 'stop' })
    expect(shownCount(replay, 3)).toBe(3)
  })

  it('간격은 노드 수에 맞춰 6초에 가깝게 하되 30~500ms 로 자른다', () => {
    expect(replayIntervalMs(4)).toBe(500)
    expect(replayIntervalMs(60)).toBe(100)
    expect(replayIntervalMs(536)).toBe(30)
  })
})
