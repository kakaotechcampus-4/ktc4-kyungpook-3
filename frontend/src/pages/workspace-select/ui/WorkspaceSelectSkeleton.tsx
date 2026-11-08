import { BrandMark } from '@/shared/ui/brand-mark'
import { Skeleton } from '@/shared/ui/skeleton'
import { COLUMN, LEAD, PAGE, TITLE, TOP } from './styles'

/**
 * 공간 선택 화면의 라우트 뼈대 (#510). 화면과 같은 머리 줄 · 제목 · 안내이고, 목록 자리는 목록이 기다릴 때(WorkspaceChoiceList)와 같은
 * 세 줄 뼈대다. 머리 줄의 아바타는 사용자 메뉴(UserMenu)와 같은 크기의 원이다
 */
export function WorkspaceSelectSkeleton() {
  return (
    <div className={PAGE}>
      <div aria-hidden="true" className={TOP}>
        <span className="inline-flex">
          <BrandMark />
        </span>
        <Skeleton variant="circle" width={29} height={29} />
      </div>
      <main aria-busy="true" className={COLUMN}>
        <div aria-hidden="true" className="flex flex-col gap-6">
          <p className={TITLE}>워크스페이스 선택</p>
          <p className={LEAD}>들어갈 워크스페이스를 골라 주세요.</p>
        </div>
        <Skeleton lines={3} />
      </main>
    </div>
  )
}
