/**
 * 세션 범위. 세션이 끝나거나 바뀔 때(로그아웃·로그인·가입·만료·앱 폐기)마다 세대가 하나 오르고, 그 세대의 취소 신호가 abort 된다.
 *
 * 「끝난 세션의 요청은 어떤 부작용도 내지 못한다」를 이 한 곳에서 지킨다 (U4 r3 M04).
 * - 공통 요청(`request`)은 출발할 때 세대를 잡아 두고, 401 을 받았을 때 **그 세대가 아직 지금 세대일 때만** 세션 만료를 알린다.
 *   이전 세션에서 보낸 요청의 늦은 401 이 다시 로그인한 새 세션을 끝내지 않는다. 지금 세션의 401 은 그대로 만료다.
 * - Query 의 조회는 세션을 끝내는 코드가 세대를 올린 뒤 `cancelQueries`·`clear` 로 거두고, 그 signal 이 요청을 끊는다.
 *   캐시 밖에서 세션 경계를 넘는 요청이 있으면 이 세대의 `signal` 로 보낸다 — 세션이 끝나면 함께 취소된다.
 *   M5 의 판정 조회는 따로 요청하지 않고 공유 Query 를 묻는다(`fetchFresh`, U4 r4 M06).
 * - 늦게 끝나는 뒷처리(알림·모달·이동·추적 등록)는 `isCurrent` 로 아직 같은 세션인지 묻고, 다르면 버린다.
 *
 * 세대는 세션을 끝내는 코드가 **동기로** 올린다. 취소·401 로 떨어진 작업이 뒤따라 돌 때는 이미 바뀌어 있다 (U4 r1 M02).
 * 도메인을 모르는 전송 사실(이 요청이 어느 세션에서 출발했나)이라 shared 에 둔다. 사용자 계층은 `entities/user` 가 감싼다.
 */
export interface SessionScope {
  /** 잡아 둔 뒤 세션이 끝나거나 바뀌지 않았으면 true */
  isCurrent: () => boolean
  /** 그 세션이 끝나면 abort 된다 */
  signal: AbortSignal
}

let generation = 0
let controller = new AbortController()

/** 지금 세션 범위를 잡아 둔다 */
export function captureSessionScope(): SessionScope {
  const at = generation
  return { isCurrent: () => at === generation, signal: controller.signal }
}

/** 세션이 끝나거나 바뀌는 순간 부른다. 세대를 먼저 올린 뒤 이전 세대의 요청을 취소한다 — 취소로 떨어진 작업은 바뀐 세대를 본다 */
export function endSessionScope(): void {
  generation += 1
  const ended = controller
  controller = new AbortController()
  ended.abort()
}
