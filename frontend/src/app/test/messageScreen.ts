import { screen, within } from '@testing-library/react'
import { http } from 'msw'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'

/* M8 메시지 화면의 MSW 모드 통합 테스트가 함께 쓰는 조회·응답 붙잡기. 화면 구조(영역 이름)는 MessageInbox 가 정한다 */

export const list = () => within(screen.getByRole('complementary', { name: '메시지 목록' }))
export const detail = () => within(screen.getByRole('region', { name: '메시지 내용' }))
export const reviewList = () => list().getByRole('region', { name: /^보내기 전 확인/ })
export const threadList = () => list().getByRole('region', { name: '대화' })
export const conversation = () => detail().getByRole('region', { name: '대화 내용' })

/** 화면 읽기가 읽는 글자. 장식(aria-hidden 아바타 글자·답장 대기 점·아이콘)은 뺀다 */
export function readable(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
  return copy.textContent
}
export const rowTexts = (region: HTMLElement) => within(region).getAllByRole('link').map(readable)
/** 목록에서 지금 골라진 행들 */
export const current = () =>
  list()
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')

type Method = 'get' | 'post' | 'patch'

/**
 * 그 요청의 응답을 붙잡는다. 풀면 기본 handler 가 답한다. `calls()` 는 붙잡는 동안 들어온 요청 수다 — 중복 제출을 센다.
 * `delay()` 대신 쓴다 (msw-guide 「지킬 규칙」)
 */
export function hold(path: string, method: Method = 'get') {
  const gate = deferred()
  let calls = 0
  server.use(
    http[method](`/api/v1${path}`, async () => {
      calls += 1
      await gate.promise
      return undefined
    }),
  )
  return { resolve: () => gate.resolve(), calls: () => calls }
}

/**
 * 화면의 목록 칸 안에서 그 뼈대를 찾는다. 라우트 뼈대(#510)도 같은 뼈대 컴포넌트를 그리지만 랜드마크가 없다(aria-hidden) —
 * 화면이 그려진 뒤의 목록 칸으로 좁혀 화면 안 뼈대만 본다
 */
export async function listSkeleton(): Promise<HTMLElement> {
  const aside = await screen.findByRole('complementary', { name: '메시지 목록' })
  return within(aside).getByTestId('message-list-skeleton')
}
