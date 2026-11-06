import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/shared/ui/button'
import { Mascot } from '@/shared/ui/mascot'

const INTRO_LINES = [
  '안녕하세요, 저는 매스예요.',
  '회의를 올려 주시면 결정사항과 할 일을 정리해 드릴게요.',
  '확인이 필요한 것만 골라서 물어볼게요.',
] as const

const LAST = INTRO_LINES.length - 1
const ADVANCE_MS = 2600
const FADE_MS = 220
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/* `inset-0` 은 tokens.css 가 간격 스케일을 꺼서 생성되지 않는다 — docs/impl-decision/2026-09-29-modal-inset-zero.md */
const SCREEN = 'fixed inset-[0px] z-100 overflow-y-auto bg-surface text-ink'
const COLUMN = 'mx-auto flex min-h-full w-full max-w-[420px] flex-col px-16 pt-16 pb-24'
/* 두 줄 높이를 미리 잡아 줄 수가 바뀌어도 마스코트와 점이 움직이지 않는다 */
const BUBBLE =
  'min-h-[82px] w-full rounded-10 bg-surface-selected px-16 py-12 text-landing text-ink transition-opacity duration-[220ms] motion-reduce:transition-none'

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}

export interface FirstVisitIntroProps {
  open: boolean
  /** 건너뛰기·시작하기·Esc. 기록과 다음 화면은 부른 쪽이 정한다 */
  onClose: () => void
}

/**
 * 첫 방문 인트로 (#430). 매스가 말풍선 세 줄로 자기를 소개한다. 랜딩의 로그인 버튼과 첫 대시보드가 같이 쓴다.
 * 화면 전체를 덮는 대화상자라 포커스가 안에 갇히고 Esc 는 건너뛰기와 같다.
 */
export function FirstVisitIntro({ open, onClose }: FirstVisitIntroProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content className={SCREEN} aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">매스 소개</DialogPrimitive.Title>
          <IntroTalk onClose={onClose} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * 말풍선은 2.6초마다 다음 줄로 가고 마지막 줄에서 멈춘다. 점을 누르면 그 줄로 가고 거기서 다시 센다.
 * 줄이 바뀔 때 0.22초 흐려졌다가 글이 바뀐다. 움직임 줄이기면 글이 바로 바뀐다.
 * 열 때마다 마운트되어 첫 줄부터 시작한다
 */
function IntroTalk({ onClose }: { onClose: () => void }) {
  const reduced = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false)
  const [index, setIndex] = useState(0)
  const [faded, setFaded] = useState(0)
  const shown = reduced ? index : faded

  useEffect(() => {
    if (index === LAST) return
    const timer = setTimeout(() => setIndex(index + 1), ADVANCE_MS)
    return () => clearTimeout(timer)
  }, [index])

  useEffect(() => {
    if (reduced || faded === index) return
    const timer = setTimeout(() => setFaded(index), FADE_MS)
    return () => clearTimeout(timer)
  }, [reduced, faded, index])

  return (
    <div className={COLUMN}>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          건너뛰기
        </Button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-16 py-24">
        <Mascot pose="talking" palette="ink" size={96} />
        <p aria-live="polite" className={`${BUBBLE} ${shown === index ? '' : 'opacity-0'}`}>
          {INTRO_LINES[shown]}
        </p>
        <div className="flex justify-center gap-2">
          {INTRO_LINES.map((line, at) => (
            <button
              key={line}
              type="button"
              aria-label={`${at + 1}번째 말`}
              aria-current={at === index ? 'step' : undefined}
              className="inline-flex h-24 w-24 items-center justify-center rounded-999"
              onClick={() => setIndex(at)}
            >
              <span
                className={`h-6 w-6 rounded-999 ${at === index ? 'bg-ink' : 'bg-ink/30'}`}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </div>
      <Button variant="primary" size="xl" fullWidth onClick={onClose}>
        시작하기
      </Button>
    </div>
  )
}
