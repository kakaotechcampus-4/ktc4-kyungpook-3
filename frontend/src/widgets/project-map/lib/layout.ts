import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { MapEdge, MapNode } from '@/entities/project-map'

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 노드 반지름. 그래프가 그릴 때와 겹침 힘이 같은 값을 쓴다 */
export const NODE_RADIUS = { topic: 9, task: 5 } as const

/**
 * 배치 하나. 한 번에 다 돌리면 500 태스크에서 0.5초 넘게 화면이 멈춘다(#551 측정). 화면이 프레임마다 `step` 을
 * 시간 한도 안에서 부르고, 끝나면 `positions` 를 읽는다
 */
export interface Layout {
  /** 한도(ms)만큼 틱을 돌린다. 모두 돌았으면 true */
  step: (budgetMs: number) => boolean
  positions: () => ReadonlyMap<string, Point>
  bounds: () => Bounds
}

interface SimNode extends SimulationNodeDatum {
  id: string
  kind: MapNode['kind']
}

/*
 * d3-force 기본값으로 알파가 최소값까지 식는 틱 수(약 300)다. 난수는 d3-force v3 의 고정 씨앗 생성기라
 * 같은 입력이면 같은 배치다 — 테스트와 화면 캡처가 흔들리지 않는다
 */
const ALPHA_MIN = 0.001
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300)
const TICKS = Math.ceil(Math.log(ALPHA_MIN) / Math.log(1 - ALPHA_DECAY))

export function createLayout(
  nodes: readonly MapNode[],
  edges: readonly MapEdge[],
  now: () => number = () => performance.now(),
): Layout {
  const simNodes: SimNode[] = nodes.map(({ id, kind }) => ({ id, kind }))
  const links: SimulationLinkDatum<SimNode>[] = edges.map(({ source, target }) => ({
    source,
    target,
  }))
  const topicLink = (link: SimulationLinkDatum<SimNode>) =>
    (link.source as SimNode).kind === 'topic' || (link.target as SimNode).kind === 'topic'
  const simulation = forceSimulation(simNodes)
    .alphaMin(ALPHA_MIN)
    .alphaDecay(ALPHA_DECAY)
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id(({ id }) => id)
        .distance((link) => (topicLink(link) ? 46 : 34)),
    )
    .force(
      'charge',
      forceManyBody<SimNode>().strength(({ kind }) => (kind === 'topic' ? -260 : -45)),
    )
    .force(
      'collide',
      forceCollide<SimNode>(({ kind }) => NODE_RADIUS[kind] + 6),
    )
    .force('x', forceX<SimNode>(0).strength(0.04))
    .force('y', forceY<SimNode>(0).strength(0.04))
    .stop()

  let ticks = 0
  return {
    step(budgetMs) {
      const until = now() + budgetMs
      while (ticks < TICKS) {
        simulation.tick()
        ticks += 1
        if (now() >= until) break
      }
      return ticks >= TICKS
    },
    positions() {
      return new Map(simNodes.map(({ id, x = 0, y = 0 }) => [id, { x, y }]))
    },
    bounds() {
      if (simNodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const { kind, x = 0, y = 0 } of simNodes) {
        const radius = NODE_RADIUS[kind]
        minX = Math.min(minX, x - radius)
        minY = Math.min(minY, y - radius)
        maxX = Math.max(maxX, x + radius)
        maxY = Math.max(maxY, y + radius)
      }
      return { minX, minY, maxX, maxY }
    },
  }
}
