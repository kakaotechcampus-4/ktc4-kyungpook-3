/** WAI-ARIA 탭 패턴의 키. 화살표는 끝에서 처음으로 돌아가고 Home·End 는 처음·끝이다. 탭 키가 아니면 null */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count
    case 'ArrowLeft':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
