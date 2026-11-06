import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { CSSProperties, Ref } from 'react'
import { createPortal } from 'react-dom'
import { getSplashHoldCount, onSplashShow, subscribeSplashHolds } from '@/shared/lib/splash'
import { Mascot } from '@/shared/ui/mascot'
import type { MascotHandle, MascotPose } from '@/shared/ui/mascot'
import {
  REVEAL_MS,
  SETTLE_MS,
  splashDeadline,
  splashSettlingUnseen,
  startSplash,
  stepSplash,
} from './splashMachine'
import type { SplashState } from './splashMachine'

/** index.html 이 JS 보다 먼저 그리는 스플래시 */
const STATIC_SPLASH_ID = 'boot-splash'
const LOOK_POSES: readonly MascotPose[] = ['idle', 'left', 'right']

interface SplashRun {
  /** performance.now() 기준 시작 시각 */
  startedAt: number
  /** 새로 접속은 index.html 이 이미 흰 화면을 덮고 있어 hidden 동안에도 덮는다. 로그인 직후는 보일 때부터 덮는다 */
  coversWhileHidden: boolean
  landing: boolean
}

/**
 * index.html 스플래시가 그려지기 시작한 시각. CSS 등장은 이 시각부터 셌으니 React 도 같은 시각부터 센다.
 * 문서 응답이 늦으면 페이지 시작(0)과 꽤 벌어진다. 시각을 읽을 수 없으면(jsdom, 아직 그려지기 전) 페이지 시작이다
 */
function paintedAt(node: Element): number {
  const animations =
    typeof node.getAnimations === 'function' ? node.getAnimations({ subtree: true }) : []
  for (const animation of animations) {
    if (typeof animation.startTime === 'number') return animation.startTime
  }
  return 0
}

function bootRun(): SplashRun | null {
  const node = document.getElementById(STATIC_SPLASH_ID)
  if (node === null) return null
  return {
    startedAt: paintedAt(node),
    coversWhileHidden: true,
    landing: window.location.pathname === '/',
  }
}

function initialState(run: SplashRun): SplashState {
  return startSplash({
    elapsed: performance.now() - run.startedAt,
    reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    revealAt: window.matchMedia('(display-mode: standalone)').matches ? 0 : REVEAL_MS,
    landing: run.landing,
  })
}

interface SplashHostProps {
  /** 스플래시가 덮는 앱의 뿌리. 덮는 동안 inert 로 키보드·스크린 리더를 막는다 */
  appRoot: HTMLElement
}

/**
 * 로딩 스플래시 (#430). main.tsx 만 그린다 — renderApp 으로 그리는 앱 테스트에는 스플래시가 없다.
 * 새로 접속이면 index.html 스플래시를 같은 자리·같은 클래스로 이어받고, 로그인 직후면 띄우기 신호에 새로 띄운다.
 */
export function SplashHost({ appRoot }: SplashHostProps) {
  const [run, setRun] = useState<SplashRun | null>(bootRun)

  useEffect(
    () =>
      onSplashShow((startedAt) => {
        setRun((current) => current ?? { startedAt, coversWhileHidden: false, landing: false })
      }),
    [],
  )

  const finish = useCallback(() => {
    setRun(null)
  }, [])

  if (run === null) return null
  return <SplashRunView key={run.startedAt} run={run} appRoot={appRoot} onDone={finish} />
}

interface SplashRunViewProps {
  run: SplashRun
  appRoot: HTMLElement
  onDone: () => void
}

