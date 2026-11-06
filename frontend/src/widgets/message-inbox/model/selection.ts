import type { Bundle, MessageInbox } from '@/entities/message'

export type DetailSelection =
  | { kind: 'invalid' }
  | { kind: 'thread'; threadId: string }
  | { kind: 'bundle'; bundle: Bundle }
  | { kind: 'loading' }
  | { kind: 'choose' }
  | { kind: 'compose' }

/** 파라미터가 없으면 아직 승인하지 않은 첫 묶음을 연다. 전부 승인했으면 목록의 첫 묶음이다 */
function defaultBundle(bundles: readonly Bundle[]): Bundle | undefined {
  return bundles.find((bundle) => bundle.stage === 'awaitingApproval') ?? bundles[0]
}

/**
 * URL 과 목록으로 오른쪽 칸을 정한다.
 * 팀원은 보낼 메시지를 받지 않는다. 대화 주소가 없으면 첫 대화를 열고, 주소는 그대로 둔다.
 * 재촉 만들기는 목록을 기다리지 않는다 — 고른 묶음보다 앞선다. 만들 수 없는 사람이면 부른 쪽이 composing 을 끈다
 */
export function selectDetail(input: {
  inbox: MessageInbox | undefined
  threadId: string | null
  bundleId: string | null | undefined
  invalidPath: boolean
  composing: boolean
}): DetailSelection {
  if (input.invalidPath) return { kind: 'invalid' }
  if (input.threadId !== null) return { kind: 'thread', threadId: input.threadId }
  if (input.composing) return { kind: 'compose' }
  if (input.inbox === undefined) return { kind: 'loading' }
  if (input.inbox.viewer === 'member') {
    const first = input.inbox.threads[0]
    return first === undefined ? { kind: 'choose' } : { kind: 'thread', threadId: first.id }
  }
  const bundle =
    input.bundleId === undefined
      ? defaultBundle(input.inbox.bundles)
      : input.inbox.bundles.find(({ id }) => id === input.bundleId)
  return bundle === undefined ? { kind: 'choose' } : { kind: 'bundle', bundle }
}
