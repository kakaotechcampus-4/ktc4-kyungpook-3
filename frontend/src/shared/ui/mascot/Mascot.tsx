import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { Ref } from 'react'

export type MascotPose =
  'idle' | 'left' | 'right' | 'squint' | 'upLeft' | 'upRight' | 'talking' | 'dial'

export type MascotPalette = 'ink' | 'coral' | 'coralCap'

export interface MascotHandle {
  /** 클릭과 같은 버튼 눌림 1회. 움직임 줄이기면 아무것도 하지 않는다 */
  press: () => void
}

export interface MascotProps {
  ref?: Ref<MascotHandle>
  /** 기본 false. 켜면 눈이 아치로 바뀌는 눈웃음 (§8-1) */
  smile?: boolean
  /** 주면 포즈와 상관없이 다이얼 줄무늬를 켜거나 끈다. 없으면 포즈 값(dial 포즈만 켜짐) */
  dial?: boolean
  /** 포즈 전환 지수 접근 계수. 기본 8 */
  lambda?: number
  /** 다이얼 줄무늬 스크롤 속도(칸/초). 기본 1.1 */
  dialHz?: number
  /** 기본 'idle' */
  pose?: MascotPose
  /** 기본 'ink' — coral 계열은 컬러 스터디다 (§8-7) */
  palette?: MascotPalette
  /** 기본 96 — 빈 상태 3장이 96px 이고 제품에서 가장 흔하다 */
  size?: number
  /** 주면 role="img" + aria-label, 없으면 aria-hidden */
  label?: string
  /** 주면 그때만 버튼 눌림 1회 + cursor pointer */
  onClick?: () => void
  className?: string
}

/* 숫자의 원본은 docs/mascot/mascot.js 와 m2-design-tokens.md §8-1·§8-2 하나뿐이다.
   여기서 반올림하거나 "예쁜" 자릿수로 고치지 않는다 — 아트보드 12장의 정적 SVG 와 어긋난다. */

const R = 84
/** viewBox 0 0 240 240 의 몸 중심. 아트보드가 절대 좌표라 원본의 translate(120 120) 를 좌표에 녹인다 */
const CENTER = 120
const VIEW_BOX = '0 0 240 240'

const INK = '#171717'
const CORAL = '#FF6969'
/** 얼굴과 줄무늬는 포즈·팔레트와 무관하게 항상 흰색이다 (§8-1) */
const WHITE = '#FFFFFF'

const PALETTES: Record<MascotPalette, { body: string; cap: string; eye: string }> = {
  ink: { body: INK, cap: INK, eye: INK },
  coral: { body: CORAL, cap: CORAL, eye: CORAL },
  coralCap: { body: INK, cap: CORAL, eye: INK },
}

const CAP_SIZE = { capW: 0.41451, capH: 0.21762, capRx: 0.06218 }

const STRIPE_W = 0.03109
const STRIPE_PITCH = 0.1153
const STRIPE_COUNT = 13
const STRIPE_ORIGIN = -6
const DIAL_HZ = 1.1
const STRIPE_INDICES = Array.from({ length: STRIPE_COUNT }, (_stripe, index) => index)

/** 포즈 전환 지수 ease-out 계수의 기본값. 오버슈트 없음 (§8-1) */
const LAMBDA = 8
const BLINK_SECONDS = 0.14
const PRESS_SECONDS = 0.26
/** 눌림은 아랫변 고정, 윗면만 1 → 0.58 */
const PRESS_SCALE = 0.42
const BOUNCE_HZ = 14
const BOUNCE_AMOUNT = 0.018

/** 눈웃음 정도(0–1)의 지수 접근 계수. 포즈 λ 와 따로 간다 */
const SMILE_LAMBDA = 4.5
/** 이보다 작으면 원래 캡슐 rect 를 그린다 */
const SMILE_VISIBLE = 0.002
/** 웃는 동안 눈 중심을 가운데에서 1.18배 바깥으로 */
const SMILE_SPREAD = 0.18
/* 아치 모양은 정규화 값이 아니라 240 좌표 그대로다 (§8-1) */
const SMILE_HALF_WIDTH = 11.5
const SMILE_END_Y = 4
const SMILE_PEAK_Y = -5
const SMILE_HANDLE = 0.4

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

