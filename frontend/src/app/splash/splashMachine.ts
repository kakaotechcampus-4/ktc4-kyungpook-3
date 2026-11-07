/*
 * 스플래시 한 번의 순서 (#430 움직임 3번). 시각은 스플래시 시작부터 잰 ms 다.
 * 새로 접속은 index.html 스플래시가 그려지기 시작한 때, 로그인 직후는 띄우기 신호가 시작이다.
 *
 * hidden → enter → look(정면·왼쪽·오른쪽을 돈다) → smile → leave → done
 * - 준비가 hidden 안에 오면 보이지 않은 채 끝난다(번쩍임 방지). 준비 시각은 잡기가 0이 된 때라, 확인(SETTLE_MS)이
 *   등장 시각을 넘겨도 hidden 에 머문다.
 * - 준비가 enter·look 에 오면 smile 로 간다. enter 에 오면 둘러보기를 건너뛴 것이다.
 * - 움직임 줄이기면 둘러보기·눈웃음·사라짐이 없다. 준비가 오면 바로 done 이다.
 *   도중에 켜면 눈웃음·사라짐은 바로 done 이고, 둘러보기는 정면으로 멈춰 준비를 기다린다.
 *
 * 모드 (#510)
 * - full: 위 순서 그대로다. 새로 접속(12시간에 한 번), 로그인 직후.
 * - quick: 12시간 안에 다시 연 설치한 앱. 시작 이미지에서 툭 바뀌지 않게 정적 판을 그리되, 둘러보기·눈웃음 없이
 *   준비되면 QUICK_FADE_MS 동안 사라진다.
 * - start: 랜딩 `시작하기` → 로그인. 기다릴 로딩이 거의 없어 짧게 돈다. 정면으로 바로 보인 뒤 한쪽을 한 번 보고(glance)
 *   눈웃음 → 사라짐, 모두 약 2.5초다. glance 가 끝나기 전에 온 준비는 glance 가 끝날 때 받는다. 누르면(skip) 바로 걷힌다.
 *
 * 단계마다 끝나는 시각을 스플래시 시계에 고정한다. 타이머를 렌더 뒤에 다시 걸어도 밀리지 않고,
 * CSS 등장(같은 시계)과 어긋나지 않는다.
 */

/** 등장 전 기다림. index.html 의 마스코트 animation-delay 300ms 와 같은 값이다 */
export const REVEAL_MS = 300
/** 모자 누르기와 둘러보기 시작. 워드마크 등장(600ms 시작, 0.8초)이 끝난 바로 뒤다 */
export const LOOK_AT_MS = 1500
/** 둘러보기 한 동작 */
export const LOOK_MS = 1700
/**
 * 눈웃음 단계. 눈웃음이 지어지는 데 약 0.5초(Mascot 의 SMILE_LAMBDA, 90% 까지), 다 지은 얼굴로 머무는 데 0.6초다 (#506).
 * 지어지는 시간보다 짧으면 웃는 중에 사라지는 것처럼 보인다
 */
export const SMILE_MS = 1100
/** 사라짐. index.html 의 splash-out 0.6s 와 같다 */
export const FADE_MS = 600
/** 설치한 앱이 12시간 안에 다시 열릴 때의 사라짐. index.html 의 data-fade='quick' 0.2s 와 같다 (#510) */
export const QUICK_FADE_MS = 200
/** `시작하기` 스플래시가 정면으로 머무는 시간. 이때 모자를 누르고 한쪽을 보기 시작한다 */
export const GLANCE_AT_MS = 100
/** `시작하기` 스플래시의 한쪽 보기가 끝나는 시각. 이어서 눈웃음(SMILE_MS)·사라짐(FADE_MS)으로 약 2.5초에 끝난다 */
export const GLANCE_END_MS = 800
/** 잡기가 0이 된 뒤 이만큼 0이 이어져야 준비다. 가드 → 이동 → 화면 코드 사이 빈 커밋에서 끝나지 않게 한다 */
export const SETTLE_MS = 100

/** at 은 그 단계가 시작된 시각이다. hidden·enter 는 끝나는 시각이 정해져 있어 필요 없다 */
export type SplashStage =
  | { phase: 'hidden' }
  | { phase: 'enter' }
  | { phase: 'glance' }
  | { phase: 'look'; at: number; step: number }
  | { phase: 'smile'; at: number }
  | { phase: 'leave'; at: number; smiling: boolean }
  | { phase: 'done' }

export type SplashMode = 'full' | 'quick' | 'start'

export interface SplashState {
  stage: SplashStage
  mode: SplashMode
  reduced: boolean
  /** 보이기 시작하는 시각. 설치한 앱은 시작 이미지에서 이어져 0이다 */
  revealAt: number
  /** 잡기가 0이 된 시각. 잡혀 있으면 null 이다. 준비는 확인(SETTLE_MS) 뒤에 오지만 0.3초 안인지는 이 시각으로 정한다 */
  idleAt: number | null
  /** start 에서 glance 가 끝나기 전에 준비됐다. glance 가 끝날 때 눈웃음으로 간다 */
  readyEarly: boolean
}

