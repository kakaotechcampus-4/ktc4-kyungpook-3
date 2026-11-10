import { useQuery } from '@tanstack/react-query'
import { Suspense, lazy, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { projectMapQueryOptions } from '@/entities/project-map'
import type { MapSelection, ProjectMap } from '@/entities/project-map'
import { ProjectBundleDownload } from '@/features/project-bundle-download'
import { queryView } from '@/shared/lib/query-view'
import { panelTabStop } from '@/shared/lib/tab-panel'
import { EmptyState } from '@/shared/ui/empty-state'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Sheet } from '@/shared/ui/sheet'
import { Skeleton } from '@/shared/ui/skeleton'
import { COLUMNS_WITH_PANEL, MAIN, NOTE, TITLE } from './frame'
import { MapListView } from './MapListView'
import { SelectionPanel } from './SelectionPanel'

/* 그래프와 배치 라이브러리(d3-force)는 그래프 탭을 고를 때 받는다. 목록으로 들어오면 내려받지 않는다 */
const GraphView = lazy(() =>
  import('./GraphView').then(({ GraphView }) => ({ default: GraphView })),
)

export type MapViewKind = 'graph' | 'list'

const VIEW_LABEL: Record<MapViewKind, string> = { graph: '그래프', list: '목록 보기' }
const VIEWS = ['graph', 'list'] as const satisfies readonly MapViewKind[]

/* 회의록 탭과 같은 모양이다 (MinutesTabs) — 38px · 13.5px 600 · 선택은 먹 밑줄 2px */
const TAB_LIST = 'flex items-center gap-18 border-b border-line'
const TAB =
  'inline-flex h-[38px] items-center border-b-2 border-transparent px-3 text-body font-semibold text-sub hover:text-ink aria-selected:border-ink aria-selected:text-ink'
const ASIDE = 'sticky top-24 flex flex-col gap-16 rounded-16 border border-line p-20'
const ASIDE_HEAD = 'flex items-start justify-between gap-12'
const ASIDE_TITLE = 'text-[17px] leading-[1.4] font-bold text-ink wrap-anywhere outline-none'
const CLOSE =
  'inline-flex h-28 w-28 shrink-0 items-center justify-center rounded-7 text-sub hover:bg-control'

/** WAI-ARIA 탭 패턴 — 화살표·Home·End 로 옮기고 옮긴 탭을 바로 고른다. 고른 탭만 Tab 순서에 들어간다 */
function MapTabs({
  prefix,
  selected,
  onSelect,
}: {
  prefix: string
  selected: MapViewKind
  onSelect: (view: MapViewKind) => void
}) {
  const buttons = useRef(new Map<MapViewKind, HTMLButtonElement>())
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = VIEWS.length - 1
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % VIEWS.length
        : event.key === 'ArrowLeft'
          ? (index + last) % VIEWS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    onSelect(VIEWS[next])
    buttons.current.get(VIEWS[next])?.focus()
  }
  return (
    <div role="tablist" aria-label="보기 방식" className={TAB_LIST}>
      {VIEWS.map((view, index) => (
        <button
          key={view}
          ref={(node) => {
            if (node === null) buttons.current.delete(view)
            else buttons.current.set(view, node)
          }}
          type="button"
          role="tab"
          id={`${prefix}-tab-${view}`}
          aria-selected={view === selected}
          aria-controls={`${prefix}-panel`}
          tabIndex={view === selected ? 0 : -1}
          className={TAB}
          onClick={() => onSelect(view)}
          onKeyDown={(event) => move(event, index)}
        >
          {VIEW_LABEL[view]}
        </button>
      ))}
    </div>
  )
}

