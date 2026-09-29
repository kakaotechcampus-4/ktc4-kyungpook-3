/**
 * 현재 탭을 앱 밖(또는 앱의 새 문서)으로 옮긴다. OAuth 시작처럼 라우터가 아닌 전체 이동이 필요할 때만 쓴다 (D-158).
 * 테스트는 이 모듈을 바꿔 끼워 주소만 확인한다 — jsdom 은 실제 이동을 하지 못한다.
 */
export function leaveApp(url: string): void {
  window.location.assign(url)
}
