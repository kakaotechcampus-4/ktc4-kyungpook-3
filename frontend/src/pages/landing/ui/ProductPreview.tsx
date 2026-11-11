import { BrandMark } from '@/shared/ui/brand-mark'
import { Icon } from '@/shared/ui/icon'
import type { IconName } from '@/shared/ui/icon'

const NAVIGATION: readonly { label: string; compact: string | null; icon: IconName }[] = [
  { label: '대시보드', compact: '홈', icon: 'home' },
  { label: '회의록', compact: '회의록', icon: 'minutes' },
  { label: '태스크', compact: '태스크', icon: 'tasks' },
  { label: '메시지', compact: '메시지', icon: 'message' },
  { label: '프로젝트 맵', compact: null, icon: 'graph' },
  { label: '팀', compact: '팀', icon: 'team' },
]

const STATUS_TABS: readonly { label: string; count: number }[] = [
  { label: '전체', count: 13 },
  { label: '확인 필요', count: 3 },
  { label: '진행 중', count: 7 },
  { label: '완료', count: 3 },
]

const PREVIEW_TASKS: readonly {
  title: string
  status: '할 일' | '진행 중'
  assignee: string
  initial: string | null
  due: string
  deadline: string
}[] = [
  {
    title: '온보딩 문구 수정',
    status: '할 일',
    assignee: '담당자 없음',
    initial: null,
    due: '09/10',
    deadline: '기한 지남',
  },
  {
    title: '회원가입 화면',
    status: '할 일',
    assignee: '박민수',
    initial: '박',
    due: '09/16',
    deadline: '기한 지남',
  },
  {
    title: 'STT 정확도 측정',
    status: '진행 중',
    assignee: '정하늘',
    initial: '정',
    due: '09/19',
    deadline: '7일 안에 마감',
  },
]

