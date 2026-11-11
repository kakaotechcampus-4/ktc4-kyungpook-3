/** Python `str.strip()` 의 공백. JS `trim()` 과 달리 \x1c-\x1f·\x85 를 지우고 \ufeff 는 남긴다. BE 가 앞뒤 공백을 빼는 칸을 같게 본다 */
export const PYTHON_STRIP =
  // eslint-disable-next-line no-control-regex
  /^[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g

export function pythonStrip(text: string): string {
  return text.replace(PYTHON_STRIP, '')
}
