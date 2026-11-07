import { Skeleton } from '@/shared/ui/skeleton'
import { BODY, CARD, ICON_BOX, NAME, SECTION, TITLE_ROW } from './connectionStyles'
import { DiscordMark, NotionMark } from './marks'

/**
 * 연결 카드의 라우트 뼈대 (#510). Discord·Notion 카드가 연동 상태를 기다릴 때와 같다 — 표식 · 이름 · 설명 줄 뼈대.
 * 상태 배지와 버튼은 상태를 받아야 생겨 넣지 않는다. 부르는 쪽이 aria-hidden 으로 감싼다
 */
export function ConnectionCardSkeleton({ service }: { service: 'discord' | 'notion' }) {
  return (
    <div className={SECTION}>
      <div className={CARD}>
        <span className={ICON_BOX}>{service === 'discord' ? <DiscordMark /> : <NotionMark />}</span>
        <div className={BODY}>
          <div className={TITLE_ROW}>
            <h3 className={NAME}>{service === 'discord' ? 'Discord' : 'Notion'}</h3>
          </div>
          <div>
            <Skeleton width={220} />
          </div>
        </div>
      </div>
    </div>
  )
}
