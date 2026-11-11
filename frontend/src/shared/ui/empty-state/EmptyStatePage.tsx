import type { ReactNode } from 'react'

const PAGE = 'flex flex-1 items-center justify-center px-48 pt-48 pb-96 max-md:px-20'
const CONTENT = 'min-h-[288px] w-full max-w-[460px] max-md:min-h-[336px]'

export function EmptyStatePage({ children }: { children: ReactNode }) {
  return (
    <main className={PAGE}>
      <div className={CONTENT}>{children}</div>
    </main>
  )
}
