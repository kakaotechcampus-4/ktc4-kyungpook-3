import type { ReactNode } from 'react'
import { Icon } from '@/shared/ui/icon'

const COMMAND = 'rounded-4 bg-control px-4 text-[0.92em] text-ink'

/** Discord 슬래시 명령 한 개 — `/join` · `/record` · `/stop` */
export function Command({ children }: { children: string }) {
  return <code className={COMMAND}>{children}</code>
}

/** 회의가 하나도 없는 빈 화면의 안내 한 문장. 대시보드와 회의록이 같은 말을 한다 */
export function FirstMeetingHint() {
  return (
    <>
      디스코드 음성 채널에서 <Command>/record</Command>로 첫 회의를 기록해 보세요.
    </>
  )
}

const EXTERNAL =
  'inline-flex items-center gap-3 font-semibold text-ink underline underline-offset-3'

/** 앱 밖 문서로 가는 링크. 새 탭으로 열리고, 그 사실을 아이콘과 숨은 글자로 알린다 */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={EXTERNAL}>
      {children}
      <Icon name="external" size={12} />
      <span className="sr-only">(새 탭)</span>
    </a>
  )
}