interface PoseValues {
  innerX: number
  innerY: number
  innerRx: number
  innerRy: number
  eyeLX: number
  eyeLY: number
  eyeLW: number
  eyeLH: number
  eyeLRot: number
  eyeRX: number
  eyeRY: number
  eyeRW: number
  eyeRH: number
  eyeRRot: number
  capX: number
  capY: number
  capRot: number
  capW: number
  capH: number
  capRx: number
  open: number
  bounce: number
  dial: number
}

const FRONT: PoseValues = {
  innerX: 0,
  innerY: -0.0725,
  innerRx: 0.782,
  innerRy: 0.762,
  eyeLX: -0.2485,
  eyeLY: -0.15,
  eyeLW: 0.176,
  eyeLH: 0.456,
  eyeLRot: 0,
  eyeRX: 0.2485,
  eyeRY: -0.15,
  eyeRW: 0.176,
  eyeRH: 0.456,
  eyeRRot: 0,
  capX: -0.46691,
  capY: -1.06198,
  capRot: -22,
  ...CAP_SIZE,
  open: 1,
  bounce: 0,
  dial: 0,
}

const LEFT: PoseValues = {
  ...FRONT,
  innerX: -0.155,
  innerY: -0.031,
  eyeLX: -0.674,
  eyeLY: -0.088,
  eyeLW: 0.155,
  eyeLH: 0.394,
  eyeRX: -0.29,
  eyeRY: -0.088,
  capX: -0.26128,
  capY: -1.122,
  capRot: -13,
}

const RIGHT: PoseValues = {
  ...FRONT,
  innerX: 0.155,
  innerY: -0.031,
  eyeLX: 0.29,
  eyeLY: -0.088,
  eyeRX: 0.674,
  eyeRY: -0.088,
  eyeRW: 0.155,
  eyeRH: 0.394,
  capX: -0.38736,
  capY: -1.08592,
  capRot: -19,
}

const SQUINT: PoseValues = {
  ...FRONT,
  eyeLX: -0.3264,
  eyeLY: -0.122,
  eyeLW: 0.456,
  eyeLH: 0.1244,
  eyeRX: 0.3264,
  eyeRY: -0.122,
  eyeRW: 0.456,
  eyeRH: 0.1244,
}

const UP_LEFT: PoseValues = {
  ...FRONT,
  innerX: -0.1036,
  innerY: -0.1347,
  eyeLX: -0.5832,
  eyeLY: -0.4381,
  eyeLW: 0.1554,
  eyeLH: 0.3678,
  eyeLRot: 12.918,
  eyeRX: -0.2178,
  eyeRY: -0.3786,
  eyeRW: 0.1762,
  eyeRH: 0.456,
  eyeRRot: 8.008,
  capX: -0.1211,
  capY: -1.14896,
  capRot: -6,
}

const UP_RIGHT: PoseValues = {
  ...FRONT,
  innerX: 0.1036,
  innerY: -0.1347,
  eyeLX: 0.2178,
  eyeLY: -0.3786,
  eyeLW: 0.1762,
  eyeLH: 0.456,
  eyeLRot: -8.008,
  eyeRX: 0.5832,
  eyeRY: -0.4381,
  eyeRW: 0.1554,
  eyeRH: 0.3678,
  eyeRRot: -12.918,
  capX: -0.68347,
  capY: -0.94451,
  capRot: -34,
}

/* 포즈는 8개다. 원본의 별칭 thinking·curious·happy 는 여기에도 타입에도 없다 (§8-2) —
   필요하면 호출부가 pose={isThinking ? "left" : "idle"} 로 푼다. */
const POSES: Record<MascotPose, PoseValues> = {
  idle: FRONT,
  left: LEFT,
  right: RIGHT,
  squint: SQUINT,
  upLeft: UP_LEFT,
  upRight: UP_RIGHT,
  talking: { ...FRONT, bounce: 1 },
  dial: { ...FRONT, dial: 1 },
}

const POSE_KEYS = Object.keys(FRONT) as Array<keyof PoseValues>

