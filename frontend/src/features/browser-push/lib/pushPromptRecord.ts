/*
 * 알림 띠를 닫은 기록 (#411). 푸시 구독이 기기 × 계정이라(계약 §5.7) 이 기기의 localStorage 에 계정별로 둔다 — 공간과는 상관없다.
 * 막힌 저장소(사생활 모드 등)에서는 닫지 않은 것으로 보고, 쓰기는 조용히 넘어간다 — 그 화면에서는 닫혀 있다
 */

const keyOf = (userId: string) => `browser-push-prompt-closed:${userId}`

export function isPushPromptClosed(userId: string): boolean {
  try {
    return window.localStorage.getItem(keyOf(userId)) !== null
  } catch {
    return false
  }
}

export function closePushPrompt(userId: string): void {
  try {
    window.localStorage.setItem(keyOf(userId), '1')
  } catch {
    // 기록하지 못해도 지금 띠는 닫는다
  }
}
