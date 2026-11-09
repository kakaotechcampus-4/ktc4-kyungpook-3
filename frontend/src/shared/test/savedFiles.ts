import { onTestFinished, vi } from 'vitest'

export interface SavedFile {
  filename: string
  type: string
  text: () => Promise<string>
}

/**
 * 브라우저 내려받기(임시 링크 누르기)를 가로채 저장된 파일을 적는다. jsdom 에는 `URL.createObjectURL` 이 없다.
 * 테스트가 끝나면 되돌린다
 */
export function captureSavedFiles(): SavedFile[] {
  const saved: SavedFile[] = []
  const blobs = new Map<string, Blob>()
  let next = 0
  const original = {
    create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
    revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
  }
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      next += 1
      const url = `blob:saved-${next}`
      blobs.set(url, blob)
      return url
    },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.getAttribute('href') ?? '')
    if (blob === undefined || this.download === '') return
    saved.push({ filename: this.download, type: blob.type, text: () => blob.text() })
  })
  onTestFinished(() => {
    click.mockRestore()
    for (const [name, descriptor] of [
      ['createObjectURL', original.create],
      ['revokeObjectURL', original.revoke],
    ] as const) {
      if (descriptor === undefined) Reflect.deleteProperty(URL, name)
      else Object.defineProperty(URL, name, descriptor)
    }
  })
  return saved
}
