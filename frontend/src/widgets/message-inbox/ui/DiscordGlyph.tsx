/** Discord 표식 — Messages 캔버스의 미리보기 카드 머리 그대로다. 장식이라 aria-hidden 이고 색은 글자색을 따른다 */
export function DiscordGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.7 5.1A18 18 0 0 0 15.4 3.8l-.5 1.1a16 16 0 0 0-5.8 0l-.5-1.1a18 18 0 0 0-4.3 1.3C1.6 9.1.9 13 .9 16.8a17 17 0 0 0 5.3 2.7l1.1-1.8-1.7-.9.4-.3a13 13 0 0 0 12 0l.4.3-1.7.9 1.1 1.8a17 17 0 0 0 5.3-2.7c0-4.4-.9-8-3.4-11.7ZM8.1 14.6c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.8 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.7.9 1.7 2-.7 2-1.7 2Z" />
    </svg>
  )
}
