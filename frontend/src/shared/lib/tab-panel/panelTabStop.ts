const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
]
  .map((selector) => `${selector}:not([tabindex^="-"])`)
  .join(',')

function sync(panel: HTMLElement) {
  const next = panel.querySelector(TABBABLE) === null ? '0' : null
  // 같은 값을 다시 쓰면 그것도 변경 기록이라 관찰이 끝없이 돈다
  if (panel.getAttribute('tabindex') === next) return
  if (next === null) panel.removeAttribute('tabindex')
  else panel.setAttribute('tabindex', next)
}

/**
 * `role="tabpanel"` 에 거는 ref. 패널 안에 Tab 으로 갈 요소가 없을 때만 패널이 Tab 순서에 들어간다 (WAI-ARIA APG 탭 패턴).
 * 글만 있는 패널은 키보드로 닿아 읽을 수 있고, 링크·버튼이 있는 패널은 Tab 이 패널을 거치지 않고 그 요소로 간다.
 * 내용이 불러오기·빈 상태·목록으로 바뀌므로 DOM 이 바뀔 때마다 다시 본다.
 * 패널에 `tabIndex` prop 을 함께 주지 않는다 — React 가 다시 그릴 때 그 값으로 덮는다.
 */
export function panelTabStop(panel: HTMLElement | null) {
  if (panel === null) return
  sync(panel)
  const observer = new MutationObserver(() => sync(panel))
  observer.observe(panel, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'tabindex', 'href', 'type', 'contenteditable'],
  })
  return () => observer.disconnect()
}
