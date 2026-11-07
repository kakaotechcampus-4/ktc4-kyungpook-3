import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { CSSProperties, Ref } from 'react'
import { createPortal } from 'react-dom'
import {
  getSplashHoldCount,
  hasSplashRecord,
  markSplashShown,
  onSplashShow,
  subscribeSplashHolds,
} from '@/shared/lib/splash'
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
import type { SplashMode, SplashState } from './splashMachine'
import { SPLASH_SIZE } from './splashSize'

/** index.html 이 JS 보다 먼저 그리는 스플래시 */
const STATIC_SPLASH_ID = 'boot-splash'
/**
 * index.html 의 <head> 스크립트가 첫 페인트 전에 <html> 에 붙이는 표시 (#510). 12시간 안에 다시 왔다.
 * skip 이면 정적 판을 그리지 않았고, quick 이면 설치한 앱이라 그렸지만 끝맺음 없이 짧게 사라진다
 */
const BOOT_MODE_ATTRIBUTE = 'data-splash'
const LOOK_POSES: readonly MascotPose[] = ['idle', 'left', 'right']
/** 시작하기 스플래시가 걷힌 뒤 로그인 화면이 아직 뼈대면 첫 입력이 나타날 때까지 이만큼 기다린다 */
const FOCUS_WAIT_MS = 10_000
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

interface SplashRun {
  /** performance.now() 기준 시작 시각 */
  startedAt: number
  /** 새로 접속은 index.html 이 이미 흰 화면을 덮고 있어 hidden 동안에도 덮는다. 로그인 직후는 보일 때부터 덮는다 */
  coversWhileHidden: boolean
  landing: boolean
  mode: SplashMode
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
  const bootMode = document.documentElement.getAttribute(BOOT_MODE_ATTRIBUTE)
  if (bootMode === 'skip') {
    node.remove()
    return null
  }
  return {
    startedAt: paintedAt(node),
    coversWhileHidden: true,
    // 써 본 사람이 `/` 로 오면 랜딩 대신 로그인으로 간다(LandingEntry). 랜딩의 바로 걷힘은 처음 온 사람(검색 로봇 포함)만이다
    landing: window.location.pathname === '/' && !hasSplashRecord(),
    mode: bootMode === 'quick' ? 'quick' : 'full',
  }
}

function initialState(run: SplashRun): SplashState {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  return startSplash({
    elapsed: performance.now() - run.startedAt,
    reduced: window.matchMedia(REDUCED_MOTION).matches,
    // `시작하기` 는 누른 순간 정면으로 바로 보인다. 기다릴 로딩이 아니라 화면 전환이다
    revealAt: standalone || run.mode === 'start' ? 0 : REVEAL_MS,
    landing: run.landing,
    mode: run.mode,
  })
}

/** 포커스가 아직 판에 있거나 아무 데도 없다 — 사람이 옮기지 않았다 */
function focusUnclaimed(): boolean {
  const active = document.activeElement
  return active === null || active === document.body || active.closest('.splash') !== null
}

/**
 * 시작하기 스플래시가 걷힌 뒤 로그인 화면의 시작점(첫 입력)으로 포커스를 옮긴다 (#510).
 * 건너뛰어 화면이 아직 뼈대면 입력이 나타날 때까지 기다린다. 그 사이 사람이 포커스를 옮겼으면 그만둔다
 */
