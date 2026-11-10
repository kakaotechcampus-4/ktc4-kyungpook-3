const NAVIGATION = ['대시보드', '회의록', '태스크', '프로젝트 맵', '메시지'] as const

const TASKS = [
  { title: '로그인 화면 다듬기', detail: '서연 · 11월 13일', status: '진행 중' },
  { title: '발표 자료의 담당자 확인', detail: '3주차 정기회의에서 나온 일', status: '확인 필요' },
  { title: 'API 문서 검토', detail: '재환 · 11월 12일', status: '완료' },
] as const

export function ProductPreview() {
  return (
    <figure id="product" className="min-w-0 scroll-mt-56">
      <div
        role="img"
        aria-label="Manager's Manager 제품 화면 미리보기. 회의에서 나온 태스크와 확인할 담당자를 한곳에서 봅니다."
        className="overflow-hidden rounded-[24px] bg-ink-solid p-12 sm:p-16"
      >
        <div className="flex items-center justify-between gap-12 px-8 pt-4 pb-18 text-[11px] text-surface sm:text-[12px]">
          <span className="inline-flex items-center gap-6 font-semibold">
            <span className="h-6 w-6 rounded-999 bg-accent-solid" />
            Manager&apos;s Manager
          </span>
          <span className="hidden sm:inline">프로젝트의 다음 할 일</span>
        </div>
        <div className="grid overflow-hidden rounded-12 bg-surface sm:grid-cols-[100px_minmax(0,1fr)]">
          <div className="hidden border-r border-line bg-surface-sunken px-10 py-20 sm:flex sm:flex-col sm:gap-7">
            {NAVIGATION.map((label) => (
              <span
                key={label}
                className={`rounded-6 px-9 py-9 text-[12px] ${label === '태스크' ? 'bg-accent-badge font-semibold text-accent' : 'text-dim'}`}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="min-w-0 px-20 pt-24 pb-20 sm:px-24">
            <div className="flex justify-between gap-8 text-[10px] text-dim">
              <span>캡스톤 프로젝트</span>
              <span>팀 공간</span>
            </div>
            <h2 className="mt-8 text-[20px] leading-[28px] font-semibold tracking-h3 text-ink sm:text-[22px]">
              회의가 끝난 다음에도
            </h2>
            <div className="mt-20 flex gap-16 border-b border-line pb-9 text-[11px] text-dim">
              <span className="relative font-semibold text-ink after:absolute after:-bottom-10 after:right-0 after:left-0 after:h-2 after:bg-accent-solid">
                리스트
              </span>
              <span>보드</span>
              <span>캘린더</span>
              <span>간트</span>
            </div>
            {TASKS.map(({ title, detail, status }) => (
              <div key={title} className="flex flex-col gap-6 border-b border-line py-16">
                <span className="text-[13px] font-semibold text-ink">{title}</span>
                <div className="flex items-center justify-between gap-10 text-[11px] text-dim">
                  <span>{detail}</span>
                  <span
                    className={`shrink-0 rounded-4 px-5 py-1 text-[10px] ${status === '완료' ? 'text-dim' : 'bg-accent-badge text-accent'}`}
                  >
                    {status}
                  </span>
                </div>
              </div>
            ))}
            <div className="mt-16 flex items-center gap-8 text-[11px] text-dim">
              <span className="inline-flex h-24 w-24 shrink-0 items-center justify-center rounded-999 bg-surface-selected text-[10px] text-ink">
                서
              </span>
              <span>담당자와 마감을 함께 확인해요.</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-12 text-right text-[11px] leading-[18px] text-dim sm:text-[12px]">
        이해를 돕기 위한 제품 화면 구성 예시입니다.
      </figcaption>
    </figure>
  )
}