export function ProductPreview() {
  return (
    <figure id="product" className="@container min-w-0 scroll-mt-56">
      <div
        role="img"
        aria-label="Manager's Manager 제품 화면 미리보기. 진행 중 탭에서 태스크의 상태, 담당자와 마감을 함께 확인하는 리스트 화면입니다."
        className="overflow-hidden rounded-[24px] bg-ink-solid p-12 sm:p-16"
      >
        <div className="flex items-center gap-6 px-8 pt-4 pb-16 text-[11px] font-semibold text-surface">
          <span className="h-6 w-6 rounded-999 bg-accent-solid" />
          Manager&apos;s Manager
        </div>
        <div className="overflow-hidden rounded-12 bg-surface text-ink">
          <div className="flex min-h-56 items-center justify-between gap-12 border-b border-line px-16 @min-[520px]:gap-8 @min-[520px]:px-12">
            <div className="hidden shrink-0 items-center gap-12 @min-[520px]:flex">
              <BrandMark size="sm" />
              <div className="flex items-center gap-1 text-[10px] font-semibold whitespace-nowrap">
                {NAVIGATION.map(({ label }) => (
                  <span
                    key={label}
                    className={`rounded-6 px-6 py-8 ${label === '태스크' ? 'bg-surface-selected text-ink' : 'text-sub'}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-12 @min-[520px]:flex-none @min-[520px]:gap-10">
              <span className="mr-auto inline-flex min-w-0 items-center gap-4 text-[12px] font-semibold whitespace-nowrap @min-[520px]:order-3 @min-[520px]:mr-0 @min-[520px]:text-[10px]">
                카테캠 3팀
                <Icon name="chevron-down" size={12} />
              </span>
              <Icon name="help" size={15} className="shrink-0" />
              <svg
                aria-hidden="true"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
              </svg>
              <span className="inline-flex h-24 w-24 shrink-0 items-center justify-center rounded-999 bg-surface-selected text-[10px] font-semibold @min-[520px]:order-4">
                진호
              </span>
            </div>
          </div>
          <div className="px-16 pt-24 pb-12 @min-[520px]:px-24 @min-[520px]:pb-24">
            <div className="flex flex-col gap-16 @min-[520px]:flex-row @min-[520px]:items-end @min-[520px]:justify-between @min-[520px]:gap-12">
              <div className="min-w-0">
                <h2 className="text-[22px] leading-[28px] font-bold tracking-h3">태스크</h2>
                <p className="mt-6 text-[12px] leading-[19px] text-sub">
                  담당자별로 걸러 보고, 준비된 태스크를 확인하세요.
                </p>
              </div>
              <div className="inline-flex w-fit shrink-0 gap-2 rounded-9 bg-surface-selected p-4 text-[11px] font-semibold">
                {['리스트', '보드', '캘린더', '간트'].map((label) => (
                  <span
                    key={label}
                    className={`rounded-6 px-9 py-7 ${label === '리스트' ? 'bg-surface text-ink' : 'text-sub'}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-24 flex items-center gap-14 text-[12px] font-semibold whitespace-nowrap">
              {STATUS_TABS.map(({ label, count }) => (
                <span
                  key={label}
                  className={`inline-flex items-center gap-5 border-b-2 pb-8 ${label === '진행 중' ? 'border-ink text-ink' : 'border-transparent text-sub'}`}
                >
                  {label}
                  <span
                    className={
                      label === '확인 필요'
                        ? 'inline-flex h-15 min-w-15 items-center justify-center rounded-999 bg-ink-solid px-3 text-[10px] leading-none text-surface'
                        : 'text-[10px] font-normal'
                    }
                  >
                    {count}
                  </span>
                </span>
              ))}
            </div>
            <div className="mt-12 flex flex-wrap items-center justify-end gap-x-14 gap-y-8 text-[11px] font-semibold text-sub">
              {['마감 전체', '담당자 전체', '마감 빠른 순'].map((label) => (
                <span key={label} className="inline-flex items-center gap-4 whitespace-nowrap">
                  {label}
                  <Icon name="chevron-down" size={12} />
                </span>
              ))}
            </div>
            <div className="mt-12 divide-y divide-line">
              {PREVIEW_TASKS.map(({ title, status, assignee, initial, due, deadline }) => (
                <div
                  key={title}
                  className="grid grid-cols-[42px_minmax(0,1fr)_38px] items-start gap-x-8 gap-y-8 py-16 @min-[520px]:grid-cols-[42px_minmax(0,1fr)_84px_38px] @min-[520px]:items-center"
                >
                  <span className="w-fit rounded-4 bg-surface-selected px-5 py-2 text-[10px] leading-[16px] font-semibold whitespace-nowrap text-sub">
                    {status}
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-7 gap-y-5">
                    <span className="text-[13px] leading-[20px] font-semibold">{title}</span>
                    <span className="rounded-4 bg-surface-selected px-5 py-2 text-[10px] leading-[16px] whitespace-nowrap text-sub">
                      {deadline}
                    </span>
                  </div>
                  <span className="col-start-2 row-start-2 inline-flex items-center gap-5 text-[11px] leading-[20px] whitespace-nowrap text-dim @min-[520px]:col-start-auto @min-[520px]:row-start-auto @min-[520px]:justify-end">
                    {initial === null ? null : (
                      <span className="inline-flex h-20 w-20 items-center justify-center rounded-999 bg-surface-selected text-[9px] font-semibold text-ink">
                        {initial}
                      </span>
                    )}
                    {assignee}
                  </span>
                  <span className="col-start-3 row-start-1 text-right text-[11px] leading-[20px] whitespace-nowrap text-dim @min-[520px]:col-start-auto @min-[520px]:row-start-auto">
                    {due}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-5 border-t border-line px-8 py-12 @min-[520px]:hidden">
            {NAVIGATION.filter(({ compact }) => compact !== null).map(
              ({ label, compact, icon }) => (
                <span
                  key={label}
                  className={`flex flex-col items-center gap-5 text-[10px] ${label === '태스크' ? 'font-semibold text-ink' : 'text-dim'}`}
                >
                  <Icon name={icon} size={17} />
                  {compact}
                </span>
              ),
            )}
          </div>
        </div>
      </div>
      <figcaption className="mt-12 text-right text-[11px] leading-[18px] text-dim sm:text-[12px]">
        실제 서비스의 태스크 리스트를 예시 데이터로 축약한 화면입니다.
      </figcaption>
    </figure>
  )
}
