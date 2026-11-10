import type { Bounds, Point } from './layout'

/** 화면 좌표 = 배치 좌표 × k + (x, y). 그래프 상자는 이 고정 크기 좌표계(viewBox)다 */
export interface Viewport {
  x: number
  y: number
  k: number
}

export const VIEW_WIDTH = 960
export const VIEW_HEIGHT = 600

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 6
/** 이만큼 확대하면 태스크 이름을 그린다. 그 아래에서는 이름이 겹쳐 읽을 수 없다 */
export const TASK_LABEL_ZOOM = 1.6
export const ZOOM_STEP = 1.4

const FIT_PADDING = 48

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

export function toScreen({ x, y }: Point, viewport: Viewport): Point {
  return { x: x * viewport.k + viewport.x, y: y * viewport.k + viewport.y }
}

/** 화면의 한 점(`anchor`)을 제자리에 둔 채 배율을 `factor` 배 한다 */
export function zoomAt(viewport: Viewport, factor: number, anchor: Point): Viewport {
  const k = clampZoom(viewport.k * factor)
  const ratio = k / viewport.k
  return {
    k,
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
  }
}

export function zoomCenter(viewport: Viewport, factor: number): Viewport {
  return zoomAt(viewport, factor, { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 })
}

/** 배치 전체가 들어오게 한다. 작은 맵을 크게 키우지는 않는다(배율 1 까지) */
export function fitViewport(bounds: Bounds): Viewport {
  const width = Math.max(bounds.maxX - bounds.minX, 1)
  const height = Math.max(bounds.maxY - bounds.minY, 1)
  const k = clampZoom(
    Math.min(1, (VIEW_WIDTH - FIT_PADDING * 2) / width, (VIEW_HEIGHT - FIT_PADDING * 2) / height),
  )
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return { k, x: VIEW_WIDTH / 2 - centerX * k, y: VIEW_HEIGHT / 2 - centerY * k }
}
