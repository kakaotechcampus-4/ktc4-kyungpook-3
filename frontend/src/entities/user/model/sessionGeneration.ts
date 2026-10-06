import { captureSessionScope, endSessionScope } from '@/shared/api/sessionScope'

/**
 * 세션 세대. 세션이 끝나거나 바뀔 때(로그아웃·로그인·가입·만료·앱 폐기)마다 하나 오른다.
 * 세대와 그 취소 신호는 shared 의 세션 범위(`shared/api/sessionScope`) 한 곳에 있다 — 공통 요청이 출발 세대로 401 알림을 거르고,
 * 직접 요청이 세대의 신호로 취소된다 (U4 r3 M04). 여기는 사용자 계층이 쓰는 이름이다.
 *
 * 늦게 끝나는 비동기 작업(연동 재조회·업로드 응답·OAuth 복귀 확인)은 시작할 때 `captureSession()` 으로 세대를 잡아 두고,
 * 끝났을 때 받은 함수로 아직 같은 세션인지 묻는다. 다르면 결과를 버린다 — 알림·모달·이동·추적 등록·캐시 쓰기를 하지 않는다.
 *
 * 컴포넌트의 mounted ref 로는 부족하다. 로그아웃의 로그인 이동은 transition 이라 이전 화면이 아직 마운트된 채
 * 세션 정리(요청 취소)가 먼저 일어나고, 취소된 작업의 뒷처리가 그 틈에 돈다 (U4 r1 M02).
 * 세대는 세션을 끝내는 코드가 **동기로** 올리므로, 취소·401 로 떨어진 작업이 뒤따라 돌 때는 이미 바뀌어 있다.
 */

/** 지금 세대를 잡아 둔다. 돌려준 함수는 그 뒤 세션이 끝나거나 바뀌지 않았으면 true 다 */
export function captureSession(): () => boolean {
  return captureSessionScope().isCurrent
}

/** 세션이 끝나거나 바뀌는 순간 부른다. 요청 취소·캐시 정리보다 먼저 부른다. 이전 세대의 직접 요청도 여기서 취소된다 */
export function advanceSessionGeneration(): void {
  endSessionScope()
}