function SplashRunView({ run, appRoot, onDone }: SplashRunViewProps) {
  const [state, dispatch] = useReducer(stepSplash, run, initialState)
  const holds = useSyncExternalStore(subscribeSplashHolds, getSplashHoldCount)
  const mascot = useRef<MascotHandle>(null)
  const { stage, reduced } = state

  // React 판이 같은 커밋에 그려지므로 두 판이 함께 보이거나 둘 다 없는 프레임이 없다
  useLayoutEffect(() => {
    document.getElementById(STATIC_SPLASH_ID)?.remove()
  }, [])

  const { startedAt } = run
  useEffect(() => {
    const deadline = splashDeadline(state)
    if (deadline === null) return
    const timer = setTimeout(
      () => {
        dispatch({ type: 'timer' })
      },
      Math.max(0, deadline - (performance.now() - startedAt)),
    )
    return () => {
      clearTimeout(timer)
    }
  }, [state, startedAt])

  useEffect(() => {
    if (holds > 0) {
      dispatch({ type: 'held' })
      return
    }
    dispatch({ type: 'idle', at: performance.now() - startedAt })
    const timer = setTimeout(() => {
      dispatch({ type: 'ready', at: performance.now() - startedAt })
    }, SETTLE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [holds, startedAt])

  useEffect(() => {
    if (stage.phase === 'done') onDone()
  }, [stage.phase, onDone])

  const lookStep = stage.phase === 'look' ? stage.step : null
  useEffect(() => {
    if (lookStep === 0) mascot.current?.press()
  }, [lookStep])

  const shown = stage.phase === 'hidden' ? run.coversWhileHidden : stage.phase !== 'done'
  // 움직임 줄이기면 준비되는 순간 걷히므로, 남은 확인 시간(SETTLE_MS) 동안은 이미 그려진 첫 화면을 막지 않는다
  const inert = shown && stage.phase !== 'leave' && !(reduced && holds === 0)
  useLayoutEffect(() => {
    if (!inert) return
    appRoot.setAttribute('inert', '')
    return () => {
      appRoot.removeAttribute('inert')
    }
  }, [inert, appRoot])

  if (!shown) return null

  const smiling = stage.phase === 'smile' || (stage.phase === 'leave' && stage.smiling)
  const status =
    stage.phase === 'look' ? '로그인 확인 중' : stage.phase === 'smile' ? '준비됐어요' : ''
  return createPortal(
    <SplashOverlay
      startedAt={run.startedAt}
      unseen={splashSettlingUnseen(state)}
      mascotRef={mascot}
      pose={lookStep === null || reduced ? 'idle' : LOOK_POSES[lookStep % LOOK_POSES.length]}
      dial={stage.phase === 'hidden' || stage.phase === 'enter' || stage.phase === 'look'}
      smile={smiling}
      status={status}
      leaving={stage.phase === 'leave'}
    />,
    document.body,
  )
}

interface SplashOverlayProps {
  startedAt: number
  /** 등장 시각이 지나도 마스코트·워드마크를 숨긴다. 흰 덮개만 남는다 */
  unseen: boolean
  mascotRef: Ref<MascotHandle>
  pose: MascotPose
  dial: boolean
  smile: boolean
  status: string
  leaving: boolean
}

/** index.html 의 #boot-splash 와 같은 마크업·클래스다. 모양과 등장·사라짐은 index.html 의 CSS 가 맡는다 */
function SplashOverlay({
  startedAt,
  unseen,
  mascotRef,
  pose,
  dial,
  smile,
  status,
  leaving,
}: SplashOverlayProps) {
  // 그려진 순간까지 지난 시간만큼 CSS 등장을 앞당긴다. 이어받을 때 등장이 처음부터 다시 돌지 않는다
  const [shift] = useState(() => performance.now() - startedAt)
  return (
    <div
      className="splash"
      data-phase={leaving ? 'leave' : undefined}
      data-settling={unseen ? '' : undefined}
      style={{ '--splash-shift': `${shift}ms` } as CSSProperties}
    >
      <div className="splash__group">
        <div className="splash__mascot">
          <Mascot
            ref={mascotRef}
            size={96}
            pose={pose}
            dial={dial}
            smile={smile}
            lambda={3.2}
            dialHz={0.55}
          />
        </div>
        <p className="splash__word">Manager&apos;s Manager</p>
      </div>
      <p className="splash__status" role="status">
        {status}
      </p>
    </div>
  )
}
