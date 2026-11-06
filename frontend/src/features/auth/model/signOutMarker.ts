/*
 * 직접 로그아웃한 기록 항목 (#411). 세션이 null 이 되면 RequireAuth 가 이전 주소로 다시 그려지고, 그 이동이 로그아웃의 이동을 덮는다.
 * 그래서 이 항목은 일부러 나간 것이니 돌아갈 경로를 붙이지 말라고 알려 둔다.
 * 기록 항목(location.key)으로 가려서, 나중에 보호 주소를 비로그인으로 열면 다시 돌아갈 경로가 붙는다.
 * 첫 항목의 key 는 늘 'default' 라 다음 로그인과 앱 한 벌을 버릴 때 지운다.
 */

let signedOutKey: string | null = null

export function markSignedOutAt(locationKey: string): void {
  signedOutKey = locationKey
}

export function wasSignedOutAt(locationKey: string): boolean {
  return signedOutKey === locationKey
}

export function clearSignOutMark(): void {
  signedOutKey = null
}