function focusFirstField(appRoot: HTMLElement): void {
  const tryFocus = (): boolean => {
    if (!focusUnclaimed()) return true
    const field = appRoot.querySelector<HTMLElement>(
      'main input:not([type="hidden"]):not(:disabled)',
    )
    if (field === null) return false
    field.focus({ preventScroll: true })
    return true
  }
  if (tryFocus()) return
  const observer = new MutationObserver(() => {
    if (tryFocus()) stop()
  })
  const timer = setTimeout(stop, FOCUS_WAIT_MS)
  function stop() {
    observer.disconnect()
    clearTimeout(timer)
  }
  observer.observe(appRoot, { childList: true, subtree: true })
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
      onSplashShow((startedAt, kind) => {
        setRun((current) => {
          if (kind === 'session') {
            return current ?? { startedAt, coversWhileHidden: false, landing: false, mode: 'full' }
          }
          // 랜딩의 사라짐이 아직 남아 있어도 `시작하기` 가 이어받는다
          if (current !== null && !current.landing) return current
          return { startedAt, coversWhileHidden: true, landing: false, mode: 'start' }
        })
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

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION)
    const onChange = () => {
      dispatch({ type: 'reduced', reduced: query.matches })
    }
    // 첫 상태를 읽은 뒤 구독하기 전에 바뀐 것도 맞춘다
    onChange()
    query.addEventListener('change', onChange)
    return () => {
      query.removeEventListener('change', onChange)
    }
  }, [])

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

  // 전체 스플래시가 실제로 보였을 때만 기록한다. 0.3초 안에 준비돼 보이지 않은 채 끝나면 기록하지 않는다 (#510).
  // 랜딩의 바로 걷힘과 설치한 앱의 짧은 사라짐은 전체 스플래시가 아니다
  const seen = stage.phase !== 'hidden' && stage.phase !== 'done'
  const full = !run.landing && run.mode !== 'quick'
  useEffect(() => {
    if (seen && full) markSplashShown()
  }, [seen, full])

  const skippable = run.mode === 'start'
  useEffect(() => {
    if (!skippable) return
    const skip = () => {
      dispatch({ type: 'skip' })
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === 'Escape') skip()
    }
    // 판이 화면 전체를 덮으므로 어디를 눌러도 판을 누른 것이다. `시작하기` 를 누른 입력은 판이 뜨기 전에 끝났다
    document.addEventListener('pointerdown', skip)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', skip)
      document.removeEventListener('keydown', onKey)
    }
  }, [skippable])

  // 모자는 둘러보기(시작하기는 한쪽 보기)를 시작할 때 한 번 누른다
  const looking = stage.phase === 'glance' || stage.phase === 'look'
  useEffect(() => {
    if (looking) mascot.current?.press()
  }, [looking])

  const shown = stage.phase === 'hidden' ? run.coversWhileHidden : stage.phase !== 'done'
  // 움직임 줄이기면 준비되는 순간 걷히므로, 남은 확인 시간(SETTLE_MS) 동안은 이미 그려진 첫 화면을 막지 않는다.
  // 시작하기는 포커스를 판에 두므로 걷히기 시작할 때까지 막는다 — 그때 로그인 화면으로 포커스를 넘긴다
  const inert = shown && stage.phase !== 'leave' && (skippable || !(reduced && holds === 0))
  useLayoutEffect(() => {
    if (!inert) return
    appRoot.setAttribute('inert', '')
    return () => {
      appRoot.removeAttribute('inert')
    }
  }, [inert, appRoot])

  // 시작하기: 사라지기 시작하거나 끝나거나 건너뛰면 로그인 화면의 첫 입력으로 포커스를 넘긴다. 한 번만이다
  const handedOff = useRef(false)
  useEffect(() => {
    if (!skippable || inert || handedOff.current) return
    handedOff.current = true
    focusFirstField(appRoot)
  }, [skippable, inert, appRoot])

  if (!shown) return null

  const lookStep = stage.phase === 'look' ? stage.step : null
  const smiling = stage.phase === 'smile' || (stage.phase === 'leave' && stage.smiling)
  const pose: MascotPose =
    reduced || stage.phase === 'smile' || stage.phase === 'leave'
      ? 'idle'
      : stage.phase === 'glance'
        ? 'left'
        : lookStep === null
          ? 'idle'
          : LOOK_POSES[lookStep % LOOK_POSES.length]
  const status =
    stage.phase === 'look' ? '로그인 확인 중' : stage.phase === 'smile' ? '준비됐어요' : ''
  return createPortal(
    <SplashOverlay
      startedAt={run.startedAt}
      unseen={splashSettlingUnseen(state)}
      mascotRef={mascot}
      pose={pose}
      dial={stage.phase === 'hidden' || stage.phase === 'enter' || looking}
      smile={smiling}
      status={status}
      leaving={stage.phase === 'leave'}
      quickFade={run.mode === 'quick'}
      instant={run.mode === 'start'}
      skippable={skippable}
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
  /** 사라짐이 QUICK_FADE_MS 다 */
  quickFade: boolean
  /** 등장 없이 처음부터 정면으로 보인다 */
  instant: boolean
  /** 시작하기 스플래시. 포커스를 받는 대화상자이고 건너뛰는 법을 스크린리더에 알린다 */
  skippable: boolean
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
  quickFade,
  instant,
  skippable,
}: SplashOverlayProps) {
  // 그려진 순간까지 지난 시간만큼 CSS 등장을 앞당긴다. 이어받을 때 등장이 처음부터 다시 돌지 않는다
  const [shift] = useState(() => performance.now() - startedAt)
  const wordId = useId()
  const hintId = useId()
  const root = useRef<HTMLDivElement>(null)
  // 누른 `시작하기` 링크는 로그인으로 옮기며 사라진다. 포커스를 판에 두어 안내를 읽히고 Enter·Esc 를 받는다
  useLayoutEffect(() => {
    if (skippable) root.current?.focus({ preventScroll: true })
  }, [skippable])
  return (
    <div
      ref={root}
      className="splash"
      data-phase={leaving ? 'leave' : undefined}
      data-settling={unseen ? '' : undefined}
      data-fade={quickFade ? 'quick' : undefined}
      data-instant={instant ? '' : undefined}
      style={{ '--splash-shift': `${shift}ms` } as CSSProperties}
      {...(skippable && {
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': wordId,
        'aria-describedby': hintId,
        tabIndex: -1,
      })}
    >
      <div className="splash__group">
        <div className="splash__mascot">
          <Mascot
            ref={mascotRef}
            size={SPLASH_SIZE.mascot}
            pose={pose}
            dial={dial}
            smile={smile}
            lambda={3.2}
            dialHz={0.55}
          />
        </div>
        <p id={wordId} className="splash__word">
          Manager&apos;s Manager
        </p>
      </div>
      {skippable && (
        <p id={hintId} className="sr-only">
          로그인 화면을 준비하고 있어요. Enter 나 Esc 를 누르면 건너뛰어요.
        </p>
      )}
      <p className="splash__status" role="status">
        {status}
      </p>
    </div>
  )
}
