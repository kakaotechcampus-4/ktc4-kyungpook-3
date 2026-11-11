import { Skeleton } from '@/shared/ui/skeleton'
import type { MapViewKind } from './ProjectMapView'
import { GRAPH_FRAME, MAIN, MAP_TAB, MAP_TABS, MAP_TOOLBAR, TITLE } from './frame'

const NODES = [
  [24, 36, 24],
  [48, 51, 24],
  [73, 30, 24],
  [15, 22, 12],
  [17, 55, 12],
  [34, 21, 12],
  [41, 73, 12],
  [59, 67, 12],
  [67, 15, 12],
  [86, 43, 12],
] as const

export function ProjectMapBodySkeleton({
  view,
  label = '프로젝트 맵을 불러오는 중',
}: {
  view: MapViewKind
  label?: string
}) {
  return (
    <div role="status" aria-label={label} data-testid="project-map-skeleton-body">
      {view === 'graph' ? (
        <div aria-hidden="true" className={GRAPH_FRAME} data-testid="project-map-skeleton-graph">
          <svg
            viewBox="0 0 800 500"
            className="absolute inset-0 h-full w-full fill-none stroke-line"
          >
            <path d="M192 180 384 255 584 150M192 180 120 110M192 180 136 275M192 180 272 105M384 255 328 365M384 255 472 335M584 150 536 75M584 150 688 215" />
          </svg>
          {NODES.map(([left, top, size], index) => (
            <Skeleton
              key={index}
              variant="circle"
              width={size}
              height={size}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%`, top: `${top}%` }}
            />
          ))}
          <div className="absolute bottom-12 left-12 flex items-center gap-6">
            {[70, 32, 32, 82].map((width, index) => (
              <Skeleton
                key={index}
                variant="block"
                width={width}
                height={32}
                className="rounded-9"
              />
            ))}
          </div>
        </div>
      ) : (
        <div aria-hidden="true" className="flex flex-col gap-28">
          {[0, 1, 2].map((section) => (
            <div key={section} className="flex flex-col gap-8">
              <div className="flex h-[24.5px] items-center">
                <Skeleton width={section === 1 ? 116 : 154} />
              </div>
              <div className="flex flex-col">
                {[0, 1, 2].map((row) => (
                  <div
                    key={row}
                    className="flex min-h-[45.25px] items-center gap-12 border-b border-line py-12"
                  >
                    <Skeleton width={64} className="shrink-0" />
                    <Skeleton width={`${row === 1 ? 58 : 80}%`} className="min-w-0 flex-1" />
                    <Skeleton width={42} className="shrink-0" />
                    <Skeleton width={55} className="shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectMapRouteSkeleton({ view }: { view: MapViewKind }) {
  return (
    <main aria-busy="true" className={MAIN} data-testid="project-map-skeleton-frame">
      <h1 aria-hidden="true" className={TITLE}>
        프로젝트 맵
      </h1>
      <div aria-hidden="true" className={MAP_TOOLBAR} data-testid="project-map-skeleton-toolbar">
        <div className={MAP_TABS}>
          {(['graph', 'list'] as const).map((kind) => (
            <span key={kind} className={MAP_TAB} aria-selected={kind === view}>
              {kind === 'graph' ? '그래프' : '목록 보기'}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-end gap-8">
            {['시작일', '종료일'].map((label) => (
              <div key={label} className="flex w-[180px] flex-col">
                <span className="mb-6 text-[12px] leading-[21px] text-sub">{label}</span>
                <Skeleton variant="block" height={44} className="rounded-9" />
              </div>
            ))}
            <span className="inline-flex h-44 items-center rounded-9 bg-surface-selected px-22 text-[14.5px] font-semibold text-transparent">
              프로젝트 내려받기
            </span>
          </div>
        </div>
      </div>
      <ProjectMapBodySkeleton view={view} />
      <div
        aria-hidden="true"
        className="absolute right-48 bottom-24 left-48 flex flex-col gap-8 max-md:right-20 max-md:left-20"
      >
        <p className="text-caption text-sub">
          <span className="text-dim">내려받을 기간 ·</span> 전체 기간
        </p>
        <p className="text-caption text-dim">
          팀원 발언 요약이 들어 있어요. 외부 AI 에 첨부할 때 주의해 주세요.
        </p>
      </div>
    </main>
  )
}