/**
 * timer: 지금 단계가 끝나는 시각이 됐다. idle·held: 잡기가 그 시각에 0이 됐다·다시 잡혔다.
 * ready: 잡기 0이 SETTLE_MS 이어져 첫 화면이 그 시각에 준비됐다. reduced: 움직임 줄이기 설정이 바뀌었다.
 * skip: 사람이 눌러 건너뛰었다(start 만 듣는다)
 */
export type SplashEvent =
  | { type: 'timer' }
  | { type: 'idle'; at: number }
  | { type: 'held' }
  | { type: 'ready'; at: number }
  | { type: 'reduced'; reduced: boolean }
  | { type: 'skip' }

export interface SplashStart {
  /** 스플래시 시작부터 지금까지 */
  elapsed: number
  reduced: boolean
  revealAt: number
  /** 랜딩은 최소 표시 시간 없이 바로 걷는다(검색 노출 조건) */
  landing: boolean
  mode: SplashMode
}

const DONE: SplashStage = { phase: 'done' }

function firstStage({ elapsed, reduced, revealAt, landing, mode }: SplashStart): SplashStage {
  if (elapsed < revealAt) return landing ? DONE : { phase: 'hidden' }
  if (landing) return reduced ? DONE : { phase: 'leave', at: elapsed, smiling: false }
  if (mode !== 'full' || elapsed < LOOK_AT_MS) return { phase: 'enter' }
  return { phase: 'look', at: elapsed, step: 0 }
}

export function startSplash(start: SplashStart): SplashState {
  return {
    stage: firstStage(start),
    mode: start.mode,
    reduced: start.reduced,
    revealAt: start.revealAt,
    idleAt: null,
    readyEarly: false,
  }
}

/** 보이기 전에 준비돼 확인만 남았다. 확인이 등장 시각을 넘겨도 보이지 않은 채 기다린다 */
export function splashSettlingUnseen({ stage, revealAt, idleAt }: SplashState): boolean {
  return stage.phase === 'hidden' && idleAt !== null && idleAt < revealAt
}

/** 지금 단계가 끝나는 시각. 준비를 기다리기만 하는 단계는 null */
export function splashDeadline(state: SplashState): number | null {
  const { stage, mode, reduced, revealAt } = state
  switch (stage.phase) {
    case 'hidden':
      return splashSettlingUnseen(state) ? null : revealAt
    case 'enter':
      if (mode === 'quick') return null
      return mode === 'start' ? GLANCE_AT_MS : LOOK_AT_MS
    case 'glance':
      return GLANCE_END_MS
    case 'look':
      return reduced ? null : stage.at + LOOK_MS
    case 'smile':
      return stage.at + SMILE_MS
    case 'leave':
      return stage.at + (mode === 'quick' ? QUICK_FADE_MS : FADE_MS)
    case 'done':
      return null
  }
}

function afterTimer(state: SplashState, at: number): SplashStage {
  const { stage, mode, reduced, readyEarly } = state
  switch (stage.phase) {
    case 'hidden':
      return { phase: 'enter' }
    case 'enter':
      return mode === 'start' ? { phase: 'glance' } : { phase: 'look', at, step: 0 }
    case 'glance':
      // 준비가 아직이면 새로 접속처럼 둘러보며 기다린다
      if (!readyEarly) return { phase: 'look', at, step: 0 }
      return reduced ? DONE : { phase: 'smile', at }
    case 'look':
      return { phase: 'look', at, step: stage.step + 1 }
    case 'smile':
      return { phase: 'leave', at, smiling: true }
    case 'leave':
    case 'done':
      return DONE
  }
}

function afterReady(state: SplashState, at: number): SplashStage {
  const { stage, mode, reduced } = state
  if (stage.phase === 'hidden') return DONE
  if (stage.phase === 'enter' || stage.phase === 'look') {
    if (reduced) return DONE
    return mode === 'quick' ? { phase: 'leave', at, smiling: false } : { phase: 'smile', at }
  }
  return stage
}

/** start 는 glance 가 끝날 때까지 준비를 미뤄 둔다 — 정면 → 한쪽 보기 → 눈웃음 순서를 지킨다 */
function defersReady({ stage, mode }: SplashState): boolean {
  return mode === 'start' && (stage.phase === 'enter' || stage.phase === 'glance')
}

function afterReducedOn(stage: SplashStage): SplashStage {
  return stage.phase === 'smile' || stage.phase === 'leave' ? DONE : stage
}

export function stepSplash(state: SplashState, event: SplashEvent): SplashState {
  switch (event.type) {
    case 'idle':
      return { ...state, idleAt: event.at }
    case 'held':
      return state.idleAt === null ? state : { ...state, idleAt: null }
    case 'ready':
      if (defersReady(state)) return state.readyEarly ? state : { ...state, readyEarly: true }
      return withStage(state, afterReady(state, event.at))
    case 'skip':
      return withStage(state, DONE)
    case 'reduced':
      if (event.reduced === state.reduced) return state
      return {
        ...state,
        reduced: event.reduced,
        stage: event.reduced ? afterReducedOn(state.stage) : state.stage,
      }
    case 'timer': {
      const deadline = splashDeadline(state)
      return deadline === null ? state : withStage(state, afterTimer(state, deadline))
    }
  }
}

function withStage(state: SplashState, stage: SplashStage): SplashState {
  return stage === state.stage ? state : { ...state, stage }
}
