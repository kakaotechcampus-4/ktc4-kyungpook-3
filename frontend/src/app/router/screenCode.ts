import { createRoutesFromElements, matchRoutes } from 'react-router'
import type { RouteObject } from 'react-router'
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'

/*
 * 지연 로드 화면과 그 화면 코드 부르기(`load`)의 짝 (#536, #539). `lazyPage` 가 만든 화면마다 적는다.
 * 경로 표의 화면 칸이 이 화면을 그대로 들고 있으므로, 경로를 경로 표에 맞춰 보면 그 경로의 `load` 를 찾는다 —
 * 같은 import 를 미리 부르기용으로 두 번 적지 않고, 경로 모양을 경로 표 밖에 다시 적지 않는다.
 * `lazyPage` 와 다른 파일이다. 지연 로드를 바꿔 끼우는 테스트(vi.mock('./router/lazyPage'))에서도 이 짝은 그대로 남는다.
 */
const loads = new WeakMap<ReactElement, () => Promise<unknown>>()

/** 지연 로드 화면과 그 코드 부르기를 짝짓는다. `load` 는 한 번으로 묶여 있어야 한다 — 미리 부르기와 지연 로드가 같은 요청을 쓴다 */
export function registerScreenCode(page: ReactElement, load: () => Promise<unknown>): void {
  loads.set(page, load)
}

/** 화면 칸(오류 칸 등으로 감싼 것 포함)에서 지연 로드 화면을 찾아 그 `load` 를 돌려준다 */
function loadOf(node: ReactNode): (() => Promise<unknown>) | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined
  return loads.get(node) ?? loadOf(node.props.children)
}

/**
 * 경로 표로 「경로 → 그 화면 코드 미리 부르기」 함수를 만든다. 경로가 지연 로드 화면에 닿지 않으면(없는 경로, 바로 그리는 화면)
 * 아무것도 하지 않는다. 이미 불렀으면 그 요청을 다시 쓴다. 실패는 삼킨다 — 화면을 열 때 지연 로드가 다시 부른다
 */
export function screenCodePreloader(routes: ReactNode): (path: string) => void {
  let table: RouteObject[] | null = null
  return (path) => {
    table ??= createRoutesFromElements(routes)
    const leaf = matchRoutes(table, path)?.at(-1)
    const load = loadOf(leaf?.route.element)
    load?.().catch(() => {
      // 미리 부르기의 실패는 알리지 않는다
    })
  }
}
