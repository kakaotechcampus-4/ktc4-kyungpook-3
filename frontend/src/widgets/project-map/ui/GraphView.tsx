import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { PointerEvent, RefObject } from 'react'
import type { MapEdge, MapNode, MapSelection, ProjectMap } from '@/entities/project-map'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { NODE_RADIUS, createLayout } from '../lib/layout'
import type { Bounds, Point } from '../lib/layout'
import { REPLAY_IDLE, replayIntervalMs, replayReducer, shownCount } from '../lib/replay'
import {
  TASK_LABEL_ZOOM,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  ZOOM_STEP,
  fitViewport,
  toScreen,
  zoomAt,
  zoomCenter,
} from '../lib/viewport'
import type { Viewport } from '../lib/viewport'

/* 한 프레임에 배치에 쓰는 시간. 60Hz 한 프레임(16ms) 안에 그리기 몫을 남긴다 */
const FRAME_BUDGET_MS = 10
/* 이보다 덜 움직였으면 끌기가 아니라 누르기다 */
const DRAG_THRESHOLD = 4
const WHEEL_ZOOM = 0.0015
/* 노드를 누를 수 있는 자리의 화면 반지름(px). 지름 24px — 보이는 점(태스크 지름 10)은 휴대폰 폭에서 4px 아래로 준다 */
const HIT_RADIUS_PX = 12

const BOX =
  'relative aspect-[8/5] w-full overflow-hidden rounded-16 border border-line bg-surface-sunken'
const CONTROLS = 'absolute bottom-12 left-12 flex items-center gap-6'
const WAIT = 'flex aspect-[8/5] w-full items-center justify-center rounded-16 border border-line'

interface Placement {
  nodes: readonly MapNode[]
  edges: readonly MapEdge[]
  positions: ReadonlyMap<string, Point>
  bounds: Bounds
}

/**
 * 프레임마다 시간 한도만큼 배치를 돌린다. 끝나기 전에는 null 이다.
 * 같은 맵을 다시 받아도(구조 공유로 nodes·edges 가 그대로면) 다시 배치하지 않는다
 */
function usePlacement(nodes: readonly MapNode[], edges: readonly MapEdge[]): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null)
  useEffect(() => {
    const layout = createLayout(nodes, edges)
    let frame = 0
    const run = () => {
      if (layout.step(FRAME_BUDGET_MS))
        setPlacement({ nodes, edges, positions: layout.positions(), bounds: layout.bounds() })
      else frame = requestAnimationFrame(run)
    }
    frame = requestAnimationFrame(run)
    return () => cancelAnimationFrame(frame)
  }, [nodes, edges])
  return placement?.nodes === nodes && placement.edges === edges ? placement : null
}

/** 화면 좌표(client)를 그래프 좌표계(viewBox)로 옮긴다. 상자 비율이 viewBox 와 같아 한 배율이다 */
function toView(svg: SVGSVGElement, clientX: number, clientY: number): Point | null {
  const rect = svg.getBoundingClientRect()
  if (rect.width === 0) return null
  const scale = VIEW_WIDTH / rect.width
  return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale }
}

/** 그래프가 그려진 너비(px). 재지 못하면(jsdom 처럼 0) viewBox 너비 그대로 그려졌다고 본다 */
function useRenderedWidth(svgRef: RefObject<SVGSVGElement | null>): number {
  const [width, setWidth] = useState(VIEW_WIDTH)
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (svg === null) return
    const measure = () => setWidth(svg.getBoundingClientRect().width || VIEW_WIDTH)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [svgRef])
  return width
}

function nodeIdOf(target: EventTarget): string | null {
  if (!(target instanceof Element)) return null
  return target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
}

export interface GraphViewProps {
  map: ProjectMap
  selection: MapSelection
  onSelect: (selection: MapSelection) => void
}

/**
 * 그래프 보기. 배치는 d3-force 로 하고 그리기는 SVG 다. 이 모듈은 그래프 탭을 고를 때 받는다 — 목록만 보는 휴대폰은
 * 배치 라이브러리를 내려받지 않는다
 */
export function GraphView({ map, selection, onSelect }: GraphViewProps) {
  const placement = usePlacement(map.nodes, map.edges)
  if (placement === null)
    return (
      <div role="status" className={WAIT}>
        <span className="text-body text-dim">배치하는 중이에요</span>
      </div>
    )
  return <PlacedGraph map={map} placement={placement} selection={selection} onSelect={onSelect} />
}

interface Drag {
  pointerId: number
  start: Point
  from: Viewport
  moved: boolean
}

