import type { MessageReview } from '@/entities/message'
import { avatarText } from '../lib/format'

/* Messages 캔버스 실측 — 가운데 604 열(위 44 · 좌우 36 · 아래 56, 간격 24), 제목 28px, 미리보기 카드 라운드 16 */
const PAGE = 'flex flex-1 justify-center overflow-y-auto px-36 pt-44 pb-56'
const COLUMN = 'flex w-full max-w-[604px] flex-col gap-24'
const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink'
const CARD = 'overflow-hidden rounded-16 border border-line bg-surface'
const CARD_HEAD = 'flex items-center gap-10 border-b border-line px-16 py-12'
const BOT_BADGE =
  'inline-flex h-16 items-center rounded-4 bg-divider px-5 text-[9.5px] leading-none font-semibold text-sub'

/**
 * 보내기 전 확인 항목의 읽기 전용 미리보기. 결정 전 부분이라 여기까지다 — 발송 시점 고르기·고쳐 쓰기·`이대로 발송`·
 * `보내지 않음` 은 결정 4 뒤에 붙인다 (계획 C-3, C-6 7단계). 본문의 이모지는 그대로 보인다 (디자인 시스템 §6)
 */
export function ReviewPreview({ review, botName }: { review: MessageReview; botName: string }) {
  return (
    <div className={PAGE}>
      <article aria-labelledby="message-review-title" className={COLUMN}>
        <div className="flex flex-col gap-8">
          <h2 id="message-review-title" className={TITLE}>
            이 메시지, 보낼까요?
          </h2>
          <p className="text-[14px] text-sub">
            <strong className="font-semibold text-ink">{review.recipientName}</strong>에게 Discord
            개인 메시지로 나갑니다. 보낸 뒤에는 되돌릴 수 없어요.
          </p>
        </div>
        <section aria-label="보낼 메시지 미리보기" className={CARD}>
          <div className={CARD_HEAD}>
            <span className="flex-1 text-caption text-ink">Discord 개인 메시지 · {botName} 봇</span>
            <span className="mono text-meta text-dim">미리보기</span>
          </div>
          <div className="flex gap-12 px-18 pt-18 pb-14">
            <span
              aria-hidden="true"
              className="inline-flex size-34 shrink-0 items-center justify-center rounded-999 bg-ink text-[12px] font-semibold text-surface"
            >
              {avatarText(botName, 'direct')}
            </span>
            <div className="flex flex-1 flex-col gap-7">
              <div className="flex items-baseline gap-8">
                <span className="text-body font-semibold text-ink">{botName}</span>
                <span className={BOT_BADGE}>BOT</span>
              </div>
              <p className="text-[14px] leading-[1.8] whitespace-pre-line text-ink">
                {review.body}
              </p>
            </div>
          </div>
        </section>
      </article>
    </div>
  )
}
