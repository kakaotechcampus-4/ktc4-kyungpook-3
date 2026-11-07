import { Skeleton } from '@/shared/ui/skeleton'

/*
 * 태스크 상세를 기다리는 뼈대 (#508). 실제 화면과 같은 틀이다 — 머리(이름 · 담당 · 마감)와 상태 고르기, 태스크 정보 패널,
 * 변경 이력. 정해진 글자(패널 이름 · 칸 이름 · 상태 이름 · 변경 이력)는 글자로 그린다. 자리표시라 스크린리더에서 뺀다.
 * 치수는 TaskDetail(HEADER · TITLE · SUBLINE), TaskInfoPanel(PANEL · CELLS · TERM · PLAIN_VALUE), TaskHistory(SECTION_TITLE)와 같다
 */
const STATUSES = ['할 일', '진행 중', '막힘', '완료'] as const
const TERMS = ['담당자', '마감', 'Notion'] as const

export function TaskDetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-22">
      <div className="flex flex-wrap items-end justify-between gap-x-24 gap-y-16">
        <div className="flex flex-col gap-8">
          <div className="flex h-lh items-center text-[30px] leading-[1.3]">
            <Skeleton variant="block" width={260} height={30} className="rounded-8" />
          </div>
          <div className="flex h-lh items-center text-[15px]">
            <Skeleton width={180} />
          </div>
        </div>
        <div className="flex gap-2 rounded-12 bg-control p-4">
          {STATUSES.map((status) => (
            <span
              key={status}
              className="inline-flex min-h-36 items-center px-12 text-control text-sub"
            >
              {status}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-12 rounded-16 bg-surface-sunken px-20 py-18">
        <p className="text-caption font-normal text-dim">태스크 정보</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-start gap-16">
          {TERMS.map((term) => (
            <div key={term} className="flex min-w-[0px] flex-col gap-6">
              <span className="text-[13px] text-sub">{term}</span>
              <div className="flex min-h-44 items-center">
                <Skeleton width={96} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col">
        <p className="pb-4 text-[17px] leading-[1.55] font-bold tracking-h2 text-ink">변경 이력</p>
        {[52, 40].map((width) => (
          <div key={width} className="flex h-[50px] items-center border-b border-line">
            <Skeleton width={`${width}%`} />
          </div>
        ))}
      </div>
    </div>
  )
}
