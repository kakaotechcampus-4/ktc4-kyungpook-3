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

/** 넓은 화면은 목록과 상세를 나란히(both), 휴대폰은 둘 중 하나만 화면 전체로 보인다 (H-4·H-5) */
export type InboxPane = 'both' | 'list' | 'detail'

/**
 * 휴대폰에서는 주소가 무엇을 가리킬 때만 상세가 열린다 — 넓은 화면처럼 첫 항목을 대신 고르지 않고 목록을 보인다.
 * 고른 것은 주소에만 있으므로 폭이 768 을 넘나들어도 같은 항목이 열린다
 */
export function inboxPane(input: {
  compact: boolean
  threadId: string | null
  bundleId: string | null | undefined
  invalidPath: boolean
  composing: boolean
}): InboxPane {
  if (!input.compact) return 'both'
  const addressed =
    input.invalidPath || input.threadId !== null || input.bundleId !== undefined || input.composing
  return addressed ? 'detail' : 'list'
}

/**
 * 휴대폰 목록이 상세를 숨겨 들고 있을지 (#478). 넓은 화면에서 폭만 줄여 목록이 됐으면 그 상세를 숨겨 둔다 — 다시 넓히면
 * 쓰던 답장이 그대로다. 이동으로 목록에 왔으면 상세를 그리지 않는다 — 이탈 확인에서 버린 답장이 숨은 채 남지 않는다.
 * 숨겨 둔 상세가 있는 채 이동하면 판(epoch)을 올려 상세를 새로 그린다. 이동은 기록 항목(location key)이 바뀐 것이다
 */
export interface PaneMemory {
  pane: InboxPane
  locationKey: string
  keep: boolean
  epoch: number
}

export function nextPaneMemory(prev: PaneMemory, pane: InboxPane, locationKey: string): PaneMemory {
  if (prev.pane === pane && prev.locationKey === locationKey) return prev
  const navigated = prev.locationKey !== locationKey
  return {
    pane,
    locationKey,
    keep: pane === 'list' && !navigated && (prev.pane === 'both' || prev.keep),
    epoch: navigated && prev.keep ? prev.epoch + 1 : prev.epoch,
  }
}
