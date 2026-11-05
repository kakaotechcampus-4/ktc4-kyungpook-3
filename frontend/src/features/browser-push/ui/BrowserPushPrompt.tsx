import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { sessionQueryOptions } from '@/entities/user'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/toast'
import { closePushPrompt, isPushPromptClosed } from '../lib/pushPromptRecord'
import { pushPromptView, settlesPushPrompt } from '../model/pushPrompt'
import { useBrowserPush } from '../model/useBrowserPush'
import { PUSH_COPY } from './copy'

/* 대화 머리 아래 한 줄 띠 — 머리와 같은 좌우 28 · 아래 선. 좁으면 버튼이 글 아래로 내려간다 */
const BAND =
  'flex shrink-0 flex-wrap items-center gap-x-16 gap-y-10 border-b border-divider bg-surface px-28 py-12'
const TEXT = 'min-w-[0px] flex-1 basis-[240px]'

/**
 * 리마인드 대화 위에서 이 기기의 알림을 켜자고 권하는 띠 (#411). 알림 허용은 `알림 켜기` 를 눌렀을 때만 묻는다.
 * 닫았거나 켰거나 브라우저가 막은 기기·계정에는 다시 보이지 않는다
 */
export function BrowserPushPrompt() {
  const session = useQuery(sessionQueryOptions())
  const userId = session.data?.user.id
  if (userId === undefined) return null
  return <PromptForUser key={userId} userId={userId} />
}

/** 닫은 사람에게는 푸시 상태를 서버에 묻지도 않는다 — 띠를 그릴 때만 `useBrowserPush` 를 붙인다 */
function PromptForUser({ userId }: { userId: string }) {
  const [closed, setClosed] = useState(() => isPushPromptClosed(userId))
  if (closed) return null
  return (
    <PromptBand
      userId={userId}
      onClose={() => {
        closePushPrompt(userId)
        setClosed(true)
      }}
    />
  )
}

function PromptBand({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { state, enable } = useBrowserPush()
  // 열 때 이미 켜져 있던 기기에는 켰다고 알리지 않는다 — 이 띠에서 누른 뒤에만 알린다
  const asked = useRef(false)

  useEffect(() => {
    if (!settlesPushPrompt(state)) return
    closePushPrompt(userId)
    if (asked.current && state.status === 'subscribed')
      toast.show({ title: '이 기기에서 알림을 받아요.' })
  }, [state, userId])

  const view = pushPromptView(state)
  if (view.kind === 'hidden') return null
  return (
    <section aria-label="기기 알림" className={BAND}>
      {view.kind === 'install' ? (
        <p className={`${TEXT} text-caption leading-[1.6] text-sub`}>{PUSH_COPY.needsInstall}</p>
      ) : (
        <div className={TEXT}>
          <h3 className="text-body leading-[1.5] font-semibold text-ink">
            다음 리마인드를 기기 알림으로 받을까요?
          </h3>
          {view.kind === 'failed' ? (
            <p role="alert" className="text-caption leading-[1.6] text-accent">
              {PUSH_COPY.enableFailed}
            </p>
          ) : (
            <p className="text-caption leading-[1.6] text-dim">
              새 리마인드가 오면 이 기기로 바로 알려 드려요.
            </p>
          )}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-8">
        {view.kind === 'install' ? null : (
          <Button
            variant="primary"
            loading={view.kind === 'offer' && view.busy}
            onClick={() => {
              asked.current = true
              enable()
            }}
          >
            {view.kind === 'failed' ? '다시 시도' : '알림 켜기'}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
    </section>
  )
}
