/* 연결 카드의 표식. 카드와 그 라우트 뼈대(#510)가 같이 쓴다 */

/* Settings 캔버스 `연결` 절의 Discord 표식 */
export function DiscordMark() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.7 5.1A18 18 0 0 0 15.4 3.8l-.5 1.1a16 16 0 0 0-5.8 0l-.5-1.1a18 18 0 0 0-4.3 1.3C1.6 9.1.9 13 .9 16.8a17 17 0 0 0 5.3 2.7l1.1-1.8-1.7-.9.4-.3a13 13 0 0 0 12 0l.4.3-1.7.9 1.1 1.8a17 17 0 0 0 5.3-2.7c0-4.4-.9-8-3.4-11.7ZM8.1 14.6c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.8 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.7.9 1.7 2-.7 2-1.7 2Z" />
    </svg>
  )
}

export function NotionMark() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8.5 16.5v-9l7 9v-9" strokeLinecap="round" />
    </svg>
  )
}
