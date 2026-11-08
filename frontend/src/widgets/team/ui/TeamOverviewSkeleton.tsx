import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { Skeleton } from '@/shared/ui/skeleton'
import { COLUMNS, HEADER, LEAD, LEAD_TEXT, MAIN, TITLE } from './frame'
import { MemberListSkeleton } from './MemberListSkeleton'
import { SIDE_CARD, SIDE_TITLE } from './teamStyles'

/**
 * 팀 화면의 라우트 뼈대 (#510). TeamOverview 가 팀원·태스크를 기다릴 때와 같은 틀이다 — 제목·안내, PM 의 `팀원 관리`,
 * 팀원 목록 뼈대(#508), 오른쪽 `연결되지 않은 계정` 카드. `먼저 챙길 것` 은 데이터가 있어야 생겨 넣지 않는다.
 * 정해진 글자·버튼도 자리표시라 누를 수 없고 스크린리더에서 뺀다. 기다림은 main 의 aria-busy 가 알린다
 */
export function TeamOverviewSkeleton({ isPm }: { isPm: boolean }) {
  return (
    <main aria-busy="true" className={MAIN}>
      <div aria-hidden="true" className={HEADER}>
        <div className="flex flex-col gap-5">
          <p className={TITLE}>팀</p>
          <p className={LEAD}>{LEAD_TEXT}</p>
        </div>
        {isPm ? (
          <Button
            size="md-compact"
            tabIndex={-1}
            className="pointer-events-none min-h-[36px] gap-7"
            startIcon={<Icon name="users" size={15} className="text-sub" />}
          >
            팀원 관리
          </Button>
        ) : null}
      </div>
      <div aria-hidden="true" className={COLUMNS}>
        <div className="flex flex-col gap-[38px]">
          <div>
            <MemberListSkeleton />
          </div>
        </div>
        <div className="flex flex-col gap-14">
          <div className={`${SIDE_CARD} gap-12 border-line`}>
            <p className={SIDE_TITLE}>연결되지 않은 계정</p>
            <div>
              <Skeleton lines={2} />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