function PlacedGraph({
  map,
  placement,
  selection,
  onSelect,
}: GraphViewProps & { placement: Placement }) {
  const svgRef = useRef<SVGSVGElement>(null)
  // 점은 viewBox 단위라 그래프가 좁게 그려지면 함께 준다. 누르는 자리는 화면 px 로 잡아 viewBox 단위로 바꾼다
  const hitRadius = (HIT_RADIUS_PX * VIEW_WIDTH) / useRenderedWidth(svgRef)
  const [viewport, setViewport] = useState(() => fitViewport(placement.bounds))
  const [replay, dispatch] = useReducer(replayReducer, REPLAY_IDLE)
  const drag = useRef<Drag | null>(null)
  // 끌기를 마친 pointerup 뒤에 오는 click 은 노드를 고르지 않는다
  const suppressClick = useRef(false)

  const total = map.nodes.length
  const visible = shownCount(replay, total)
  const order = useMemo(() => new Map(map.nodes.map(({ id }, index) => [id, index])), [map.nodes])

  useEffect(() => {
    if (replay.phase !== 'playing') return
    const timer = window.setTimeout(
      () => dispatch({ type: 'tick', total }),
      replayIntervalMs(total),
    )
    return () => window.clearTimeout(timer)
  }, [replay, total])

  // React 의 wheel 은 passive 라 페이지 스크롤을 막을 수 없다. 그래프 위 휠은 확대·축소다
  useEffect(() => {
    const svg = svgRef.current
    if (svg === null) return
    const onWheel = (event: WheelEvent) => {
      const anchor = toView(svg, event.clientX, event.clientY)
      if (anchor === null) return
      event.preventDefault()
      setViewport((current) => zoomAt(current, Math.exp(-event.deltaY * WHEEL_ZOOM), anchor))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const start = toView(event.currentTarget, event.clientX, event.clientY)
    if (start === null) return
    drag.current = { pointerId: event.pointerId, start, from: viewport, moved: false }
  }
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current
    if (current === null || current.pointerId !== event.pointerId) return
    const point = toView(event.currentTarget, event.clientX, event.clientY)
    if (point === null) return
    const dx = point.x - current.start.x
    const dy = point.y - current.start.y
    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    if (!current.moved) {
      current.moved = true
      // 끌기로 판정한 뒤에만 붙잡는다. 누르기에서 붙잡으면 click 이 노드가 아니라 상자에 간다
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setViewport({ ...current.from, x: current.from.x + dx, y: current.from.y + dy })
  }
  const endDrag = () => {
    suppressClick.current = drag.current?.moved === true
    drag.current = null
  }

  const shownEdges = map.edges.filter(
    ({ source, target }) =>
      (order.get(source) ?? total) < visible && (order.get(target) ?? total) < visible,
  )
  const at = (id: string) => toScreen(placement.positions.get(id) ?? { x: 0, y: 0 }, viewport)
  const taskLabels = viewport.k >= TASK_LABEL_ZOOM
  const shownNodes = map.nodes.slice(0, visible)

  return (
    <div className={BOX}>
      {/* 노드는 Tab 순서에 넣지 않는다 — 수백 개를 하나씩 지나가야 한다. 같은 내용과 패널을 목록 보기가 키보드로 준다 */}
      <svg
        ref={svgRef}
        role="img"
        aria-label="주제와 태스크를 잇는 그래프. 같은 내용을 목록 보기에서 볼 수 있어요."
        viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          const id = nodeIdOf(event.target)
          const node = id === null ? undefined : map.nodeById.get(id)
          if (node !== undefined) onSelect({ kind: node.kind, id: node.id })
        }}
      >
        <g className="stroke-line-strong" strokeWidth={1}>
          {shownEdges.map(({ source, target }) => {
            const from = at(source)
            const to = at(target)
            return <line key={`${source}|${target}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
          })}
        </g>
        {/* 누르는 자리는 보이는 점 모두의 아래 한 층이다. 점끼리 가까우면 넓은 자리가 옆 점을 덮는데, 보이는 점은 늘 그 점이 받는다 */}
        <g fill="transparent">
          {shownNodes.map((node) => {
            const { x, y } = at(node.id)
            return (
              <circle
                key={node.id}
                data-node-id={node.id}
                cx={x}
                cy={y}
                r={Math.max(NODE_RADIUS[node.kind], hitRadius)}
                className="cursor-pointer"
              />
            )
          })}
        </g>
        {shownNodes.map((node) => {
          const { x, y } = at(node.id)
          const radius = NODE_RADIUS[node.kind]
          const selected = selection?.id === node.id
          const topic = node.kind === 'topic'
          return (
            <g
              key={node.id}
              data-node-id={node.id}
              transform={`translate(${String(x)} ${String(y)})`}
              className="cursor-pointer"
            >
              {selected ? (
                <circle
                  r={radius + 5}
                  fill="none"
                  strokeWidth={2.5}
                  className="stroke-accent-point"
                />
              ) : null}
              <circle
                r={radius}
                className={topic ? 'fill-ink' : 'fill-dashed stroke-surface'}
                strokeWidth={topic ? 0 : 1}
              />
              {topic || taskLabels ? (
                <text
                  x={radius + 5}
                  y={4}
                  className={
                    topic
                      ? 'fill-ink text-[12.5px] font-semibold'
                      : 'fill-sub text-[11px] font-normal'
                  }
                >
                  {node.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <div className={CONTROLS}>
        {replay.phase === 'playing' ? (
          <Button size="sm" onClick={() => dispatch({ type: 'stop' })}>
            멈추기
          </Button>
        ) : (
          <Button size="sm" onClick={() => dispatch({ type: 'play' })}>
            <Icon name="play" size={13} />
            재생
          </Button>
        )}
        <Button
          size="sm"
          aria-label="확대"
          onClick={() => setViewport((v) => zoomCenter(v, ZOOM_STEP))}
        >
          <Icon name="plus" size={14} />
        </Button>
        <Button
          size="sm"
          aria-label="축소"
          onClick={() => setViewport((v) => zoomCenter(v, 1 / ZOOM_STEP))}
        >
          <span aria-hidden="true" className="text-[15px] leading-none">
            −
          </span>
        </Button>
        <Button size="sm" onClick={() => setViewport(fitViewport(placement.bounds))}>
          전체 보기
        </Button>
      </div>
    </div>
  )
}
