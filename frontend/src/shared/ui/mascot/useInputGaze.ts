import { useCallback, useSyncExternalStore } from 'react'

type InputGaze = 'idle' | 'left' | 'right' | null

function subscribe(onChange: () => void) {
  document.addEventListener('focusin', onChange)
  document.addEventListener('focusout', onChange)
  window.addEventListener('resize', onChange)
  document.addEventListener('scroll', onChange, true)
  return () => {
    document.removeEventListener('focusin', onChange)
    document.removeEventListener('focusout', onChange)
    window.removeEventListener('resize', onChange)
    document.removeEventListener('scroll', onChange, true)
  }
}

function serverSnapshot(): InputGaze {
  return null
}

export function useInputGaze(mascot: SVGSVGElement | null): InputGaze {
  const snapshot = useCallback((): InputGaze => {
    const input = document.activeElement
    if (
      mascot === null ||
      !(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)
    )
      return null

    const face = mascot.getBoundingClientRect()
    const field = input.getBoundingClientRect()
    if (face.width === 0 || field.width === 0) return null
    const offset = field.x + field.width / 2 - (face.x + face.width / 2)
    return Math.abs(offset) < 1 ? 'idle' : offset < 0 ? 'left' : 'right'
  }, [mascot])

  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