function targetPose(pose: MascotPose, dial: boolean | undefined): PoseValues {
  const values = POSES[pose]
  return dial === undefined ? values : { ...values, dial: dial ? 1 : 0 }
}

/** 한 프레임에서 실제로 그리는 값. pose 는 목표가 아니라 지금 보간된 자세다 */
interface MascotFrame {
  pose: PoseValues
  smile: number
  blink: number
  press: number
  bounce: number
  dialShift: number
}

/** rAF 사이에 들고 다니는 가변 상태. 이 객체를 바꾸는 것만으로는 리렌더가 나지 않는다 */
interface MascotAnimation {
  pose: PoseValues
  smile: number
  time: number
  last: number
  blinkT: number
  nextBlink: number
  pendingDouble: boolean
  pressT: number
  nextPress: number
  dialPhase: number
}

function createAnimation(pose: PoseValues, smile: number): MascotAnimation {
  return {
    pose,
    smile,
    time: 0,
    last: 0,
    blinkT: -1,
    nextBlink: 1.8 + Math.random() * 1.4,
    pendingDouble: false,
    pressT: -1,
    nextPress: 3.2 + Math.random() * 2.2,
    dialPhase: 0,
  }
}

/** 줄이기를 켜면 목표 포즈를 바로 그린다 — 깜빡임·눌림·bounce·줄무늬 스크롤 전부 0 (§8-5) */
function stillFrame(pose: PoseValues, smile: number): MascotFrame {
  return { pose, smile, blink: 0, press: 0, bounce: 0, dialShift: 0 }
}

/* 줄이기 설정은 한 번 읽고 마는 값이 아니라 **바깥 스토어**다 (§8-4). useSyncExternalStore 로 묶으면
   구독·해제·첫 스냅샷이 한 자리에 모이고, 이펙트 안에서 setState 하는 계단식 렌더가 사라진다. */
function subscribeReducedMotion(onStoreChange: () => void): () => void {
  // jsdom 처럼 matchMedia 가 없는 환경이 있다
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onStoreChange)
  return () => {
    query.removeEventListener('change', onStoreChange)
  }
}

function getReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION).matches
}

/** 서버에는 사용자 설정이 없다. 움직이는 쪽으로 그리고 클라이언트에서 맞춘다 */
function getServerReducedMotion(): boolean {
  return false
}

