import { ITEM, ITEM_SIZE, ITEM_TONE, TRACK } from './styles'
import type { SegmentedSize } from './styles'

export interface SegmentedFrameProps {
  items: readonly { value: string; label: string }[]
  /** 고른 칸 */
  selected: string
  /** 기본 'sm' */
  size?: SegmentedSize
}

/**
 * Segmented 의 모양만 그린다 — 라우트 뼈대(#510)가 화면과 같은 자리·크기로 쓴다. 누를 수 없고 Radix 를 불러오지 않는다.
 * 뼈대 안이라 부르는 쪽이 aria-hidden 으로 감싼다. 라우트 뼈대는 첫 번들에 들어가므로 index 가 아니라 이 파일을 직접 가져온다 —
 * index 는 Segmented(Radix) 를 함께 끌어온다
 */
export function SegmentedFrame({ items, selected, size = 'sm' }: SegmentedFrameProps) {
  return (
    <div className={TRACK}>
      {items.map(({ value, label }) => (
        <span
          key={value}
          data-state={value === selected ? 'on' : 'off'}
          className={[ITEM, ITEM_SIZE[size], ITEM_TONE.default].join(' ')}
        >
          {label}
        </span>
      ))}
    </div>
  )
}
