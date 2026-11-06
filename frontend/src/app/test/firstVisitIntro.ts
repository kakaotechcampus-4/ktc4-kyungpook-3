/**
 * 이 기기에서 그 계정이 첫 대시보드 인트로를 이미 닫은 것으로 둔다 (#430).
 * 온보딩을 끝내고 대시보드를 확인하는 테스트가 인트로 대화상자에 가리지 않게 쓴다. 인트로 자체는 firstVisitIntro.test.tsx 가 본다.
 * 키는 entities/user 의 introRecord 와 같다 — 바뀌면 인트로가 다시 떠서 그 테스트들이 대시보드를 찾지 못하고 실패한다
 */
export function seenDashboardIntro(userId = 'us_01'): void {
  window.localStorage.setItem(`first-visit-intro:account:${userId}`, 'seen')
}
