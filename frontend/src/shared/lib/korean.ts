/** 받침이 있으면 `을`, 없으면 `를`. 한글로 끝나지 않으면 둘 다 적는다 */
export function objectParticle(word: string): string {
  const last = word.trim().at(-1)
  if (last === undefined) return '을(를)'
  const code = last.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return '을(를)'
  return code % 28 === 0 ? '를' : '을'
}