function DesktopPanel({
  itemId,
  title,
  onClose,
  children,
}: {
  itemId: string
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  // 고른 항목이 바뀌면 패널 제목으로 옮긴다 — 키보드로 고른 사람이 바로 이어 읽는다. 이름만 바뀐 것(고치기)은 옮기지 않는다
  useEffect(() => heading.current?.focus(), [itemId])
  return (
    <aside aria-label="고른 항목" className={ASIDE}>
      <div className={ASIDE_HEAD}>
        <h2 ref={heading} tabIndex={-1} className={ASIDE_TITLE}>
          {title}
        </h2>
        <button type="button" aria-label="패널 닫기" className={CLOSE} onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {children}
    </aside>
  )
}

function MapBody({
  workspaceId,
  map,
  view,
  compact,
}: {
  workspaceId: string
  map: ProjectMap
  view: MapViewKind
  compact: boolean
}) {
  const [selection, setSelection] = useState<MapSelection>(null)
  // 패널을 닫으면 연 단추로 돌아간다. 그래프에서 열었으면 돌아갈 곳이 없다. 다음에 열 때 새로 적는다
  const opener = useRef<HTMLElement | null>(null)
  const node = selection === null ? undefined : map.nodeById.get(selection.id)

  const select = (next: MapSelection) => {
    if (selection === null && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement
    setSelection(next)
  }
  const close = () => {
    setSelection(null)
    // 시트는 닫힘이 끝난 뒤(포커스 가둠이 풀린 뒤) 스스로 돌려보낸다
    if (!compact) opener.current?.focus()
  }

  const content =
    view === 'graph' ? (
      <Suspense
        fallback={
          <div role="status" className="text-body text-dim">
            그래프를 불러오는 중이에요
          </div>
        }
      >
        <GraphView map={map} selection={selection} onSelect={select} />
      </Suspense>
    ) : (
      <MapListView map={map} selection={selection} onSelect={select} />
    )
  const panel =
    node === undefined ? null : (
      <SelectionPanel workspaceId={workspaceId} map={map} node={node} onSelect={select} />
    )

  if (compact)
    return (
      <>
        {content}
        <Sheet
          open={node !== undefined}
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={node?.label ?? ''}
          itemKey={node?.id}
          returnFocus={() => opener.current}
        >
          <div className="min-h-[0px] overflow-y-auto pb-8">{panel}</div>
        </Sheet>
      </>
    )
  return (
    <div className={node === undefined ? 'flex flex-col' : COLUMNS_WITH_PANEL}>
      <div className="min-w-[0px]">{content}</div>
      {node === undefined ? null : (
        <DesktopPanel itemId={node.id} title={node.label} onClose={close}>
          {panel}
        </DesktopPanel>
      )}
    </div>
  )
}

export interface ProjectMapViewProps {
  workspaceId: string
  /** URL 이 정한 보기. 없으면 페이지가 폭으로 정해 넘긴다 */
  view: MapViewKind
  onViewChange: (view: MapViewKind) => void
  /** 폭 768px 미만. 패널이 옆 칸이 아니라 아래 시트다 */
  compact: boolean
}

/**
 * 프로젝트 맵 화면 (#551). 주제·태스크를 그래프나 주제별 목록으로 보고, 누르면 같은 패널이 열린다.
 * 그래프는 나온 순서대로 다시 그려 볼 수 있다(재생). 맨 아래는 AI 에 줄 프로젝트 합본 내려받기다
 */
export function ProjectMapView({ workspaceId, view, onViewChange, compact }: ProjectMapViewProps) {
  const query = useQuery(projectMapQueryOptions(workspaceId))
  const state = queryView(query)
  const map = query.data
  const prefix = useId()

  return (
    <main className={MAIN}>
      <h1 className={TITLE}>프로젝트 맵</h1>
      <MapTabs prefix={prefix} selected={view} onSelect={onViewChange} />
      <div
        ref={panelTabStop}
        id={`${prefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-${view}`}
        className="flex flex-col gap-16"
      >
        {state === 'loading' ? (
          <div role="status" aria-label="프로젝트 맵을 불러오는 중">
            <Skeleton variant="block" height={360} className="rounded-16" />
          </div>
        ) : state === 'error' ? (
          <QueryErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : map === undefined ? null : map.nodes.length === 0 ? (
          <div className="flex justify-center py-48">
            <EmptyState
              titleAs="h2"
              title="아직 프로젝트 맵이 비어 있어요"
              description="회의에서 태스크가 생기면 여기에 나와요."
            />
          </div>
        ) : (
          <>
            {map.topicGroups.length === 0 ? (
              <p className={NOTE}>
                아직 주제가 없어요. 회의 요약이 만들어지면 주제와 결정이 생겨요.
              </p>
            ) : null}
            <MapBody workspaceId={workspaceId} map={map} view={view} compact={compact} />
          </>
        )}
      </div>
      <ProjectBundleDownload workspaceId={workspaceId} />
    </main>
  )
}
