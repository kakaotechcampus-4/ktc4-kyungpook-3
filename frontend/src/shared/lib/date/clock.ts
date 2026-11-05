let read: () => number = () => Date.now()

/** 지금 시각(ms). 브라우저 MSW(개발 서버·Storybook)에서는 목과 같은 고정 시각이다 */
export function now(): number {
  return read()
}

/**
 * 시계를 한 시각에 멈춘다. 목 handler 는 고정 시각(MOCK_NOW)으로 지난 시각을 판단하므로,
 * 화면도 같은 시계를 써야 `지남` 표시와 409 응답이 어긋나지 않는다
 */
export function fixClock(at: number): void {
  read = () => at
}
