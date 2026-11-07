/*
 * 정리 진행 토스트 (#424). 토스트 자리 맨 아래 고정 칸, 또는 화면이 둔 자리(메시지 화면, #474)에 회의마다 카드 하나(section)다.
 * 짧은 토스트(data-toast-key)와 따로 찾는다
 */

/** 지금 그려진 진행 토스트 카드 전부. 접힌 알약도 카드 하나로 센다 */
export function processingSignals(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      ['pinned-toast-slot', 'pinned-toast-host']
        .map((id) => `[data-testid="${id}"] :is(section, button[aria-expanded="false"])`)
        .join(', '),
    ),
  )
}

/** 글자에 text 가 들어간 진행 토스트 카드 */
export function signalsWith(text: string): HTMLElement[] {
  return processingSignals().filter((node) => node.textContent?.includes(text))
}
