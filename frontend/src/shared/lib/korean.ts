/** 마지막 글자에 받침이 있으면 true, 없으면 false. 한글로 끝나지 않으면 null 이다 */
function hasFinalConsonant(word: string): boolean | null {
  const last = word.trim().at(-1)
  if (last === undefined) return null
  const code = last.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return null
  return code % 28 !== 0
}

/** 받침이 있으면 `을`, 없으면 `를`. 한글로 끝나지 않으면 둘 다 적는다 */
export function objectParticle(word: string): string {
  const final = hasFinalConsonant(word)
  return final === null ? '을(를)' : final ? '을' : '를'
}

/** 받침이 있으면 `은`, 없으면 `는`. 한글로 끝나지 않으면 둘 다 적는다 */
export function topicParticle(word: string): string {
  const final = hasFinalConsonant(word)
  return final === null ? '은(는)' : final ? '은' : '는'
}