function expApproach(current: number, target: number, dt: number, lambda: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

function approach(current: PoseValues, target: PoseValues, dt: number, lambda: number): PoseValues {
  const next = { ...current }
  for (const key of POSE_KEYS) {
    next[key] = expApproach(current[key], target[key], dt, lambda)
  }
  return next
}

function blinkEnvelope(t: number): number {
  if (t < 0) return 0
  if (t < 0.32) {
    const rise = t / 0.32
    return rise * rise * (3 - 2 * rise)
  }
  if (t < 0.48) return 1
  const fall = (t - 0.48) / 0.52
  return 1 - fall * fall * (3 - 2 * fall)
}

function pressEnvelope(t: number): number {
  if (t < 0) return 0
  if (t < 0.34) {
    const rise = t / 0.34
    return rise * rise * (3 - 2 * rise)
  }
  if (t < 0.52) return 1
  const fall = (t - 0.52) / 0.48
  return 1 - fall * fall * (3 - 2 * fall)
}

/** 원본 `_render()` 의 toFixed 와 같은 자릿수다. 숫자로 돌려줘야 120.00 이 아니라 120 이 나온다 */
function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

interface EyeAttributes {
  x: number
  y: number
  width: number
  height: number
  rx: number
  transform: string | undefined
}

/** 눈 캡슐. 반경은 min(w, h)/2, 회전은 **회전 전 w×h 의 중심** 기준이다 (§8-1) */
function eyeAttributes(nx: number, ny: number, nw: number, nh: number, rot: number): EyeAttributes {
  const w = nw * R
  const h = nh * R
  const cx = CENTER + nx * R
  const cy = CENTER + ny * R
  return {
    x: round(cx - w / 2, 2),
    y: round(cy - h / 2, 2),
    width: round(w, 2),
    height: round(h, 2),
    rx: round(Math.min(w, h) / 2, 2),
    transform: rot === 0 ? undefined : `rotate(${round(rot, 1)} ${round(cx, 2)} ${round(cy, 2)})`,
  }
}

interface SmileAttributes {
  d: string
  strokeWidth: number
}

/**
 * 눈웃음 아치. 뜬 눈도 같은 3차 곡선의 퇴화형(아래 끝 → 위 → 아래 끝 세로선)으로 보고
 * 두 모양을 같은 점끼리 보간한다. 그래서 눈이 사라졌다 나타나지 않고 이어서 휜다.
 * 선 굵기가 캡슐 폭이고 끝이 둥글어서 smile 0 의 세로선은 캡슐과 같은 모양이 된다.
 * 회전은 넣지 않는다 — 원본 morph 와 같다.
 */
function smileAttributes(
  nx: number,
  ny: number,
  nw: number,
  nh: number,
  open: number,
  smile: number,
): SmileAttributes {
  const w = nw * R
  const h = Math.max(nh * R * open, w)
  const half = (h - w) / 2
  const cx = CENTER + nx * R * (1 + SMILE_SPREAD * smile)
  const cy = CENTER + ny * R
  // 두 제어점이 같으면 곡선 꼭대기는 끝점과 제어점의 1:3 지점이다. 5/3 이어야 꼭대기가 cy - half 에 닿는다
  const k = (5 / 3) * half
  const lerp = (from: number, to: number) => round(from + (to - from) * smile, 2)
  const x0 = lerp(cx, cx - SMILE_HALF_WIDTH)
  const y0 = lerp(cy + half, cy + SMILE_END_Y)
  const c1x = lerp(cx, cx - SMILE_HALF_WIDTH * SMILE_HANDLE)
  const c2x = lerp(cx, cx + SMILE_HALF_WIDTH * SMILE_HANDLE)
  const cy1 = lerp(cy - k, cy + SMILE_PEAK_Y)
  const x3 = lerp(cx, cx + SMILE_HALF_WIDTH)
  return {
    d: `M${x0} ${y0} C${c1x} ${cy1} ${c2x} ${cy1} ${x3} ${y0}`,
    strokeWidth: round(w, 2),
  }
}

/** 눌림이 없을 때는 아트보드의 정적 SVG 와 글자 그대로 같은 transform 을 낸다 */
function capTransform(pose: PoseValues, press: number): string {
  const x = round(CENTER + pose.capX * R, 2)
  const y = round(CENTER + pose.capY * R, 2)
  const base = `translate(${x} ${y}) rotate(${round(pose.capRot, 3)})`
  if (press === 0) return base
  // 아랫변을 고정하려고 축을 높이 절반만큼 내렸다가 되돌린다
  const pivot = round((pose.capH * R) / 2, 2)
  const scaleY = round(1 - press * PRESS_SCALE, 4)
  return `${base} translate(0 ${pivot}) scale(1 ${scaleY}) translate(0 ${-pivot})`
}

/** talking 의 세로 숨. 몸 중심을 축으로 눌렀다 펴는 거라 좌표에 CENTER 를 되돌려 끼운다 */
function puppetTransform(bounce: number): string | undefined {
  if (bounce === 0) return undefined
  const scaleY = round(1 + bounce, 4)
  return `translate(${CENTER} ${CENTER}) scale(1 ${scaleY}) translate(${-CENTER} ${-CENTER})`
}

/**
 * 링 마스코트. `docs/mascot/mascot.js` 를 그대로 옮긴 것이고 숫자는 §8-1·§8-2 가 원본이다.
 *
 * 인스턴스마다 자기 `useEffect` + 자기 rAF 를 돈다 — 전역 instances 배열은 언마운트 누수를 만든다 (§8-4).
 * `prefers-reduced-motion` 은 한 번 읽고 마는 게 아니라 **구독**한다. OS 설정을 바꾸면 바로 멈춘다.
 *
 * 금지: 그라데이션·그림자·입·눈썹·커서 추적·몸 회전. 승인 워크벤치 본문에는 넣지 않는다 (§8-7).
 */
export function Mascot({
  ref,
  pose = 'idle',
  smile = false,
  dial,
  lambda = LAMBDA,
  dialHz = DIAL_HZ,
  palette = 'ink',
  size = 96,
  label,
  onClick,
  className,
}: MascotProps) {
  // useId 는 SSR·StrictMode 이중 마운트에서도 어긋나지 않는다. 전역 카운터를 쓰지 않는다 (§8-4)
  const faceClipId = `mascot-face-${useId()}`
  const capClipId = `mascot-cap-${useId()}`

  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getServerReducedMotion,
  )
  const smileTarget = smile ? 1 : 0
  const [animated, setAnimated] = useState<MascotFrame>(() =>
    stillFrame(targetPose(pose, dial), smileTarget),
  )

  // 가변 상태는 렌더 밖에서만 읽는다 — 이펙트와 클릭 핸들러가 전부다
  const animationRef = useRef<MascotAnimation | null>(null)

  useEffect(() => {
    const target = targetPose(pose, dial)
    const animation = (animationRef.current ??= createAnimation(target, smileTarget))

    // 줄이기를 켜면 루프를 아예 돌리지 않는다. 포즈 전환도 애니메이션하지 않는다 (§8-5)
    if (reduced) {
      animation.pose = target
      animation.smile = smileTarget
      animation.blinkT = -1
      animation.pressT = -1
      return
    }

    animation.last = 0
    let raf = 0

    const step = (now: number) => {
      if (animation.last === 0) animation.last = now
      const dt = Math.min((now - animation.last) / 1000, 0.05)
      animation.last = now
      animation.time += dt

      animation.pose = approach(animation.pose, target, dt, lambda)
      animation.smile = expApproach(animation.smile, smileTarget, dt, SMILE_LAMBDA)
      if (animation.pose.dial > 0.02 || target.dial > 0.02) {
        animation.dialPhase += dt * dialHz
      }

      if (animation.blinkT < 0) {
        animation.nextBlink -= dt
        if (animation.nextBlink <= 0) animation.blinkT = 0
      } else {
        animation.blinkT += dt / BLINK_SECONDS
        if (animation.blinkT >= 1) {
          if (animation.pendingDouble) {
            animation.pendingDouble = false
            animation.blinkT = 0
          } else {
            animation.blinkT = -1
            animation.nextBlink = 2.1 + Math.random() * 2.3
            // 16% 로 더블 블링크 — 0.09초 뒤 한 번 더
            if (Math.random() < 0.16) {
              animation.pendingDouble = true
              animation.nextBlink = 0.09
            }
          }
        }
      }

      if (animation.pressT < 0) {
        animation.nextPress -= dt
        if (animation.nextPress <= 0) animation.pressT = 0
      } else {
        animation.pressT += dt / PRESS_SECONDS
        if (animation.pressT >= 1) {
          animation.pressT = -1
          animation.nextPress = 4.6 + Math.random() * 3.8
        }
      }

      setAnimated({
        pose: animation.pose,
        smile: animation.smile,
        blink: blinkEnvelope(animation.blinkT),
        press: pressEnvelope(animation.pressT),
        bounce: Math.sin(animation.time * BOUNCE_HZ) * BOUNCE_AMOUNT * animation.pose.bounce,
        dialShift: (((animation.dialPhase % 1) + 1) % 1) * STRIPE_PITCH * R,
      })

      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [pose, dial, smileTarget, lambda, dialHz, reduced])

  const press = () => {
    const animation = animationRef.current
    if (animation !== null && !reduced) animation.pressT = 0
  }

  useImperativeHandle(ref, () => ({ press }))

  const handleClick = () => {
    press()
    onClick?.()
  }

  // 줄이기를 켠 화면은 보간값이 아니라 목표 포즈 자체다 — 상태를 거치지 않고 여기서 가른다
  const frame = reduced ? stillFrame(targetPose(pose, dial), smileTarget) : animated
  const colors = PALETTES[palette]
  const current = frame.pose

  const innerCx = round(CENTER + current.innerX * R, 2)
  const innerCy = round(CENTER + current.innerY * R, 2)
  const innerRx = round(current.innerRx * R, 2)
  const innerRy = round(current.innerRy * R, 2)

  const capWidth = round(current.capW * R, 2)
  const capHeight = round(current.capH * R, 2)
  const capRadius = round(current.capRx * R, 2)
  const capX = round((-current.capW * R) / 2, 2)
  const capY = round((-current.capH * R) / 2, 2)

  const stripeWidth = STRIPE_W * R
  const stripeHeight = current.capH * R + 2
  const stripePitch = STRIPE_PITCH * R

  // 깜빡임은 눈 높이만 줄인다. 0.08 아래로는 내려가지 않아 캡슐이 아주 사라지지는 않는다
  const open = Math.max(0.08, current.open * (1 - frame.blink * 0.92))
  const eyeL = eyeAttributes(
    current.eyeLX,
    current.eyeLY,
    current.eyeLW,
    current.eyeLH * open,
    current.eyeLRot,
  )
  const eyeR = eyeAttributes(
    current.eyeRX,
    current.eyeRY,
    current.eyeRW,
    current.eyeRH * open,
    current.eyeRRot,
  )

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={VIEW_BOX}
      fill="none"
      focusable="false"
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      // 타이머 버튼이 viewBox 밖으로 나간다. overflow 를 빼면 버튼이 잘린다 (§8-4)
      style={{
        display: 'block',
        overflow: 'visible',
        cursor: onClick === undefined ? undefined : 'pointer',
      }}
      onClick={onClick === undefined ? undefined : handleClick}
    >
      <defs>
        <clipPath id={faceClipId}>
          <ellipse cx={innerCx} cy={innerCy} rx={innerRx} ry={innerRy} />
        </clipPath>
        <clipPath id={capClipId}>
          <rect
            x={capX}
            y={capY}
            width={capWidth}
            height={capHeight}
            rx={capRadius}
            ry={capRadius}
          />
        </clipPath>
      </defs>
      <g data-part="puppet" transform={puppetTransform(frame.bounce)}>
        <circle data-part="outer" cx={CENTER} cy={CENTER} r={R} fill={colors.body} />
        <ellipse
          data-part="inner"
          cx={innerCx}
          cy={innerCy}
          rx={innerRx}
          ry={innerRy}
          fill={WHITE}
        />
        <g data-part="cap-g" transform={capTransform(current, frame.press)}>
          <rect
            data-part="cap"
            x={capX}
            y={capY}
            width={capWidth}
            height={capHeight}
            rx={capRadius}
            ry={capRadius}
            fill={colors.cap}
          />
          <g data-part="dial" clipPath={`url(#${capClipId})`} opacity={round(current.dial, 3)}>
            <g data-part="dial-shift" transform={`translate(${round(frame.dialShift, 2)} 0)`}>
              {STRIPE_INDICES.map((index) => (
                <rect
                  key={index}
                  x={round((STRIPE_ORIGIN + index) * stripePitch - stripeWidth / 2, 2)}
                  y={round(-stripeHeight / 2, 2)}
                  width={round(stripeWidth, 2)}
                  height={round(stripeHeight, 2)}
                  fill={WHITE}
                />
              ))}
            </g>
          </g>
        </g>
        {/* 눈만 얼굴 clip 에 든다. 타이머 버튼은 들어가지 않는다 (§8-7) */}
        <g data-part="eyes" clipPath={`url(#${faceClipId})`}>
          {frame.smile > SMILE_VISIBLE ? (
            <>
              <path
                data-part="smile-l"
                {...smileAttributes(
                  current.eyeLX,
                  current.eyeLY,
                  current.eyeLW,
                  current.eyeLH,
                  open,
                  frame.smile,
                )}
                fill="none"
                stroke={colors.eye}
                strokeLinecap="round"
              />
              <path
                data-part="smile-r"
                {...smileAttributes(
                  current.eyeRX,
                  current.eyeRY,
                  current.eyeRW,
                  current.eyeRH,
                  open,
                  frame.smile,
                )}
                fill="none"
                stroke={colors.eye}
                strokeLinecap="round"
              />
            </>
          ) : (
            <>
              <rect data-part="eye-l" {...eyeL} fill={colors.eye} />
              <rect data-part="eye-r" {...eyeR} fill={colors.eye} />
            </>
          )}
        </g>
      </g>
    </svg>
  )
}
