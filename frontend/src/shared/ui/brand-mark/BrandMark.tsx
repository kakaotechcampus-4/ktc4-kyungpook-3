export type BrandMarkSize = 'sm' | 'md' | 'lg'

export interface BrandMarkProps {
  /** sm 22px(랜딩 푸터) · md 24px(랜딩·앱 헤더) · lg 30px(로그인·회원가입). 기본 md */
  size?: BrandMarkSize
  className?: string
}

/* 캔버스 실측: 면 크기 / 반경 / 안쪽 글리프 크기 */
const BOX: Record<BrandMarkSize, string> = {
  sm: 'h-22 w-22 rounded-6',
  md: 'h-24 w-24 rounded-7',
  lg: 'h-[30px] w-[30px] rounded-9',
}

const GLYPH: Record<BrandMarkSize, number> = { sm: 14, md: 15, lg: 19 }

/**
 * 먹 사각형 안의 `M` 글리프. 장식이다(`aria-hidden`) — 이름은 옆 글자나 감싼 링크의 `aria-label` 이 준다.
 * Landing·Login·Signup·Main 캔버스의 같은 SVG 를 옮겼다.
 */
export function BrandMark({ size = 'md', className }: BrandMarkProps) {
  const glyph = GLYPH[size]
  return (
    <span
      aria-hidden="true"
      className={['inline-flex shrink-0 items-center justify-center bg-ink', BOX[size], className]
        .filter(Boolean)
        .join(' ')}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 14 14" fill="none">
        <path
          d="M2 11V3.5l3.5 4.5L9 3.5V11"
          className="stroke-surface"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M11.6 5.2v2.4"
          className="stroke-surface"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
