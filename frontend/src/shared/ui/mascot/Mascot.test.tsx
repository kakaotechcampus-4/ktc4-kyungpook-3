import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Mascot } from './Mascot'
import type { MascotPalette, MascotPose } from './Mascot'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

const ALL_POSES: MascotPose[] = [
  'idle',
  'left',
  'right',
  'squint',
  'upLeft',
  'upRight',
  'talking',
  'dial',
]

/* jsdom 에는 matchMedia 가 아예 없다. 줄이기를 켠 사람을 흉내 내려면 테스트가 직접 깔아야 한다.
   setup.ts 는 T0 소유라 손대지 않고 이 파일 안에서만 세운다. */
function installMatchMedia(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches: initial,
    media: REDUCED_MOTION,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }

  vi.stubGlobal('matchMedia', () => query as unknown as MediaQueryList)

  return {
    listenerCount: () => listeners.size,
    emit(next: boolean) {
      query.matches = next
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent)
    },
  }
}

function part(container: HTMLElement, name: string): Element {
  const node = container.querySelector(`[data-part="${name}"]`)
  if (node === null) throw new Error(`data-part="${name}" 가 없다`)
  return node
}

function svgOf(container: HTMLElement): SVGSVGElement {
  const node = container.querySelector('svg')
  if (node === null) throw new Error('svg 가 없다')
  return node
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Mascot', () => {
  /* §8-3 의 9개 숫자. Login.dc.html 의 정적 SVG 와 글자 그대로 같아야 포팅이 맞는 것이다. */
  it('draws idle at the nine artboard numbers', () => {
    const { container } = render(<Mascot pose="idle" />)

    const inner = part(container, 'inner')
    expect(inner).toHaveAttribute('cx', '120')
    expect(inner).toHaveAttribute('cy', '113.91')
    expect(inner).toHaveAttribute('rx', '65.69')
    expect(inner).toHaveAttribute('ry', '64.01')

    expect(part(container, 'cap-g')).toHaveAttribute(
      'transform',
      'translate(80.78 30.79) rotate(-22)',
    )

    const cap = part(container, 'cap')
    expect(cap).toHaveAttribute('width', '34.82')
    expect(cap).toHaveAttribute('height', '18.28')
    expect(cap).toHaveAttribute('rx', '5.22')

    const eyeL = part(container, 'eye-l')
    expect(eyeL).toHaveAttribute('x', '91.73')
    expect(eyeL).toHaveAttribute('y', '88.25')
    expect(eyeL).toHaveAttribute('rx', '7.39')
  })

  it('keeps idle as the default pose', () => {
    const { container } = render(<Mascot />)

    expect(part(container, 'inner')).toHaveAttribute('cy', '113.91')
    expect(part(container, 'eye-l')).toHaveAttribute('x', '91.73')
  })

  /* §8-3 의 두 번째 검산 — Signup.dc.html 의 squint 눈 */
  it('draws squint at the Signup artboard numbers', () => {
    const { container } = render(<Mascot pose="squint" />)
    const eyeL = part(container, 'eye-l')

    expect(eyeL).toHaveAttribute('x', '73.43')
    expect(eyeL).toHaveAttribute('y', '104.53')
    expect(eyeL).toHaveAttribute('width', '38.3')
    expect(eyeL).toHaveAttribute('height', '10.45')
    expect(eyeL).toHaveAttribute('rx', '5.22')
  })

  it('draws the body as a circle of r 84 at the viewBox centre', () => {
    const { container } = render(<Mascot />)
    const outer = part(container, 'outer')

    expect(outer).toHaveAttribute('cx', '120')
    expect(outer).toHaveAttribute('cy', '120')
    expect(outer).toHaveAttribute('r', '84')
    expect(svgOf(container)).toHaveAttribute('viewBox', '0 0 240 240')
  })

  it('stacks outer, inner, cap and eyes in that order', () => {
    const { container } = render(<Mascot />)
    const layers = Array.from(part(container, 'puppet').children)

    expect(layers.map((layer) => layer.getAttribute('data-part'))).toEqual([
      'outer',
      'inner',
      'cap-g',
      'eyes',
    ])
  })

  it('clips the eyes but not the cap', () => {
    const { container } = render(<Mascot />)
    const eyes = part(container, 'eyes')
    const cap = part(container, 'cap-g')

    expect(eyes.getAttribute('clip-path')).toMatch(/^url\(#mascot-face-/)
    expect(cap.getAttribute('clip-path')).toBeNull()
    expect(eyes.contains(cap)).toBe(false)
  })

  it('puts the dial stripes under the cap clip', () => {
    const { container } = render(<Mascot pose="dial" />)
    const dial = part(container, 'dial')

    expect(dial.getAttribute('clip-path')).toMatch(/^url\(#mascot-cap-/)
    expect(part(container, 'cap-g').contains(dial)).toBe(true)
    expect(part(container, 'dial-shift').children).toHaveLength(13)
  })

  it('leaves the face and the stripes white in every palette', () => {
    const palettes: MascotPalette[] = ['ink', 'coral', 'coralCap']

    for (const palette of palettes) {
      const { container, unmount } = render(<Mascot palette={palette} pose="dial" />)

      expect(part(container, 'inner')).toHaveAttribute('fill', '#FFFFFF')
      for (const stripe of Array.from(part(container, 'dial-shift').children)) {
        expect(stripe).toHaveAttribute('fill', '#FFFFFF')
      }
      unmount()
    }
  })

  it('inks the body, the cap and the eyes by default', () => {
    const { container } = render(<Mascot />)

    expect(part(container, 'outer')).toHaveAttribute('fill', '#171717')
    expect(part(container, 'cap')).toHaveAttribute('fill', '#171717')
    expect(part(container, 'eye-l')).toHaveAttribute('fill', '#171717')
    expect(part(container, 'eye-r')).toHaveAttribute('fill', '#171717')
  })

  it('paints the whole mascot coral', () => {
    const { container } = render(<Mascot palette="coral" />)

    expect(part(container, 'outer')).toHaveAttribute('fill', '#FF6969')
    expect(part(container, 'cap')).toHaveAttribute('fill', '#FF6969')
    expect(part(container, 'eye-l')).toHaveAttribute('fill', '#FF6969')
  })

  it('paints only the cap coral in coralCap', () => {
    const { container } = render(<Mascot palette="coralCap" />)

    expect(part(container, 'outer')).toHaveAttribute('fill', '#171717')
    expect(part(container, 'cap')).toHaveAttribute('fill', '#FF6969')
    expect(part(container, 'eye-l')).toHaveAttribute('fill', '#171717')
  })

  it('falls back to 96px and lets the cap overflow the viewBox', () => {
    const { container } = render(<Mascot />)
    const svg = svgOf(container)

    expect(svg).toHaveAttribute('width', '96')
    expect(svg).toHaveAttribute('height', '96')
    expect(svg.style.overflow).toBe('visible')
    expect(svg.style.display).toBe('block')
  })

  it('takes the size the caller asks for', () => {
    const { container } = render(<Mascot size={148} />)
    const svg = svgOf(container)

    expect(svg).toHaveAttribute('width', '148')
    expect(svg).toHaveAttribute('height', '148')
  })

  it('hides itself from assistive technology without a label', () => {
    const { container } = render(<Mascot />)
    const svg = svgOf(container)

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
    expect(svg).not.toHaveAttribute('aria-label')
  })

  it('becomes an image with a label', () => {
    const { container } = render(<Mascot label="매스" />)
    const svg = svgOf(container)

    expect(svg).toHaveAttribute('role', 'img')
    expect(svg).toHaveAttribute('aria-label', '매스')
    expect(svg).not.toHaveAttribute('aria-hidden')
  })

  it('shows no pointer cursor without onClick', () => {
    const { container } = render(<Mascot />)

    expect(svgOf(container).style.cursor).toBe('')
  })

  it('shows a pointer cursor and calls back with onClick', async () => {
    const onClick = vi.fn()
    const { container } = render(<Mascot onClick={onClick} />)
    const svg = svgOf(container)

    expect(svg.style.cursor).toBe('pointer')
    await userEvent.click(svg)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the caller className', () => {
    const { container } = render(<Mascot className="mt-12" />)

    expect(svgOf(container)).toHaveClass('mt-12')
  })

  it('gives every instance its own clip ids', () => {
    const { container } = render(
      <>
        <Mascot />
        <Mascot />
      </>,
    )
    const ids = Array.from(container.querySelectorAll('clipPath')).map((clip) => clip.id)

    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })

  it.each(ALL_POSES)('renders the %s pose', (pose) => {
    const { container } = render(<Mascot pose={pose} />)

    expect(part(container, 'outer')).toBeInTheDocument()
    expect(part(container, 'eye-l')).toBeInTheDocument()
  })

  it('keeps the aliases off the pose type', () => {
    // @ts-expect-error thinking 은 별칭이다 — 타입에 없다 (§8-2). 호출부가 'left' 로 푼다
    const alias: MascotPose = 'thinking'

    expect(ALL_POSES).not.toContain(alias)
    expect(ALL_POSES).toHaveLength(8)
  })

  it('never draws a gradient, a shadow, a mouth or eyebrows', () => {
    const { container } = render(<Mascot pose="talking" />)
    const svg = svgOf(container)

    expect(svg.querySelector('linearGradient, radialGradient, filter, path, polyline')).toBeNull()
    expect(part(container, 'puppet').children).toHaveLength(4)
  })

  describe('animation', () => {
    it('runs a rAF loop when motion is allowed', () => {
      installMatchMedia(false)
      const raf = vi.spyOn(window, 'requestAnimationFrame')

      render(<Mascot />)

      expect(raf).toHaveBeenCalled()
    })

    it('runs no rAF loop under prefers-reduced-motion', () => {
      installMatchMedia(true)
      const raf = vi.spyOn(window, 'requestAnimationFrame')

      render(<Mascot pose="squint" />)

      expect(raf).not.toHaveBeenCalled()
    })

    it('snaps straight to the target pose under prefers-reduced-motion', () => {
      installMatchMedia(true)

      const { container } = render(<Mascot pose="squint" />)

      // 전환을 애니메이션하지 않는다 — 첫 프레임이 곧 목표 포즈다 (§8-5)
      expect(part(container, 'eye-l')).toHaveAttribute('x', '73.43')
      expect(part(container, 'eye-l')).toHaveAttribute('height', '10.45')
    })

    it('shows the dial stripes but never scrolls them under prefers-reduced-motion', () => {
      installMatchMedia(true)

      const { container } = render(<Mascot pose="dial" />)

      expect(part(container, 'dial')).toHaveAttribute('opacity', '1')
      expect(part(container, 'dial-shift')).toHaveAttribute('transform', 'translate(0 0)')
    })

    it('holds the pose still under prefers-reduced-motion — no blink, press or bounce', () => {
      installMatchMedia(true)

      const { container } = render(<Mascot pose="talking" />)

      // 눈은 활짝, 버튼은 눌리지 않은 transform, 몸은 scale 없음
      expect(part(container, 'eye-l')).toHaveAttribute('height', '38.3')
      expect(part(container, 'cap-g')).toHaveAttribute(
        'transform',
        'translate(80.78 30.79) rotate(-22)',
      )
      expect(part(container, 'puppet')).not.toHaveAttribute('transform')
    })

    it('stops the loop when the OS setting flips to reduce', () => {
      const media = installMatchMedia(false)
      const cancel = vi.spyOn(window, 'cancelAnimationFrame')

      render(<Mascot />)
      expect(cancel).not.toHaveBeenCalled()

      act(() => {
        media.emit(true)
      })

      expect(cancel).toHaveBeenCalled()
    })

    it('cancels the loop and unsubscribes on unmount', () => {
      const media = installMatchMedia(false)
      const cancel = vi.spyOn(window, 'cancelAnimationFrame')

      const { unmount } = render(<Mascot />)
      expect(media.listenerCount()).toBe(1)

      unmount()

      expect(cancel).toHaveBeenCalled()
      expect(media.listenerCount()).toBe(0)
    })

    it('survives a missing matchMedia', () => {
      const { container } = render(<Mascot />)

      expect(part(container, 'inner')).toHaveAttribute('cy', '113.91')
    })
  })
})
